//! Rust wrapper around the Node CLI adapter in `scripts/netease_adapter.cjs`.
//!
//! Each call spawns `node scripts/netease_adapter.cjs <command> <payload>` and
//! parses the single-line JSON response `{ ok, data | error }`.
//!
//! Cookies are owned by [`crate::auth`] and passed through the `cookie` field
//! on each payload, so this module stays stateless.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NeteaseError {
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

fn locate_node() -> Result<PathBuf, NeteaseError> {
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
    Err(NeteaseError::NodeNotFound)
}

fn adapter_script_path() -> Result<PathBuf, NeteaseError> {
    static CACHED: OnceCell<PathBuf> = OnceCell::new();
    if let Some(path) = CACHED.get() {
        return Ok(path.clone());
    }

    // Prefer the path relative to CARGO_MANIFEST_DIR (dev builds) and fall
    // back to paths relative to the executable for bundled installs.
    let manifest_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/netease_adapter.cjs");

    let exe_candidates: Vec<PathBuf> = std::env::current_exe()
        .ok()
        .into_iter()
        .flat_map(|exe| {
            let parent = exe.parent().map(Path::to_path_buf).unwrap_or_default();
            vec![
                parent.join("../scripts/netease_adapter.cjs"),
                parent.join("../../scripts/netease_adapter.cjs"),
                parent.join("../Resources/scripts/netease_adapter.cjs"),
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
    Err(NeteaseError::ScriptMissing(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/netease_adapter.cjs"),
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

/// Synchronously invokes the adapter. Blocking—call from a blocking context
/// or wrap in `tokio::task::spawn_blocking` for async paths.
pub fn invoke(command: &str, payload: Value) -> Result<Value, NeteaseError> {
    let node = locate_node()?;
    let script = adapter_script_path()?;
    let payload_str = serde_json::to_string(&payload)?;

    let output = Command::new(&node)
        .arg(&script)
        .arg(command)
        .arg(&payload_str)
        .output()?;

    let stdout = String::from_utf8(output.stdout).map_err(|_| NeteaseError::Encoding)?;
    // The adapter always writes one JSON line to stdout, even on failures.
    let line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    if line.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(NeteaseError::Adapter(if stderr.is_empty() {
            format!("adapter produced no output (exit code {:?})", output.status.code())
        } else {
            stderr
        }));
    }

    let resp: AdapterResponse = serde_json::from_str(line)?;
    if resp.ok {
        Ok(resp.data)
    } else {
        Err(NeteaseError::Adapter(
            resp.error.unwrap_or_else(|| "unknown adapter error".into()),
        ))
    }
}

// ---- typed DTOs ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub album: String,
    pub cover_url: String,
    pub duration_secs: u32,
    pub playable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongUrl {
    pub url: String,
    pub br: u32,
    pub size: u64,
    #[serde(rename = "type")]
    pub file_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lyric {
    pub lrc: String,
    pub tlyric: String,
    pub romalrc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub cover_url: String,
    pub track_count: u32,
    pub description: String,
    pub creator_name: String,
    pub creator_id: String,
    pub play_count: u64,
    pub special_type: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistDetail {
    pub summary: Playlist,
    pub tracks: Vec<Song>,
}

// ---- typed helpers ---------------------------------------------------------

pub fn search_songs(query: &str, limit: u32, cookie: &str) -> Result<Vec<Song>, NeteaseError> {
    let data = invoke(
        "search_songs",
        json!({ "query": query, "limit": limit, "cookie": cookie }),
    )?;
    Ok(serde_json::from_value(data)?)
}

pub fn song_detail(id: &str, cookie: &str) -> Result<Song, NeteaseError> {
    let data = invoke("song_detail", json!({ "id": id, "cookie": cookie }))?;
    Ok(serde_json::from_value(data)?)
}

pub fn song_url(id: &str, level: &str, cookie: &str) -> Result<SongUrl, NeteaseError> {
    let data = invoke(
        "song_url",
        json!({ "id": id, "level": level, "cookie": cookie }),
    )?;
    Ok(serde_json::from_value(data)?)
}

pub fn lyric(id: &str, cookie: &str) -> Result<Lyric, NeteaseError> {
    let data = invoke("lyric", json!({ "id": id, "cookie": cookie }))?;
    Ok(serde_json::from_value(data)?)
}

pub fn user_playlists(
    uid: &str,
    cookie: &str,
    limit: u32,
) -> Result<Vec<Playlist>, NeteaseError> {
    let data = invoke(
        "user_playlists",
        json!({ "uid": uid, "cookie": cookie, "limit": limit }),
    )?;
    Ok(serde_json::from_value(data)?)
}

pub fn playlist_detail(
    id: &str,
    cookie: &str,
    limit: u32,
) -> Result<PlaylistDetail, NeteaseError> {
    let data = invoke(
        "playlist_detail",
        json!({ "id": id, "cookie": cookie, "limit": limit }),
    )?;
    Ok(serde_json::from_value(data)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_search_returns_real_results() {
        // Smoke test — hits the network. Skip locally with --lib -- --skip
        // if the environment is offline.
        let results = search_songs("海阔天空", 2, "").expect("search_songs");
        assert!(!results.is_empty(), "expected at least one song");
        assert_eq!(results[0].artist, "Beyond");
    }
}
