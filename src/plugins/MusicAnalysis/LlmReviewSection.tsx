// AI 短评 section —— 调用 active provider + model 生成音乐解读。
// 独立组件，便于排查。

import { useCallback, useEffect, useState } from "react";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import { useLLM } from "@/hooks/useLLM";
import { api, type AudioFeatures, type LlmProvider, type Song } from "@/lib/api";

interface Props {
  song: Song | null;
}

export function LlmReviewSection({ song }: Props) {
  const { features } = useAudioFeatures(song);
  const { content, loading, error, request, reset } = useLLM();
  const [provider, setProvider] = useState<LlmProvider | null>(null);
  const [model, setModel] = useState<string>("");
  const [providerLoading, setProviderLoading] = useState(true);

  // 读取 active provider + model
  const loadActive = useCallback(async () => {
    setProviderLoading(true);
    try {
      const providers = await api.llmProvidersList();
      const savedId = await api
        .getSetting("ai.active_provider_id")
        .catch(() => null);
      const savedModel = await api
        .getSetting("ai.active_model")
        .catch(() => null);
      if (savedId && savedModel) {
        const p = providers.find((p) => p.id === savedId);
        if (p) {
          setProvider(p);
          setModel(savedModel);
          return;
        }
      }
      // fallback：第一个有 key 的 provider 的第一个模型
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
      setProviderLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActive();
  }, [loadActive]);

  // 每次特征或 provider 变化触发短评
  useEffect(() => {
    if (providerLoading) return;
    if (!features || !song || !provider || !model) return;
    runReview(features);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features?.bpm, features?.key, provider?.id, model, song?.id, providerLoading]);

  const runReview = useCallback(
    (feats: AudioFeatures) => {
      if (!song || !provider || !model) return;
      const prompt = buildAnalysisPrompt(song, feats);
      request({
        provider_id: provider.id,
        model,
        messages: [
          {
            role: "system",
            content:
              "你是一位懂音乐的乐评人。用简洁、感性的中文给出 2-3 句话的音乐特征解读，重点说明曲风、情绪和听感。不要重复用户给你的数据原文，直接给解读。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }).catch((err) => {
        console.error("[LlmReview] request failed:", err);
      });
    },
    [song, provider, model, request],
  );

  const header = (
    <div className="mb-2 flex items-center justify-between">
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          fontFamily: "var(--font-mono)",
        }}
      >
        AI 短评
      </div>
      <div className="flex items-center gap-2">
        {provider && model && (
          <span
            style={{
              fontSize: 9,
              color: "var(--theme-lyrics-mid)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {provider.id} / {model}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            reset();
            loadActive().then(() => features && runReview(features));
          }}
          style={{
            fontSize: 9,
            padding: "2px 8px",
            borderRadius: 999,
            color: "var(--theme-accent)",
            background: "rgba(0,0,0,0.3)",
            border: "1px solid var(--theme-accent)",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >
          ↻ 重新生成
        </button>
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (!song) {
    body = (
      <span style={{ color: "var(--theme-lyrics-mid)" }}>
        选一首歌开始
      </span>
    );
  } else if (providerLoading) {
    body = (
      <span style={{ color: "var(--theme-lyrics-mid)" }}>
        正在读取模型配置…
      </span>
    );
  } else if (!provider || !model) {
    body = (
      <span style={{ color: "var(--theme-lyrics-mid)" }}>
        未配置大模型 —— 切到「设置」tab 配置后返回此页切歌可生成短评
      </span>
    );
  } else if (!features) {
    body = (
      <span style={{ color: "var(--theme-lyrics-mid)" }}>
        等待音频特征提取…
      </span>
    );
  } else if (loading) {
    body = (
      <span style={{ color: "var(--theme-lyrics-mid)" }}>
        {provider.name} 分析中…
      </span>
    );
  } else if (error) {
    body = (
      <span style={{ color: "rgba(255,180,160,0.9)" }}>
        生成失败：{error}
      </span>
    );
  } else if (content) {
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    body = (
      <span
        style={{
          color: "var(--theme-lyrics-next)",
          lineHeight: 1.7,
          fontSize: 13,
        }}
      >
        {cleaned}
      </span>
    );
  } else {
    body = (
      <span style={{ color: "var(--theme-lyrics-mid)" }}>
        等待生成…
      </span>
    );
  }

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(0,0,0,0.45)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)",
      }}
    >
      {header}
      <div style={{ fontSize: 12 }}>{body}</div>
    </div>
  );
}

function buildAnalysisPrompt(song: Song, features: AudioFeatures): string {
  return [
    `歌曲：${song.name} - ${song.artist}`,
    `BPM ${features.bpm.toFixed(1)}，调性 ${features.key}，`,
    `能量 ${(features.energy * 100).toFixed(0)}%，情绪 ${(features.valence * 100).toFixed(0)}%，`,
    `频谱质心 ${features.spectral_centroid.toFixed(0)} Hz。`,
  ].join(" ");
}
