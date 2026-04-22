//! 统一 LLM 客户端。
//!
//! 支持 OpenAI + Anthropic 两种协议，Provider 元数据从 [`crate::db`]
//! 读取。本模块只负责构造 HTTP 请求和解析响应，不缓存，不管理 Provider
//! 生命周期 —— 那些属于 Db 层的职责。
//!
//! LlmClient 是无状态的（只持有 reqwest::Client），Db 通过 method 参数
//! 注入 —— 这样可以作为 Tauri managed state 单独存在，不和 Db state
//! 的生命周期耦合。
//!
//! 流式输出的实现放在 phase 4.5，当前版本只提供 non-streaming。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

use crate::db::{Db, ProviderRow};
use crate::secrets;

// 默认实现保证可以 manage 到 Tauri state 里
impl Default for LlmClient {
    fn default() -> Self {
        Self::new()
    }
}

// ---- types -----------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Openai,
    Anthropic,
}

impl Protocol {
    fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "anthropic" => Protocol::Anthropic,
            _ => Protocol::Openai,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Protocol::Openai => "openai",
            Protocol::Anthropic => "anthropic",
        }
    }
}

/// 用户可见的 Provider（前端/命令层使用，不含 ProviderRow 的
/// `models_json` 字符串，已解析为 `Vec<String>`）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub base_url: String,
    pub protocol: Protocol,
    pub models: Vec<String>,
}

impl Provider {
    pub fn from_row(row: ProviderRow) -> Self {
        let models = serde_json::from_str::<Vec<String>>(&row.models_json)
            .unwrap_or_default();
        Provider {
            id: row.id,
            name: row.name,
            api_key: row.api_key,
            base_url: row.base_url,
            protocol: Protocol::parse(&row.protocol),
            models,
        }
    }
    pub fn into_row(self) -> ProviderRow {
        ProviderRow {
            id: self.id,
            name: self.name,
            api_key: self.api_key,
            base_url: self.base_url,
            protocol: self.protocol.as_str().into(),
            models_json: serde_json::to_string(&self.models)
                .unwrap_or_else(|_| "[]".into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub provider_id: String,
    pub model: String,
    pub messages: Vec<LlmMessage>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub content: String,
    pub model: String,
    pub usage: Option<LlmUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// Tauri 事件 payload：发给前端的流式 chunk。
#[derive(Debug, Clone, Serialize)]
pub struct LlmStreamChunk {
    pub request_id: String,
    pub delta: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<LlmUsage>,
}

/// chunk 回调接收器——stream 方法内部通过这个回调把 delta 广播出去。
/// 生产环境实现：Tauri AppHandle.emit(...)。测试环境实现：push 到 Vec。
pub trait ChunkSink: Send + Sync {
    fn on_chunk(&self, chunk: &LlmStreamChunk);
}

struct TauriSink<'a> {
    app: &'a AppHandle,
    event_name: String,
}

impl<'a> ChunkSink for TauriSink<'a> {
    fn on_chunk(&self, chunk: &LlmStreamChunk) {
        let _ = self.app.emit(&self.event_name, chunk);
    }
}

// ---- errors ----------------------------------------------------------------

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("未找到 Provider: {0}")]
    ProviderNotFound(String),
    #[error("Provider {0} 未配置 api_key")]
    MissingApiKey(String),
    #[error("HTTP 请求失败: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    #[error("DB 错误: {0}")]
    Db(#[from] crate::db::DbError),
    #[error("Secret store 错误: {0}")]
    SecretStore(String),
    #[error("LLM API 错误 (status {status}): {body}")]
    Api { status: u16, body: String },
    #[error("响应格式异常: {0}")]
    BadResponse(String),
}

// ---- client ----------------------------------------------------------------

pub struct LlmClient {
    http: reqwest::Client,
}

impl LlmClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent("melody/0.1.0")
            .build()
            .expect("failed to build reqwest client");
        LlmClient { http }
    }

    fn hydrate_provider_secret(provider: &mut Provider) -> Result<(), LlmError> {
        let secret = secrets::get_provider_api_key(&provider.id)
            .map_err(|e| LlmError::SecretStore(e.to_string()))?;
        provider.api_key = secret.unwrap_or_default();
        Ok(())
    }

    // ---- provider management ----
    pub fn list_providers(&self, db: &Db) -> Result<Vec<Provider>, LlmError> {
        db.provider_list()?
            .into_iter()
            .map(|row| {
                let mut provider = Provider::from_row(row);
                Self::hydrate_provider_secret(&mut provider)?;
                Ok(provider)
            })
            .collect()
    }

