//! NetEase 登录态管理。
//!
//! 职责：
//! - 通过 [`crate::netease_api`] 发起 QR 码登录流程
//! - 将 cookie 持久化到 app data 目录
//! - 为其他模块提供当前 cookie 与当前用户信息
//!
//! 此模块是整个后端的 cookie 真相源。`netease_api` 本身无状态，所有
//! 调用方从这里读取 cookie 再传入 adapter。

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;

use crate::netease_api::{invoke, NeteaseError};

// ---- paths -----------------------------------------------------------------

fn config_dir() -> Result<PathBuf, AuthError> {
    let base = dirs::config_dir().ok_or(AuthError::NoConfigDir)?;
    let dir = base.join("melody");
    fs::create_dir_all(&dir).map_err(AuthError::Io)?;
    Ok(dir)
}

fn session_path() -> Result<PathBuf, AuthError> {
    Ok(config_dir()?.join("session.json"))
}

// ---- types -----------------------------------------------------------------

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("未能定位用户配置目录")]
    NoConfigDir,
    #[error("读写会话文件失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("会话文件格式错误: {0}")]
    Json(#[from] serde_json::Error),
    #[error("网易云适配器调用失败: {0}")]
    Netease(#[from] NeteaseError),
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(default)]
    pub cookie: String,
    #[serde(default)]
    pub pending_unikey: String,
    #[serde(default)]
    pub user: Option<UserProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub user_id: String,
    pub nickname: String,
    pub avatar_url: String,
    pub vip_type: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrStartReceipt {
    pub unikey: String,
    pub qr_url: String,
    pub qr_img: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum QrCheckOutcome {
    Waiting { message: String },
    Scanned { message: String },
    Expired { message: String },
    Ok { user: UserProfile },
}

// ---- state -----------------------------------------------------------------

#[derive(Default)]
pub struct AuthState {
    inner: Mutex<Session>,
}

impl AuthState {
    /// 启动时从磁盘载入。如果文件不存在或损坏，返回空 session。
    pub fn load() -> Self {
        let session = load_session().unwrap_or_default();
        AuthState {
            inner: Mutex::new(session),
        }
    }

    pub fn cookie(&self) -> String {
        self.inner.lock().unwrap().cookie.clone()
    }

    pub fn current_user(&self) -> Option<UserProfile> {
        self.inner.lock().unwrap().user.clone()
    }

    pub fn snapshot(&self) -> Session {
        self.inner.lock().unwrap().clone()
    }

    fn update<F>(&self, mutator: F) -> Result<(), AuthError>
    where
        F: FnOnce(&mut Session),
    {
        let mut guard = self.inner.lock().unwrap();
        mutator(&mut guard);
        save_session(&guard)
    }

    // ---- public flows ------------------------------------------------------

    pub fn start_qr(&self) -> Result<QrStartReceipt, AuthError> {
        let key_data = invoke("qr_key", json!({}))?;
        let unikey = key_data
            .get("unikey")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if unikey.is_empty() {
            return Err(AuthError::Netease(NeteaseError::Adapter(
                "qr_key 未返回 unikey".into(),
            )));
        }

        let qr = invoke("qr_create", json!({ "unikey": unikey }))?;
        let qr_url = qr
            .get("qr_url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let qr_img = qr
            .get("qr_img")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        self.update(|s| {
            s.pending_unikey = unikey.clone();
        })?;

        Ok(QrStartReceipt {
            unikey,
            qr_url,
            qr_img,
        })
    }

    pub fn check_qr(&self) -> Result<QrCheckOutcome, AuthError> {
        let unikey = {
            let guard = self.inner.lock().unwrap();
            guard.pending_unikey.clone()
        };
        if unikey.is_empty() {
            return Ok(QrCheckOutcome::Waiting {
                message: "尚未发起扫码登录".into(),
            });
        }

        let resp = invoke("qr_check", json!({ "unikey": unikey }))?;
        let status = resp
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("waiting");
        let message = resp
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        match status {
            "waiting" => Ok(QrCheckOutcome::Waiting { message }),
            "scanned" => Ok(QrCheckOutcome::Scanned { message }),
            "expired" => {
                self.update(|s| s.pending_unikey.clear())?;
                Ok(QrCheckOutcome::Expired { message })
            }
            "ok" => {
                let cookie = resp
                    .get("cookie")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let status_data = invoke("login_status", json!({ "cookie": cookie }))?;
                let user = parse_user(&status_data)?;
                self.update(|s| {
                    s.cookie = cookie.clone();
                    s.pending_unikey.clear();
                    s.user = Some(user.clone());
                })?;
                Ok(QrCheckOutcome::Ok { user })
            }
            _ => Ok(QrCheckOutcome::Waiting { message }),
        }
    }

    /// 启动时刷新 cookie 状态：尝试验证已存 cookie 是否仍然有效。
    pub fn refresh(&self) -> Result<Option<UserProfile>, AuthError> {
        let cookie = self.cookie();
        if cookie.is_empty() {
            return Ok(None);
        }
        let resp = invoke("login_status", json!({ "cookie": cookie }))?;
        let logged_in = resp
            .get("logged_in")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !logged_in {
            self.update(|s| {
                s.cookie.clear();
                s.user = None;
            })?;
            return Ok(None);
        }
        let user = parse_user(&resp)?;
        self.update(|s| s.user = Some(user.clone()))?;
        Ok(Some(user))
    }

    pub fn logout(&self) -> Result<(), AuthError> {
        let cookie = self.cookie();
        if !cookie.is_empty() {
            let _ = invoke("logout", json!({ "cookie": cookie }));
        }
        self.update(|s| {
            *s = Session::default();
        })
    }
}

fn parse_user(resp: &serde_json::Value) -> Result<UserProfile, AuthError> {
    let user_val = resp.get("user").ok_or_else(|| {
        AuthError::Netease(NeteaseError::Adapter("login_status 未返回 user".into()))
    })?;
    let user: UserProfile = serde_json::from_value(user_val.clone())?;
    Ok(user)
}

// ---- persistence -----------------------------------------------------------

fn load_session() -> Result<Session, AuthError> {
    let path = session_path()?;
    if !path.exists() {
        return Ok(Session::default());
    }
    let raw = fs::read_to_string(&path)?;
    let session: Session = serde_json::from_str(&raw).unwrap_or_default();
    Ok(session)
}

fn save_session(session: &Session) -> Result<(), AuthError> {
    let path = session_path()?;
    let raw = serde_json::to_string_pretty(session)?;
    fs::write(&path, raw)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_key_and_create_round_trip() {
        // 直接走 adapter 接口，避免触碰全局 session 文件。
        let key_data = invoke("qr_key", json!({})).expect("qr_key");
        let unikey = key_data
            .get("unikey")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert!(!unikey.is_empty(), "unikey 不应为空");

        let qr = invoke("qr_create", json!({ "unikey": unikey })).expect("qr_create");
        let url = qr.get("qr_url").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(url.starts_with("http"), "qr_url 应为 http 链接, got: {url}");
    }
}
