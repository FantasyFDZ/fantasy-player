// Phase 1 entrypoint.

pub mod auth;
pub mod commands;
pub mod db;
pub mod netease_api;
pub mod player;
pub mod queue;

use auth::AuthState;
use db::Db;
use player::PlayerState;
use queue::QueueState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let auth = AuthState::load();
    let player = PlayerState::new();
    let queue = QueueState::new();
    let db = Db::open_default().expect("failed to open melody.db");

    // 启动时做一次 cookie 刷新（非阻塞——失败不影响启动）。
    let auth_for_refresh = auth.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || auth_for_refresh.refresh()).await;
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(auth)
        .manage(player)
        .manage(queue)
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            commands::auth_session,
            commands::auth_qr_start,
            commands::auth_qr_check,
            commands::auth_refresh,
            commands::auth_logout,
            commands::search_songs,
            commands::get_lyric,
            commands::get_user_playlists,
            commands::get_playlist_detail,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
