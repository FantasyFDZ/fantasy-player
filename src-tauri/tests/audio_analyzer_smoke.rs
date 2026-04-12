//! 音频分析端到端烟测。
//!
//! 流程：搜索网易云获取一首公开歌曲 → 拿 stream URL → 下载 → Python
//! sidecar 分析 → 验证特征非空。全部用 in-memory Db。
//!
//! 需要网络 + python3.12 + librosa。

use melody_lib::audio_analyzer::analyze_song_blocking;
use melody_lib::db::Db;
use melody_lib::netease_api;

#[test]
fn end_to_end_analyze_real_song() {
    // 1. 搜歌 —— 用一首周杰伦《晴天》做基准，Phase 1 已验证其可播放
    let results =
        netease_api::search_songs("晴天 周杰伦", 5, "").expect("search songs");
    let song = results
        .into_iter()
        .find(|s| s.playable)
        .expect("expected a playable song");
    eprintln!("[step1] 选定: {} - {} (id={})", song.name, song.artist, song.id);

    // 2. 拿 stream URL
    let url = netease_api::song_url(&song.id, "standard", "").expect("song url");
    if url.url.is_empty() {
        eprintln!("[skip] 当前歌曲无公开 URL（VIP?），测试跳过");
        return;
    }
    eprintln!("[step2] URL bitrate={} type={}", url.br, url.file_type);

    // 3. 把歌写入 songs 表（满足 song_features 的 FK 约束），
    //    然后下载 + python sidecar 分析
    let db = Db::open_default_in_memory_for_test();
    db.song_upsert(
        &song.id,
        &song.name,
        &song.artist,
        &song.album,
        &song.cover_url,
        song.duration_secs,
    )
    .expect("song_upsert");
    let features = analyze_song_blocking(&db, &song.id, &url.url).expect("analyze");
    eprintln!(
        "[step3] bpm={:.1} energy={:.3} valence={:.3} key={}",
        features.bpm, features.energy, features.valence, features.key
    );
    eprintln!(
        "        spectral: centroid={:.0} bandwidth={:.0} rolloff={:.0} zcr={:.4}",
        features.spectral_centroid,
        features.spectral_bandwidth,
        features.spectral_rolloff,
        features.zero_crossing_rate
    );

    assert!(features.bpm > 0.0, "真实歌曲的 BPM 应大于 0");
    assert!(
        !features.key.is_empty(),
        "调式应该被估计出来"
    );
    assert!(
        features.spectral_centroid > 100.0,
        "频谱质心应有合理正值"
    );

    // 4. 验证缓存命中 —— 第二次调用应该从 Db 直接返回
    let cached = analyze_song_blocking(&db, &song.id, &url.url).expect("cached");
    assert_eq!(cached.bpm, features.bpm);
    assert_eq!(cached.key, features.key);
    eprintln!("[step4] 缓存命中 ✓");
}
