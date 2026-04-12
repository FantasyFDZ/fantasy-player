//! 全 Provider × 全模型 × 两协议的烟测矩阵。
//!
//! 需要环境变量：
//! - MELODY_TEST_DASHSCOPE_KEY
//! - MELODY_TEST_MINIMAX_KEY
//! - MELODY_TEST_MIMO_KEY
//!
//! 任一未设置的 Provider 会整组跳过。每个测试函数覆盖一个套餐的
//! 所有聊天模型 × OpenAI 协议 × Anthropic 协议。不涉及 TTS 模型
//! （TTS 不走 chat/completions 接口）。
//!
//! 运行：
//! ```
//! MELODY_TEST_DASHSCOPE_KEY=... MELODY_TEST_MINIMAX_KEY=... MELODY_TEST_MIMO_KEY=... \
//!   cargo test --test llm_all_providers -- --nocapture
//! ```

use melody_lib::db::Db;
use melody_lib::llm_client::{
    LlmClient, LlmMessage, LlmRequest, Protocol, Provider,
};

fn build_request(provider_id: &str, model: &str) -> LlmRequest {
    LlmRequest {
        provider_id: provider_id.into(),
        model: model.into(),
        messages: vec![
            LlmMessage {
                role: "system".into(),
                content: "You are a terse assistant. Answer with exactly one word.".into(),
            },
            LlmMessage {
                role: "user".into(),
                content: "What is the capital of France?".into(),
            },
        ],
        temperature: Some(0.0),
        // 512 足够 thinking 模型走完 reasoning 阶段再输出答案
        max_tokens: Some(512),
    }
}

/// 把一个模型在一种协议上跑一次 chat。OK/ERR 都 print 出来，返回是否通过。
async fn try_model(
    client: &LlmClient,
    db: &Db,
    label: &str,
    provider_id: &str,
    model: &str,
) -> bool {
    match client.request(db, build_request(provider_id, model)).await {
        Ok(resp) => {
            let brief: String = resp.content.chars().take(60).collect();
            let matched = resp.content.to_lowercase().contains("paris");
            eprintln!(
                "  [{}] {} / {}  →  {:?}{} {}",
                if matched { "✓" } else { "?" },
                label,
                model,
                brief,
                if resp.content.len() > 60 { "…" } else { "" },
                resp.usage
                    .as_ref()
                    .map(|u| format!("(total {} tok)", u.total_tokens))
                    .unwrap_or_default()
            );
            // 只要后端返回了 content 就算通过（部分模型可能输出多字符，不严格匹配）
            !resp.content.trim().is_empty()
        }
        Err(e) => {
            eprintln!("  [✗] {} / {}  →  ERROR: {}", label, model, e);
            false
        }
    }
}

// ========== DashScope ==========

#[tokio::test(flavor = "multi_thread")]
async fn dashscope_all_models() {
    let Ok(api_key) = std::env::var("MELODY_TEST_DASHSCOPE_KEY") else {
        eprintln!("[skip] MELODY_TEST_DASHSCOPE_KEY not set");
        return;
    };

    let db = Db::open_default_in_memory_for_test();
    let client = LlmClient::new();

    // 注册两个 Provider：同一个 key，不同 base_url + protocol
    client
        .upsert_provider(
            &db,
            Provider {
                id: "ds-openai".into(),
                name: "DashScope OpenAI".into(),
                api_key: api_key.clone(),
                base_url: "https://coding.dashscope.aliyuncs.com/v1".into(),
                protocol: Protocol::Openai,
                models: vec![],
            },
        )
        .unwrap();
    client
        .upsert_provider(
            &db,
            Provider {
                id: "ds-anthropic".into(),
                name: "DashScope Anthropic".into(),
                api_key,
                base_url: "https://coding.dashscope.aliyuncs.com/apps/anthropic".into(),
                protocol: Protocol::Anthropic,
                models: vec![],
            },
        )
        .unwrap();

    eprintln!("\n=== DashScope Coding Plan ===");
    let models = ["qwen3.5-plus", "glm-5", "kimi-k2.5", "MiniMax-M2.5"];
    let mut pass = 0usize;
    let mut total = 0usize;

    eprintln!("-- OpenAI 协议 --");
    for m in models {
        total += 1;
        if try_model(&client, &db, "openai", "ds-openai", m).await {
            pass += 1;
        }
    }

    eprintln!("-- Anthropic 协议 --");
    for m in models {
        total += 1;
        if try_model(&client, &db, "anthropic", "ds-anthropic", m).await {
            pass += 1;
        }
    }

    eprintln!(
        "\n[dashscope] {} / {} 通过（{} 模型 × 2 协议）\n",
        pass, total, models.len()
    );
    assert_eq!(pass, total, "DashScope 套餐有模型调用失败");
}

