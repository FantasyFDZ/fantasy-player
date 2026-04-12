// AI 音乐分析仪表盘面板。
//
// 数据来源：
//   - useAudioFeatures(song)  →  librosa 提取的 BPM/energy/valence/key/频谱
//   - useLLM().request()      →  LLM 生成的风格短评（需用户配置 provider）
//
// 无 key 时 LLM 部分显示引导提示。

import { useEffect, useMemo, useState } from "react";
import { api, type LlmProvider, type Song } from "@/lib/api";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import { useLLM } from "@/hooks/useLLM";

interface Props {
  song: Song | null;
}

export function MusicAnalysis({ song }: Props) {
  const { features, loading, error } = useAudioFeatures(song);
  const {
    content: llmContent,
    loading: llmLoading,
    error: llmError,
    request,
  } = useLLM();
  const [provider, setProvider] = useState<LlmProvider | null>(null);

  // 启动时查找第一个配置了 api_key 的 provider
  useEffect(() => {
    api
      .llmProvidersList()
      .then((list) => {
        const p = list.find((p) => p.api_key.trim() !== "");
        setProvider(p ?? null);
      })
      .catch(() => setProvider(null));
  }, []);

  // 每次特征或 provider 变化触发短评生成
  useEffect(() => {
    if (!features || !song || !provider) return;
    const model =
      provider.models[0] ??
      (provider.id === "dashscope" ? "qwen3.5-plus" : "");
    if (!model) return;
    const prompt = buildAnalysisPrompt(song, features);
    request({
      provider_id: provider.id,
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一位懂音乐的乐评人。用简洁、感性的中文给出 2-3 句话的音乐特征解读，重点说明曲风、情绪和听感，不要重复用户给你的数据原文。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 256,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features?.bpm, features?.key, provider?.id, song?.id]);

  if (!song) {
    return <Placeholder text="选一首歌后开始分析" />;
  }
  if (loading) {
    return <Placeholder text="正在分析音频特征…" />;
  }
  if (error) {
    return <Placeholder text={`分析失败：${error}`} tone="error" />;
  }
  if (!features) {
    return <Placeholder text="暂无数据" />;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 顶部大数字 —— BPM + Key，带置信度徽章 */}
      <div className="flex items-start justify-between">
        <BigStat
          label="BPM"
          value={features.bpm.toFixed(1)}
          hint={describeTempo(features.bpm)}
          confidence={features.bpm_confidence}
          tooltip="每分钟节拍数 (Beats Per Minute)。由 Essentia RhythmExtractor2013 分析整首歌得到。置信度低于 0.3 时结果不可靠，常见于慢板抒情曲（主旋律长音掩盖鼓点）。"
        />
        <BigStat
          label="Key"
          value={features.key}
          hint={describeKey(features.key)}
          confidence={features.key_confidence}
          tooltip="调式。由 Essentia KeyExtractor 通过 HPCP + Krumhansl 谱推断。大调写作 'C'，小调写作 'Cm'。置信度 0-1，>0.7 基本可信。"
        />
      </div>

      {/* 能量 / 情绪 环形 */}
      <div className="flex items-center justify-between gap-3">
        <RadialGauge
          label="能量"
          value={features.energy}
          tooltip="音频整体响度（RMS 能量均值归一化），0 极安静、1 极响。对应歌曲的冲击力。"
        />
        <RadialGauge
          label="情绪"
          value={features.valence}
          tooltip="情绪代理值，基于频谱质心推断。高值代表明亮正面的听感（通常意味着高音多、节奏跳跃），低值代表低沉深情。这是经验代理，不是真实音乐情感分析。"
        />
      </div>

      {/* 频谱柱状 */}
      <SpectrumBars features={features} />

      {/* LLM 短评 */}
      <LlmReview
        provider={provider}
        loading={llmLoading}
        error={llmError}
        content={llmContent}
      />
    </div>
  );
}

// ---- subcomponents ---------------------------------------------------------

function Placeholder({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className="flex h-full items-center justify-center text-center"
      style={{
        color:
          tone === "error"
            ? "rgba(255,180,160,0.95)"
            : "var(--theme-lyrics-mid)",
        fontSize: 13,
        padding: "24px 16px",
      }}
    >
      {text}
    </div>
  );
}

function BigStat({
  label,
  value,
  hint,
  confidence,
  tooltip,
}: {
  label: string;
  value: string;
  hint: string;
  confidence?: number;
  tooltip?: string;
}) {
  const confLevel = confidence === undefined ? "none" : confidenceLevel(confidence);
  const confColor =
    confLevel === "high"
      ? "var(--theme-accent)"
      : confLevel === "medium"
        ? "rgba(230,200,120,0.85)"
        : confLevel === "low"
          ? "rgba(255,150,130,0.85)"
          : "transparent";

  return (
    <div className="flex flex-col" title={tooltip}>
      <span
        className="font-mono"
        style={{
          fontSize: 9,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          cursor: tooltip ? "help" : "default",
        }}
      >
        {label}
      </span>
      <span
        className="font-display"
        style={{
          fontSize: 32,
          fontWeight: 600,
          color: "var(--theme-lyrics-active)",
          lineHeight: 1,
          marginTop: 2,
        }}
      >
        {value}
      </span>
      <div className="mt-1 flex items-center gap-2">
        <span
          style={{
            fontSize: 10,
            color: "var(--theme-lyrics-mid)",
          }}
        >
          {hint}
        </span>
        {confidence !== undefined && (
          <span
            title={`置信度 ${(confidence * 100).toFixed(0)}%`}
            style={{
              fontSize: 9,
              padding: "1px 6px",
              borderRadius: 999,
              border: `1px solid ${confColor}`,
              color: confColor,
              fontFamily: "var(--font-mono)",
            }}
          >
            {confLevel === "low"
              ? "⚠ 低信度"
              : `${(confidence * 100).toFixed(0)}%`}
          </span>
        )}
      </div>
    </div>
  );
}

function confidenceLevel(c: number): "high" | "medium" | "low" {
  if (c >= 0.7) return "high";
  if (c >= 0.3) return "medium";
  return "low";
}

function RadialGauge({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: number;
  tooltip?: string;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, value)));

  return (
    <div
      className="flex items-center gap-3"
      title={tooltip}
      style={{ cursor: tooltip ? "help" : "default" }}
    >
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle
          cx="30"
          cy="30"
          r={radius}
          fill="none"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="4"
        />
        <circle
          cx="30"
          cy="30"
          r={radius}
          fill="none"
          stroke="var(--theme-accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 30 30)"
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
        <text
          x="30"
          y="34"
          textAnchor="middle"
          fontSize="13"
          fill="var(--theme-lyrics-active)"
          fontFamily="var(--font-display)"
          fontWeight="600"
        >
          {(value * 100).toFixed(0)}
        </text>
      </svg>
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.15em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          fontFamily: "var(--font-ui)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function SpectrumBars({
  features,
}: {
  features: {
    spectral_centroid: number;
    spectral_bandwidth: number;
    spectral_flatness: number;
    spectral_rolloff: number;
    zero_crossing_rate: number;
  };
}) {
  // 把 5 个频谱指标归一化到 0-1 用于可视化
  const bars = useMemo(
    () => [
      {
        label: "质心",
        value: Math.min(1, features.spectral_centroid / 5000),
        tooltip: `频谱质心 ${features.spectral_centroid.toFixed(0)} Hz —— 音色的亮度中心，高值意味着更多高频（铙钹、女声、口哨），低值更暗沉（bass、低音男声）。`,
      },
      {
        label: "带宽",
        value: Math.min(1, features.spectral_bandwidth / 4000),
        tooltip: `频谱带宽 ${features.spectral_bandwidth.toFixed(0)} Hz —— 频率扩散程度。纯音乐器带宽小，嘈杂或爆音带宽大。`,
      },
      {
        label: "平坦",
        value: Math.min(1, features.spectral_flatness * 10),
        tooltip: `频谱平坦度 ${features.spectral_flatness.toFixed(4)} —— 越接近 1 越像白噪声（hi-hat、底噪），越接近 0 越像纯音（人声、弦乐）。`,
      },
      {
        label: "滚降",
        value: Math.min(1, features.spectral_rolloff / 10000),
        tooltip: `频谱滚降 ${features.spectral_rolloff.toFixed(0)} Hz —— 85% 能量集中的上限频率。用于区分柔和和尖锐的音色。`,
      },
      {
        label: "过零率",
        value: Math.min(1, features.zero_crossing_rate * 5),
        tooltip: `过零率 ${features.zero_crossing_rate.toFixed(4)} —— 波形穿过零点的频率。打击乐、噪声成分高则过零率高。`,
      },
    ],
    [features],
  );
  return (
    <div>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          marginBottom: 5,
        }}
      >
        频谱
      </div>
      <div className="flex items-end justify-between gap-1" style={{ height: 44 }}>
        {bars.map((b) => (
          <div
            key={b.label}
            className="flex flex-1 flex-col items-center gap-1"
            title={b.tooltip}
            style={{ cursor: "help" }}
          >
            <div
              style={{
                width: "100%",
                height: `${b.value * 38}px`,
                background: "var(--theme-accent)",
                borderRadius: "2px 2px 0 0",
                opacity: 0.85,
                transition: "height 400ms ease",
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: "var(--theme-lyrics-mid)",
                fontFamily: "var(--font-ui)",
              }}
            >
              {b.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LlmReview({
  provider,
  loading,
  error,
  content,
}: {
  provider: LlmProvider | null;
  loading: boolean;
  error: string | null;
  content: string;
}) {
  let body: React.ReactNode;
  if (!provider) {
    body = (
      <span style={{ color: "var(--theme-lyrics-mid)" }}>
        未配置大模型 —— 点击顶部"设置"按钮填入任一 Provider 的 api_key
        后切换歌曲即可生成短评
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
    body = (
      <span
        style={{
          color: "var(--theme-lyrics-next)",
          lineHeight: 1.7,
          fontSize: 12.5,
        }}
      >
        {content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()}
      </span>
    );
  } else {
    body = (
      <span style={{ color: "var(--theme-lyrics-mid)" }}>
        等待切换歌曲触发短评
      </span>
    );
  }

  return (
    <div
      style={{
        marginTop: 4,
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(0,0,0,0.45)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)",
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          marginBottom: 4,
        }}
      >
        AI 短评
      </div>
      <div style={{ fontSize: 12 }}>{body}</div>
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------

function buildAnalysisPrompt(
  song: Song,
  features: {
    bpm: number;
    energy: number;
    valence: number;
    key: string;
    spectral_centroid: number;
  },
): string {
  return [
    `歌曲：${song.name} - ${song.artist}`,
    `BPM ${features.bpm.toFixed(1)}，调性 ${features.key}，`,
    `能量 ${(features.energy * 100).toFixed(0)}%，情绪 ${(features.valence * 100).toFixed(0)}%，`,
    `频谱质心 ${features.spectral_centroid.toFixed(0)} Hz。`,
  ].join(" ");
}

function describeTempo(bpm: number): string {
  if (bpm < 70) return "舒缓";
  if (bpm < 100) return "中速";
  if (bpm < 130) return "轻快";
  if (bpm < 160) return "快板";
  return "激烈";
}

function describeKey(key: string): string {
  return `${key} 调`;
}
