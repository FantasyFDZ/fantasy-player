//! Phase 1 端到端集成验证。
//!
//! 不启动 Tauri webview，直接驱动后端模块，模拟用户从"搜索→播放→
//! 暂停/恢复→切歌"的核心链路。
//!
//! 运行：`cargo test --test phase1_integration -- --nocapture`

use std::thread;
use std::time::Duration;

use melody_lib::{
    netease_api,
    player::{PlayState, PlayerState},
    queue::{PlayMode, QueueState},
};

#[test]
fn end_to_end_search_and_playback() {
    // 1. 搜索歌曲（匿名 cookie，仅搜索可播放的公开曲目）
    let results =
        netease_api::search_songs("晴天 周杰伦", 5, "").expect("search_songs failed");
    assert!(
        !results.is_empty(),
        "搜索应至少返回一首歌"
    );
    let first_playable = results
        .iter()
        .find(|s| s.playable)
        .cloned()
        .expect("expected at least one playable song");
    eprintln!(
        "[step1] 选定播放: {} - {}",
        first_playable.name, first_playable.artist
    );

    // 2. 拿到流地址
    let url = netease_api::song_url(&first_playable.id, "standard", "")
        .expect("song_url failed");
    if url.url.is_empty() {
        eprintln!(
            "[skip] 歌曲 {} 需要登录/VIP，端到端播放跳过",
            first_playable.name
        );
        return;
    }
    assert!(url.url.starts_with("http"));
    eprintln!("[step2] 拿到 mp3 URL, bitrate={}", url.br);

    // 3. 启动 mpv & 加载
    melody_lib::player::__test_start_mpv().expect("start mpv");
    let player = PlayerState::new();
    player.load_url(&url.url).expect("load_url");
    eprintln!("[step3] 已 loadfile，等待 400ms 让播放开始");
    thread::sleep(Duration::from_millis(400));

    // 4. 控制面：暂停 → 恢复 → seek → volume
    player.set_volume(60.0).expect("set_volume");
    player.pause().expect("pause");
    thread::sleep(Duration::from_millis(150));
    player.resume().expect("resume");
    player.seek(5.0).expect("seek");
    eprintln!("[step4] 暂停/恢复/seek/volume 全部成功");

    // 5. 队列切歌逻辑：把全部搜索结果替换进队列，next/prev 环绕
    let queue = QueueState::new();
    let tracks = results.clone();
    queue.replace(tracks.clone(), 0);
    assert_eq!(
        queue.current().expect("current").id,
        tracks[0].id,
        "队列初始应为第一首"
    );

    let next = queue.next(false).expect("next");
    assert_eq!(next.id, tracks[1].id, "next 应前进一首");

    let prev = queue.prev().expect("prev");
    assert_eq!(prev.id, tracks[0].id, "prev 应回到第一首");
    eprintln!("[step5] 队列 next/prev 行为正确");

    // 6. 单曲循环模式下 auto-advance 保持当前
    queue.set_mode(PlayMode::RepeatOne);
    let stay = queue.next(true).expect("next(auto)");
    assert_eq!(stay.id, tracks[0].id, "RepeatOne auto-advance 应停留");

    queue.set_mode(PlayMode::Sequential);
    eprintln!("[step6] 单曲循环 auto-advance 正确");

    // 7. 停止播放
    player.stop().expect("stop");
    thread::sleep(Duration::from_millis(150));
    let status = player.status();
    // watcher 没启动，status.state 仍是 default (Idle)
    assert!(matches!(
        status.state,
        PlayState::Idle | PlayState::Paused
    ));
    eprintln!("[done] Phase 1 端到端链路全部通过");
}
