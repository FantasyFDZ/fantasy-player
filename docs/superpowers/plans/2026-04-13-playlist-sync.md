# PlaylistSync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Melody panel plugin that migrates playlists bidirectionally between QQ Music and NetEase Cloud Music.

**Architecture:** New `qqmusic_adapter.cjs` Node adapter (mirrors `netease_adapter.cjs`), new `qqmusic_api.rs` + `qq_auth.rs` Rust modules (mirror `netease_api.rs` + `auth.rs`), new `sync.rs` migration orchestrator, and a `PlaylistSync` React panel plugin. All layers follow existing patterns exactly.

**Tech Stack:** Node.js (`qq-music-api` npm), Rust (Tauri 2, serde, thiserror), React 18 + TypeScript + Tailwind CSS.

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `scripts/qqmusic_adapter.cjs` | QQ Music Node CLI adapter (mirrors `netease_adapter.cjs`) |
| `src-tauri/src/qqmusic_api.rs` | Rust wrapper for QQ Music adapter (mirrors `netease_api.rs`) |
| `src-tauri/src/qq_auth.rs` | QQ auth state management (mirrors `auth.rs`) |
| `src-tauri/src/sync.rs` | Migration orchestration logic |
| `src/plugins/PlaylistSync/PlaylistSync.tsx` | Main panel component |
| `src/plugins/PlaylistSync/index.ts` | Plugin export |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `qq-music-api` dependency |
| `src-tauri/src/lib.rs` | Register new modules + QQAuthState + commands |
| `src-tauri/src/commands.rs` | Add QQ auth + sync commands |
| `src/lib/api.ts` | Add QQ auth + sync TypeScript bindings |
| `src/plugins/index.ts` | Register PlaylistSync plugin |

---

## Task 1: Install qq-music-api and Create Node Adapter

**Files:**
- Modify: `package.json`
- Create: `scripts/qqmusic_adapter.cjs`

- [ ] **Step 1: Install qq-music-api npm package**

```bash
cd /Users/fms26/Coding/musicplayer && npm install qq-music-api
```

Expected: `qq-music-api` added to `package.json` dependencies.

- [ ] **Step 2: Create `scripts/qqmusic_adapter.cjs`**

This adapter mirrors `netease_adapter.cjs` exactly: CLI mode, `node qqmusic_adapter.cjs <command> <json-payload>`, single-line JSON response `{ok, data}` or `{ok, error}`.

```javascript
#!/usr/bin/env node
/*
 * Melody QQ Music adapter — stateless CLI wrapper around qq-music-api.
 *
 * Usage: node qqmusic_adapter.cjs <command> <json-payload>
 *
 * Contract:
 *   - Reads command + JSON payload from argv.
 *   - Writes a single line to stdout: {"ok":true,"data":...} or
 *     {"ok":false,"error":"..."}
 *   - Exits 0 on success, 1 on failure.
 *   - Cookies are owned by the Rust side and passed through payload.cookie.
 */

const qqMusic = require("qq-music-api");

// ---- helpers ---------------------------------------------------------------

function toStr(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickArray(...values) {
  for (const v of values) if (Array.isArray(v)) return v;
  return [];
}

function joinSingers(singers) {
  return pickArray(singers)
    .map((s) => toStr(s?.name || s?.title))
    .filter(Boolean)
    .join(" / ");
}

function normalizeSong(record) {
  if (!record) return null;
  const mid = toStr(record?.songmid || record?.mid || record?.strMusicId);
  if (!mid) return null;
  const singer = joinSingers(record?.singer);
  const album = record?.album || {};
  return {
    mid,
    id: toStr(record?.songid || record?.id),
    name: toStr(record?.songname || record?.name || record?.title),
    artist: singer,
    album: toStr(album?.name || record?.albumname),
    duration: toNum(record?.interval, 0),
  };
}

function normalizePlaylist(record) {
  if (!record) return null;
  const disstid = toStr(
    record?.dissid || record?.tid || record?.content_id || record?.id
  );
  if (!disstid) return null;
  return {
    disstid,
    name: toStr(record?.dissname || record?.diss_name || record?.title || record?.name),
    song_cnt: toNum(record?.song_cnt || record?.songnum || record?.cur_song_num, 0),
    cover: toStr(record?.imgurl || record?.logo || record?.picurl || record?.diss_cover),
  };
}

// ---- command handlers ------------------------------------------------------

async function setCookie({ cookie = "" }) {
  if (cookie) {
    qqMusic.setCookie(cookie);
  }
  return { ok: true };
}

async function qrCreate() {
  // qq-music-api 的 QR 登录接口
  const resp = await qqMusic.api("/user/getQQLoginQr");
  return {
    qrsig: toStr(resp?.data?.qrsig),
    ptqrtoken: toStr(resp?.data?.ptqrtoken),
    qr_img: toStr(resp?.data?.image),
  };
}

async function qrCheck({ qrsig = "", ptqrtoken = "" }) {
  const resp = await qqMusic.api("/user/checkQQLoginQr", { qrsig, ptqrtoken });
  const code = toNum(resp?.data?.code || resp?.code, 0);
  // code: 0=success, 66=scanned, 67=waiting, 65=expired
  const statusMap = { 0: "ok", 66: "scanned", 67: "waiting", 65: "expired" };
  return {
    code,
    status: statusMap[code] || "waiting",
    cookie: code === 0 ? toStr(resp?.data?.cookie) : "",
  };
}

async function userDetail({ id = "", cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  const resp = await qqMusic.api("/user/detail", { id });
  const data = resp?.data || resp || {};
  return {
    uin: toStr(data?.uin || data?.creator?.uin || id),
    nickname: toStr(data?.nick || data?.creator?.nick),
    avatar: toStr(data?.headurl || data?.creator?.headurl),
  };
}

async function userPlaylists({ id = "", cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  const resp = await qqMusic.api("/user/songlist", { id });
  const list = pickArray(resp?.data?.list, resp?.data, resp?.list);
  return { list: list.map(normalizePlaylist).filter(Boolean) };
}

async function playlistDetail({ disstid = "", cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  const resp = await qqMusic.api("/songlist", { id: disstid });
  const data = resp?.data || resp || {};
  const songs = pickArray(data?.songlist, data?.songList, data?.songs);
  return {
    info: normalizePlaylist(data),
    songs: songs.map(normalizeSong).filter(Boolean),
  };
}

async function searchSongs({ keyword = "", limit = 30, cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  if (!keyword) return { list: [] };
  const resp = await qqMusic.api("/search", { key: keyword, pageSize: limit });
  const list = pickArray(
    resp?.data?.list,
    resp?.data?.song?.list,
    resp?.data?.songs
  );
  return { list: list.map(normalizeSong).filter(Boolean).slice(0, limit) };
}

async function createPlaylist({ name = "新建歌单", cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  const resp = await qqMusic.api("/songlist/create", { name });
  const data = resp?.data || resp || {};
  return {
    dirid: toStr(data?.dirid || data?.id),
    name: toStr(data?.name || name),
  };
}

async function addToPlaylist({ dirid = "", mid_list = [], cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  const mids = pickArray(mid_list);
  if (!dirid || mids.length === 0) return { ok: false };
  const resp = await qqMusic.api("/songlist/add", {
    dirid,
    mid: mids.join(","),
  });
  const code = toNum(resp?.data?.code || resp?.code, -1);
  return { ok: code === 0 || code === 200, code };
}

// ---- dispatch --------------------------------------------------------------

const COMMANDS = {
  set_cookie: setCookie,
  qr_create: qrCreate,
  qr_check: qrCheck,
  user_detail: userDetail,
  user_playlists: userPlaylists,
  playlist_detail: playlistDetail,
  search_songs: searchSongs,
  create_playlist: createPlaylist,
  add_to_playlist: addToPlaylist,
};

async function main() {
  const command = process.argv[2];
  const payloadArg = process.argv[3];

  if (!command) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: "missing command argument" }) + "\n"
    );
    process.exit(1);
  }

  const handler = COMMANDS[command];
  if (!handler) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: `unknown command: ${command}` }) + "\n"
    );
    process.exit(1);
  }

  let payload = {};
  if (payloadArg) {
    try {
      payload = JSON.parse(payloadArg);
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: `invalid JSON payload: ${error.message}`,
        }) + "\n"
      );
      process.exit(1);
    }
  }

  try {
    const data = await handler(payload);
    process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
    process.stderr.write(message + "\n");
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Smoke test the adapter**

```bash
cd /Users/fms26/Coding/musicplayer && node scripts/qqmusic_adapter.cjs search_songs '{"keyword":"海阔天空","limit":2}'
```

Expected: `{"ok":true,"data":{"list":[...]}}` with at least one song result.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/qqmusic_adapter.cjs
git commit -m "feat: add QQ Music Node adapter (qqmusic_adapter.cjs)"
```

