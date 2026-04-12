//! MPV 播放引擎。
//!
//! 启动一个隐藏的 mpv 进程，监听 Unix socket IPC。Rust 侧通过
//! JSON 命令控制播放，并在后台线程轮询关键属性变化（播放状态、
//! 位置），通过 Tauri event 推送到前端。
//!
//! 此模块只负责"单轨播放"的原语，不管理队列或歌曲元数据——那些
//! 属于 [`crate::queue`] 的职责。

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

// ---- paths -----------------------------------------------------------------

fn config_dir() -> Result<PathBuf, PlayerError> {
    let base = dirs::config_dir().ok_or(PlayerError::NoConfigDir)?;
    let dir = base.join("melody");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn socket_path() -> Result<PathBuf, PlayerError> {
    Ok(config_dir()?.join("mpv.sock"))
}

fn locate_mpv() -> Result<PathBuf, PlayerError> {
    let candidates = [
        "/opt/homebrew/bin/mpv",
        "/usr/local/bin/mpv",
        "/usr/bin/mpv",
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Some(path_env) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let candidate = dir.join("mpv");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(PlayerError::MpvNotFound)
}

// ---- errors ----------------------------------------------------------------

#[derive(Debug, Error)]
pub enum PlayerError {
    #[error("无法定位用户配置目录")]
    NoConfigDir,
    #[error("未找到 mpv 可执行文件，请先安装 mpv")]
    MpvNotFound,
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("mpv IPC 错误: {0}")]
    Ipc(String),
    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),
}

// ---- state & events --------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlayState {
    Idle,
    Playing,
    Paused,
}

