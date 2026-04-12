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
