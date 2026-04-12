// 设置面板 —— 独立窗口版。
//
// 功能：
//   - 列出所有 Provider，每个可编辑：name / base_url / protocol /
//     api_key (password) / models（逐行输入）
//   - 每个模型旁边有 radio，全局选中一个 (provider_id, model) 作为 active
//   - active 选择保存到 settings 表 ai.active_provider_id / ai.active_model
//   - api_key 留空 = 本地/免 token 场景合法
//   - 新增 Provider 按钮（id 自动生成）
//   - 删除 Provider 按钮
//   - 保存按钮 per provider

import { useCallback, useEffect, useState } from "react";
import { api, type LlmProtocol, type LlmProvider } from "@/lib/api";

interface Draft {
  id: string;
  name: string;
  protocol: LlmProtocol;
  base_url: string;
  api_key: string;
  models_text: string; // 逐行编辑，保存时 split
}

function providerToDraft(p: LlmProvider): Draft {
  return {
    id: p.id,
    name: p.name,
    protocol: p.protocol,
    base_url: p.base_url,
    api_key: p.api_key,
    models_text: p.models.join("\n"),
  };
}

function draftToProvider(d: Draft): LlmProvider {
  return {
    id: d.id,
    name: d.name.trim() || d.id,
    protocol: d.protocol,
    base_url: d.base_url.trim(),
    api_key: d.api_key,
    models: d.models_text
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

export function SettingsPanel() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>("");
  const [activeModel, setActiveModel] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const providers = await api.llmProvidersList();
    setDrafts(providers.map(providerToDraft));
    const savedProvider = await api.getSetting("ai.active_provider_id");
    const savedModel = await api.getSetting("ai.active_model");
    setActiveProviderId(savedProvider ?? "");
    setActiveModel(savedModel ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    reload().catch(() => setLoading(false));
  }, [reload]);

  const flashStatus = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 2500);
  };

  const saveDraft = async (d: Draft) => {
    try {
      await api.llmProviderUpsert(draftToProvider(d));
      flashStatus(`✓ ${d.name || d.id} 已保存`);
    } catch (err) {
      flashStatus(`✗ 保存失败：${err}`);
    }
  };

  const deleteDraft = async (d: Draft) => {
    try {
      await api.llmProviderDelete(d.id);
      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
      if (activeProviderId === d.id) {
        setActiveProviderId("");
        setActiveModel("");
        await api.setSetting("ai.active_provider_id", "");
        await api.setSetting("ai.active_model", "");
      }
      flashStatus(`✓ ${d.name || d.id} 已删除`);
    } catch (err) {
      flashStatus(`✗ 删除失败：${err}`);
    }
  };

  const addProvider = () => {
    const newId = `custom_${Date.now()}`;
    setDrafts((prev) => [
      ...prev,
      {
        id: newId,
        name: "新 Provider",
        protocol: "openai",
        base_url: "https://api.example.com/v1",
        api_key: "",
        models_text: "",
      },
    ]);
  };

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  };

  const selectActive = async (providerId: string, model: string) => {
    setActiveProviderId(providerId);
    setActiveModel(model);
    await api.setSetting("ai.active_provider_id", providerId).catch(() => {});
    await api.setSetting("ai.active_model", model).catch(() => {});
    flashStatus(`✓ 当前模型：${providerId} / ${model}`);
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
        LLM Providers
      </div>
      <div
        className="mb-3"
        style={{
          fontSize: 11,
          color: "var(--theme-lyrics-mid)",
          lineHeight: 1.6,
        }}
      >
        配置要用的大模型。api_key 存储在本机 SQLite，不会上传。
        勾选下方某个模型作为所有 AI 面板的默认调用目标。
      </div>

      {/* Active 提示 */}
      <div
        className="mb-3 rounded-md px-3 py-2"
        style={{
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(0,0,0,0.45)",
          fontSize: 11,
        }}
      >
        <span style={{ color: "var(--theme-lyrics-mid)" }}>当前使用：</span>
        <span
          style={{
            color: activeProviderId
              ? "var(--theme-accent)"
              : "rgba(255,150,130,0.85)",
            fontFamily: "var(--font-mono)",
            marginLeft: 6,
          }}
        >
          {activeProviderId
            ? `${activeProviderId} / ${activeModel}`
            : "(未选中)"}
        </span>
      </div>

      {/* Provider 列表 */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {drafts.map((d) => (
          <ProviderCard
            key={d.id}
            draft={d}
            activeProviderId={activeProviderId}
            activeModel={activeModel}
            onChange={(patch) => updateDraft(d.id, patch)}
            onSave={() => saveDraft(d)}
            onDelete={() => deleteDraft(d)}
            onSelectActive={(model) => selectActive(d.id, model)}
          />
        ))}
      </div>

      {/* 新增按钮 */}
      <button
        type="button"
        onClick={addProvider}
        className="mt-3 rounded-md px-3 py-2 transition-all hover:scale-[1.01]"
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--theme-accent)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.3))",
          border: "1px dashed var(--theme-accent)",
          cursor: "pointer",
        }}
      >
        + 新增 Provider
      </button>

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