impl Default for PlayState {
    fn default() -> Self {
        PlayState::Idle
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct PlaybackStatus {
    pub state: PlayState,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
}

/// Tauri event payload for progress updates (emitted from the watcher).
#[derive(Debug, Clone, Serialize)]
pub struct PlaybackEvent {
    pub state: PlayState,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
}

// ---- PlayerState -----------------------------------------------------------

/// Managed Tauri state for the MPV player. Clone-able (Arc inside) so
/// it can move into spawn_blocking closures.
#[derive(Clone)]
pub struct PlayerState {
    inner: Arc<PlayerStateInner>,
}

struct PlayerStateInner {
    initialized: AtomicBool,
    last_status: Arc<Mutex<PlaybackStatus>>,
    /// 去抖 track-ended 事件（eof-reached 在同一首歌播完后会连续多帧为 true）。
    finished_emitted: Arc<AtomicBool>,
    watcher_started: AtomicBool,
}

impl PlayerState {
    pub fn new() -> Self {
        PlayerState {
            inner: Arc::new(PlayerStateInner {
                initialized: AtomicBool::new(false),
                last_status: Arc::new(Mutex::new(PlaybackStatus::default())),
                finished_emitted: Arc::new(AtomicBool::new(false)),
                watcher_started: AtomicBool::new(false),
            }),
        }
    }

    pub fn status(&self) -> PlaybackStatus {
        self.inner.last_status.lock().unwrap().clone()
    }

    /// 幂等启动 mpv。首次调用时 spawn 子进程 + 启动后台 watcher。
    pub fn ensure_running(&self, app: AppHandle) -> Result<(), PlayerError> {
        if self.inner.initialized.load(Ordering::Acquire) && mpv_ready() {
            return Ok(());
        }
        start_mpv_process()?;
        self.inner.initialized.store(true, Ordering::Release);

        // 启动后台 watcher（仅一次）——共享同一份 last_status / finished_emitted。
        if !self.inner.watcher_started.swap(true, Ordering::AcqRel) {
            spawn_watcher(
                app,
                Arc::clone(&self.inner.last_status),
                Arc::clone(&self.inner.finished_emitted),
            );
        }
        Ok(())
    }

    pub fn load_url(&self, url: &str) -> Result<(), PlayerError> {
        self.inner.finished_emitted.store(false, Ordering::Release);
        send_command(json!({ "command": ["loadfile", url, "replace"] }))?;
        send_command(json!({ "command": ["set_property", "pause", false] }))?;
        Ok(())
    }

    pub fn pause(&self) -> Result<(), PlayerError> {
        send_command(json!({ "command": ["set_property", "pause", true] }))?;
        Ok(())
    }

    pub fn resume(&self) -> Result<(), PlayerError> {
        send_command(json!({ "command": ["set_property", "pause", false] }))?;
        Ok(())
    }

    pub fn seek(&self, position: f64) -> Result<(), PlayerError> {
        send_command(json!({
            "command": ["seek", position, "absolute"]
        }))?;
        Ok(())
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), PlayerError> {
        // mpv volume 是 0-100（或更高，但我们限制到 0-100）。
        let clamped = volume.clamp(0.0, 100.0);
        send_command(json!({
            "command": ["set_property", "volume", clamped]
        }))?;
        Ok(())
    }

    pub fn stop(&self) -> Result<(), PlayerError> {
        send_command(json!({ "command": ["stop"] }))?;
        Ok(())
    }
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Test-only helper: start mpv without an AppHandle / watcher.
#[doc(hidden)]
pub fn __test_start_mpv() -> Result<(), PlayerError> {
    start_mpv_process()
}

// ---- low-level mpv IPC -----------------------------------------------------

fn mpv_ready() -> bool {
    get_string_property("mpv-version").is_ok()
}

fn start_mpv_process() -> Result<(), PlayerError> {
    if mpv_ready() {
        return Ok(());
    }
    let socket = socket_path()?;
    if socket.exists() {
        let _ = fs::remove_file(&socket);
    }
    let mpv = locate_mpv()?;
    Command::new(&mpv)
        .arg("--idle=yes")
        .arg("--video=no")
        .arg("--no-terminal")
        .arg("--force-window=no")
        .arg("--really-quiet")
        .arg("--keep-open=yes")
        .arg(format!("--input-ipc-server={}", socket.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if mpv_ready() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(80));
    }
    Err(PlayerError::Ipc("mpv 启动超时".into()))
}

fn send_command(cmd: Value) -> Result<Value, PlayerError> {
    let socket = socket_path()?;
    let mut stream = UnixStream::connect(&socket)
        .map_err(|e| PlayerError::Ipc(format!("连接 mpv socket 失败: {e}")))?;
    stream.set_read_timeout(Some(Duration::from_millis(500)))?;
    stream.set_write_timeout(Some(Duration::from_millis(500)))?;

    let line = format!("{cmd}\n");
    stream.write_all(line.as_bytes())?;
    stream.flush()?;

    // mpv 会把无关事件穿插在响应前；找到含 "request_id" 或 "error" 的响应行。
    let mut reader = BufReader::new(stream);
    for _ in 0..16 {
        let mut buf = String::new();
        let bytes = reader
            .read_line(&mut buf)
            .map_err(|e| PlayerError::Ipc(format!("读取 mpv 响应失败: {e}")))?;
        if bytes == 0 {
            break;
        }
        let trimmed = buf.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if value.get("event").is_some() {
            continue; // 丢弃异步事件，等真正的响应
        }
        return Ok(value);
    }
    Err(PlayerError::Ipc("mpv 未返回响应".into()))
}

fn get_property(property: &str) -> Result<Value, PlayerError> {
    let resp = send_command(json!({ "command": ["get_property", property] }))?;
    if resp.get("error").and_then(Value::as_str) != Some("success") {
        return Err(PlayerError::Ipc(format!(
            "get_property {property} 失败: {}",
            resp.get("error").and_then(Value::as_str).unwrap_or("?")
        )));
    }
    resp.get("data")
        .cloned()
        .ok_or_else(|| PlayerError::Ipc(format!("{property} 无 data")))
}

fn get_string_property(property: &str) -> Result<String, PlayerError> {
    Ok(get_property(property)?
        .as_str()
        .unwrap_or_default()
        .to_string())
}

fn get_number_property(property: &str) -> Result<f64, PlayerError> {
    get_property(property)?
        .as_f64()
        .ok_or_else(|| PlayerError::Ipc(format!("{property} 不是数字")))
}

fn get_bool_property(property: &str) -> Result<bool, PlayerError> {
    get_property(property)?
        .as_bool()
        .ok_or_else(|| PlayerError::Ipc(format!("{property} 不是布尔值")))
}

// ---- watcher thread --------------------------------------------------------

fn spawn_watcher(
    app: AppHandle,
    last_status: Arc<Mutex<PlaybackStatus>>,
    finished_emitted: Arc<AtomicBool>,
) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(400));

        let pause = get_bool_property("pause").unwrap_or(true);
        let idle = get_bool_property("idle-active").unwrap_or(true);
        let position = get_number_property("time-pos").unwrap_or(0.0);
        let duration = get_number_property("duration").unwrap_or(0.0);
        let volume = get_number_property("volume").unwrap_or(100.0);
        let eof = get_bool_property("eof-reached").unwrap_or(false);

        let state = if idle {
            PlayState::Idle
        } else if pause {
            PlayState::Paused
        } else {
            PlayState::Playing
        };

        let status = PlaybackStatus {
            state,
            position,
            duration,
            volume,
        };

        // 更新共享状态
        if let Ok(mut guard) = last_status.lock() {
            *guard = status.clone();
        }

        // 每次推送进度事件
        let _ = app.emit("melody://playback-update", PlaybackEvent {
            state,
            position,
            duration,
            volume,
        });

        // 播完去抖推送 track-ended 事件
        if eof && !finished_emitted.load(Ordering::Acquire) {
            finished_emitted.store(true, Ordering::Release);
            let _ = app.emit("melody://track-ended", ());
        } else if !eof && finished_emitted.load(Ordering::Acquire) {
            finished_emitted.store(false, Ordering::Release);
        }
    });
}
