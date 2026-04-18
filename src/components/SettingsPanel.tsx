// 设置面板 —— 独立窗口版。
//
// 功能（按 tab 分组）：
//   "模型"   —— LLM Provider 配置（name / base_url / protocol / api_key /
//                models 列表 + active 选择，保存到 settings 表）
//   "歌单迁移" —— QQ 音乐 ↔ 网易云 歌单迁移（原 PlaylistSync 面板）
//
// 默认显示"模型" tab。tab bar 风格沿用 SearchPanel 的 TabButton。

import { useEffect, useState } from "react";
import { api, type LlmProtocol } from "@/lib/api";
import { PlaylistSync } from "@/plugins/PlaylistSync/PlaylistSync";

type Tab = "models" | "playlist_sync";

export function SettingsPanel() {
  const [tab, setTab] = useState<Tab>("models");

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="mb-3 flex items-center gap-2">
        <TabButton active={tab === "models"} onClick={() => setTab("models")}>
          模型
        </TabButton>
        <TabButton
          active={tab === "playlist_sync"}
          onClick={() => setTab("playlist_sync")}
        >
          歌单迁移
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex flex-1 flex-col" style={{ minHeight: 0 }}>
        {tab === "models" ? <LlmSettingsView /> : <PlaylistSync />}
      </div>
    </div>
  );
}

// ---- LLM 模型配置视图 (简化版 —— 单一配置) ----------------------------------
//
// 三个核心字段：调用地址、模型名称、API Key。
// 协议默认 openai（kimi/通义/MiniMax 等国内模型都走 OpenAI 兼容接口），
// 仅在使用 Claude API 时需要手动切到 anthropic。

function LlmSettingsView() {
  // 保留原 provider id，保存时回写同一条记录
  const [providerId, setProviderId] = useState("default");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [protocol, setProtocol] = useState<LlmProtocol>("openai");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const providers = await api.llmProvidersList();
      const savedId =
        (await api.getSetting("ai.active_provider_id").catch(() => null)) ?? "";
      const savedModel =
        (await api.getSetting("ai.active_model").catch(() => null)) ?? "";

      // 优先用 active provider 填充
      const active = providers.find((p) => p.id === savedId);
      if (active) {
        setProviderId(active.id);
        setBaseUrl(active.base_url);
        setApiKey(active.api_key);
        setProtocol(active.protocol);
        if (savedModel) setModelName(savedModel);
        else if (active.models.length > 0) setModelName(active.models[0]);
      } else {
        // 没有 active：取第一个有 key 的
        const first = providers.find(
          (p) => p.api_key.trim() !== "" && p.models.length > 0,
        );
        if (first) {
          setProviderId(first.id);
          setBaseUrl(first.base_url);
          setApiKey(first.api_key);
          setProtocol(first.protocol);
          setModelName(first.models[0]);
        }
        // 都没有 → 保持默认值
      }
      if (!cancelled) setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const flashStatus = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 2800);
  };

  const handleSave = async () => {
    const model = modelName.trim();
    if (!model) {
      flashStatus("✗ 请填写模型名称");
      return;
    }
    if (!baseUrl.trim()) {
      flashStatus("✗ 请填写调用地址");
      return;
    }
    try {
      await api.llmProviderUpsert({
        id: providerId,
        name: model,
        protocol,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        models: [model],
      });
      await api.setSetting("ai.active_provider_id", providerId);
      await api.setSetting("ai.active_model", model);
      flashStatus("✓ 配置已保存");
    } catch (err) {
      flashStatus(`✗ 保存失败: ${err}`);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "var(--theme-lyrics-mid)",
          fontSize: 13,
        }}
      >
        加载中…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="mb-2"
        style={{
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "var(--theme-label)",
          fontFamily: "var(--font-mono)",
          filter: "brightness(1.4)",
        }}
      >
        模型配置
      </div>
      <div
        className="mb-4"
        style={{
          fontSize: 11,
          color: "var(--theme-lyrics-mid)",
          lineHeight: 1.6,
        }}
      >
        配置 AI 调用的大模型。API Key 存储在本机 SQLite，不会上传。
      </div>

      {/* 主表单 */}
      <div className="flex flex-col gap-3">
        <Field label="调用地址">
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            style={inputStyle}
            placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
          />
        </Field>
        <Field label="模型名称">
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            style={inputStyle}
            placeholder="kimi-k2.5"
          />
        </Field>
        <Field label="API Key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={inputStyle}
            placeholder="留空 = 本地模型 / 免 token 服务"
          />
        </Field>

        {/* 高级：协议切换 */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{
            alignSelf: "flex-start",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
            color: "var(--theme-lyrics-mid)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 0",
          }}
        >
          {showAdvanced ? "▾ 高级选项" : "▸ 高级选项"}
        </button>
        {showAdvanced && (
          <div
            className="rounded-md px-3 py-2"
            style={{
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(0,0,0,0.35)",
            }}
          >
            <Field label="协议">
              <div className="flex items-center gap-4" style={{ marginTop: 2 }}>
                {(["openai", "anthropic"] as const).map((p) => (
                  <label
                    key={p}
                    className="flex items-center gap-1.5"
                    style={{
                      fontSize: 11,
                      cursor: "pointer",
                      color:
                        protocol === p
                          ? "var(--theme-accent)"
                          : "var(--theme-lyrics-title)",
                    }}
                  >
                    <input
                      type="radio"
                      name="llm-protocol"
                      checked={protocol === p}
                      onChange={() => setProtocol(p)}
                      style={{ accentColor: "var(--theme-accent)" }}
                    />
                    <span className="font-mono">{p}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}

        {/* 保存 */}
        <button
          type="button"
          onClick={handleSave}
          className="mt-1 rounded-md transition-all hover:scale-[1.01]"
          style={saveButtonStyle}
        >
          保存
        </button>
      </div>

      {status && (
        <div
          className="mt-3 rounded-md px-3 py-2"
          style={{
            fontSize: 11,
            background: status.startsWith("✓")
              ? "rgba(80,160,80,0.15)"
              : "rgba(180,60,60,0.2)",
            color: status.startsWith("✓")
              ? "rgba(200,240,200,0.9)"
              : "rgba(255,200,180,0.9)",
            border: "1px solid rgba(0,0,0,0.3)",
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "var(--theme-lyrics-mid)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-ui)",
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(0,0,0,0.55)",
  color: "rgba(255,240,220,0.95)",
  padding: "6px 10px",
  borderRadius: 4,
  outline: "none",
  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
};

const saveButtonStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--theme-accent)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
  border: "1px solid var(--theme-accent)",
  padding: "5px 12px",
  borderRadius: 4,
  cursor: "pointer",
};

// ---- Tab 切换按钮（沿用 SearchPanel 的视觉风格） ---------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono uppercase transition-all"
      style={{
        fontSize: "10px",
        letterSpacing: "0.24em",
        padding: "4px 12px",
        color: active
          ? "var(--theme-accent)"
          : "var(--theme-wood-highlight)",
        filter: active ? "brightness(1.5)" : "brightness(1.1)",
        textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        background: active ? "rgba(255,255,255,0.05)" : "transparent",
        border: active
          ? "1px solid rgba(255,255,255,0.15)"
          : "1px solid transparent",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