---

## Task 2: Rust QQ Music API Wrapper

**Files:**
- Create: `src-tauri/src/qqmusic_api.rs`
- Modify: `src-tauri/src/lib.rs:1` (add `pub mod qqmusic_api;`)

- [ ] **Step 1: Create `src-tauri/src/qqmusic_api.rs`**

Mirrors `netease_api.rs` exactly: locate node, locate adapter script, `invoke()` dispatcher, typed DTOs, typed helper functions.

```rust
//! Rust wrapper around the Node CLI adapter in `scripts/qqmusic_adapter.cjs`.
//!
//! Mirrors `netease_api.rs`: spawns `node scripts/qqmusic_adapter.cjs <command> <payload>`
//! and parses the single-line JSON response.

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

// ---- node / script discovery (reuse same node binary as netease) -----------

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
    pub album: String,
    pub duration: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQPlaylist {
    pub disstid: String,
    pub name: String,
    pub song_cnt: u32,
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
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQTrackAddResult {
    pub ok: bool,
    pub code: i32,
}

// ---- typed helpers ---------------------------------------------------------

pub fn search_songs(keyword: &str, limit: u32, cookie: &str) -> Result<Vec<QQSong>, QQMusicError> {
    let data = invoke(
        "search_songs",
        json!({ "keyword": keyword, "limit": limit, "cookie": cookie }),
    )?;
    let list = data.get("list").cloned().unwrap_or(Value::Array(vec![]));
    Ok(serde_json::from_value(list)?)
}

pub fn user_playlists(id: &str, cookie: &str) -> Result<Vec<QQPlaylist>, QQMusicError> {
    let data = invoke("user_playlists", json!({ "id": id, "cookie": cookie }))?;
    let list = data.get("list").cloned().unwrap_or(Value::Array(vec![]));
    Ok(serde_json::from_value(list)?)
}

pub fn playlist_detail(disstid: &str, cookie: &str) -> Result<QQPlaylistDetail, QQMusicError> {
    let data = invoke(
        "playlist_detail",
        json!({ "disstid": disstid, "cookie": cookie }),
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
    dirid: &str,
    mid_list: &[String],
    cookie: &str,
) -> Result<QQTrackAddResult, QQMusicError> {
    let data = invoke(
        "add_to_playlist",
        json!({ "dirid": dirid, "mid_list": mid_list, "cookie": cookie }),
    )?;
    Ok(serde_json::from_value(data)?)
}
```

- [ ] **Step 2: Register the module in `src-tauri/src/lib.rs`**

Add after line `pub mod netease_api;`:

```rust
pub mod qqmusic_api;
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/fms26/Coding/musicplayer/src-tauri && cargo check
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/qqmusic_api.rs src-tauri/src/lib.rs
git commit -m "feat: add Rust QQ Music API wrapper (qqmusic_api.rs)"
```

---

## Task 3: QQ Auth State Management

**Files:**
- Create: `src-tauri/src/qq_auth.rs`
- Modify: `src-tauri/src/lib.rs` (add module + manage QQAuthState)

