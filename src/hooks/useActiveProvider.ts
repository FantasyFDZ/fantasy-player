// 读取当前 active 的 LLM provider + model（从 settings 表）
// fallback：第一个配了 api_key 的 provider 的第一个 model
//
// 返回 { provider, model, loading, reload }
// reload() 可用于设置面板保存后手动刷新。

import { useCallback, useEffect, useState } from "react";
import { api, type LlmProvider } from "@/lib/api";

export interface ActiveProviderState {
  provider: LlmProvider | null;
  model: string;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useActiveProvider(): ActiveProviderState {
  const [provider, setProvider] = useState<LlmProvider | null>(null);
  const [model, setModel] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const providers = await api.llmProvidersList();
      const savedId = await api
        .getSetting("ai.active_provider_id")
        .catch(() => null);
      const savedModel = await api
        .getSetting("ai.active_model")
        .catch(() => null);
      if (savedId && savedModel) {
        const p = providers.find((x) => x.id === savedId);
        if (p) {
          setProvider(p);
          setModel(savedModel);
          return;
        }
      }
      // 偏好的默认组合（按顺序找第一个可用的）。
      // 这个清单基于 4 首歌 × 7 模型的对比测试结论：
      // kimi-k2.5 文笔最具体且 4 秒内出，mimo/v2-omni 视觉化最强。
      // 注意：这不写 settings，只是 fallback 偏好。
      const PREFERRED: Array<{ providerId: string; model: string }> = [
        { providerId: "dashscope", model: "kimi-k2.5" },
        { providerId: "mimo", model: "mimo-v2-omni" },
        { providerId: "dashscope", model: "qwen3.5-plus" },
      ];
      for (const pref of PREFERRED) {
        const p = providers.find(
          (x) =>
            x.id === pref.providerId &&
            x.api_key.trim() !== "" &&
            x.models.includes(pref.model),
        );
        if (p) {
          setProvider(p);
          setModel(pref.model);
          return;
        }
      }
      // 通用 fallback：任何有 api_key 的第一个 provider 的第一个 model
      const firstWithKey = providers.find(
        (p) => p.api_key.trim() !== "" && p.models.length > 0,
      );
      if (firstWithKey) {
        setProvider(firstWithKey);
        setModel(firstWithKey.models[0]);
      } else {
        setProvider(null);
        setModel("");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { provider, model, loading, reload };
}
