//! SQLite 管理。
//!
//! 启动时：
//! - 在 ~/.config/melody/melody.db 打开数据库
//! - 跑一次 migration 创建设计文档第 9 节全部表
//!
//! Phase 1 只有 songs / settings / playlists / playlist_songs 被写入，
//! 其余表先建好 schema，留给后续 phase 填充。

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("无法定位配置目录")]
    NoConfigDir,
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("SQLite 错误: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

fn db_path() -> Result<PathBuf, DbError> {
    let base = dirs::config_dir().ok_or(DbError::NoConfigDir)?;
    let dir = base.join("melody");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("melody.db"))
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open_default() -> Result<Self, DbError> {
        let path = db_path()?;
        let conn = Connection::open(&path)?;
        migrate(&conn)?;
        Ok(Db {
            conn: Mutex::new(conn),
        })
    }

    #[cfg(test)]
    fn open_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        migrate(&conn)?;
        Ok(Db {
            conn: Mutex::new(conn),
        })
    }

    pub fn upsert_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }
}

// ---- migration -------------------------------------------------------------

fn migrate(conn: &Connection) -> Result<(), DbError> {
    // 单次 migration——Phase 1 只有 v1。后续扩展时引入
    // schema_version 表和 if version < N { ... } 的升级路径。
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS songs (
            id              TEXT PRIMARY KEY,
            netease_id      TEXT,
            name            TEXT NOT NULL,
            artist          TEXT NOT NULL DEFAULT '',
            album           TEXT NOT NULL DEFAULT '',
            cover_url       TEXT NOT NULL DEFAULT '',
            duration_secs   INTEGER NOT NULL DEFAULT 0,
            cached_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS song_features (
            song_id                 TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
            bpm                     REAL,
            energy                  REAL,
            valence                 REAL,
            key                     TEXT,
            spectral_centroid       REAL,
            spectral_bandwidth      REAL,
            spectral_flatness       REAL,
            spectral_rolloff        REAL,
            zero_crossing_rate      REAL,
            analyzed_at             INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS song_ai_content (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            type        TEXT NOT NULL,
            content     TEXT NOT NULL,
            provider    TEXT NOT NULL DEFAULT '',
            model       TEXT NOT NULL DEFAULT '',
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            UNIQUE(song_id, type, provider, model)
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            netease_id  TEXT,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            position    INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, song_id)
        );

        CREATE TABLE IF NOT EXISTS comments_cache (
            song_id         TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
            comments_json   TEXT NOT NULL,
            fetched_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS chat_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS dj_sessions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            queue_json          TEXT NOT NULL,
            arrangement_json    TEXT NOT NULL,
            created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS panel_layout (
            panel_id    TEXT PRIMARY KEY,
            x           REAL NOT NULL,
            y           REAL NOT NULL,
            width       REAL NOT NULL,
            height      REAL NOT NULL,
            visible     INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            key     TEXT PRIMARY KEY,
            value   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS providers (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            api_key     TEXT NOT NULL DEFAULT '',
            base_url    TEXT NOT NULL,
            protocol    TEXT NOT NULL DEFAULT 'openai',
            models_json TEXT NOT NULL DEFAULT '[]'
        );
        "#,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_creates_all_tables() {
        let db = Db::open_in_memory().expect("open");
        let conn = db.conn.lock().unwrap();
        let expected = [
            "songs",
            "song_features",
            "song_ai_content",
            "playlists",
            "playlist_songs",
            "comments_cache",
            "chat_history",
            "dj_sessions",
            "panel_layout",
            "settings",
            "providers",
        ];
        for table in expected {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    params![table],
                    |row| row.get(0),
                )
                .expect(table);
            assert_eq!(count, 1, "table {table} 未创建");
        }
    }

    #[test]
    fn settings_upsert_round_trip() {
        let db = Db::open_in_memory().expect("open");
        db.upsert_setting("theme", "moonlight_study").unwrap();
        assert_eq!(
            db.get_setting("theme").unwrap().unwrap(),
            "moonlight_study"
        );
        // 覆盖同一 key
        db.upsert_setting("theme", "sunset_jazz").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().unwrap(), "sunset_jazz");
    }

    #[test]
    fn missing_setting_returns_none() {
        let db = Db::open_in_memory().expect("open");
        assert!(db.get_setting("nope").unwrap().is_none());
    }
}