    pub fn upsert_provider(&self, db: &Db, provider: Provider) -> Result<(), LlmError> {
        let secret = provider.api_key.clone();
        let mut row = provider.into_row();
        row.api_key.clear();
        db.provider_upsert(&row)?;
        secrets::set_provider_api_key(&row.id, &secret)
            .map_err(|e| LlmError::SecretStore(e.to_string()))?;
        Ok(())
    }

    pub fn delete_provider(&self, db: &Db, id: &str) -> Result<(), LlmError> {
        db.provider_delete(id)?;
        secrets::delete_provider_api_key(id)
            .map_err(|e| LlmError::SecretStore(e.to_string()))?;
        Ok(())
    }

    // ---- request routing ----
    pub async fn request(&self, db: &Db, req: LlmRequest) -> Result<LlmResponse, LlmError> {
        let row = db
            .provider_get(&req.provider_id)?
            .ok_or_else(|| LlmError::ProviderNotFound(req.provider_id.clone()))?;
        let mut provider = Provider::from_row(row);
        Self::hydrate_provider_secret(&mut provider)?;

        match provider.protocol {
            Protocol::Openai => self.request_openai(&provider, req).await,
            Protocol::Anthropic => self.request_anthropic(&provider, req).await,
        }
    }

    /// 流式调用。逐 chunk 通过 Tauri event 推送到前端：
    /// - event 名: `melody://llm-chunk/<request_id>`
    /// - payload: [`LlmStreamChunk`]
    ///
    /// 返回值：当流结束时返回累积的完整内容（供调用方缓存或最终展示）。
    pub async fn stream(
        &self,
        db: &Db,
        app: &AppHandle,
        request_id: &str,
        req: LlmRequest,
    ) -> Result<LlmResponse, LlmError> {
        let sink = TauriSink {
            app,
            event_name: format!("melody://llm-chunk/{request_id}"),
        };
        self.stream_with_sink(db, request_id, req, &sink).await
    }

    /// 可测试入口：调用方提供自己的 ChunkSink（如 push 到 Vec）。
    pub async fn stream_with_sink(
        &self,
        db: &Db,
        request_id: &str,
        req: LlmRequest,
        sink: &dyn ChunkSink,
    ) -> Result<LlmResponse, LlmError> {
        let row = db
            .provider_get(&req.provider_id)?
            .ok_or_else(|| LlmError::ProviderNotFound(req.provider_id.clone()))?;
        let mut provider = Provider::from_row(row);
        Self::hydrate_provider_secret(&mut provider)?;

        match provider.protocol {
            Protocol::Openai => {
                self.stream_openai(&provider, request_id, req, sink).await
            }
            Protocol::Anthropic => {
                self.stream_anthropic(&provider, request_id, req, sink).await
            }
        }
    }

    // ---- OpenAI chat/completions -----------------------------------------

