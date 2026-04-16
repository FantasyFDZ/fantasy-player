// Phase 1 entrypoint.

pub mod audio_analyzer;
pub mod auth;
pub mod commands;
pub mod db;
pub mod llm_client;
pub mod logger;
pub mod netease_api;
pub mod player;
pub mod qq_auth;
pub mod qqmusic_api;
pub mod queue;
pub mod sync;

use tauri::Manager;

use auth::AuthState;
use db::Db;
use llm_client::LlmClient;
use player::PlayerState;
use qq_auth::QQAuthState;
use queue::QueueState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let auth = AuthState::load();
    let qq_auth = QQAuthState::load();
    let player = PlayerState::new();
    let queue = QueueState::new();
    let db = Db::open_default().expect("failed to open melody.db");
    // 首次启动时植入 4 个默认 Provider（api_key 为空，由用户后续填入）
    let _ = db.seed_providers_if_empty();
    let llm = LlmClient::new();

    // 启动时做一次 cookie 刷新（非阻塞——失败不影响启动）。
    let auth_for_refresh = auth.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || auth_for_refresh.refresh()).await;
    });

    // QQ 音乐 cookie 刷新
    let qq_auth_for_refresh = qq_auth.clone();
    tauri::async_runtime::spawn(async move {
        let _ =
            tauri::async_runtime::spawn_blocking(move || qq_auth_for_refresh.refresh()).await;
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(auth)
        .manage(qq_auth)
        .manage(player)
        .manage(queue)
        .manage(db)
        .manage(llm)
        .setup(|app| {
            // macOS：把窗口和 webview 背景设为完全透明，去掉白色边框
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    use objc2_app_kit::{NSColor, NSWindow};
                    use objc2_foundation::MainThreadMarker;
                    let ns_win: *mut std::ffi::c_void = win.ns_window()
                        .map_err(|e| e.to_string())?;
                    unsafe {
                        let _mtm = MainThreadMarker::new().unwrap();
                        let ns_window: &NSWindow = &*(ns_win as *const NSWindow);
                        ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
                        ns_window.setHasShadow(false);
                    }
                }
            }
            Ok(())
        })
        // 主窗口关闭 → 杀 mpv + 退出 app（macOS 默认只关窗口不退出）
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    if let Some(p) = window.app_handle().try_state::<PlayerState>() {
                        p.quit();
                    }
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::write_log,
            commands::auth_session,
            commands::auth_qr_start,
            commands::auth_qr_check,
            commands::auth_refresh,
            commands::auth_logout,
            commands::search_songs,
            commands::get_lyric,
            commands::get_user_playlists,
            commands::get_playlist_detail,
            commands::get_song_comments,
            commands::create_playlist,
            commands::add_tracks_to_playlist,
            commands::remove_tracks_from_playlist,
            commands::play_song,
            commands::pause,
            commands::resume,
            commands::seek,
            commands::set_volume,
            commands::stop,
            commands::playback_status,
            commands::queue_snapshot,
            commands::queue_set_mode,
            commands::queue_append,
            commands::queue_play_next,
            commands::queue_remove,
            commands::queue_clear,
            commands::queue_replace,
            commands::next_track,
            commands::prev_track,
            commands::get_setting,
            commands::set_setting,
            commands::llm_providers_list,
            commands::llm_provider_upsert,
            commands::llm_provider_delete,
            commands::llm_request,
            commands::llm_stream,
            commands::analyze_song,
            commands::update_song_bpm,
            commands::qq_auth_session,
            commands::qq_auth_login_cookie,
            commands::qq_auth_refresh,
            commands::qq_auth_logout,
            commands::qq_get_playlists,
            commands::qq_get_playlist_detail,
            commands::sync_playlists,
            commands::panel_layout_list,
            commands::panel_layout_upsert,
            commands::panel_layout_delete,
            commands::panel_open,
            commands::panel_close,
            commands::panel_open_list,
            commands::panel_persist_geometry,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 程序坞右键 Quit / 系统终止信号 → 杀 mpv
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(p) = app_handle.try_state::<PlayerState>() {
                    p.quit();
                }
            }
        });
}
