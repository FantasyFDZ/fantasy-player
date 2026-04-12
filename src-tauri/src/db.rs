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

    /// 内部锁访问——供同 crate 其他模块（如 audio_analyzer）直接操作连接
    pub(crate) fn conn_lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    /// 公开的 in-memory 构造函数，供集成测试使用（cfg(test) 只作用于
    /// lib.rs 树中的单测，集成测试的 crate 是另一个 crate）。
    pub fn open_default_in_memory_for_test() -> Self {
        let conn = Connection::open_in_memory().expect("open in-memory");
        migrate(&conn).expect("migrate");
        Db {
            conn: Mutex::new(conn),
        }
    }

    /// 把一首歌的元数据写入 songs 表（用于满足 song_features 等的
    /// FK 约束）。只传入最小字段。
    pub fn song_upsert(
        &self,
        id: &str,
        name: &str,
        artist: &str,
        album: &str,
        cover_url: &str,
        duration_secs: u32,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO songs
                (id, netease_id, name, artist, album, cover_url, duration_secs)
             VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               name          = excluded.name,
               artist        = excluded.artist,
               album         = excluded.album,
               cover_url     = excluded.cover_url,
               duration_secs = excluded.duration_secs",
            params![id, name, artist, album, cover_url, duration_secs],
        )?;
        Ok(())
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

    // ---- providers CRUD ----------------------------------------------------

    pub fn provider_list(&self) -> Result<Vec<ProviderRow>, DbError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, api_key, base_url, protocol, models_json
             FROM providers ORDER BY name",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ProviderRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    api_key: row.get(2)?,
                    base_url: row.get(3)?,
                    protocol: row.get(4)?,
                    models_json: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn provider_get(&self, id: &str) -> Result<Option<ProviderRow>, DbError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, api_key, base_url, protocol, models_json
             FROM providers WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(ProviderRow {
                id: row.get(0)?,
                name: row.get(1)?,
                api_key: row.get(2)?,
                base_url: row.get(3)?,
                protocol: row.get(4)?,
                models_json: row.get(5)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn provider_upsert(&self, row: &ProviderRow) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO providers (id, name, api_key, base_url, protocol, models_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               name        = excluded.name,
               api_key     = excluded.api_key,
               base_url    = excluded.base_url,
               protocol    = excluded.protocol,
               models_json = excluded.models_json",
            params![
                row.id,
                row.name,
                row.api_key,
                row.base_url,
                row.protocol,
                row.models_json
            ],
        )?;
        Ok(())
    }

    pub fn provider_delete(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM providers WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---- panel_layout CRUD -------------------------------------------------

    pub fn panel_layout_get(
        &self,
        panel_id: &str,
    ) -> Result<Option<PanelLayoutRow>, DbError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT panel_id, x, y, width, height, visible
             FROM panel_layout WHERE panel_id = ?1",
        )?;
        let mut rows = stmt.query(params![panel_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(PanelLayoutRow {
                panel_id: row.get(0)?,
                x: row.get(1)?,
                y: row.get(2)?,
                width: row.get(3)?,
                height: row.get(4)?,
                visible: row.get::<_, i64>(5)? != 0,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn panel_layout_list(&self) -> Result<Vec<PanelLayoutRow>, DbError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT panel_id, x, y, width, height, visible FROM panel_layout",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PanelLayoutRow {
                    panel_id: row.get(0)?,
                    x: row.get(1)?,
                    y: row.get(2)?,
                    width: row.get(3)?,
                    height: row.get(4)?,
                    visible: row.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn panel_layout_upsert(&self, row: &PanelLayoutRow) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO panel_layout (panel_id, x, y, width, height, visible)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(panel_id) DO UPDATE SET
               x       = excluded.x,
               y       = excluded.y,
               width   = excluded.width,
               height  = excluded.height,
               visible = excluded.visible",
            params![
                row.panel_id,
                row.x,
                row.y,
                row.width,
                row.height,
                i64::from(row.visible),
            ],
        )?;
        Ok(())
    }

    pub fn panel_layout_delete(&self, panel_id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM panel_layout WHERE panel_id = ?1",
            params![panel_id],
        )?;
        Ok(())
    }

    /// 首次启动 seed：为空表写入 4 个默认 Provider（api_key 留空）。
    /// 已存在的 Provider 不覆盖，避免抹掉用户配置。
    pub fn seed_providers_if_empty(&self) -> Result<(), DbError> {
        let existing = self.provider_list()?;
        if !existing.is_empty() {
            return Ok(());
        }
        for row in default_providers() {
            self.provider_upsert(&row)?;
        }
        Ok(())
    }
}

// ---- provider row type -----------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderRow {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub base_url: String,
    pub protocol: String, // "openai" | "anthropic"
    pub models_json: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PanelLayoutRow {
    pub panel_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

fn default_providers() -> Vec<ProviderRow> {
    let d = |id: &str, name: &str, base_url: &str, protocol: &str, models: &[&str]| {
        ProviderRow {
            id: id.into(),
            name: name.into(),
            api_key: String::new(),
            base_url: base_url.into(),
            protocol: protocol.into(),
            models_json: serde_json::to_string(models).unwrap_or_else(|_| "[]".into()),
        }
    };
    vec![
        d(
            "dashscope",
            "通义 DashScope",
            "https://coding.dashscope.aliyuncs.com/v1",
            "openai",
            &["qwen3.5-plus", "glm-5", "kimi-k2.5", "MiniMax-M2.5"],
        ),
        d(
            "minimax",
            "MiniMax",
            "https://api.minimaxi.com/v1",
            "openai",
            &["MiniMax-M2.7-highspeed"],
        ),
        d(
            "mimo",
            "MiMo",
            "https://token-plan-cn.xiaomimimo.com/v1",
            "openai",
            // MiMo 网关对模型 ID 大小写严格（非小写会被 gate 判为
            // "Illegal access" 403），必须用小写。
            &["mimo-v2-pro", "mimo-v2-omni"],
        ),
        d(
            "local",
            "本地 (OpenAI 兼容)",
            "http://localhost:1234/v1",
            "openai",
            // 留空——用户填模型名。默认 URL 是 LM Studio 的默认端口，
            // Ollama / llama.cpp server / vLLM 也可以直接改
            &[],
        ),
    ]
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
            bpm_confidence          REAL DEFAULT 0,
            energy                  REAL,
            valence                 REAL,
            key                     TEXT,
            key_confidence          REAL DEFAULT 0,
            spectral_centroid       REAL,
            spectral_bandwidth      REAL,
            spectral_flatness       REAL,
            spectral_rolloff        REAL,
            zero_crossing_rate      REAL,
            analyzed_at             INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- 兼容升级：已有 song_features 表时补齐 2 列
        -- SQLite 不支持 IF NOT EXISTS on ALTER，用 try/ignore
        -- （旧版本创建的表会命中这里）

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

    // 旧 DB 兼容：song_features 表在早期版本没有 bpm_confidence 和
    // key_confidence 两列，用 ALTER TABLE 补齐。SQLite 不支持
    // IF NOT EXISTS on ALTER，于是用 try-ignore。
    let _ = conn.execute(
        "ALTER TABLE song_features ADD COLUMN bpm_confidence REAL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE song_features ADD COLUMN key_confidence REAL DEFAULT 0",
        [],
    );

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

    #[test]
    fn providers_crud_round_trip() {
        let db = Db::open_in_memory().expect("open");

        // 空表
        assert!(db.provider_list().unwrap().is_empty());

        // 插入
        let row = ProviderRow {
            id: "test".into(),
            name: "Test Provider".into(),
            api_key: "sk-abc".into(),
            base_url: "https://example.com/v1".into(),
            protocol: "openai".into(),
            models_json: r#"["m1","m2"]"#.into(),
        };
        db.provider_upsert(&row).unwrap();

        let list = db.provider_list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].api_key, "sk-abc");

        // 覆盖更新
        let mut updated = row.clone();
        updated.api_key = "sk-def".into();
        db.provider_upsert(&updated).unwrap();
        let got = db.provider_get("test").unwrap().unwrap();
        assert_eq!(got.api_key, "sk-def");

        // 删除
        db.provider_delete("test").unwrap();
        assert!(db.provider_list().unwrap().is_empty());
    }

    #[test]
    fn seed_providers_if_empty_plants_four() {
        let db = Db::open_in_memory().expect("open");
        db.seed_providers_if_empty().unwrap();
        let list = db.provider_list().unwrap();
        assert_eq!(list.len(), 4, "should seed 4 providers");

        // 非空时不重复 seed
        db.seed_providers_if_empty().unwrap();
        assert_eq!(db.provider_list().unwrap().len(), 4);
    }

    #[test]
    fn panel_layout_crud_round_trip() {
        let db = Db::open_in_memory().expect("open");
        assert!(db.panel_layout_list().unwrap().is_empty());

        let row = PanelLayoutRow {
            panel_id: "music_analysis".into(),
            x: 120.0,
            y: 80.0,
            width: 420.0,
            height: 320.0,
            visible: true,
        };
        db.panel_layout_upsert(&row).unwrap();

        let got = db.panel_layout_get("music_analysis").unwrap().unwrap();
        assert_eq!(got.width, 420.0);
        assert!(got.visible);

        // 覆盖
        let mut updated = row.clone();
        updated.x = 200.0;
        updated.visible = false;
        db.panel_layout_upsert(&updated).unwrap();
        let got = db.panel_layout_get("music_analysis").unwrap().unwrap();
        assert_eq!(got.x, 200.0);
        assert!(!got.visible);

        // list
        assert_eq!(db.panel_layout_list().unwrap().len(), 1);

        // delete
        db.panel_layout_delete("music_analysis").unwrap();
        assert!(db.panel_layout_list().unwrap().is_empty());
    }
}