    async fn request_openai(
        &self,
        provider: &Provider,
        req: LlmRequest,
    ) -> Result<LlmResponse, LlmError> {
        if provider.api_key.is_empty() && !is_local(&provider.base_url) {
            return Err(LlmError::MissingApiKey(provider.id.clone()));
        }

        let url = join_url(&provider.base_url, "chat/completions");
        let mut body = json!({
            "model": req.model,
            "messages": req.messages,
        });
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(m) = req.max_tokens {
            body["max_tokens"] = json!(m);
        }

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&provider.api_key)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(LlmError::Api {
                status: status.as_u16(),
                body: text,
            });
        }

        let v: serde_json::Value = serde_json::from_str(&text)?;
        let message = v
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .ok_or_else(|| {
                LlmError::BadResponse(format!(
                    "OpenAI 响应缺少 choices[0].message: {text}"
                ))
            })?;
        let content_raw = message.get("content").and_then(|s| s.as_str()).unwrap_or("");
        // Reasoning 模型的思考过程在 message.reasoning_content，用 <think>
        // 标签包起来拼到 content 前（前端已剥离 <think>...</think>）。
        let reasoning = message
            .get("reasoning_content")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        let content = if reasoning.is_empty() {
            content_raw.to_string()
        } else {
            format!("<think>{reasoning}</think>\n{content_raw}")
        };
        if content.is_empty() {
            return Err(LlmError::BadResponse(format!(
                "OpenAI 响应 content 和 reasoning_content 都为空: {text}"
            )));
        }

        let model = v
            .get("model")
            .and_then(|s| s.as_str())
            .unwrap_or(&req.model)
            .to_string();

        let usage = v.get("usage").and_then(|u| {
            Some(LlmUsage {
                prompt_tokens: u.get("prompt_tokens")?.as_u64()? as u32,
                completion_tokens: u.get("completion_tokens")?.as_u64()? as u32,
                total_tokens: u.get("total_tokens")?.as_u64()? as u32,
            })
        });

        Ok(LlmResponse {
            content,
            model,
            usage,
        })
    }

    // ---- Anthropic messages ---------------------------------------------
    //
    // 与 OpenAI 的主要差异：
    // - x-api-key header 而不是 Authorization: Bearer
    // - system 作为顶层字段而不是 role=system 的 message
    // - max_tokens 必填（我们给 4096 默认）
    // - 响应 content[0].text, usage.input_tokens/output_tokens

    async fn request_anthropic(
        &self,
        provider: &Provider,
        req: LlmRequest,
    ) -> Result<LlmResponse, LlmError> {
        if provider.api_key.is_empty() && !is_local(&provider.base_url) {
            return Err(LlmError::MissingApiKey(provider.id.clone()));
        }

        let url = anthropic_url(&provider.base_url);
        let body = build_anthropic_body(&req);

        let resp = self
            .http
            .post(&url)
            .header("x-api-key", &provider.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(LlmError::Api {
                status: status.as_u16(),
                body: text,
            });
        }

        let v: serde_json::Value = serde_json::from_str(&text)?;

        // 合并 content 数组里所有 type="text" 块
        let content = v
            .get("content")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|block| {
                        if block.get("type")?.as_str()? == "text" {
                            Some(block.get("text")?.as_str()?.to_string())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("")
            })
            .ok_or_else(|| {
                LlmError::BadResponse(format!(
                    "Anthropic 响应缺少 content[]: {text}"
                ))
            })?;

        let model = v
            .get("model")
            .and_then(|s| s.as_str())
            .unwrap_or(&req.model)
            .to_string();

        let usage = v.get("usage").and_then(|u| {
            let input = u.get("input_tokens")?.as_u64()? as u32;
            let output = u.get("output_tokens")?.as_u64()? as u32;
            Some(LlmUsage {
                prompt_tokens: input,
                completion_tokens: output,
                total_tokens: input + output,
            })
        });

        Ok(LlmResponse {
            content,
            model,
            usage,
        })
    }
}

// ---- OpenAI streaming ------------------------------------------------------