// ========== MiniMax ==========

#[tokio::test(flavor = "multi_thread")]
async fn minimax_all_models() {
    let Ok(api_key) = std::env::var("MELODY_TEST_MINIMAX_KEY") else {
        eprintln!("[skip] MELODY_TEST_MINIMAX_KEY not set");
        return;
    };

    let db = Db::open_default_in_memory_for_test();
    let client = LlmClient::new();

    client
        .upsert_provider(
            &db,
            Provider {
                id: "mm-openai".into(),
                name: "MiniMax OpenAI".into(),
                api_key: api_key.clone(),
                base_url: "https://api.minimaxi.com/v1".into(),
                protocol: Protocol::Openai,
                models: vec![],
            },
        )
        .unwrap();
    client
        .upsert_provider(
            &db,
            Provider {
                id: "mm-anthropic".into(),
                name: "MiniMax Anthropic".into(),
                api_key,
                base_url: "https://api.minimaxi.com/anthropic".into(),
                protocol: Protocol::Anthropic,
                models: vec![],
            },
        )
        .unwrap();

    eprintln!("\n=== MiniMax Coding Plan ===");
    let models = ["MiniMax-M2.7-highspeed"];
    let mut pass = 0usize;
    let mut total = 0usize;

    eprintln!("-- OpenAI 协议 --");
    for m in models {
        total += 1;
        if try_model(&client, &db, "openai", "mm-openai", m).await {
            pass += 1;
        }
    }

    eprintln!("-- Anthropic 协议 --");
    for m in models {
        total += 1;
        if try_model(&client, &db, "anthropic", "mm-anthropic", m).await {
            pass += 1;
        }
    }

    eprintln!(
        "\n[minimax] {} / {} 通过（{} 模型 × 2 协议）\n",
        pass, total, models.len()
    );
    assert_eq!(pass, total, "MiniMax 套餐有模型调用失败");
}

// ========== MiMo ==========

#[tokio::test(flavor = "multi_thread")]
async fn mimo_all_models() {
    let Ok(api_key) = std::env::var("MELODY_TEST_MIMO_KEY") else {
        eprintln!("[skip] MELODY_TEST_MIMO_KEY not set");
        return;
    };

    let db = Db::open_default_in_memory_for_test();
    let client = LlmClient::new();

    client
        .upsert_provider(
            &db,
            Provider {
                id: "mimo-openai".into(),
                name: "MiMo OpenAI".into(),
                api_key: api_key.clone(),
                base_url: "https://token-plan-cn.xiaomimimo.com/v1".into(),
                protocol: Protocol::Openai,
                models: vec![],
            },
        )
        .unwrap();
    client
        .upsert_provider(
            &db,
            Provider {
                id: "mimo-anthropic".into(),
                name: "MiMo Anthropic".into(),
                api_key,
                base_url: "https://token-plan-cn.xiaomimimo.com/anthropic".into(),
                protocol: Protocol::Anthropic,
                models: vec![],
            },
        )
        .unwrap();

    eprintln!("\n=== MiMo Coding Plan ===");
    // MiMo 网关对大小写敏感（大写会被 gate 拦 403），必须小写
    // 用户指定只测 mimo-v2-pro
    let models = ["mimo-v2-pro"];
    let mut pass = 0usize;
    let mut total = 0usize;

    eprintln!("-- OpenAI 协议 --");
    for m in models {
        total += 1;
        if try_model(&client, &db, "openai", "mimo-openai", m).await {
            pass += 1;
        }
    }

    eprintln!("-- Anthropic 协议 --");
    for m in models {
        total += 1;
        if try_model(&client, &db, "anthropic", "mimo-anthropic", m).await {
            pass += 1;
        }
    }

    eprintln!(
        "\n[mimo] {} / {} 通过（{} 模型 × 2 协议）\n",
        pass, total, models.len()
    );
    assert_eq!(pass, total, "MiMo 套餐有模型调用失败");
}
