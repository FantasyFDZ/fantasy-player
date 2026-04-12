//! 音频分析调度。
//!
//! 流程：
//!   1. 检查 [`crate::db`] 的 `song_features` 表缓存命中
//!   2. 未命中 → 下载 audio_url 到临时文件
//!   3. spawn Python sidecar (`sidecar/audio_analyzer.py`) 进行 librosa 分析
//!   4. 解析结果，写入 `song_features` 缓存
//!
//! Python 解释器通过 [`find_python`] 查找——优先 python3.12（librosa 安装
//! 在这个版本），回退到 python3 / python3.11 / python3.13。
//!
//! Tauri command: [`analyze_song`] in `commands.rs`。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::Db;

// ---- errors ----------------------------------------------------------------

#[derive(Debug, Error)]
pub enum AnalyzeError {
    #[error("未找到 Python 3.12 解释器（librosa 所在版本）")]
    PythonNotFound,
    #[error("未找到 sidecar/audio_analyzer.py 脚本")]
    ScriptMissing,
    #[error("下载音频失败: {0}")]
    Download(#[from] reqwest::Error),
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),
    #[error("sidecar 错误: {0}")]
    Sidecar(String),
    #[error("DB 错误: {0}")]
    Db(#[from] crate::db::DbError),
}

// ---- types -----------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioFeatures {
    pub bpm: f64,
    /// BPM 置信度（Essentia beats_confidence，0-1 左右，>5 基本靠谱）
    #[serde(default)]
    pub bpm_confidence: f64,
    pub energy: f64,
    pub valence: f64,
    /// 调式，大调 "C"，小调 "Cm"（参考 Rekordbox 写法）
    pub key: String,
    /// 调式置信度（Essentia key_strength，0-1）
    #[serde(default)]
    pub key_confidence: f64,
    pub spectral_centroid: f64,
    pub spectral_bandwidth: f64,
    pub spectral_flatness: f64,
    pub spectral_rolloff: f64,
    pub zero_crossing_rate: f64,
}

#[derive(Debug, Deserialize)]
struct SidecarResponse {
    ok: bool,
    #[serde(default)]
    data: Option<AudioFeatures>,
    #[serde(default)]
    error: Option<String>,
}

// ---- discovery -------------------------------------------------------------