impl LlmClient {
    async fn stream_openai(
        &self,
        provider: &Provider,
        request_id: &str,
        req: LlmRequest,
        sink: &dyn ChunkSink,
    ) -> Result<LlmResponse, LlmError> {
        if provider.api_key.is_empty() && !is_local(&provider.base_url) {
            return Err(LlmError::MissingApiKey(provider.id.clone()));
        }

        let url = join_url(&provider.base_url, "chat/completions");
        let mut body = json!({
            "model": req.model,
            "messages": req.messages,
            "stream": true,
        });
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(m) = req.max_tokens {
            body["max_tokens"] = json!(m);
        }

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&provider.api_key)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(LlmError::Api {
                status: status.as_u16(),
                body,
            });
        }

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        let mut accumulated = String::new();
        let mut final_usage: Option<LlmUsage> = None;
        let mut final_model = req.model.clone();
        // Reasoning 模型（MiMo / DeepSeek-R1 等）会把思考过程写进
        // delta.reasoning_content，正式答案才进 delta.content。把思考流
        // 用 <think>…</think> 包起来串到 accumulated，前端已有剥离逻辑，
        // 既不污染展示，又能让用户流式看到"在思考"。
        let mut in_reasoning = false;

        let mut emit = |text: &str, acc: &mut String| {
            if text.is_empty() {
                return;
            }
            acc.push_str(text);
            sink.on_chunk(&LlmStreamChunk {
                request_id: request_id.to_string(),
                delta: text.to_string(),
                done: false,
                usage: None,
            });
        };

        while let Some(chunk) = stream.next().await {
            let bytes = chunk?;
            buf.extend_from_slice(&bytes);
            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                let line_str = std::str::from_utf8(&line_bytes).unwrap_or("").trim();
                if line_str.is_empty() {
                    continue;
                }
                let Some(data) = strip_sse_data_prefix(line_str) else {
                    continue;
                };
                if data == "[DONE]" {
                    continue;
                }
                let Ok(val) = serde_json::from_str::<serde_json::Value>(data) else {
                    continue;
                };
                let delta_obj = val
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"));
                let reasoning = delta_obj
                    .and_then(|d| d.get("reasoning_content"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                let content_str = delta_obj
                    .and_then(|d| d.get("content"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                if !reasoning.is_empty() {
                    if !in_reasoning {
                        emit("<think>", &mut accumulated);
                        in_reasoning = true;
                    }
                    emit(reasoning, &mut accumulated);
                }
                if !content_str.is_empty() {
                    if in_reasoning {
                        emit("</think>\n", &mut accumulated);
                        in_reasoning = false;
                    }
                    emit(content_str, &mut accumulated);
                }
                if let Some(model) = val.get("model").and_then(|m| m.as_str()) {
                    final_model = model.to_string();
                }
                if let Some(usage) = val.get("usage") {
                    final_usage = parse_openai_usage(usage);
                }
            }
        }
        // 流结束但还在 reasoning 区间（模型被 max_tokens 截断，没输出 content）
        // —— 补闭合标签，前端剥离后会显示"正文为空"而不是卡死的 <think>。
        if in_reasoning {
            emit("</think>", &mut accumulated);
        }

        sink.on_chunk(&LlmStreamChunk {
            request_id: request_id.to_string(),
            delta: String::new(),
            done: true,
            usage: final_usage.clone(),
        });

        Ok(LlmResponse {
            content: accumulated,
            model: final_model,
            usage: final_usage,
        })
    }
}

fn parse_openai_usage(u: &serde_json::Value) -> Option<LlmUsage> {
    Some(LlmUsage {
        prompt_tokens: u.get("prompt_tokens")?.as_u64()? as u32,
        completion_tokens: u.get("completion_tokens")?.as_u64()? as u32,
        total_tokens: u.get("total_tokens")?.as_u64()? as u32,
    })
}

/// 兼容 `data: ` 和 `data:` 两种 SSE 分隔符写法。
/// 不同 LLM 代理（官方 OpenAI / Anthropic / DashScope 的 anthropic 网关）
/// 在这个分隔符上行为不一致。
fn strip_sse_data_prefix(line: &str) -> Option<&str> {
    if let Some(rest) = line.strip_prefix("data: ") {
        Some(rest)
    } else if let Some(rest) = line.strip_prefix("data:") {
        Some(rest)
    } else {
        None
    }
}

// ---- Anthropic streaming ---------------------------------------------------

impl LlmClient {
    async fn stream_anthropic(
        &self,
        provider: &Provider,
        request_id: &str,
        req: LlmRequest,
        sink: &dyn ChunkSink,
    ) -> Result<LlmResponse, LlmError> {
        if provider.api_key.is_empty() && !is_local(&provider.base_url) {
            return Err(LlmError::MissingApiKey(provider.id.clone()));
        }

        let url = anthropic_url(&provider.base_url);
        let mut body = build_anthropic_body(&req);
        body["stream"] = json!(true);

        let resp = self
            .http
            .post(&url)
            .header("x-api-key", &provider.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(LlmError::Api {
                status: status.as_u16(),
                body,
            });
        }

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        let mut accumulated = String::new();
        let mut final_usage_input: u32 = 0;
        let mut final_usage_output: u32 = 0;
        let mut final_model = req.model.clone();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk?;
            buf.extend_from_slice(&bytes);
            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                let line_str = std::str::from_utf8(&line_bytes).unwrap_or("").trim();
                let Some(data) = strip_sse_data_prefix(line_str) else {
                    continue;
                };
                let Ok(val) = serde_json::from_str::<serde_json::Value>(data) else {
                    continue;
                };
                let Some(type_str) = val.get("type").and_then(|t| t.as_str()) else {
                    continue;
                };
                match type_str {
                    "message_start" => {
                        if let Some(model) = val
                            .get("message")
                            .and_then(|m| m.get("model"))
                            .and_then(|m| m.as_str())
                        {
                            final_model = model.to_string();
                        }
                        if let Some(usage) = val.get("message").and_then(|m| m.get("usage")) {
                            if let Some(input) = usage.get("input_tokens").and_then(|u| u.as_u64()) {
                                final_usage_input = input as u32;
                            }
                        }
                    }
                    "content_block_delta" => {
                        if let Some(text) = val
                            .get("delta")
                            .and_then(|d| d.get("text"))
                            .and_then(|s| s.as_str())
                        {
                            if !text.is_empty() {
                                accumulated.push_str(text);
                                sink.on_chunk(&LlmStreamChunk {
                                    request_id: request_id.to_string(),
                                    delta: text.to_string(),
                                    done: false,
                                    usage: None,
                                });
                            }
                        }
                    }
                    "message_delta" => {
                        if let Some(output) =
                            val.get("usage").and_then(|u| u.get("output_tokens")).and_then(|o| o.as_u64())
                        {
                            final_usage_output = output as u32;
                        }
                    }
                    _ => {}
                }
            }
        }

        let usage = if final_usage_input > 0 || final_usage_output > 0 {
            Some(LlmUsage {
                prompt_tokens: final_usage_input,
                completion_tokens: final_usage_output,
                total_tokens: final_usage_input + final_usage_output,
            })
        } else {
            None
        };

        sink.on_chunk(&LlmStreamChunk {
            request_id: request_id.to_string(),
            delta: String::new(),
            done: true,
            usage: usage.clone(),
        });

        Ok(LlmResponse {
            content: accumulated,
            model: final_model,
            usage,
        })
    }
}

