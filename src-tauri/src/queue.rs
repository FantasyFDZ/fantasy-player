//! 播放队列管理。
//!
//! 职责：
//! - 维护 Vec<Song> + current_index + PlayMode
//! - 暴露 CRUD 方法（添加、删除、清空、移动、替换整列）
//! - 提供 next/prev 逻辑（顺序/随机/单曲循环）
//! - 不直接操作 mpv。调用方（Tauri command 层）从 queue 拿到
//!   "下一首" Song，再获取 stream URL，最后 player.load_url
//!
//! 这样 queue 保持纯数据，player 保持纯播放，二者解耦。

use std::sync::{Arc, Mutex};

use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};

use crate::netease_api::Song;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlayMode {
    Sequential,
    Shuffle,
    RepeatOne,
}

impl Default for PlayMode {
    fn default() -> Self {
        PlayMode::Sequential
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct QueueSnapshot {
    pub tracks: Vec<Song>,
    pub current_index: Option<usize>,
    pub mode: PlayMode,
}

#[derive(Debug, Default, Clone)]
pub struct QueueState {
    inner: Arc<Mutex<QueueSnapshot>>,
}

impl QueueState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        self.inner.lock().unwrap().clone()
    }

    pub fn current(&self) -> Option<Song> {
        let guard = self.inner.lock().unwrap();
        guard.current_index.and_then(|i| guard.tracks.get(i).cloned())
    }

    pub fn set_mode(&self, mode: PlayMode) {
        self.inner.lock().unwrap().mode = mode;
    }

    /// 预览 replace 后将要播放的歌曲，但不修改队列状态。
    pub fn preview_replace(tracks: &[Song], start_index: usize) -> Option<Song> {
        if tracks.is_empty() {
            return None;
        }
        let index = start_index.min(tracks.len() - 1);
        Some(tracks[index].clone())
    }

    /// 用新的曲目替换整个队列，current_index 指向首个播放位置。
    pub fn replace(&self, tracks: Vec<Song>, start_index: usize) -> Option<Song> {
        let mut guard = self.inner.lock().unwrap();
        if tracks.is_empty() {
            guard.tracks.clear();
            guard.current_index = None;
            return None;
        }
        let index = start_index.min(tracks.len() - 1);
        let song = tracks[index].clone();
        guard.tracks = tracks;
        guard.current_index = Some(index);
        Some(song)
    }

    /// 追加一首到队列末尾。
    pub fn append(&self, song: Song) {
        let mut guard = self.inner.lock().unwrap();
        guard.tracks.push(song);
        if guard.current_index.is_none() && !guard.tracks.is_empty() {
            guard.current_index = Some(0);
        }
    }

    /// 插入到"下一首"位置（当前曲目之后一位）。
    pub fn play_next(&self, song: Song) {
        let mut guard = self.inner.lock().unwrap();
        let insert_at = match guard.current_index {
            Some(idx) => (idx + 1).min(guard.tracks.len()),
            None => 0,
        };
        guard.tracks.insert(insert_at, song);
        if guard.current_index.is_none() {
            guard.current_index = Some(0);
        }
    }

    /// 从队列中移除指定位置。如果删除的是当前歌，返回 true 表示调用方
    /// 应触发重新加载——否则前端 UI 会和后端不同步。
    pub fn remove(&self, index: usize) -> bool {
        let mut guard = self.inner.lock().unwrap();
        if index >= guard.tracks.len() {
            return false;
        }
        guard.tracks.remove(index);
        match guard.current_index {
            Some(current) if index == current => {
                if guard.tracks.is_empty() {
                    guard.current_index = None;
                } else if current >= guard.tracks.len() {
                    guard.current_index = Some(guard.tracks.len() - 1);
                }
                true
            }
            Some(current) if index < current => {
                guard.current_index = Some(current - 1);
                false
            }
            _ => false,
        }
    }

    pub fn clear(&self) {
        let mut guard = self.inner.lock().unwrap();
        guard.tracks.clear();
        guard.current_index = None;
    }

    /// 跳转到队列中的指定位置，返回该位置的 Song。
    pub fn jump_to(&self, index: usize) -> Option<Song> {
        let mut guard = self.inner.lock().unwrap();
        if index >= guard.tracks.len() {
            return None;
        }
        guard.current_index = Some(index);
        guard.tracks.get(index).cloned()
    }

    /// 预览下一首，但不提交 current_index。
    pub fn peek_next(&self, auto_advance: bool) -> Option<(usize, Song)> {
        let guard = self.inner.lock().unwrap();
        if guard.tracks.is_empty() {
            return None;
        }
        let current = guard.current_index.unwrap_or(0);

        let next_index = match (guard.mode, auto_advance) {
            (PlayMode::RepeatOne, true) => current,
            (PlayMode::Shuffle, _) => {
                let len = guard.tracks.len();
                if len == 1 {
                    0
                } else {
                    let mut rng = rand::thread_rng();
                    let choices: Vec<usize> = (0..len).filter(|&i| i != current).collect();
                    *choices.choose(&mut rng).unwrap_or(&0)
                }
            }
            _ => {
                let len = guard.tracks.len();
                (current + 1) % len
            }
        };

        guard
            .tracks
            .get(next_index)
            .cloned()
            .map(|song| (next_index, song))
    }

