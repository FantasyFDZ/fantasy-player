//! LLM 客户端真实调用烟测。
//!
//! 使用 in-memory Db，从环境变量读取 API key，打一次真实调用验证
//! OpenAI 协议实现是否正确。
//!
//! 运行：
//! ```
//! MELODY_TEST_DASHSCOPE_KEY=sk-xxx cargo test --test llm_smoke -- --nocapture
//! ```
//!
//! 如果环境变量未设置，测试会跳过（打印提示）。

use std::sync::Mutex;

use melody_lib::db::Db;
use melody_lib::llm_client::{
    ChunkSink, LlmClient, LlmMessage, LlmRequest, LlmStreamChunk, Protocol, Provider,
};

/// 测试用 ChunkSink —— 把每个 chunk push 到一个 Vec，稍后断言
struct CollectingSink {
    chunks: Mutex<Vec<LlmStreamChunk>>,
}

impl CollectingSink {
    fn new() -> Self {
        Self {
            chunks: Mutex::new(Vec::new()),
        }
    }
    fn chunks(&self) -> Vec<LlmStreamChunk> {
        self.chunks.lock().unwrap().clone()
    }
}

impl ChunkSink for CollectingSink {
    fn on_chunk(&self, chunk: &LlmStreamChunk) {
        self.chunks.lock().unwrap().push(chunk.clone());
    }
}

fn dashscope_key() -> Option<String> {
    std::env::var("MELODY_TEST_DASHSCOPE_KEY").ok()
}

fn seed_dashscope_openai(client: &LlmClient, db: &Db, api_key: String) {
    client
        .upsert_provider(
            db,
            Provider {
                id: "dashscope".into(),
                name: "通义 DashScope".into(),
                api_key,
                base_url: "https://coding.dashscope.aliyuncs.com/v1".into(),
                protocol: Protocol::Openai,
                models: vec!["qwen3.5-plus".into()],
            },
        )
        .expect("seed dashscope openai");
}

fn seed_dashscope_anthropic(client: &LlmClient, db: &Db, api_key: String) {
    client
        .upsert_provider(
            db,
            Provider {
                id: "dashscope-anthropic".into(),
                name: "通义 DashScope (Anthropic)".into(),
                api_key,
                base_url: "https://coding.dashscope.aliyuncs.com/apps/anthropic".into(),
                protocol: Protocol::Anthropic,
                models: vec!["qwen3.5-plus".into()],
            },
        )
        .expect("seed dashscope anthropic");
}

#[tokio::test(flavor = "multi_thread")]
async fn dashscope_openai_chat_round_trip() {
    let Some(api_key) = dashscope_key() else {
        eprintln!("[skip] MELODY_TEST_DASHSCOPE_KEY not set");
        return;
    };

    let db = Db::open_default_in_memory_for_test();
    let client = LlmClient::new();
    seed_dashscope_openai(&client, &db, api_key);

    let resp = client
        .request(
            &db,
            LlmRequest {
                provider_id: "dashscope".into(),
                model: "qwen3.5-plus".into(),
                messages: vec![
                    LlmMessage {
                        role: "system".into(),
                        content: "You are a terse assistant. Answer with exactly one word."
                            .into(),
                    },
                    LlmMessage {
                        role: "user".into(),
                        content: "What is the capital of France?".into(),
                    },
                ],
                temperature: Some(0.0),
                max_tokens: Some(32),
            },
        )
        .await
        .expect("llm request");

    eprintln!(
        "[openai] model={}, content={:?}, usage={:?}",
        resp.model, resp.content, resp.usage
    );
    assert!(!resp.content.is_empty());
    assert!(resp.content.to_lowercase().contains("paris"));
}

