//! QQ Music 登录态管理（cookie 粘贴模式）。
//!
//! 职责：
//! - 接受用户粘贴的 QQ Music cookie 并验证有效性
//! - 将 cookie 持久化到 `~/.config/melody/qq_session.json`
//! - 为其他模块提供当前 cookie 与用户信息
//!
//! QQ 音乐的 ptqrlogin 端点会拦截非浏览器请求，因此不走 QR 扫码流程，
//! 改为 cookie 粘贴：用户从浏览器开发者工具复制 cookie，粘贴到 UI 中。

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::qqmusic_api::{self, QQMusicError};

// ---- paths -----------------------------------------------------------------

fn config_dir() -> Result<PathBuf, QQAuthError> {
    let base = dirs::config_dir().ok_or(QQAuthError::NoConfigDir)?;
    let dir = base.join("melody");
    fs::create_dir_all(&dir).map_err(QQAuthError::Io)?;
    Ok(dir)
}

fn session_path() -> Result<PathBuf, QQAuthError> {
    Ok(config_dir()?.join("qq_session.json"))
}

// ---- types -----------------------------------------------------------------

#[derive(Debug, Error)]
pub enum QQAuthError {
    #[error("未能定位用户配置目录")]
    NoConfigDir,
    #[error("读写会话文件失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("会话文件格式错误: {0}")]
    Json(#[from] serde_json::Error),
    #[error("QQ Music 适配器调用失败: {0}")]
    QQMusic(#[from] QQMusicError),
    #[error("cookie 无效或已过期")]
    InvalidCookie,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct QQSession {
    #[serde(default)]
    pub cookie: String,
    #[serde(default)]
    pub user: Option<QQUserProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QQUserProfile {
    pub uin: String,
    pub nickname: String,
    pub avatar_url: String,
}

// ---- state -----------------------------------------------------------------

#[derive(Default, Clone)]
pub struct QQAuthState {
    inner: Arc<Mutex<QQSession>>,
}

impl QQAuthState {
    /// Load session from disk on startup. Returns empty session if file is
    /// missing or corrupted.
    pub fn load() -> Self {
        let session = load_session().unwrap_or_default();
        QQAuthState {
            inner: Arc::new(Mutex::new(session)),
        }
    }

    pub fn cookie(&self) -> String {
        self.inner.lock().unwrap().cookie.clone()
    }

    pub fn current_user(&self) -> Option<QQUserProfile> {
        self.inner.lock().unwrap().user.clone()
    }

    pub fn snapshot(&self) -> QQSession {
        self.inner.lock().unwrap().clone()
    }

    fn update<F>(&self, mutator: F) -> Result<(), QQAuthError>
    where
        F: FnOnce(&mut QQSession),
    {
        let mut guard = self.inner.lock().unwrap();
        mutator(&mut guard);
        save_session(&guard)
    }

    // ---- public flows ------------------------------------------------------

    /// Validate a cookie by calling set_cookie + user_detail on the adapter,
    /// then persist if valid.
    pub fn login_with_cookie(&self, cookie: &str) -> Result<QQUserProfile, QQAuthError> {
        if cookie.trim().is_empty() {
            return Err(QQAuthError::InvalidCookie);
        }

        // Set cookie in the adapter
        qqmusic_api::set_cookie(cookie)?;

        // Extract uin from the cookie string to call user_detail
        let uin = extract_uin(cookie).unwrap_or_default();
        if uin.is_empty() {
            return Err(QQAuthError::InvalidCookie);
        }

        // Validate by fetching user detail
        let detail = qqmusic_api::user_detail(&uin, cookie)?;

        let nickname = detail
            .get("nickname")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let avatar_url = detail
            .get("avatar")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // Prefer the uin extracted from cookie — the API may return "0"
        // for encrypted accounts.
        let returned_uin = detail
            .get("uin")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty() && *v != "0")
            .unwrap_or(&uin)
            .to_string();

        let user = QQUserProfile {
            uin: returned_uin,
            nickname,
            avatar_url,
        };

        self.update(|s| {
            s.cookie = cookie.to_string();
            s.user = Some(user.clone());
        })?;

        Ok(user)
    }

    /// Validate stored cookie on startup; clear if invalid.
    pub fn refresh(&self) -> Result<Option<QQUserProfile>, QQAuthError> {
        let cookie = self.cookie();
        if cookie.is_empty() {
            return Ok(None);
        }

        let uin = extract_uin(&cookie).unwrap_or_default();
        if uin.is_empty() {
            self.update(|s| {
                s.cookie.clear();
                s.user = None;
            })?;
            return Ok(None);
        }

        // Try to validate by calling user_detail
        match qqmusic_api::user_detail(&uin, &cookie) {
            Ok(detail) => {
                let nickname = detail
                    .get("nickname")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let avatar_url = detail
                    .get("avatar")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let returned_uin = detail
                    .get("uin")
                    .and_then(|v| v.as_str())
                    .filter(|v| !v.is_empty() && *v != "0")
                    .unwrap_or(&uin)
                    .to_string();

                let user = QQUserProfile {
                    uin: returned_uin,
                    nickname,
                    avatar_url,
                };
                self.update(|s| s.user = Some(user.clone()))?;
                Ok(Some(user))
            }
            Err(_) => {
                // Cookie is invalid, clear it
                self.update(|s| {
                    s.cookie.clear();
                    s.user = None;
                })?;
                Ok(None)
            }
        }
    }

    /// Clear session entirely.
    pub fn logout(&self) -> Result<(), QQAuthError> {
        self.update(|s| {
            *s = QQSession::default();
        })
    }
}

// ---- helpers ---------------------------------------------------------------

/// Extract QQ uin from a cookie string.
/// Typical format: `uin=o1234567890; ...` or `uin=1234567890; ...`
pub fn extract_uin(cookie: &str) -> Option<String> {
    for part in cookie.split(';') {
        let trimmed = part.trim();
        if let Some(rest) = trimmed.strip_prefix("uin=") {
            let value = rest.trim();
            if value.is_empty() {
                continue;
            }
            // Strip leading 'o' if present (QQ cookie convention)
            let uin = value.strip_prefix('o').unwrap_or(value);
            if !uin.is_empty() && uin.chars().all(|c| c.is_ascii_digit()) {
                return Some(uin.to_string());
            }
        }
    }
    None
}

// ---- persistence -----------------------------------------------------------

fn load_session() -> Result<QQSession, QQAuthError> {
    let path = session_path()?;
    if !path.exists() {
        return Ok(QQSession::default());
    }
    let raw = fs::read_to_string(&path)?;
    let session: QQSession = serde_json::from_str(&raw).unwrap_or_default();
    Ok(session)
}

fn save_session(session: &QQSession) -> Result<(), QQAuthError> {
    let path = session_path()?;
    let raw = serde_json::to_string_pretty(session)?;
    fs::write(&path, raw)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_uin_standard_format() {
        let cookie = "pgv_pvid=abc; uin=o1234567890; skey=@abc; p_uin=o1234567890";
        assert_eq!(extract_uin(cookie), Some("1234567890".to_string()));
    }

    #[test]
    fn extract_uin_no_prefix() {
        let cookie = "uin=9876543210; skey=@xyz";
        assert_eq!(extract_uin(cookie), Some("9876543210".to_string()));
    }

    #[test]
    fn extract_uin_missing() {
        let cookie = "skey=@abc; p_skey=xyz";
        assert_eq!(extract_uin(cookie), None);
    }

    #[test]
    fn extract_uin_empty_value() {
        let cookie = "uin=; skey=@abc";
        assert_eq!(extract_uin(cookie), None);
    }
}