- [ ] **Step 1: Create `src-tauri/src/qq_auth.rs`**

Mirrors `auth.rs` exactly: `QQAuthState` with `Arc<Mutex<QQSession>>`, persistent to `~/.config/melody/qq_session.json`, QR login flow, refresh, logout.

```rust
//! QQ 音乐登录态管理。
//!
//! 镜像 auth.rs 的设计：cookie 持久化 + QR 码登录。

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;

use crate::qqmusic_api::{invoke, QQMusicError};

fn config_dir() -> Result<PathBuf, QQAuthError> {
    let base = dirs::config_dir().ok_or(QQAuthError::NoConfigDir)?;
    let dir = base.join("melody");
    fs::create_dir_all(&dir).map_err(QQAuthError::Io)?;
    Ok(dir)
}

fn session_path() -> Result<PathBuf, QQAuthError> {
    Ok(config_dir()?.join("qq_session.json"))
}

#[derive(Debug, Error)]
pub enum QQAuthError {
    #[error("未能定位用户配置目录")]
    NoConfigDir,
    #[error("读写会话文件失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("会话文件格式错误: {0}")]
    Json(#[from] serde_json::Error),
    #[error("QQ 音乐适配器调用失败: {0}")]
    QQMusic(#[from] QQMusicError),
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct QQSession {
    #[serde(default)]
    pub cookie: String,
    #[serde(default)]
    pub pending_qrsig: String,
    #[serde(default)]
    pub pending_ptqrtoken: String,
    #[serde(default)]
    pub user: Option<QQUserProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQUserProfile {
    pub uin: String,
    pub nickname: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQQrStartReceipt {
    pub qrsig: String,
    pub ptqrtoken: String,
    pub qr_img: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum QQQrCheckOutcome {
    Waiting,
    Scanned,
    Expired,
    Ok { user: QQUserProfile },
}

#[derive(Default, Clone)]
pub struct QQAuthState {
    inner: Arc<Mutex<QQSession>>,
}

impl QQAuthState {
    pub fn load() -> Self {
        let session = load_session().unwrap_or_default();
        QQAuthState {
            inner: Arc::new(Mutex::new(session)),
        }
    }

    pub fn cookie(&self) -> String {
        self.inner.lock().unwrap().cookie.clone()
    }

    pub fn current_user(&self) -> Option<QQUserProfile> {
        self.inner.lock().unwrap().user.clone()
    }

    pub fn snapshot(&self) -> QQSession {
        self.inner.lock().unwrap().clone()
    }

    fn update<F>(&self, mutator: F) -> Result<(), QQAuthError>
    where
        F: FnOnce(&mut QQSession),
    {
        let mut guard = self.inner.lock().unwrap();
        mutator(&mut guard);
        save_session(&guard)
    }

    pub fn start_qr(&self) -> Result<QQQrStartReceipt, QQAuthError> {
        let data = invoke("qr_create", json!({}))?;
        let qrsig = data
            .get("qrsig")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let ptqrtoken = data
            .get("ptqrtoken")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let qr_img = data
            .get("qr_img")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        self.update(|s| {
            s.pending_qrsig = qrsig.clone();
            s.pending_ptqrtoken = ptqrtoken.clone();
        })?;

        Ok(QQQrStartReceipt {
            qrsig,
            ptqrtoken,
            qr_img,
        })
    }

    pub fn check_qr(&self) -> Result<QQQrCheckOutcome, QQAuthError> {
        let (qrsig, ptqrtoken) = {
            let guard = self.inner.lock().unwrap();
            (guard.pending_qrsig.clone(), guard.pending_ptqrtoken.clone())
        };
        if qrsig.is_empty() {
            return Ok(QQQrCheckOutcome::Waiting);
        }

        let resp = invoke("qr_check", json!({ "qrsig": qrsig, "ptqrtoken": ptqrtoken }))?;
        let status = resp
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("waiting");

        match status {
            "waiting" => Ok(QQQrCheckOutcome::Waiting),
            "scanned" => Ok(QQQrCheckOutcome::Scanned),
            "expired" => {
                self.update(|s| {
                    s.pending_qrsig.clear();
                    s.pending_ptqrtoken.clear();
                })?;
                Ok(QQQrCheckOutcome::Expired)
            }
            "ok" => {
                let cookie = resp
                    .get("cookie")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                // Set cookie in adapter then fetch user detail
                let _ = invoke("set_cookie", json!({ "cookie": cookie }));

                // Extract uin from cookie for user_detail call
                let uin = extract_uin(&cookie);
                let user_data = invoke("user_detail", json!({ "id": uin, "cookie": cookie }))?;
                let user = QQUserProfile {
                    uin: user_data
                        .get("uin")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&uin)
                        .to_string(),
                    nickname: user_data
                        .get("nickname")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    avatar_url: user_data
                        .get("avatar")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                };

                self.update(|s| {
                    s.cookie = cookie;
                    s.pending_qrsig.clear();
                    s.pending_ptqrtoken.clear();
                    s.user = Some(user.clone());
                })?;

                Ok(QQQrCheckOutcome::Ok { user })
            }
            _ => Ok(QQQrCheckOutcome::Waiting),
        }
    }

    pub fn refresh(&self) -> Result<Option<QQUserProfile>, QQAuthError> {
        let cookie = self.cookie();
        if cookie.is_empty() {
            return Ok(None);
        }
        // Try to refresh cookie validity
        let _ = invoke("set_cookie", json!({ "cookie": cookie }));
        let uin = extract_uin(&cookie);
        if uin.is_empty() {
            self.update(|s| {
                s.cookie.clear();
                s.user = None;
            })?;
            return Ok(None);
        }
        match invoke("user_detail", json!({ "id": uin, "cookie": cookie })) {
            Ok(data) => {
                let nickname = data
                    .get("nickname")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                if nickname.is_empty() {
                    self.update(|s| {
                        s.cookie.clear();
                        s.user = None;
                    })?;
                    return Ok(None);
                }
                let user = QQUserProfile {
                    uin: uin.clone(),
                    nickname,
                    avatar_url: data
                        .get("avatar")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                };
                self.update(|s| s.user = Some(user.clone()))?;
                Ok(Some(user))
            }
            Err(_) => {
                self.update(|s| {
                    s.cookie.clear();
                    s.user = None;
                })?;
                Ok(None)
            }
        }
    }

    pub fn logout(&self) -> Result<(), QQAuthError> {
        self.update(|s| {
            *s = QQSession::default();
        })
    }
}

/// Extract QQ uin number from cookie string (looks for uin=oNNNN or uin=NNNN)
fn extract_uin(cookie: &str) -> String {
    for part in cookie.split(';') {
        let trimmed = part.trim();
        if let Some(val) = trimmed.strip_prefix("uin=") {
            let val = val.trim().trim_start_matches('o');
            if !val.is_empty() {
                return val.to_string();
            }
        }
    }
    String::new()
}

fn load_session() -> Result<QQSession, QQAuthError> {
    let path = session_path()?;
    if !path.exists() {
        return Ok(QQSession::default());
    }
    let raw = fs::read_to_string(&path)?;
    let session: QQSession = serde_json::from_str(&raw).unwrap_or_default();
    Ok(session)
}

fn save_session(session: &QQSession) -> Result<(), QQAuthError> {
    let path = session_path()?;
    let raw = serde_json::to_string_pretty(session)?;
    fs::write(&path, raw)?;
    Ok(())
}
```

