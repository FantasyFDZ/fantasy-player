//! 歌单迁移调度器。
//!
//! 支持 QQ 音乐 ↔ 网易云音乐的双向歌单迁移。
//! 流程：读取源歌单 → 逐首搜索目标平台 → 匹配 → 创建歌单 → 批量添加。

use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::auth::AuthState;
use crate::netease_api;
use crate::qq_auth::QQAuthState;
use crate::qqmusic_api;

/// Search interval between requests to avoid 405 rate-limiting.
const SEARCH_INTERVAL: Duration = Duration::from_millis(1500);
/// Max retries on 405 rate-limit errors.
const MAX_RETRIES: u32 = 3;
/// Backoff after 405 (doubles on each retry).
const RETRY_BACKOFF: Duration = Duration::from_secs(5);

// ---- types -----------------------------------------------------------------

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncSource {
    Qq,
    Netease,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncTarget {
    Qq,
    Netease,
}

// ---- normalization ---------------------------------------------------------

/// Normalize a string for fuzzy matching:
/// - lowercase
/// - strip content in brackets/parens: (xxx) [xxx] （xxx） 【xxx】
/// - collapse whitespace
pub fn normalize_for_match(s: &str) -> String {
    let lower = s.to_lowercase();

    // Strip bracketed content
    let mut result = String::with_capacity(lower.len());
    let mut depth_paren = 0i32;
    let mut depth_bracket = 0i32;
    let mut chars = lower.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '(' | '\u{FF08}' => {
                // ( or （
                depth_paren += 1;
            }
            ')' | '\u{FF09}' => {
                // ) or ）
                depth_paren = (depth_paren - 1).max(0);
            }
            '[' | '\u{3010}' => {
                // [ or 【
                depth_bracket += 1;
            }
            ']' | '\u{3011}' => {
                // ] or 】
                depth_bracket = (depth_bracket - 1).max(0);
            }
            _ => {
                if depth_paren == 0 && depth_bracket == 0 {
                    result.push(ch);
                }
            }
        }
    }

    // Collapse whitespace
    let collapsed: String = result
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .trim()
        .to_string();

    collapsed
}