    /// 预览上一首，但不提交 current_index。
    pub fn peek_prev(&self) -> Option<(usize, Song)> {
        let guard = self.inner.lock().unwrap();
        if guard.tracks.is_empty() {
            return None;
        }
        let current = guard.current_index.unwrap_or(0);
        let len = guard.tracks.len();
        let prev_index = match guard.mode {
            PlayMode::Shuffle => {
                if len == 1 {
                    0
                } else {
                    let mut rng = rand::thread_rng();
                    let choices: Vec<usize> = (0..len).filter(|&i| i != current).collect();
                    *choices.choose(&mut rng).unwrap_or(&0)
                }
            }
            _ => {
                if current == 0 {
                    len - 1
                } else {
                    current - 1
                }
            }
        };

        guard
            .tracks
            .get(prev_index)
            .cloned()
            .map(|song| (prev_index, song))
    }

    pub fn set_current_index(&self, index: usize) -> Option<Song> {
        let mut guard = self.inner.lock().unwrap();
        if index >= guard.tracks.len() {
            return None;
        }
        guard.current_index = Some(index);
        guard.tracks.get(index).cloned()
    }

    /// 获取下一首应该播放的歌曲。
    ///
    /// `auto_advance` 标记区分两种场景：
    /// - `true`：自动切歌（当前曲目播完）——RepeatOne 时返回当前歌
    /// - `false`：用户手动按"下一首"——RepeatOne 时仍前进到下一首
    pub fn next(&self, auto_advance: bool) -> Option<Song> {
        let (next_index, song) = self.peek_next(auto_advance)?;
        self.set_current_index(next_index)?;
        Some(song)
    }

    pub fn prev(&self) -> Option<Song> {
        let (prev_index, song) = self.peek_prev()?;
        self.set_current_index(prev_index)?;
        Some(song)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(id: &str) -> Song {
        Song {
            id: id.to_string(),
            name: id.to_string(),
            artist: "artist".into(),
            album: "album".into(),
            cover_url: "".into(),
            duration_secs: 100,
            playable: true,
        }
    }

    #[test]
    fn replace_sets_current_index() {
        let q = QueueState::new();
        let first = q.replace(vec![song("a"), song("b"), song("c")], 1);
        assert_eq!(first.unwrap().id, "b");
        assert_eq!(q.current().unwrap().id, "b");
    }

    #[test]
    fn preview_replace_does_not_mutate_queue() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b"), song("c")], 0);
        let preview = QueueState::preview_replace(&[song("x"), song("y")], 1).unwrap();
        assert_eq!(preview.id, "y");
        assert_eq!(q.current().unwrap().id, "a");
    }

    #[test]
    fn sequential_next_wraps_around() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b"), song("c")], 0);
        assert_eq!(q.next(false).unwrap().id, "b");
        assert_eq!(q.next(false).unwrap().id, "c");
        assert_eq!(q.next(false).unwrap().id, "a");
    }

    #[test]
    fn repeat_one_auto_stays_manual_advances() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b")], 0);
        q.set_mode(PlayMode::RepeatOne);
        assert_eq!(q.next(true).unwrap().id, "a", "auto-advance 应停留");
        assert_eq!(q.next(false).unwrap().id, "b", "手动 next 应前进");
    }

    #[test]
    fn peek_next_does_not_commit_index() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b"), song("c")], 0);
        let (idx, next) = q.peek_next(false).unwrap();
        assert_eq!(idx, 1);
        assert_eq!(next.id, "b");
        assert_eq!(q.current().unwrap().id, "a");
    }

    #[test]
    fn prev_wraps_backward() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b"), song("c")], 0);
        assert_eq!(q.prev().unwrap().id, "c");
        assert_eq!(q.prev().unwrap().id, "b");
    }

    #[test]
    fn remove_current_returns_true_and_shifts() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b"), song("c")], 1);
        assert!(q.remove(1), "删除当前歌应返回 true");
        assert_eq!(q.current().unwrap().id, "c");
    }

    #[test]
    fn remove_before_current_adjusts_index() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b"), song("c")], 2);
        assert!(!q.remove(0), "删除当前之前的歌应返回 false");
        assert_eq!(q.current().unwrap().id, "c");
    }

    #[test]
    fn play_next_inserts_after_current() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b"), song("c")], 0);
        q.play_next(song("x"));
        let tracks: Vec<String> = q.snapshot().tracks.iter().map(|s| s.id.clone()).collect();
        assert_eq!(tracks, vec!["a", "x", "b", "c"]);
    }

    #[test]
    fn shuffle_never_repeats_current_in_multi_track() {
        let q = QueueState::new();
        q.replace(vec![song("a"), song("b"), song("c"), song("d")], 0);
        q.set_mode(PlayMode::Shuffle);
        for _ in 0..20 {
            let before = q.current().unwrap().id;
            let after = q.next(false).unwrap().id;
            assert_ne!(before, after, "shuffle 不应跳到自己");
        }
    }
}