- [ ] **Step 2: Register module and state in `src-tauri/src/lib.rs`**

Add after `pub mod qqmusic_api;`:

```rust
pub mod qq_auth;
```

Add to imports:

```rust
use qq_auth::QQAuthState;
```

In `run()`, after `let auth = AuthState::load();` add:

```rust
let qq_auth = QQAuthState::load();
```

After `let auth_for_refresh = auth.clone();` block, add:

```rust
let qq_auth_for_refresh = qq_auth.clone();
tauri::async_runtime::spawn(async move {
    let _ = tauri::async_runtime::spawn_blocking(move || qq_auth_for_refresh.refresh()).await;
});
```

Add `.manage(qq_auth)` after `.manage(auth)`.

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/fms26/Coding/musicplayer/src-tauri && cargo check
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/qq_auth.rs src-tauri/src/lib.rs
git commit -m "feat: add QQ auth state management (qq_auth.rs)"
```

---

## Task 4: Sync Orchestrator

**Files:**
- Create: `src-tauri/src/sync.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod sync;`)

- [ ] **Step 1: Create `src-tauri/src/sync.rs`**

Contains the core migration logic: load source playlist → search target platform → match songs → create target playlist → add tracks → return report.

```rust
//! 歌单迁移编排器。
//!
//! 读取源平台歌单 → 逐首搜索目标平台 → 精确匹配 → 创建歌单 → 批量添加。

use serde::{Deserialize, Serialize};
use std::thread;
use std::time::Duration;

