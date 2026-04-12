//! Tauri commands——前端唯一的后端入口。
//!
//! 约定：
//! - 所有错误通过 `Result<T, String>` 返回，前端直接显示
//! - 阻塞操作（spawn node）用 `tauri::async_runtime::spawn_blocking` 包裹
//! - State: AuthState / PlayerState / QueueState / Db

use tauri::{AppHandle, Emitter, Manager, State};
use tauri::{WebviewUrl, WebviewWindowBuilder};

use crate::audio_analyzer::{self, AudioFeatures};
use crate::auth::{AuthState, QrCheckOutcome, QrStartReceipt, Session};
use crate::db::{Db, PanelLayoutRow};
use crate::llm_client::{LlmClient, LlmRequest, LlmResponse, Provider};
use crate::netease_api::{self, PlaylistDetail, Song, Playlist, Lyric};
use crate::player::{PlaybackStatus, PlayerState};
use crate::queue::{PlayMode, QueueSnapshot, QueueState};

// ---- auth ------------------------------------------------------------------

#[tauri::command]
pub async fn auth_session(auth: State<'_, AuthState>) -> Result<Session, String> {
    Ok(auth.snapshot())
}

#[tauri::command]
pub async fn auth_qr_start(auth: State<'_, AuthState>) -> Result<QrStartReceipt, String> {
    // inner uses blocking node spawn
    let auth = auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || auth.start_qr())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_qr_check(auth: State<'_, AuthState>) -> Result<QrCheckOutcome, String> {
    let auth = auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || auth.check_qr())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_refresh(auth: State<'_, AuthState>) -> Result<Option<crate::auth::UserProfile>, String> {
    let auth = auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || auth.refresh())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_logout(auth: State<'_, AuthState>) -> Result<(), String> {
    let auth = auth.inner().clone();
    tauri::async_runtime::spawn_blocking(move || auth.logout())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---- netease catalog -------------------------------------------------------

#[tauri::command]
pub async fn search_songs(
    auth: State<'_, AuthState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<Song>, String> {
    let cookie = auth.cookie();
    let limit = limit.unwrap_or(30);
    tauri::async_runtime::spawn_blocking(move || netease_api::search_songs(&query, limit, &cookie))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_lyric(auth: State<'_, AuthState>, id: String) -> Result<Lyric, String> {
    let cookie = auth.cookie();
    tauri::async_runtime::spawn_blocking(move || netease_api::lyric(&id, &cookie))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user_playlists(
    auth: State<'_, AuthState>,
    limit: Option<u32>,
) -> Result<Vec<Playlist>, String> {
    let user = auth
        .current_user()
        .ok_or_else(|| "未登录网易云账号".to_string())?;
    let cookie = auth.cookie();
    let limit = limit.unwrap_or(100);
    tauri::async_runtime::spawn_blocking(move || {
        netease_api::user_playlists(&user.user_id, &cookie, limit)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_playlist_detail(
    auth: State<'_, AuthState>,
    id: String,
    limit: Option<u32>,
) -> Result<PlaylistDetail, String> {
    let cookie = auth.cookie();
    let limit = limit.unwrap_or(500);
    tauri::async_runtime::spawn_blocking(move || netease_api::playlist_detail(&id, &cookie, limit))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---- playback --------------------------------------------------------------

#[tauri::command]
pub async fn play_song(
    app: AppHandle,
    auth: State<'_, AuthState>,
    player: State<'_, PlayerState>,
    queue: State<'_, QueueState>,
    song: Song,
) -> Result<PlaybackStatus, String> {
    player.ensure_running(app.clone()).map_err(|e| e.to_string())?;
    let cookie = auth.cookie();
    let id = song.id.clone();

    // 替换队列为单曲
    queue.replace(vec![song.clone()], 0);

    let url = tauri::async_runtime::spawn_blocking(move || {
        netease_api::song_url(&id, "standard", &cookie)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if url.url.is_empty() {
        return Err("未能获取歌曲播放链接（可能需要登录或 VIP）".into());
    }
    player.load_url(&url.url).map_err(|e| e.to_string())?;
    let _ = app.emit("melody://song-changed", &song);
    Ok(player.status())
}

#[tauri::command]
pub async fn pause(player: State<'_, PlayerState>) -> Result<(), String> {
    player.pause().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resume(player: State<'_, PlayerState>) -> Result<(), String> {
    player.resume().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn seek(player: State<'_, PlayerState>, position: f64) -> Result<(), String> {
    player.seek(position).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_volume(player: State<'_, PlayerState>, volume: f64) -> Result<(), String> {
    player.set_volume(volume).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop(player: State<'_, PlayerState>) -> Result<(), String> {
    player.stop().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn playback_status(player: State<'_, PlayerState>) -> Result<PlaybackStatus, String> {
    Ok(player.status())
}

// ---- queue -----------------------------------------------------------------

#[tauri::command]
pub async fn queue_snapshot(queue: State<'_, QueueState>) -> Result<QueueSnapshot, String> {
    Ok(queue.snapshot())
}

#[tauri::command]
pub async fn queue_set_mode(queue: State<'_, QueueState>, mode: PlayMode) -> Result<(), String> {
    queue.set_mode(mode);
    Ok(())
}

#[tauri::command]
pub async fn queue_append(queue: State<'_, QueueState>, song: Song) -> Result<(), String> {
    queue.append(song);
    Ok(())
}

#[tauri::command]
pub async fn queue_play_next(queue: State<'_, QueueState>, song: Song) -> Result<(), String> {
    queue.play_next(song);
    Ok(())
}

#[tauri::command]
pub async fn queue_remove(queue: State<'_, QueueState>, index: usize) -> Result<bool, String> {
    Ok(queue.remove(index))
}

#[tauri::command]
pub async fn queue_clear(queue: State<'_, QueueState>) -> Result<(), String> {
    queue.clear();
    Ok(())
}

#[tauri::command]
pub async fn queue_replace(
    app: AppHandle,
    auth: State<'_, AuthState>,
    player: State<'_, PlayerState>,
    queue: State<'_, QueueState>,
    tracks: Vec<Song>,
    start_index: Option<usize>,
) -> Result<(), String> {
    let start = queue
        .replace(tracks, start_index.unwrap_or(0))
        .ok_or_else(|| "空队列".to_string())?;
    play_current(app, auth, player, start).await
}

#[tauri::command]
pub async fn next_track(
    app: AppHandle,
    auth: State<'_, AuthState>,
    player: State<'_, PlayerState>,
    queue: State<'_, QueueState>,
    auto_advance: Option<bool>,
) -> Result<Option<Song>, String> {
    let Some(song) = queue.next(auto_advance.unwrap_or(false)) else {
        return Ok(None);
    };
    play_current(app, auth, player, song.clone()).await?;
    Ok(Some(song))
}

#[tauri::command]
pub async fn prev_track(
    app: AppHandle,
    auth: State<'_, AuthState>,
    player: State<'_, PlayerState>,
    queue: State<'_, QueueState>,
) -> Result<Option<Song>, String> {
    let Some(song) = queue.prev() else {
        return Ok(None);
    };
    play_current(app, auth, player, song.clone()).await?;
    Ok(Some(song))
}

// 内部工具：拿到一首歌 → 取 URL → load。命令层复用。
// 成功后广播 melody://song-changed 事件，所有窗口都能收到。
async fn play_current(
    app: AppHandle,
    auth: State<'_, AuthState>,
    player: State<'_, PlayerState>,
    song: Song,
) -> Result<(), String> {
    player.ensure_running(app.clone()).map_err(|e| e.to_string())?;
    let cookie = auth.cookie();
    let id = song.id.clone();
    let url = tauri::async_runtime::spawn_blocking(move || {
        netease_api::song_url(&id, "standard", &cookie)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if url.url.is_empty() {
        return Err("未能获取歌曲播放链接（可能需要登录或 VIP）".into());
    }
    player.load_url(&url.url).map_err(|e| e.to_string())?;
    // 广播 —— 主窗口和各面板子窗口都订阅此事件
    let _ = app.emit("melody://song-changed", &song);
    Ok(())
}

// ---- settings --------------------------------------------------------------

#[tauri::command]
pub async fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    db.upsert_setting(&key, &value).map_err(|e| e.to_string())
}

// ---- LLM -------------------------------------------------------------------

#[tauri::command]
pub async fn llm_providers_list(
    llm: State<'_, LlmClient>,
    db: State<'_, Db>,
) -> Result<Vec<Provider>, String> {
    llm.list_providers(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn llm_provider_upsert(
    llm: State<'_, LlmClient>,
    db: State<'_, Db>,
    provider: Provider,
) -> Result<(), String> {
    llm.upsert_provider(&db, provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn llm_provider_delete(
    llm: State<'_, LlmClient>,
    db: State<'_, Db>,
    id: String,
) -> Result<(), String> {
    llm.delete_provider(&db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn llm_request(
    llm: State<'_, LlmClient>,
    db: State<'_, Db>,
    req: LlmRequest,
) -> Result<LlmResponse, String> {
    llm.request(&db, req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn llm_stream(
    app: AppHandle,
    llm: State<'_, LlmClient>,
    db: State<'_, Db>,
    request_id: String,
    req: LlmRequest,
) -> Result<LlmResponse, String> {
    llm.stream(&db, &app, &request_id, req)
        .await
        .map_err(|e| e.to_string())
}

// ---- Panel windows ---------------------------------------------------------
//
// 每个面板都是一个独立的 Tauri WebviewWindow，URL 为
// `index.html?panel=<id>`。关闭时通过 window event 触发
// `melody://panel-closed` 广播给主窗口同步 UI 状态。

#[tauri::command]
pub async fn panel_open(
    app: AppHandle,
    db: State<'_, Db>,
    panel_id: String,
    default_width: Option<f64>,
    default_height: Option<f64>,
) -> Result<(), String> {
    // 已存在则 focus
    if let Some(window) = app.get_webview_window(&panel_id) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    // 恢复持久化的位置和大小
    let saved = db.panel_layout_get(&panel_id).map_err(|e| e.to_string())?;
    let width = saved.as_ref().map(|r| r.width).unwrap_or_else(|| default_width.unwrap_or(360.0));
    let height = saved.as_ref().map(|r| r.height).unwrap_or_else(|| default_height.unwrap_or(480.0));

    let url = WebviewUrl::App(format!("index.html?panel={panel_id}").into());
    let mut builder = WebviewWindowBuilder::new(&app, panel_id.clone(), url)
        .title(format!("Melody · {panel_id}"))
        .inner_size(width, height)
        .min_inner_size(280.0, 280.0)
        .resizable(true);

    // 尝试恢复位置
    if let Some(s) = saved.as_ref() {
        builder = builder.position(s.x, s.y);
    }

    let window = builder.build().map_err(|e: tauri::Error| e.to_string())?;

    // 持久化 visible=true
    let _ = db.panel_layout_upsert(&PanelLayoutRow {
        panel_id: panel_id.clone(),
        x: saved.as_ref().map(|r| r.x).unwrap_or(80.0),
        y: saved.as_ref().map(|r| r.y).unwrap_or(80.0),
        width,
        height,
        visible: true,
    });

    // 监听窗口事件：close → emit panel-closed + 更新 DB visible
    // move/resize → debounced persist 位置和大小
    let app_for_event = app.clone();
    let panel_id_for_event = panel_id.clone();
    let db_label = panel_id.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Destroyed => {
            let _ = app_for_event.emit("melody://panel-closed", &panel_id_for_event);
            // 把 visible=false 写回 DB（下次打开时保留位置/大小）
            if let Some(db) = app_for_event.try_state::<Db>() {
                if let Ok(Some(mut row)) = db.panel_layout_get(&db_label) {
                    row.visible = false;
                    let _ = db.panel_layout_upsert(&row);
                }
            }
        }
        _ => {}
    });

    Ok(())
}

#[tauri::command]
pub async fn panel_close(app: AppHandle, panel_id: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&panel_id) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 主窗口启动时调用：返回当前打开的面板 id 列表（通过检查 Tauri 窗口注册表）
#[tauri::command]
pub async fn panel_open_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|k| k.as_str() != "main")
        .cloned()
        .collect();
    labels.sort();
    Ok(labels)
}

/// 面板窗口退出前主动保存位置和大小（由前端在 window close 前调用）
#[tauri::command]
pub async fn panel_persist_geometry(
    app: AppHandle,
    db: State<'_, Db>,
    panel_id: String,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&panel_id) else {
        return Ok(());
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let row = PanelLayoutRow {
        panel_id: panel_id.clone(),
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        visible: true,
    };
    db.panel_layout_upsert(&row).map_err(|e| e.to_string())
}

// ---- Panel layout ----------------------------------------------------------

#[tauri::command]
pub async fn panel_layout_list(db: State<'_, Db>) -> Result<Vec<PanelLayoutRow>, String> {
    db.panel_layout_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn panel_layout_upsert(
    db: State<'_, Db>,
    row: PanelLayoutRow,
) -> Result<(), String> {
    db.panel_layout_upsert(&row).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn panel_layout_delete(
    db: State<'_, Db>,
    panel_id: String,
) -> Result<(), String> {
    db.panel_layout_delete(&panel_id).map_err(|e| e.to_string())
}

// ---- Audio analysis --------------------------------------------------------

#[tauri::command]
pub async fn analyze_song(
    auth: State<'_, AuthState>,
    db: State<'_, Db>,
    song: Song,
) -> Result<AudioFeatures, String> {
    // 缓存命中直接返回
    if let Some(cached) = db.song_feature_get(&song.id).map_err(|e| e.to_string())? {
        return Ok(cached);
    }

    // 将歌曲元数据写入 songs 表（满足 song_features 的 FK 约束）
    db.song_upsert(
        &song.id,
        &song.name,
        &song.artist,
        &song.album,
        &song.cover_url,
        song.duration_secs,
    )
    .map_err(|e| e.to_string())?;

    // 取 stream URL（通过 cookie，允许 VIP 曲目）
    let cookie = auth.cookie();
    let id_for_url = song.id.clone();
    let url = tauri::async_runtime::spawn_blocking(move || {
        netease_api::song_url(&id_for_url, "standard", &cookie)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if url.url.is_empty() {
        return Err("未能获取歌曲音频链接".into());
    }

    // spawn_blocking 里做下载 + python sidecar
    // tauri state 跨线程不易 move，开一个新的 Db handle 复用磁盘文件
    let db_for_call = Db::open_default().map_err(|e| e.to_string())?;
    let audio_url = url.url.clone();
    let song_id_for_call = song.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        audio_analyzer::analyze_song_blocking(&db_for_call, &song_id_for_call, &audio_url)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
