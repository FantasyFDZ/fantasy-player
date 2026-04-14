//! 文件日志——追加时间戳行到 ~/.config/melody/melody.log。
//!
//! 超过 5 MB 自动轮转为 melody.log.old。
//! 所有 I/O 错误静默吞掉——日志永远不应让应用崩溃。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024; // 5 MB

fn log_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config").join("melody"))
}

fn log_path() -> Option<PathBuf> {
    log_dir().map(|d| d.join("melody.log"))
}

fn rotate_if_needed(path: &PathBuf) {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_LOG_SIZE {
            let old = path.with_extension("log.old");
            let _ = fs::rename(path, old);
        }
    }
}

/// 追加一行日志到 ~/.config/melody/melody.log。
///
/// 格式：`[2026-04-14 21:30:45] [INFO] [播放] 播放歌曲: xxx - yyy`
///
/// 任何 I/O 错误都被忽略。
pub fn log(level: &str, module: &str, message: &str) {
    let Some(path) = log_path() else { return };

    // 确保目录存在
    if let Some(dir) = log_dir() {
        let _ = fs::create_dir_all(dir);
    }

    rotate_if_needed(&path);

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("[{now}] [{level}] [{module}] {message}\n");

    let file = OpenOptions::new().create(true).append(true).open(&path);
    if let Ok(mut f) = file {
        let _ = f.write_all(line.as_bytes());
    }
}
