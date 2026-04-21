use keyring::{Entry, Error as KeyringError};
use thiserror::Error;

const SERVICE_NAME: &str = "com.fantasy.player";
const NETEASE_COOKIE_ACCOUNT: &str = "netease.cookie";
const QQ_COOKIE_ACCOUNT: &str = "qq.cookie";
const PROVIDER_PREFIX: &str = "llm.provider.";

#[derive(Debug, Error)]
pub enum SecretStoreError {
    #[error("系统凭证存取失败: {0}")]
    Backend(String),
}

impl From<KeyringError> for SecretStoreError {
    fn from(value: KeyringError) -> Self {
        SecretStoreError::Backend(value.to_string())
    }
}

fn entry(account: &str) -> Entry {
    Entry::new(SERVICE_NAME, account)
}

fn get_value(account: &str) -> Result<Option<String>, SecretStoreError> {
    match entry(account).get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn set_value(account: &str, value: &str) -> Result<(), SecretStoreError> {
    if value.is_empty() {
        return clear_value(account);
    }
    entry(account).set_password(value)?;
    Ok(())
}

fn clear_value(account: &str) -> Result<(), SecretStoreError> {
    match entry(account).delete_password() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub fn get_netease_cookie() -> Result<Option<String>, SecretStoreError> {
    get_value(NETEASE_COOKIE_ACCOUNT)
}

pub fn set_netease_cookie(cookie: &str) -> Result<(), SecretStoreError> {
    set_value(NETEASE_COOKIE_ACCOUNT, cookie)
}

pub fn clear_netease_cookie() -> Result<(), SecretStoreError> {
    clear_value(NETEASE_COOKIE_ACCOUNT)
}

pub fn get_qq_cookie() -> Result<Option<String>, SecretStoreError> {
    get_value(QQ_COOKIE_ACCOUNT)
}

pub fn set_qq_cookie(cookie: &str) -> Result<(), SecretStoreError> {
    set_value(QQ_COOKIE_ACCOUNT, cookie)
}

pub fn clear_qq_cookie() -> Result<(), SecretStoreError> {
    clear_value(QQ_COOKIE_ACCOUNT)
}

fn provider_account(provider_id: &str) -> String {
    format!("{PROVIDER_PREFIX}{provider_id}")
}

pub fn get_provider_api_key(provider_id: &str) -> Result<Option<String>, SecretStoreError> {
    get_value(&provider_account(provider_id))
}

pub fn set_provider_api_key(provider_id: &str, api_key: &str) -> Result<(), SecretStoreError> {
    set_value(&provider_account(provider_id), api_key)
}

pub fn clear_provider_api_key(provider_id: &str) -> Result<(), SecretStoreError> {
    clear_value(&provider_account(provider_id))
}