#[tokio::test(flavor = "multi_thread")]
async fn dashscope_anthropic_chat_round_trip() {
    let Some(api_key) = dashscope_key() else {
        eprintln!("[skip] MELODY_TEST_DASHSCOPE_KEY not set");
        return;
    };

    let db = Db::open_default_in_memory_for_test();
    let client = LlmClient::new();
    seed_dashscope_anthropic(&client, &db, api_key);

    let resp = client
        .request(
            &db,
            LlmRequest {
                provider_id: "dashscope-anthropic".into(),
                model: "qwen3.5-plus".into(),
                messages: vec![
                    LlmMessage {
                        role: "system".into(),
                        content: "You are a terse assistant. Answer with exactly one word."
                            .into(),
                    },
                    LlmMessage {
                        role: "user".into(),
                        content: "What is the capital of Japan?".into(),
                    },
                ],
                temperature: Some(0.0),
                max_tokens: Some(32),
            },
        )
        .await
        .expect("anthropic request");

    eprintln!(
        "[anthropic] model={}, content={:?}, usage={:?}",
        resp.model, resp.content, resp.usage
    );
    assert!(!resp.content.is_empty());
    assert!(
        resp.content.to_lowercase().contains("tokyo")
            || resp.content.contains("东京"),
        "expected Tokyo in response, got: {}",
        resp.content
    );
}

// 让 LlmStreamChunk 可以 clone，避免测试里反复解锁 mutex
//
// 我们在 llm_client.rs 已经给 LlmStreamChunk derive 了 Clone——如果未来
// 删除需要加回来。此注释只为提醒。

#[tokio::test(flavor = "multi_thread")]
async fn dashscope_openai_stream_round_trip() {
    let Some(api_key) = dashscope_key() else {
        eprintln!("[skip] MELODY_TEST_DASHSCOPE_KEY not set");
        return;
    };

    let db = Db::open_default_in_memory_for_test();
    let client = LlmClient::new();
    seed_dashscope_openai(&client, &db, api_key);

    let sink = CollectingSink::new();
    let resp = client
        .stream_with_sink(
            &db,
            "test-req-1",
            LlmRequest {
                provider_id: "dashscope".into(),
                model: "qwen3.5-plus".into(),
                messages: vec![LlmMessage {
                    role: "user".into(),
                    content: "数一数 one two three four five，完整输出".into(),
                }],
                temperature: Some(0.0),
                max_tokens: Some(64),
            },
            &sink,
        )
        .await
        .expect("openai stream");

    let chunks = sink.chunks();
    let deltas: Vec<_> = chunks.iter().filter(|c| !c.done).collect();
    let done = chunks.iter().filter(|c| c.done).count();

    eprintln!(
        "[openai-stream] chunks={} content={:?} usage={:?}",
        deltas.len(),
        resp.content,
        resp.usage
    );

    assert!(
        deltas.len() >= 2,
        "流式应返回多个 delta chunks, got {}",
        deltas.len()
    );
    assert_eq!(done, 1, "恰好一个 done=true 结尾 chunk");
    assert!(!resp.content.is_empty());

    // 累积的 delta 应等于最终 content
    let joined: String = deltas.iter().map(|c| c.delta.clone()).collect();
    assert_eq!(joined, resp.content, "delta 累加应等于最终 content");
}

#[tokio::test(flavor = "multi_thread")]
async fn dashscope_anthropic_stream_round_trip() {
    let Some(api_key) = dashscope_key() else {
        eprintln!("[skip] MELODY_TEST_DASHSCOPE_KEY not set");
        return;
    };

    let db = Db::open_default_in_memory_for_test();
    let client = LlmClient::new();
    seed_dashscope_anthropic(&client, &db, api_key);

    let sink = CollectingSink::new();
    let resp = client
        .stream_with_sink(
            &db,
            "test-req-2",
            LlmRequest {
                provider_id: "dashscope-anthropic".into(),
                model: "qwen3.5-plus".into(),
                messages: vec![LlmMessage {
                    role: "user".into(),
                    content: "数一数 one two three four five，完整输出".into(),
                }],
                temperature: Some(0.0),
                max_tokens: Some(64),
            },
            &sink,
        )
        .await
        .expect("anthropic stream");

    let chunks = sink.chunks();
    let deltas: Vec<_> = chunks.iter().filter(|c| !c.done).collect();
    let done = chunks.iter().filter(|c| c.done).count();

    eprintln!(
        "[anthropic-stream] chunks={} content={:?} usage={:?}",
        deltas.len(),
        resp.content,
        resp.usage
    );

    assert!(
        deltas.len() >= 2,
        "流式应返回多个 delta chunks, got {}",
        deltas.len()
    );
    assert_eq!(done, 1);
    assert!(!resp.content.is_empty());
    let joined: String = deltas.iter().map(|c| c.delta.clone()).collect();
    assert_eq!(joined, resp.content);
}