// ---- Anthropic helpers -----------------------------------------------------

/// Anthropic 期望 base_url 可能以 /v1 结尾也可能不以 /v1 结尾
fn anthropic_url(base: &str) -> String {
    let base = base.trim_end_matches('/');
    if base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    }
}

/// 把 LlmRequest 翻译成 Anthropic messages body。
/// system role 被抽离成顶层 `system` 字段。
fn build_anthropic_body(req: &LlmRequest) -> serde_json::Value {
    let mut system_parts = Vec::new();
    let mut messages = Vec::new();
    for msg in &req.messages {
        if msg.role == "system" {
            system_parts.push(msg.content.clone());
        } else {
            messages.push(serde_json::json!({
                "role": msg.role,
                "content": msg.content,
            }));
        }
    }

    let mut body = serde_json::json!({
        "model": req.model,
        "messages": messages,
        "max_tokens": req.max_tokens.unwrap_or(4096),
    });
    if !system_parts.is_empty() {
        body["system"] = serde_json::json!(system_parts.join("\n\n"));
    }
    if let Some(t) = req.temperature {
        body["temperature"] = serde_json::json!(t);
    }
    body
}

// ---- helpers ---------------------------------------------------------------

fn is_local(url: &str) -> bool {
    url.contains("localhost") || url.contains("127.0.0.1")
}

fn join_url(base: &str, path: &str) -> String {
    let base = base.trim_end_matches('/');
    let path = path.trim_start_matches('/');
    format!("{base}/{path}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_parse_is_case_insensitive() {
        assert_eq!(Protocol::parse("openai"), Protocol::Openai);
        assert_eq!(Protocol::parse("OPENAI"), Protocol::Openai);
        assert_eq!(Protocol::parse("anthropic"), Protocol::Anthropic);
        assert_eq!(Protocol::parse("garbage"), Protocol::Openai);
    }

    #[test]
    fn join_url_handles_trailing_slash() {
        assert_eq!(
            join_url("https://api.example.com/v1", "chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            join_url("https://api.example.com/v1/", "/chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn anthropic_url_handles_v1_suffix() {
        assert_eq!(
            anthropic_url("https://api.anthropic.com"),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            anthropic_url("https://api.anthropic.com/v1"),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            anthropic_url("https://coding.dashscope.aliyuncs.com/apps/anthropic/"),
            "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages"
        );
    }

    #[test]
    fn anthropic_body_extracts_system_role() {
        let req = LlmRequest {
            provider_id: "x".into(),
            model: "claude".into(),
            messages: vec![
                LlmMessage {
                    role: "system".into(),
                    content: "be terse".into(),
                },
                LlmMessage {
                    role: "user".into(),
                    content: "hi".into(),
                },
            ],
            temperature: Some(0.5),
            max_tokens: Some(100),
        };
        let body = build_anthropic_body(&req);
        assert_eq!(body["system"], "be terse");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["max_tokens"], 100);
        assert_eq!(body["temperature"], 0.5);
    }

    #[test]
    fn provider_row_round_trip() {
        let p = Provider {
            id: "x".into(),
            name: "X".into(),
            api_key: "k".into(),
            base_url: "http://x".into(),
            protocol: Protocol::Anthropic,
            models: vec!["a".into(), "b".into()],
        };
        let row = p.clone().into_row();
        let back = Provider::from_row(row);
        assert_eq!(back.id, "x");
        assert_eq!(back.protocol, Protocol::Anthropic);
        assert_eq!(back.models, vec!["a".to_string(), "b".into()]);
    }
}