/// Retry a search call if it fails with a 405 rate-limit error.
fn retry_on_rate_limit<T, F>(mut f: F) -> Result<T, String>
where
    F: FnMut() -> Result<T, String>,
{
    let mut backoff = RETRY_BACKOFF;
    for attempt in 0..=MAX_RETRIES {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) if e.contains("405") && attempt < MAX_RETRIES => {
                thread::sleep(backoff);
                backoff *= 2;
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!()
}

// ---- QQ → NetEase ----------------------------------------------------------

/// Migrate a QQ playlist to NetEase.
pub fn migrate_qq_to_netease<F>(
    qq_auth: &QQAuthState,
    netease_auth: &AuthState,
    qq_playlist_id: &str,
    progress_cb: F,
) -> Result<SyncReport, String>
where
    F: Fn(SyncProgress),
{
    let qq_cookie = qq_auth.cookie();
    let netease_cookie = netease_auth.cookie();

    if qq_cookie.is_empty() {
        return Err("未登录 QQ 音乐".into());
    }
    if netease_cookie.is_empty() {
        return Err("未登录网易云音乐".into());
    }

    // 1. Load QQ playlist
    let qq_detail = qqmusic_api::playlist_detail(qq_playlist_id, &qq_cookie)
        .map_err(|e| format!("获取 QQ 歌单失败: {e}"))?;
    let playlist_name = qq_detail.info.name.clone();
    let total = qq_detail.songs.len();

    // 2. Search and match each song on NetEase
    let mut matched_ids: Vec<String> = Vec::new();
    let mut skipped_songs: Vec<SkippedSong> = Vec::new();

    for (i, song) in qq_detail.songs.iter().enumerate() {
        progress_cb(SyncProgress {
            playlist_name: playlist_name.clone(),
            current: i + 1,
            total,
            current_song: format!("{} - {}", song.name, song.artist),
        });

        let query = format!("{} {}", song.name, song.artist);
        let search_result = retry_on_rate_limit(|| {
            netease_api::search_songs(&query, 5, &netease_cookie)
                .map_err(|e| e.to_string())
        });
        match search_result {
            Ok(results) => {
                let norm_name = normalize_for_match(&song.name);
                let norm_artist = normalize_for_match(&song.artist);
                let found = results.iter().find(|r| {
                    let rn = normalize_for_match(&r.name);
                    let ra = normalize_for_match(&r.artist);
                    rn == norm_name && ra == norm_artist
                });
                match found {
                    Some(matched) => {
                        matched_ids.push(matched.id.clone());
                    }
                    None => {
                        skipped_songs.push(SkippedSong {
                            name: song.name.clone(),
                            artist: song.artist.clone(),
                            reason: "未找到匹配歌曲".into(),
                        });
                    }
                }
            }
            Err(e) => {
                skipped_songs.push(SkippedSong {
                    name: song.name.clone(),
                    artist: song.artist.clone(),
                    reason: format!("搜索失败: {e}"),
                });
            }
        }

        thread::sleep(SEARCH_INTERVAL);
    }

    let matched = matched_ids.len();

    // 3. Create playlist on NetEase
    if matched_ids.is_empty() {
        return Ok(SyncReport {
            playlist_name,
            total,
            matched: 0,
            skipped: skipped_songs.len(),
            skipped_songs,
        });
    }

    let receipt = netease_api::create_playlist(&playlist_name, &netease_cookie)
        .map_err(|e| format!("创建网易云歌单失败: {e}"))?;

    // 4. Batch add tracks (100 per batch for NetEase)
    for chunk in matched_ids.chunks(100) {
        let ids: Vec<String> = chunk.to_vec();
        netease_api::add_tracks_to_playlist(&receipt.playlist_id, &ids, &netease_cookie)
            .map_err(|e| format!("添加歌曲失败: {e}"))?;
        thread::sleep(SEARCH_INTERVAL);
    }

    Ok(SyncReport {
        playlist_name,
        total,
        matched,
        skipped: skipped_songs.len(),
        skipped_songs,
    })
}

// ---- NetEase → QQ ----------------------------------------------------------

/// Migrate a NetEase playlist to QQ Music.
pub fn migrate_netease_to_qq<F>(
    netease_auth: &AuthState,
    qq_auth: &QQAuthState,
    netease_playlist_id: &str,
    progress_cb: F,
) -> Result<SyncReport, String>
where
    F: Fn(SyncProgress),
{
    let netease_cookie = netease_auth.cookie();
    let qq_cookie = qq_auth.cookie();

    if netease_cookie.is_empty() {
        return Err("未登录网易云音乐".into());
    }
    if qq_cookie.is_empty() {
        return Err("未登录 QQ 音乐".into());
    }

    // 1. Load NetEase playlist
    let ne_detail = netease_api::playlist_detail(netease_playlist_id, &netease_cookie, 500)
        .map_err(|e| format!("获取网易云歌单失败: {e}"))?;
    let playlist_name = ne_detail.summary.name.clone();
    let total = ne_detail.tracks.len();

    // 2. Search and match each song on QQ Music
    let mut matched_mids: Vec<String> = Vec::new();
    let mut skipped_songs: Vec<SkippedSong> = Vec::new();

    for (i, song) in ne_detail.tracks.iter().enumerate() {
        progress_cb(SyncProgress {
            playlist_name: playlist_name.clone(),
            current: i + 1,
            total,
            current_song: format!("{} - {}", song.name, song.artist),
        });

        let query = format!("{} {}", song.name, song.artist);
        let search_result = retry_on_rate_limit(|| {
            qqmusic_api::search_songs(&query, 5, &qq_cookie)
                .map_err(|e| e.to_string())
        });
        match search_result {
            Ok(results) => {
                let norm_name = normalize_for_match(&song.name);
                let norm_artist = normalize_for_match(&song.artist);
                let found = results.iter().find(|r| {
                    let rn = normalize_for_match(&r.name);
                    let ra = normalize_for_match(&r.artist);
                    rn == norm_name && ra == norm_artist
                });
                match found {
                    Some(matched) => {
                        matched_mids.push(matched.mid.clone());
                    }
                    None => {
                        skipped_songs.push(SkippedSong {
                            name: song.name.clone(),
                            artist: song.artist.clone(),
                            reason: "未找到匹配歌曲".into(),
                        });
                    }
                }
            }
            Err(e) => {
                skipped_songs.push(SkippedSong {
                    name: song.name.clone(),
                    artist: song.artist.clone(),
                    reason: format!("搜索失败: {e}"),
                });
            }
        }

        thread::sleep(SEARCH_INTERVAL);
    }

    let matched = matched_mids.len();

    // 3. Create playlist on QQ Music
    if matched_mids.is_empty() {
        return Ok(SyncReport {
            playlist_name,
            total,
            matched: 0,
            skipped: skipped_songs.len(),
            skipped_songs,
        });
    }

    let receipt = qqmusic_api::create_playlist(&playlist_name, &qq_cookie)
        .map_err(|e| format!("创建 QQ 歌单失败: {e}"))?;

    // 4. Batch add tracks (50 per batch for QQ)
    for chunk in matched_mids.chunks(50) {
        let mids: Vec<String> = chunk.to_vec();
        qqmusic_api::add_to_playlist(&mids, &receipt.dirid, &qq_cookie)
            .map_err(|e| format!("添加歌曲失败: {e}"))?;
        thread::sleep(SEARCH_INTERVAL);
    }

    Ok(SyncReport {
        playlist_name,
        total,
        matched,
        skipped: skipped_songs.len(),
        skipped_songs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_parens() {
        assert_eq!(normalize_for_match("海阔天空 (Live)"), "海阔天空");
    }

    #[test]
    fn normalize_strips_brackets() {
        assert_eq!(normalize_for_match("光辉岁月 [Remastered]"), "光辉岁月");
    }

    #[test]
    fn normalize_strips_fullwidth_parens() {
        assert_eq!(normalize_for_match("红日（粤语版）"), "红日");
    }

    #[test]
    fn normalize_strips_fullwidth_brackets() {
        assert_eq!(normalize_for_match("喜欢你【现场版】"), "喜欢你");
    }

    #[test]
    fn normalize_collapses_whitespace() {
        assert_eq!(normalize_for_match("  hello   world  "), "hello world");
    }

    #[test]
    fn normalize_lowercases() {
        assert_eq!(normalize_for_match("Hello World"), "hello world");
    }
}
