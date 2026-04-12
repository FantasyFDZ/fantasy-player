// 设置面板 —— Phase 9 会做完整版，当前是"够用"最小实现，
// 只覆盖 AI Provider 的 api_key 配置（其他面板需要 LLM 才能工作）。

import { useEffect, useState } from "react";
import { api, type LlmProvider } from "@/lib/api";

export function SettingsPanel() {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    api
      .llmProvidersList()
      .then((list) => {
        setProviders(list);
        setDrafts(
          Object.fromEntries(list.map((p) => [p.id, p.api_key] as const)),
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async (provider: LlmProvider) => {
    const key = drafts[provider.id] ?? "";
    try {
      await api.llmProviderUpsert({ ...provider, api_key: key });
      setStatus(`✓ ${provider.name} 已保存`);
      setProviders((prev) =>
        prev.map((p) => (p.id === provider.id ? { ...p, api_key: key } : p)),
      );
      window.setTimeout(() => setStatus(""), 2500);
    } catch (err) {
      setStatus(`✗ 保存失败：${err}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className="mb-4 font-mono text-[10px] uppercase"
        style={{
          color: "var(--theme-label)",
          letterSpacing: "0.24em",
          filter: "brightness(1.4)",
          textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        }}
      >
        LLM Providers
      </div>

      <div
        className="mb-3 text-[11px]"
        style={{
          color: "var(--theme-lyrics-mid)",
          lineHeight: 1.6,
        }}
      >
        为 AI 面板配置大模型。api_key 存储在本机 SQLite，不会上传。
      </div>

      {loading ? (
        <Placeholder text="加载中…" />
      ) : (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              value={drafts[p.id] ?? ""}
              onChange={(value) =>
                setDrafts((prev) => ({ ...prev, [p.id]: value }))
              }
              onSave={() => save(p)}
            />
          ))}
        </div>
      )}

      {status && (
        <div
          className="mt-3 rounded-md px-3 py-2 text-[11px]"
          style={{
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

function ProviderRow({
  provider,
  value,
  onChange,
  onSave,
}: {
  provider: LlmProvider;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  const hasKey = value.trim().length > 0;
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(0,0,0,0.45)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)",
      }}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="font-display"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--theme-lyrics-title)",
            }}
          >
            {provider.name}
          </span>
          {hasKey && (
            <span
              style={{
                fontSize: 9,
                color: "var(--theme-accent)",
                padding: "1px 6px",
                borderRadius: 999,
                border: "1px solid var(--theme-accent)",
              }}
            >
              已配置
            </span>
          )}
        </div>
        <span
          className="font-mono"
          style={{
            fontSize: 9,
            color: "var(--theme-lyrics-mid)",
            letterSpacing: "0.1em",
          }}
        >
          {provider.protocol}
        </span>
      </div>
      <div
        className="mb-1 truncate font-mono"
        style={{
          fontSize: 10,
          color: "var(--theme-lyrics-mid)",
        }}
      >
        {provider.base_url}
      </div>
      {provider.models.length > 0 && (
        <div
          className="mb-2 truncate"
          style={{
            fontSize: 10,
            color: "var(--theme-lyrics-mid)",
            opacity: 0.8,
          }}
        >
          模型：{provider.models.join(" / ")}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="粘贴 api_key"
          className="flex-1 rounded px-3 py-1.5 outline-none"
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(0,0,0,0.5)",
            color: "rgba(255,240,220,0.95)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
          }}
        />
        <button
          type="button"
          onClick={onSave}
          className="rounded px-3 py-1.5 transition-all hover:scale-[1.03]"
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--theme-accent)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
            border: "1px solid var(--theme-accent)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.15), 0 1px 2px rgba(0,0,0,0.4)",
            cursor: "pointer",
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        padding: "24px",
        color: "var(--theme-lyrics-mid)",
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}
