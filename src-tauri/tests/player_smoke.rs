//! player.rs 的烟测。
//!
//! 真正启动 mpv 子进程，验证 IPC 往返。运行后会在 ~/.config/melody/
//! 留下一个 idle 的 mpv 进程——测试后需手动 `pkill mpv` 或靠
//! ensure_running 的幂等性跳过。
//!
//! 运行：`cargo test --test player_smoke -- --nocapture`

use std::thread;
use std::time::Duration;

use melody_lib::player::PlayerState;

#[test]
fn mpv_lifecycle_with_lavfi_source() {
    // 手动 spawn——不经过 AppHandle，因为 watcher 需要 Tauri 运行时，
    // 这里只测 IPC 往返，不启动 watcher。
    melody_lib::player::__test_start_mpv().expect("start mpv");

    let state = PlayerState::new();

    // 用 mpv 内置的 null audio source 作为测试流——无需网络或真实文件。
    state
        .load_url("av://lavfi:anullsrc=r=44100:cl=stereo")
        .expect("load anullsrc");

    // 等一小会儿让 mpv 真正开始播
    thread::sleep(Duration::from_millis(400));

    // 音量设置应成功
    state.set_volume(50.0).expect("set volume");

    // 暂停与恢复应成功
    state.pause().expect("pause");
    thread::sleep(Duration::from_millis(150));
    state.resume().expect("resume");

    // Seek 到 0 应成功
    state.seek(0.0).expect("seek");

    // Stop 清理
    state.stop().expect("stop");
}