use crate::auth::AuthState;
use crate::netease_api;
use crate::qq_auth::QQAuthState;
use crate::qqmusic_api;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncReport {
    pub playlist_name: String,
    pub total: usize,
    pub matched: usize,
    pub skipped: usize,
    pub skipped_songs: Vec<SkippedSong>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkippedSong {
    pub name: String,
    pub artist: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub playlist_name: String,
    pub current: usize,
    pub total: usize,
    pub current_song: String,
}

/// Normalize a string for comparison: lowercase, strip brackets and content, collapse whitespace.
fn normalize_for_match(s: &str) -> String {
    let mut result = s.to_lowercase();
    // Remove parenthesized content: (Live), （翻唱）, [Remix], etc.
    let patterns = [('(', ')'), ('（', '）'), ('[', ']'), ('【', '】')];
    for (open, close) in patterns {
        while let Some(start) = result.find(open) {
            if let Some(end) = result[start..].find(close) {
                result = format!("{}{}", &result[..start], &result[start + end + close.len_utf8()..]);
            } else {
                break;
            }
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string()
}

/// Migrate a single QQ Music playlist → NetEase Cloud Music.
/// `progress_cb` is called for each song to report progress.
pub fn migrate_qq_to_netease<F>(
    qq_auth: &QQAuthState,
    netease_auth: &AuthState,
    qq_playlist_id: &str,
    progress_cb: &F,
) -> Result<SyncReport, String>
where
    F: Fn(SyncProgress),
{
    let qq_cookie = qq_auth.cookie();
    let ne_cookie = netease_auth.cookie();

    // 1. Load source playlist
    let detail = qqmusic_api::playlist_detail(qq_playlist_id, &qq_cookie)
        .map_err(|e| e.to_string())?;
    let playlist_name = detail.info.name.clone();
    let songs = detail.songs;
    let total = songs.len();

    // 2. Search and match each song on NetEase
    let mut matched_ids: Vec<String> = Vec::new();
    let mut skipped: Vec<SkippedSong> = Vec::new();

    for (i, song) in songs.iter().enumerate() {
        progress_cb(SyncProgress {
            playlist_name: playlist_name.clone(),
            current: i + 1,
            total,
            current_song: format!("{} - {}", song.artist, song.name),
        });

        let keyword = format!("{} {}", song.name, song.artist);
        match netease_api::search_songs(&keyword, 5, &ne_cookie) {
            Ok(results) => {
                let src_name = normalize_for_match(&song.name);
                let src_artist = normalize_for_match(&song.artist);
                let matched = results.iter().find(|r| {
                    normalize_for_match(&r.name) == src_name
                        && normalize_for_match(&r.artist) == src_artist
                });
                if let Some(m) = matched {
                    matched_ids.push(m.id.clone());
                } else {
                    skipped.push(SkippedSong {
                        name: song.name.clone(),
                        artist: song.artist.clone(),
                        reason: "目标平台未找到匹配".into(),
                    });
                }
            }
            Err(e) => {
                skipped.push(SkippedSong {
                    name: song.name.clone(),
                    artist: song.artist.clone(),
                    reason: format!("搜索失败: {e}"),
                });
            }
        }
        thread::sleep(Duration::from_millis(200));
    }

    // 3. Create target playlist
    if matched_ids.is_empty() {
        return Ok(SyncReport {
            playlist_name,
            total,
            matched: 0,
            skipped: skipped.len(),
            skipped_songs: skipped,
        });
    }

    let receipt = netease_api::create_playlist(&playlist_name, &ne_cookie)
        .map_err(|e| e.to_string())?;

    // 4. Add tracks in batches of 100
    for chunk in matched_ids.chunks(100) {
        let ids: Vec<String> = chunk.to_vec();
        netease_api::add_tracks_to_playlist(&receipt.playlist_id, &ids, &ne_cookie)
            .map_err(|e| e.to_string())?;
    }

    Ok(SyncReport {
        playlist_name,
        total,
        matched: matched_ids.len(),
        skipped: skipped.len(),
        skipped_songs: skipped,
    })
}

/// Migrate a single NetEase playlist → QQ Music.
pub fn migrate_netease_to_qq<F>(
    netease_auth: &AuthState,
    qq_auth: &QQAuthState,
    netease_playlist_id: &str,
    progress_cb: &F,
) -> Result<SyncReport, String>
where
    F: Fn(SyncProgress),
{
    let ne_cookie = netease_auth.cookie();
    let qq_cookie = qq_auth.cookie();

    // 1. Load source playlist
    let detail = netease_api::playlist_detail(netease_playlist_id, &ne_cookie, 500)
        .map_err(|e| e.to_string())?;
    let playlist_name = detail.summary.name.clone();
    let songs = detail.tracks;
    let total = songs.len();

    // 2. Search and match each song on QQ Music
    let mut matched_mids: Vec<String> = Vec::new();
    let mut skipped: Vec<SkippedSong> = Vec::new();

    for (i, song) in songs.iter().enumerate() {
        progress_cb(SyncProgress {
            playlist_name: playlist_name.clone(),
            current: i + 1,
            total,
            current_song: format!("{} - {}", song.artist, song.name),
        });

        let keyword = format!("{} {}", song.name, song.artist);
        match qqmusic_api::search_songs(&keyword, 5, &qq_cookie) {
            Ok(results) => {
                let src_name = normalize_for_match(&song.name);
                let src_artist = normalize_for_match(&song.artist);
                let matched = results.iter().find(|r| {
                    normalize_for_match(&r.name) == src_name
                        && normalize_for_match(&r.artist) == src_artist
                });
                if let Some(m) = matched {
                    matched_mids.push(m.mid.clone());
                } else {
                    skipped.push(SkippedSong {
                        name: song.name.clone(),
                        artist: song.artist.clone(),
                        reason: "目标平台未找到匹配".into(),
                    });
                }
            }
            Err(e) => {
                skipped.push(SkippedSong {
                    name: song.name.clone(),
                    artist: song.artist.clone(),
                    reason: format!("搜索失败: {e}"),
                });
            }
        }
        thread::sleep(Duration::from_millis(200));
    }

    // 3. Create target playlist
    if matched_mids.is_empty() {
        return Ok(SyncReport {
            playlist_name,
            total,
            matched: 0,
            skipped: skipped.len(),
            skipped_songs: skipped,
        });
    }

    let receipt = qqmusic_api::create_playlist(&playlist_name, &qq_cookie)
        .map_err(|e| e.to_string())?;

    // 4. Add tracks in batches of 50 (QQ Music limit is lower)
    for chunk in matched_mids.chunks(50) {
        let mids: Vec<String> = chunk.to_vec();
        qqmusic_api::add_to_playlist(&receipt.dirid, &mids, &qq_cookie)
            .map_err(|e| e.to_string())?;
    }

    Ok(SyncReport {
        playlist_name,
        total,
        matched: matched_mids.len(),
        skipped: skipped.len(),
        skipped_songs: skipped,
    })
}
```

- [ ] **Step 2: Register module in `src-tauri/src/lib.rs`**

Add after `pub mod qq_auth;`:

```rust
pub mod sync;
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/fms26/Coding/musicplayer/src-tauri && cargo check
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/sync.rs src-tauri/src/lib.rs
git commit -m "feat: add playlist sync orchestrator (sync.rs)"
```

---

## Task 5: Tauri Commands for QQ Auth + Sync

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (register new commands in invoke_handler)

- [ ] **Step 1: Add QQ auth + sync commands to `src-tauri/src/commands.rs`**

Add these imports at the top of the file, after the existing imports:

```rust
use crate::qq_auth::{QQAuthState, QQSession, QQQrStartReceipt, QQQrCheckOutcome, QQUserProfile as QQUser};
use crate::qqmusic_api::{self, QQPlaylist, QQPlaylistDetail};
use crate::sync::{self, SyncReport, SyncProgress};
```

Add these command functions at the end of the file (before the closing of the module, after `panel_layout_delete`):

```rust
// ---- QQ auth ---------------------------------------------------------------

#[tauri::command]
pub async fn qq_auth_session(qq_auth: State<'_, QQAuthState>) -> Result<QQSession, String> {
    Ok(qq_auth.snapshot())
}

#[tauri::command]
pub async fn qq_auth_qr_start(qq_auth: State<'_, QQAuthState>) -> Result<QQQrStartReceipt, String> {
    let qq_auth = qq_auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || qq_auth.start_qr())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn qq_auth_qr_check(qq_auth: State<'_, QQAuthState>) -> Result<QQQrCheckOutcome, String> {
    let qq_auth = qq_auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || qq_auth.check_qr())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn qq_auth_refresh(qq_auth: State<'_, QQAuthState>) -> Result<Option<QQUser>, String> {
    let qq_auth = qq_auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || qq_auth.refresh())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn qq_auth_logout(qq_auth: State<'_, QQAuthState>) -> Result<(), String> {
    let qq_auth = qq_auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || qq_auth.logout())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---- QQ playlists ----------------------------------------------------------

#[tauri::command]
pub async fn qq_get_playlists(qq_auth: State<'_, QQAuthState>) -> Result<Vec<QQPlaylist>, String> {
    let user = qq_auth
        .current_user()
        .ok_or_else(|| "未登录 QQ 音乐账号".to_string())?;
    let cookie = qq_auth.cookie();
    tauri::async_runtime::spawn_blocking(move || qqmusic_api::user_playlists(&user.uin, &cookie))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn qq_get_playlist_detail(
    qq_auth: State<'_, QQAuthState>,
    disstid: String,
) -> Result<QQPlaylistDetail, String> {
    let cookie = qq_auth.cookie();
    tauri::async_runtime::spawn_blocking(move || qqmusic_api::playlist_detail(&disstid, &cookie))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---- sync ------------------------------------------------------------------

#[tauri::command]
pub async fn sync_playlists(
    app: AppHandle,
    auth: State<'_, AuthState>,
    qq_auth: State<'_, QQAuthState>,
    source: String,
    target: String,
    playlist_ids: Vec<String>,
) -> Result<Vec<SyncReport>, String> {
    let auth = auth.inner().clone();
    let qq_auth = qq_auth.inner().clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut reports = Vec::new();
        let progress_cb = |progress: SyncProgress| {
            let _ = app_handle.emit("sync-progress", &progress);
        };

        for id in &playlist_ids {
            let report = match (source.as_str(), target.as_str()) {
                ("qq", "netease") => {
                    sync::migrate_qq_to_netease(&qq_auth, &auth, id, &progress_cb)
                }
                ("netease", "qq") => {
                    sync::migrate_netease_to_qq(&auth, &qq_auth, id, &progress_cb)
                }
                _ => Err(format!("不支持的迁移方向: {} → {}", source, target)),
            };
            match report {
                Ok(r) => reports.push(r),
                Err(e) => return Err(e),
            }
        }
        Ok(reports)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

- [ ] **Step 2: Register commands in `src-tauri/src/lib.rs` invoke_handler**

Add these entries to the `tauri::generate_handler![]` array, after `commands::panel_persist_geometry,`:

```rust
commands::qq_auth_session,
commands::qq_auth_qr_start,
commands::qq_auth_qr_check,
commands::qq_auth_refresh,
commands::qq_auth_logout,
commands::qq_get_playlists,
commands::qq_get_playlist_detail,
commands::sync_playlists,
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/fms26/Coding/musicplayer/src-tauri && cargo check
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for QQ auth + playlist sync"
```

---

## Task 6: Frontend TypeScript API Bindings

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add QQ types and API bindings to `src/lib/api.ts`**

Add these types after the existing `Session` interface (around line 58):

```typescript
// ---- QQ Music types -------------------------------------------------------

export interface QQUserProfile {
  uin: string;
  nickname: string;
  avatar_url: string;
}

export interface QQSession {
  cookie: string;
  pending_qrsig: string;
  pending_ptqrtoken: string;
  user: QQUserProfile | null;
}

export interface QQQrStartReceipt {
  qrsig: string;
  ptqrtoken: string;
  qr_img: string;
}

export type QQQrCheckOutcome =
  | { status: "waiting" }
  | { status: "scanned" }
  | { status: "expired" }
  | { status: "ok"; user: QQUserProfile };

export interface QQSong {
  mid: string;
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
}

export interface QQPlaylist {
  disstid: string;
  name: string;
  song_cnt: number;
  cover: string;
}

export interface QQPlaylistDetail {
  info: QQPlaylist;
  songs: QQSong[];
}

export interface SyncReport {
  playlist_name: string;
  total: number;
  matched: number;
  skipped: number;
  skipped_songs: SkippedSong[];
}

export interface SkippedSong {
  name: string;
  artist: string;
  reason: string;
}

export interface SyncProgress {
  playlist_name: string;
  current: number;
  total: number;
  current_song: string;
}
```

Add these methods inside the `api` object, after the `addTracksToPlaylist` method:

```typescript
  // ---- QQ auth ----
  async qqSession() {
    return invoke<QQSession>("qq_auth_session");
  },
  async qqQrStart() {
    return invoke<QQQrStartReceipt>("qq_auth_qr_start");
  },
  async qqQrCheck() {
    return invoke<QQQrCheckOutcome>("qq_auth_qr_check");
  },
  async qqRefresh() {
    return invoke<QQUserProfile | null>("qq_auth_refresh");
  },
  async qqLogout() {
    return invoke<void>("qq_auth_logout");
  },

  // ---- QQ catalog ----
  async qqGetPlaylists() {
    return invoke<QQPlaylist[]>("qq_get_playlists");
  },
  async qqGetPlaylistDetail(disstid: string) {
    return invoke<QQPlaylistDetail>("qq_get_playlist_detail", { disstid });
  },

  // ---- sync ----
  async syncPlaylists(
    source: "qq" | "netease",
    target: "qq" | "netease",
    playlistIds: string[],
  ) {
    return invoke<SyncReport[]>("sync_playlists", {
      source,
      target,
      playlistIds,
    });
  },
```

Add a sync progress event listener after the `onPanelClosed` function:

```typescript
export function onSyncProgress(
  handler: (progress: SyncProgress) => void,
): Promise<UnlistenFn> {
  return listen<SyncProgress>("sync-progress", (event) =>
    handler(event.payload),
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /Users/fms26/Coding/musicplayer && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add QQ auth + sync TypeScript API bindings"
```

---

## Task 7: PlaylistSync React Plugin

**Files:**
- Create: `src/plugins/PlaylistSync/PlaylistSync.tsx`
- Create: `src/plugins/PlaylistSync/index.ts`
- Modify: `src/plugins/index.ts`

- [ ] **Step 1: Create `src/plugins/PlaylistSync/index.ts`**

```typescript
export { PlaylistSync } from "./PlaylistSync";
```

- [ ] **Step 2: Create `src/plugins/PlaylistSync/PlaylistSync.tsx`**

This is the main panel component implementing the UI state machine: Idle → Login → SelectPlaylists → Syncing → Report.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelProps } from "@/lib/panelTypes";
import {
  api,
  onSyncProgress,
  type QQPlaylist,
  type QQQrCheckOutcome,
  type QQUserProfile,
  type Playlist,
  type SyncProgress,
  type SyncReport,
  type UserProfile,
} from "@/lib/api";

type Direction = "qq-to-netease" | "netease-to-qq";
type Phase = "idle" | "login" | "select" | "syncing" | "report";

export function PlaylistSync(_props: PanelProps) {
  // ---- auth state ----
  const [neUser, setNeUser] = useState<UserProfile | null>(null);
  const [qqUser, setQQUser] = useState<QQUserProfile | null>(null);
  const [qqQrImg, setQQQrImg] = useState("");
  const [qqQrPolling, setQQQrPolling] = useState(false);

  // ---- UI state ----
  const [phase, setPhase] = useState<Phase>("idle");
  const [direction, setDirection] = useState<Direction>("qq-to-netease");
  const [sourcePlaylists, setSourcePlaylists] = useState<
    (QQPlaylist | Playlist)[]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [reports, setReports] = useState<SyncReport[]>([]);
  const [error, setError] = useState("");
  const [expandedReport, setExpandedReport] = useState<number | null>(null);

  const qqPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- load auth state on mount ----
  useEffect(() => {
    (async () => {
      try {
        const neSession = await api.session();
        setNeUser(neSession.user);
      } catch {}
      try {
        const qqSession = await api.qqSession();
        setQQUser(qqSession.user);
      } catch {}
    })();
  }, []);

  // ---- auto-advance to select when both logged in ----
  useEffect(() => {
    if (neUser && qqUser && phase === "idle") {
      setPhase("select");
      loadPlaylists();
    }
  }, [neUser, qqUser, phase]);

  // ---- subscribe to sync progress events ----
  useEffect(() => {
    const unlisten = onSyncProgress((p) => setProgress(p));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ---- cleanup QR polling ----
  useEffect(() => {
    return () => {
      if (qqPollRef.current) clearInterval(qqPollRef.current);
    };
  }, []);

  // ---- QQ QR login ----
  const startQQLogin = useCallback(async () => {
    setError("");
    try {
      const receipt = await api.qqQrStart();
      setQQQrImg(receipt.qr_img);
      setQQQrPolling(true);
      setPhase("login");

      if (qqPollRef.current) clearInterval(qqPollRef.current);
      qqPollRef.current = setInterval(async () => {
        try {
          const outcome: QQQrCheckOutcome = await api.qqQrCheck();
          if (outcome.status === "ok") {
            setQQUser(outcome.user);
            setQQQrPolling(false);
            setQQQrImg("");
            if (qqPollRef.current) clearInterval(qqPollRef.current);
          } else if (outcome.status === "expired") {
            setQQQrPolling(false);
            setQQQrImg("");
            setError("QR 码已过期，请重新扫码");
            if (qqPollRef.current) clearInterval(qqPollRef.current);
          }
        } catch {}
      }, 2000);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ---- load playlists from source ----
  const loadPlaylists = useCallback(async () => {
    setError("");
    try {
      if (direction === "qq-to-netease") {
        const list = await api.qqGetPlaylists();
        setSourcePlaylists(list);
      } else {
        const list = await api.getUserPlaylists();
        setSourcePlaylists(list);
      }
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    }
  }, [direction]);

  // ---- toggle direction ----
  const toggleDirection = useCallback(() => {
    const next: Direction =
      direction === "qq-to-netease" ? "netease-to-qq" : "qq-to-netease";
    setDirection(next);
    setSourcePlaylists([]);
    setSelected(new Set());
  }, [direction]);

  // reload playlists when direction changes and phase is select
  useEffect(() => {
    if (phase === "select") loadPlaylists();
  }, [direction, phase]);

  // ---- toggle selection ----
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- start sync ----
  const startSync = useCallback(async () => {
    if (selected.size === 0) return;
    setPhase("syncing");
    setProgress(null);
    setError("");
    try {
      const source = direction === "qq-to-netease" ? "qq" : "netease";
      const target = direction === "qq-to-netease" ? "netease" : "qq";
      const ids = Array.from(selected);
      const results = await api.syncPlaylists(
        source as "qq" | "netease",
        target as "qq" | "netease",
        ids,
      );
      setReports(results);
      setPhase("report");
    } catch (e) {
      setError(String(e));
      setPhase("select");
    }
  }, [selected, direction]);

  // ---- helpers ----
  const getPlaylistId = (p: QQPlaylist | Playlist): string => {
    return "disstid" in p ? p.disstid : p.id;
  };
  const getPlaylistName = (p: QQPlaylist | Playlist): string => p.name;
  const getPlaylistCount = (p: QQPlaylist | Playlist): number => {
    return "song_cnt" in p ? p.song_cnt : p.track_count;
  };

  const sourceName = direction === "qq-to-netease" ? "QQ 音乐" : "网易云";
  const targetName = direction === "qq-to-netease" ? "网易云" : "QQ 音乐";

  // ---- render ----
  return (
    <div className="flex flex-col h-full bg-black/90 text-white p-4 gap-4 overflow-y-auto select-none">
      {/* Header */}
      <div className="text-center text-lg font-medium tracking-wide opacity-90">
        歌单迁移
      </div>

      {/* Platform status */}
      <div className="flex items-center justify-center gap-3">
        <div className="flex flex-col items-center gap-1 px-4 py-2 rounded-lg bg-white/5">
          <span className="text-xs opacity-60">{sourceName}</span>
          <span className="text-xs">
            {direction === "qq-to-netease"
              ? qqUser
                ? `✓ ${qqUser.nickname}`
                : "未登录"
              : neUser
                ? `✓ ${neUser.nickname}`
                : "未登录"}
          </span>
        </div>
        <span className="opacity-40">→</span>
        <div className="flex flex-col items-center gap-1 px-4 py-2 rounded-lg bg-white/5">
          <span className="text-xs opacity-60">{targetName}</span>
          <span className="text-xs">
            {direction === "qq-to-netease"
              ? neUser
                ? `✓ ${neUser.nickname}`
                : "未登录"
              : qqUser
                ? `✓ ${qqUser.nickname}`
                : "未登录"}
          </span>
        </div>
      </div>

      {/* Direction toggle */}
      {phase !== "syncing" && (
        <button
          onClick={toggleDirection}
          className="mx-auto text-xs px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
        >
          切换方向 ⇄
        </button>
      )}

      {/* Login section */}
      {!qqUser && phase !== "syncing" && (
        <div className="flex flex-col items-center gap-2 py-4">
          {qqQrImg ? (
            <>
              <p className="text-xs opacity-60">用 QQ 扫描二维码登录</p>
              <img
                src={qqQrImg}
                alt="QQ QR Code"
                className="w-48 h-48 rounded-lg"
              />
              {qqQrPolling && (
                <p className="text-xs opacity-40 animate-pulse">等待扫码...</p>
              )}
            </>
          ) : (
            <button
              onClick={startQQLogin}
              className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm"
            >
              登录 QQ 音乐
            </button>
          )}
        </div>
      )}

      {!neUser && phase !== "syncing" && (
        <p className="text-center text-xs opacity-60">
          请先在主界面登录网易云音乐账号
        </p>
      )}

      {/* Error display */}
      {error && (
        <div className="text-xs text-red-400 text-center py-1">{error}</div>
      )}

      {/* Playlist selection */}
      {phase === "select" && sourcePlaylists.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs opacity-60 mb-1">选择要迁移的歌单：</p>
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {sourcePlaylists.map((p) => {
              const id = getPlaylistId(p);
              const isSelected = selected.has(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleSelect(id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-white/15 text-white"
                      : "bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                >
                  <span className="w-4 text-center">
                    {isSelected ? "☑" : "☐"}
                  </span>
                  <span className="flex-1 truncate">{getPlaylistName(p)}</span>
                  <span className="text-xs opacity-40">
                    {getPlaylistCount(p)}首
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={startSync}
            disabled={selected.size === 0}
            className={`mt-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selected.size > 0
                ? "bg-white/20 hover:bg-white/30 text-white"
                : "bg-white/5 text-white/30 cursor-not-allowed"
            }`}
          >
            开始迁移 ({selected.size} 个歌单)
          </button>
        </div>
      )}

      {/* Syncing progress */}
      {phase === "syncing" && progress && (
        <div className="flex flex-col gap-2 py-4">
          <p className="text-xs opacity-60">
            正在迁移: {progress.playlist_name}
          </p>
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/40 rounded-full transition-all duration-300"
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
              }}
            />
          </div>
          <p className="text-xs opacity-40">
            {progress.current}/{progress.total} — {progress.current_song}
          </p>
        </div>
      )}
      {phase === "syncing" && !progress && (
        <p className="text-center text-xs opacity-40 animate-pulse py-4">
          准备中...
        </p>
      )}

      {/* Report */}
      {phase === "report" && reports.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium opacity-80">迁移完成</p>
          {reports.map((r, i) => (
            <div key={i} className="bg-white/5 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm truncate">{r.playlist_name}</span>
              </div>
              <div className="flex gap-4 text-xs opacity-60">
                <span>✓ 成功 {r.matched}</span>
                <span>⚠ 跳过 {r.skipped}</span>
                <span>共 {r.total}</span>
              </div>
              {r.skipped > 0 && (
                <button
                  onClick={() =>
                    setExpandedReport(expandedReport === i ? null : i)
                  }
                  className="text-xs mt-2 text-white/40 hover:text-white/60 transition-colors"
                >
                  {expandedReport === i ? "收起" : "查看跳过详情"}
                </button>
              )}
              {expandedReport === i && r.skipped_songs.length > 0 && (
                <div className="mt-2 flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {r.skipped_songs.map((s, j) => (
                    <div key={j} className="text-xs opacity-40 truncate">
                      {s.artist} - {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={() => {
              setPhase("select");
              setReports([]);
              setExpandedReport(null);
              loadPlaylists();
            }}
            className="mt-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors"
          >
            再次迁移
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register plugin in `src/plugins/index.ts`**

Add import:

```typescript
import { PlaylistSync } from "./PlaylistSync";
```

Add to the `PANEL_PLUGINS` array:

```typescript
{
  id: "playlist_sync",
  name: "歌单迁移",
  icon: "🔄",
  minSize: { w: 360, h: 500 },
  defaultSize: { w: 420, h: 650 },
  component: PlaylistSync,
  requiredCapabilities: [],
},
```

- [ ] **Step 4: Verify frontend compilation**

```bash
cd /Users/fms26/Coding/musicplayer && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/plugins/PlaylistSync/ src/plugins/index.ts
git commit -m "feat: add PlaylistSync panel plugin (frontend)"
```

---

## Task 8: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Verify full Rust build**

```bash
cd /Users/fms26/Coding/musicplayer/src-tauri && cargo build
```

Expected: compiles without errors.

- [ ] **Step 2: Verify full frontend build**

```bash
cd /Users/fms26/Coding/musicplayer && npm run build
```

Expected: TypeScript and Vite build both succeed.

- [ ] **Step 3: Verify Tauri dev server starts**

```bash
cd /Users/fms26/Coding/musicplayer && npx tauri dev
```

Expected: app starts, PlaylistSync panel can be opened from the panel cabinet.

- [ ] **Step 4: Manual smoke test**

1. Open the 🔄 歌单迁移 panel
2. Verify QQ Music QR login flow works (scan → get user info)
3. Verify playlist loading from QQ Music
4. Verify migration of a small playlist (1-2 songs) QQ → NetEase
5. Verify the report shows correct matched/skipped counts

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues from integration testing"
```
