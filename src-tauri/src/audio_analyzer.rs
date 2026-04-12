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
    // ---- Tier 0: 节奏 / 调式 ----
    pub bpm: f64,
    /// BPM 置信度 0-1，融合后的最终结果
    #[serde(default)]
    pub bpm_confidence: f64,
    /// 多算法的候选 BPM 数组（multifeature、Percival 等）
    #[serde(default)]
    pub bpm_candidates: Vec<f64>,
    /// 调式，大调 "C"，小调 "Cm"
    pub key: String,
    /// 调式置信度 0-1
    #[serde(default)]
    pub key_confidence: f64,

    // ---- Tier 1: 能量 / 频谱 ----
    pub energy: f64,
    pub valence: f64,
    pub spectral_centroid: f64,
    pub spectral_bandwidth: f64,
    pub spectral_flatness: f64,
    pub spectral_rolloff: f64,
    pub zero_crossing_rate: f64,

    // ---- Tier 2: Essentia 拓展（纯算法，可能为 None 仅在算法异常时）----
    #[serde(default)]
    pub loudness_lufs: Option<f64>,
    #[serde(default)]
    pub dynamic_complexity: Option<f64>,
    #[serde(default)]
    pub danceability: Option<f64>,
    #[serde(default)]
    pub onset_rate: Option<f64>,
    #[serde(default)]
    pub pitch_mean_hz: Option<f64>,
    #[serde(default)]
    pub pitch_std_hz: Option<f64>,
    #[serde(default)]
    pub pitch_range_semitones: Option<f64>,
    #[serde(default)]
    pub tuning_hz: Option<f64>,
    #[serde(default)]
    pub chord_progression: Option<Vec<String>>,
    #[serde(default)]
    pub chord_changes_per_min: Option<f64>,
    #[serde(default)]
    pub mfcc_brightness: Option<f64>,
    #[serde(default)]
    pub mfcc_warmth: Option<f64>,
    #[serde(default)]
    pub timbre_brightness_label: Option<String>,
    #[serde(default)]
    pub timbre_warmth_label: Option<String>,

    // ---- Tier 3: TensorFlow 预训练（缺模型时全为 None）----
    #[serde(default)]
    pub voice_instrumental: Option<String>,
    #[serde(default)]
    pub voice_gender: Option<String>,
    #[serde(default)]
    pub mood_tags: Option<Vec<String>>,
    #[serde(default)]
    pub genre_tags: Option<Vec<String>>,
    #[serde(default)]
    pub instrument_tags: Option<Vec<String>>,
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
                    spectral_rolloff, zero_crossing_rate,
                    COALESCE(extra_json, '{}')
             FROM song_features WHERE song_id = ?1",
        )?;
        let mut rows = stmt.query(rusqlite::params![song_id])?;
        if let Some(row) = rows.next()? {
            // 把核心列读出来
            let bpm: f64 = row.get(0)?;
            let bpm_confidence: f64 = row.get(1)?;
            let energy: f64 = row.get(2)?;
            let valence: f64 = row.get(3)?;
            let key: String = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            let key_confidence: f64 = row.get(5)?;
            let spectral_centroid: f64 = row.get(6)?;
            let spectral_bandwidth: f64 = row.get(7)?;
            let spectral_flatness: f64 = row.get(8)?;
            let spectral_rolloff: f64 = row.get(9)?;
            let zero_crossing_rate: f64 = row.get(10)?;

            // extra_json 反序列化为半结构化 features，然后合并
            let extra_str: String = row.get(11)?;
            let mut features: AudioFeatures = serde_json::from_str(&format!(
                r#"{{
                    "bpm": {bpm},
                    "bpm_confidence": {bpm_confidence},
                    "key": {key:?},
                    "key_confidence": {key_confidence},
                    "energy": {energy},
                    "valence": {valence},
                    "spectral_centroid": {spectral_centroid},
                    "spectral_bandwidth": {spectral_bandwidth},
                    "spectral_flatness": {spectral_flatness},
                    "spectral_rolloff": {spectral_rolloff},
                    "zero_crossing_rate": {zero_crossing_rate}
                }}"#
            ))
            .map_err(|e| {
                crate::db::DbError::Other(format!("song_features 核心列反序列化失败: {e}"))
            })?;

            // 把 extra_json 里的字段覆盖回去
            if let Ok(extra) = serde_json::from_str::<serde_json::Value>(&extra_str) {
                merge_extra_into(&mut features, &extra);
            }

            Ok(Some(features))
        } else {
            Ok(None)
        }
    }

    pub fn song_feature_upsert(
        &self,
        song_id: &str,
        f: &AudioFeatures,
    ) -> Result<(), crate::db::DbError> {
        // 核心列单独写，扩展字段塞进 extra_json
        let extra = serde_json::json!({
            "bpm_candidates": f.bpm_candidates,
            "loudness_lufs": f.loudness_lufs,
            "dynamic_complexity": f.dynamic_complexity,
            "danceability": f.danceability,
            "onset_rate": f.onset_rate,
            "pitch_mean_hz": f.pitch_mean_hz,
            "pitch_std_hz": f.pitch_std_hz,
            "pitch_range_semitones": f.pitch_range_semitones,
            "tuning_hz": f.tuning_hz,
            "chord_progression": f.chord_progression,
            "chord_changes_per_min": f.chord_changes_per_min,
            "mfcc_brightness": f.mfcc_brightness,
            "mfcc_warmth": f.mfcc_warmth,
            "timbre_brightness_label": f.timbre_brightness_label,
            "timbre_warmth_label": f.timbre_warmth_label,
            "voice_instrumental": f.voice_instrumental,
            "voice_gender": f.voice_gender,
            "mood_tags": f.mood_tags,
            "genre_tags": f.genre_tags,
            "instrument_tags": f.instrument_tags,
        });
        let extra_str = serde_json::to_string(&extra).map_err(|e| {
            crate::db::DbError::Other(format!("extra_json 序列化失败: {e}"))
        })?;

        let conn = self.conn_lock();
        conn.execute(
            "INSERT INTO song_features
               (song_id, bpm, bpm_confidence, energy, valence,
                key, key_confidence,
                spectral_centroid, spectral_bandwidth, spectral_flatness,
                spectral_rolloff, zero_crossing_rate, extra_json, analyzed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
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
               extra_json = excluded.extra_json,
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
                extra_str,
            ],
        )?;
        Ok(())
    }
}