// ---- Provider 卡片 ---------------------------------------------------------

function ProviderCard({
  draft,
  activeProviderId,
  activeModel,
  onChange,
  onSave,
  onDelete,
  onSelectActive,
}: {
  draft: Draft;
  activeProviderId: string;
  activeModel: string;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDelete: () => void;
  onSelectActive: (model: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasKey = draft.api_key.trim().length > 0;
  const isLocal =
    draft.base_url.includes("localhost") || draft.base_url.includes("127.0.0.1");
  const modelList = draft.models_text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
      {/* 头部：名字 + 协议标签 + 状态 + 展开 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--theme-lyrics-mid)",
              fontSize: 10,
              padding: "0 4px 0 0",
            }}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <span
            className="font-display"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--theme-lyrics-title)",
            }}
          >
            {draft.name}
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
          {isLocal && !hasKey && (
            <span
              style={{
                fontSize: 9,
                color: "rgba(230,200,120,0.85)",
                padding: "1px 6px",
                borderRadius: 999,
                border: "1px solid rgba(230,200,120,0.6)",
              }}
            >
              本地（免 token）
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 9,
            color: "var(--theme-lyrics-mid)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
          }}
        >
          {draft.protocol}
        </span>
      </div>

      {/* 默认折叠时的 URL 和模型数 */}
      {!expanded && (
        <div
          className="mt-1 truncate"
          style={{
            fontSize: 10,
            color: "var(--theme-lyrics-mid)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {draft.base_url} · {modelList.length} 个模型
        </div>
      )}

      {/* 模型列表（始终显示），每个模型前面一个 radio */}
      {modelList.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {modelList.map((model) => {
            const isActive =
              activeProviderId === draft.id && activeModel === model;
            return (
              <label
                key={model}
                className="flex items-center gap-2 cursor-pointer"
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: 4,
                  background: isActive ? "rgba(0,0,0,0.4)" : "transparent",
                  border: isActive
                    ? "1px solid var(--theme-accent)"
                    : "1px solid transparent",
                }}
              >
                <input
                  type="radio"
                  name="active-model"
                  checked={isActive}
                  onChange={() => onSelectActive(model)}
                  style={{ accentColor: "var(--theme-accent)" }}
                />
                <span
                  className="font-mono"
                  style={{
                    color: isActive
                      ? "var(--theme-accent)"
                      : "var(--theme-lyrics-title)",
                  }}
                >
                  {model}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* 展开后的可编辑字段 */}
      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          <Field label="名称">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => onChange({ name: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Base URL">
            <input
              type="text"
              value={draft.base_url}
              onChange={(e) => onChange({ base_url: e.target.value })}
              style={inputStyle}
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field label="协议">
            <select
              value={draft.protocol}
              onChange={(e) =>
                onChange({ protocol: e.target.value as LlmProtocol })
              }
              style={{ ...inputStyle, padding: "6px 10px" }}
            >
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
            </select>
          </Field>
          <Field label="API Key">
            <input
              type="password"
              value={draft.api_key}
              onChange={(e) => onChange({ api_key: e.target.value })}
              style={inputStyle}
              placeholder="留空 = 本地/免 token"
            />
          </Field>
          <Field label="模型（每行一个）">
            <textarea
              value={draft.models_text}
              onChange={(e) => onChange({ models_text: e.target.value })}
              rows={4}
              style={{
                ...inputStyle,
                resize: "vertical",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
              }}
              placeholder="qwen3.5-plus&#10;glm-5"
            />
          </Field>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onSave}
              style={saveButtonStyle}
            >
              保存
            </button>
            <button
              type="button"
              onClick={onDelete}
              style={deleteButtonStyle}
            >
              删除
            </button>
          </div>
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

const deleteButtonStyle: React.CSSProperties = {
  ...saveButtonStyle,
  color: "rgba(255,150,130,0.9)",
  border: "1px solid rgba(255,150,130,0.6)",
};