fn find_python() -> Result<PathBuf, AnalyzeError> {
    static CACHED: OnceCell<PathBuf> = OnceCell::new();
    if let Some(path) = CACHED.get() {
        return Ok(path.clone());
    }

    // Melody 依赖 librosa，在本机 python3.12 里已安装；其他版本作为回退
    let candidates = [
        "/opt/homebrew/bin/python3.12",
        "/opt/homebrew/bin/python3.11",
        "/usr/local/bin/python3.12",
        "/usr/local/bin/python3",
        "python3.12",
        "python3",
    ];

    for candidate in candidates {
        let path = PathBuf::from(candidate);
        // 校验该 Python 是否真的能 import librosa
        let ok = Command::new(&path)
            .args(["-c", "import librosa"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            let _ = CACHED.set(path.clone());
            return Ok(path);
        }
    }
    Err(AnalyzeError::PythonNotFound)
}

fn script_path() -> Result<PathBuf, AnalyzeError> {
    static CACHED: OnceCell<PathBuf> = OnceCell::new();
    if let Some(path) = CACHED.get() {
        return Ok(path.clone());
    }

    let manifest =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/audio_analyzer.py");
    if manifest.is_file() {
        let resolved = manifest.canonicalize().unwrap_or(manifest);
        let _ = CACHED.set(resolved.clone());
        return Ok(resolved);
    }

    // 兜底：相对于可执行文件（bundled 模式）
    if let Ok(exe) = std::env::current_exe() {
        for rel in [
            "../sidecar/audio_analyzer.py",
            "../../sidecar/audio_analyzer.py",
            "../Resources/sidecar/audio_analyzer.py",
        ] {
            let candidate = exe.parent().map(|p| p.join(rel)).unwrap_or_default();
            if candidate.is_file() {
                let resolved = candidate.canonicalize().unwrap_or(candidate);
                let _ = CACHED.set(resolved.clone());
                return Ok(resolved);
            }
        }
    }
    Err(AnalyzeError::ScriptMissing)
}

// ---- core logic ------------------------------------------------------------

/// 分析一首歌：先查 cache，未命中则下载 + 分析 + 写 cache。
/// 注意这是一个阻塞函数（下载用 blocking reqwest，python sidecar 是同步 spawn）——
/// 调用方应在 tokio spawn_blocking 里使用。
pub fn analyze_song_blocking(
    db: &Db,
    song_id: &str,
    audio_url: &str,
) -> Result<AudioFeatures, AnalyzeError> {
    if let Some(cached) = db.song_feature_get(song_id)? {
        eprintln!("[audio_analyzer] {} cache hit", song_id);
        return Ok(cached);
    }

    let t0 = Instant::now();

    // 下载到临时文件
    eprintln!("[audio_analyzer] {} downloading full audio…", song_id);
    let tmp = download_to_tempfile(audio_url)?;
    let dl_bytes = tmp.as_file().metadata().map(|m| m.len()).unwrap_or(0);
    let dl_elapsed = t0.elapsed();
    eprintln!(
        "[audio_analyzer] {} downloaded {:.1} KB in {:.2}s",
        song_id,
        dl_bytes as f64 / 1024.0,
        dl_elapsed.as_secs_f64()
    );

    // 分析
    let t_analyze = Instant::now();
    let features = run_sidecar(tmp.path())?;
    eprintln!(
        "[audio_analyzer] {} essentia+librosa analyzed in {:.2}s \
         (bpm={:.1} conf={:.2}, key={} conf={:.2})",
        song_id,
        t_analyze.elapsed().as_secs_f64(),
        features.bpm,
        features.bpm_confidence,
        features.key,
        features.key_confidence,
    );

    // 回写缓存
    db.song_feature_upsert(song_id, &features)?;
    eprintln!(
        "[audio_analyzer] {} total {:.2}s, cached to song_features",
        song_id,
        t0.elapsed().as_secs_f64()
    );

    drop(tmp);
    Ok(features)
}

fn download_to_tempfile(url: &str) -> Result<tempfile::NamedTempFile, AnalyzeError> {
    // 用 blocking reqwest client 避免把 tokio runtime 拖进这里
    let client = reqwest::blocking::Client::builder()
        .user_agent("melody/0.1.0")
        .build()?;
    let resp = client.get(url).send()?.error_for_status()?;
    let bytes = resp.bytes()?;

    // 保留 .mp3 扩展名让 librosa/audioread 正确识别
    let mut tmp = tempfile::Builder::new()
        .prefix("melody-audio-")
        .suffix(".mp3")
        .tempfile()?;
    tmp.write_all(&bytes)?;
    tmp.flush()?;
    Ok(tmp)
}

fn run_sidecar(audio_path: &Path) -> Result<AudioFeatures, AnalyzeError> {
    let python = find_python()?;
    let script = script_path()?;

    let mut child = Command::new(&python)
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // 写 request
    if let Some(mut stdin) = child.stdin.take() {
        let req = serde_json::json!({
            "audio_path": audio_path.to_string_lossy().to_string(),
        });
        stdin.write_all(req.to_string().as_bytes())?;
        stdin.write_all(b"\n")?;
    }

    let output = child.wait_with_output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let line = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();

    if line.is_empty() {
        return Err(AnalyzeError::Sidecar(format!(
            "sidecar 无输出 (exit {:?}, stderr: {})",
            output.status.code(),
            stderr.trim()
        )));
    }

    let resp: SidecarResponse = serde_json::from_str(line)?;
    if !resp.ok {
        return Err(AnalyzeError::Sidecar(
            resp.error.unwrap_or_else(|| "unknown sidecar error".into()),
        ));
    }
    resp.data.ok_or_else(|| {
        AnalyzeError::Sidecar("sidecar 返回 ok=true 但无 data".into())
    })
}

// ---- db cache integration --------------------------------------------------

impl Db {
    pub fn song_feature_get(
        &self,
        song_id: &str,
    ) -> Result<Option<AudioFeatures>, crate::db::DbError> {
        let conn = self.conn_lock();
        let mut stmt = conn.prepare(
            "SELECT bpm, COALESCE(bpm_confidence, 0), energy, valence,
                    key, COALESCE(key_confidence, 0),
                    spectral_centroid, spectral_bandwidth, spectral_flatness,
                    spectral_rolloff, zero_crossing_rate
             FROM song_features WHERE song_id = ?1",
        )?;
        let mut rows = stmt.query(rusqlite::params![song_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AudioFeatures {
                bpm: row.get(0)?,
                bpm_confidence: row.get(1)?,
                energy: row.get(2)?,
                valence: row.get(3)?,
                key: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                key_confidence: row.get(5)?,
                spectral_centroid: row.get(6)?,
                spectral_bandwidth: row.get(7)?,
                spectral_flatness: row.get(8)?,
                spectral_rolloff: row.get(9)?,
                zero_crossing_rate: row.get(10)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn song_feature_upsert(
        &self,
        song_id: &str,
        f: &AudioFeatures,
    ) -> Result<(), crate::db::DbError> {
        let conn = self.conn_lock();
        conn.execute(
            "INSERT INTO song_features
               (song_id, bpm, bpm_confidence, energy, valence,
                key, key_confidence,
                spectral_centroid, spectral_bandwidth, spectral_flatness,
                spectral_rolloff, zero_crossing_rate, analyzed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                     strftime('%s','now'))
             ON CONFLICT(song_id) DO UPDATE SET
               bpm = excluded.bpm,
               bpm_confidence = excluded.bpm_confidence,
               energy = excluded.energy,
               valence = excluded.valence,
               key = excluded.key,
               key_confidence = excluded.key_confidence,
               spectral_centroid = excluded.spectral_centroid,
               spectral_bandwidth = excluded.spectral_bandwidth,
               spectral_flatness = excluded.spectral_flatness,
               spectral_rolloff = excluded.spectral_rolloff,
               zero_crossing_rate = excluded.zero_crossing_rate,
               analyzed_at = strftime('%s','now')",
            rusqlite::params![
                song_id,
                f.bpm,
                f.bpm_confidence,
                f.energy,
                f.valence,
                f.key,
                f.key_confidence,
                f.spectral_centroid,
                f.spectral_bandwidth,
                f.spectral_flatness,
                f.spectral_rolloff,
                f.zero_crossing_rate,
            ],
        )?;
        Ok(())
    }
}