/// 把 extra_json 里反序列化出来的 Value 字段合并回 AudioFeatures。
/// 仅覆盖在 extra 里出现的字段，未出现的保持 default。
fn merge_extra_into(features: &mut AudioFeatures, extra: &serde_json::Value) {
    use serde_json::from_value;
    let obj = match extra.as_object() {
        Some(o) => o,
        None => return,
    };
    if let Some(v) = obj.get("bpm_candidates").cloned() {
        if let Ok(x) = from_value(v) {
            features.bpm_candidates = x;
        }
    }
    if let Some(v) = obj.get("loudness_lufs").cloned() {
        features.loudness_lufs = from_value(v).ok();
    }
    if let Some(v) = obj.get("dynamic_complexity").cloned() {
        features.dynamic_complexity = from_value(v).ok();
    }
    if let Some(v) = obj.get("danceability").cloned() {
        features.danceability = from_value(v).ok();
    }
    if let Some(v) = obj.get("onset_rate").cloned() {
        features.onset_rate = from_value(v).ok();
    }
    if let Some(v) = obj.get("pitch_mean_hz").cloned() {
        features.pitch_mean_hz = from_value(v).ok();
    }
    if let Some(v) = obj.get("pitch_std_hz").cloned() {
        features.pitch_std_hz = from_value(v).ok();
    }
    if let Some(v) = obj.get("pitch_range_semitones").cloned() {
        features.pitch_range_semitones = from_value(v).ok();
    }
    if let Some(v) = obj.get("tuning_hz").cloned() {
        features.tuning_hz = from_value(v).ok();
    }
    if let Some(v) = obj.get("chord_progression").cloned() {
        features.chord_progression = from_value(v).ok();
    }
    if let Some(v) = obj.get("chord_changes_per_min").cloned() {
        features.chord_changes_per_min = from_value(v).ok();
    }
    if let Some(v) = obj.get("mfcc_brightness").cloned() {
        features.mfcc_brightness = from_value(v).ok();
    }
    if let Some(v) = obj.get("mfcc_warmth").cloned() {
        features.mfcc_warmth = from_value(v).ok();
    }
    if let Some(v) = obj.get("timbre_brightness_label").cloned() {
        features.timbre_brightness_label = from_value(v).ok();
    }
    if let Some(v) = obj.get("timbre_warmth_label").cloned() {
        features.timbre_warmth_label = from_value(v).ok();
    }
    if let Some(v) = obj.get("voice_instrumental").cloned() {
        features.voice_instrumental = from_value(v).ok();
    }
    if let Some(v) = obj.get("voice_gender").cloned() {
        features.voice_gender = from_value(v).ok();
    }
    if let Some(v) = obj.get("mood_tags").cloned() {
        features.mood_tags = from_value(v).ok();
    }
    if let Some(v) = obj.get("genre_tags").cloned() {
        features.genre_tags = from_value(v).ok();
    }
    if let Some(v) = obj.get("instrument_tags").cloned() {
        features.instrument_tags = from_value(v).ok();
    }
}
