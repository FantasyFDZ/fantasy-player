use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SecretStoreError {
    #[error("无法定位配置目录")]
    NoConfigDir,
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ProviderSecretRow {
    pub provider_id: String,
    pub api_key: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct ProviderSecretsFile {
    providers: Vec<ProviderSecretRow>,
}

fn config_dir() -> Result<PathBuf, SecretStoreError> {
    let base = dirs::config_dir().ok_or(SecretStoreError::NoConfigDir)?;
    let dir = base.join("melody");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn secrets_path() -> Result<PathBuf, SecretStoreError> {
    Ok(config_dir()?.join("provider_secrets.json"))
}

#[cfg(unix)]
fn restrict_file_permissions(path: &PathBuf) -> Result<(), SecretStoreError> {
    use std::os::unix::fs::PermissionsExt;
    let perms = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, perms)?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &PathBuf) -> Result<(), SecretStoreError> {
    Ok(())
}

fn load_file() -> Result<ProviderSecretsFile, SecretStoreError> {
    let path = secrets_path()?;
    if !path.exists() {
        return Ok(ProviderSecretsFile::default());
    }
    let raw = fs::read_to_string(&path)?;
    let parsed = serde_json::from_str(&raw).unwrap_or_default();
    Ok(parsed)
}

fn save_file(file: &ProviderSecretsFile) -> Result<(), SecretStoreError> {
    let path = secrets_path()?;
    let raw = serde_json::to_string_pretty(file)?;
    fs::write(&path, raw)?;
    restrict_file_permissions(&path)?;
    Ok(())
}

pub fn get_provider_api_key(provider_id: &str) -> Result<Option<String>, SecretStoreError> {
    let file = load_file()?;
    Ok(file
        .providers
        .into_iter()
        .find(|row| row.provider_id == provider_id)
        .map(|row| row.api_key))
}

pub fn set_provider_api_key(provider_id: &str, api_key: &str) -> Result<(), SecretStoreError> {
    let mut file = load_file()?;
    if let Some(row) = file
        .providers
        .iter_mut()
        .find(|row| row.provider_id == provider_id)
    {
        row.api_key = api_key.to_string();
    } else {
        file.providers.push(ProviderSecretRow {
            provider_id: provider_id.to_string(),
            api_key: api_key.to_string(),
        });
    }
    save_file(&file)
}

pub fn delete_provider_api_key(provider_id: &str) -> Result<(), SecretStoreError> {
    let mut file = load_file()?;
    file.providers.retain(|row| row.provider_id != provider_id);
    save_file(&file)
}
