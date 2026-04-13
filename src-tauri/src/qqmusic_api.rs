//! Rust wrapper around the Node CLI adapter in `scripts/qqmusic_adapter.cjs`.
//!
//! Each call spawns `node scripts/qqmusic_adapter.cjs <command> <payload>` and
//! parses the single-line JSON response `{ ok, data | error }`.
//!
//! Cookies are owned by [`crate::qq_auth`] and passed through the `cookie` field
//! on each payload, so this module stays stateless.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum QQMusicError {
    #[error("node binary not found on PATH")]
    NodeNotFound,
    #[error("adapter script missing at {0}")]
    ScriptMissing(PathBuf),
    #[error("failed to spawn node: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("adapter returned non-utf8 output")]
    Encoding,
    #[error("adapter returned invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("adapter error: {0}")]
    Adapter(String),
}

// ---- node / script discovery ----------------------------------------------

fn locate_node() -> Result<PathBuf, QQMusicError> {
    static CACHED: OnceCell<PathBuf> = OnceCell::new();
    if let Some(path) = CACHED.get() {
        return Ok(path.clone());
    }

    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            let _ = CACHED.set(path.clone());
            return Ok(path);
        }
    }
    // Fall back to PATH lookup.
    if let Some(path_env) = env::var_os("PATH") {
        for dir in env::split_paths(&path_env) {
            let candidate = dir.join("node");
            if candidate.is_file() {
                let _ = CACHED.set(candidate.clone());
                return Ok(candidate);
            }
        }
    }
    Err(QQMusicError::NodeNotFound)
}

fn adapter_script_path() -> Result<PathBuf, QQMusicError> {
    static CACHED: OnceCell<PathBuf> = OnceCell::new();
    if let Some(path) = CACHED.get() {
        return Ok(path.clone());
    }

    // Prefer the path relative to CARGO_MANIFEST_DIR (dev builds) and fall
    // back to paths relative to the executable for bundled installs.
    let manifest_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/qqmusic_adapter.cjs");

    let exe_candidates: Vec<PathBuf> = std::env::current_exe()
        .ok()
        .into_iter()
        .flat_map(|exe| {
            let parent = exe.parent().map(Path::to_path_buf).unwrap_or_default();
            vec![
                parent.join("../scripts/qqmusic_adapter.cjs"),
                parent.join("../../scripts/qqmusic_adapter.cjs"),
                parent.join("../Resources/scripts/qqmusic_adapter.cjs"),
            ]
        })
        .collect();

    for candidate in std::iter::once(manifest_candidate).chain(exe_candidates) {
        if candidate.is_file() {
            let resolved = candidate.canonicalize().unwrap_or(candidate);
            let _ = CACHED.set(resolved.clone());
            return Ok(resolved);
        }
    }
    Err(QQMusicError::ScriptMissing(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/qqmusic_adapter.cjs"),
    ))
}

// ---- dispatch --------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct AdapterResponse {
    ok: bool,
    #[serde(default)]
    data: Value,
    #[serde(default)]
    error: Option<String>,
}

/// Synchronously invokes the adapter. Blocking -- call from a blocking context
/// or wrap in `tokio::task::spawn_blocking` for async paths.
pub fn invoke(command: &str, payload: Value) -> Result<Value, QQMusicError> {
    let node = locate_node()?;
    let script = adapter_script_path()?;
    let payload_str = serde_json::to_string(&payload)?;

    let output = Command::new(&node)
        .arg(&script)
        .arg(command)
        .arg(&payload_str)
        .output()?;

    let stdout = String::from_utf8(output.stdout).map_err(|_| QQMusicError::Encoding)?;
    // The adapter always writes one JSON line to stdout, even on failures.
    let line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    if line.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(QQMusicError::Adapter(if stderr.is_empty() {
            format!("adapter produced no output (exit code {:?})", output.status.code())
        } else {
            stderr
        }));
    }

    let resp: AdapterResponse = serde_json::from_str(line)?;
    if resp.ok {
        Ok(resp.data)
    } else {
        Err(QQMusicError::Adapter(
            resp.error.unwrap_or_else(|| "unknown adapter error".into()),
        ))
    }
}

// ---- typed DTOs ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQSong {
    pub mid: String,
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub duration: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQPlaylist {
    pub disstid: String,
    pub name: String,
    #[serde(default)]
    pub song_cnt: u32,
    #[serde(default)]
    pub cover: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQPlaylistDetail {
    pub info: QQPlaylist,
    pub songs: Vec<QQSong>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQPlaylistCreateReceipt {
    pub dirid: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQTrackAddResult {
    pub ok: bool,
    #[serde(default)]
    pub message: String,
}

// ---- typed helpers ---------------------------------------------------------

pub fn search_songs(query: &str, limit: u32, cookie: &str) -> Result<Vec<QQSong>, QQMusicError> {
    let data = invoke(
        "search_songs",
        json!({ "keyword": query, "limit": limit, "cookie": cookie }),
    )?;
    Ok(serde_json::from_value(data)?)
}

pub fn user_playlists(id: &str, cookie: &str) -> Result<Vec<QQPlaylist>, QQMusicError> {
    let data = invoke(
        "user_playlists",
        json!({ "id": id, "cookie": cookie }),
    )?;
    Ok(serde_json::from_value(data)?)
}

pub fn playlist_detail(
    id: &str,
    cookie: &str,
) -> Result<QQPlaylistDetail, QQMusicError> {
    let data = invoke(
        "playlist_detail",
        json!({ "id": id, "cookie": cookie }),
    )?;
    Ok(serde_json::from_value(data)?)
}

pub fn create_playlist(name: &str, cookie: &str) -> Result<QQPlaylistCreateReceipt, QQMusicError> {
    let data = invoke(
        "create_playlist",
        json!({ "name": name, "cookie": cookie }),
    )?;
    Ok(serde_json::from_value(data)?)
}

pub fn add_to_playlist(
    mid: &[String],
    dirid: &str,
    cookie: &str,
) -> Result<QQTrackAddResult, QQMusicError> {
    let data = invoke(
        "add_to_playlist",
        json!({ "mid": mid, "dirid": dirid, "cookie": cookie }),
    )?;
    Ok(serde_json::from_value(data)?)
}

pub fn set_cookie(cookie: &str) -> Result<Value, QQMusicError> {
    invoke("set_cookie", json!({ "cookie": cookie }))
}

pub fn user_detail(id: &str, cookie: &str) -> Result<Value, QQMusicError> {
    invoke("user_detail", json!({ "id": id, "cookie": cookie }))
}
