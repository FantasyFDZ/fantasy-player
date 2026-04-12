// 音乐特征 section —— BPM / Key / Energy / Valence / 频谱。
// 从之前的 MusicAnalysis 抽出来的。

import { useMemo } from "react";
import { Tooltip } from "@/components/Tooltip";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import type { Song } from "@/lib/api";

export function FeaturesSection({ song }: { song: Song | null }) {
  const { features, loading, error } = useAudioFeatures(song);

  if (!song) return <Placeholder text="选一首歌后开始分析" />;
  if (loading) return <Placeholder text="正在分析音频特征…" />;
  if (error) return <Placeholder text={`分析失败：${error}`} tone="error" />;
  if (!features) return <Placeholder text="暂无数据" />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <BigStat
          label="BPM"
          value={features.bpm.toFixed(1)}
          hint={describeTempo(features.bpm)}
          confidence={features.bpm_confidence}
          tooltip="每分钟节拍数。由 Essentia RhythmExtractor2013 分析整首歌得到。置信度低于 30% 时结果不可靠（常见于慢板抒情曲，主旋律长音掩盖鼓点）。"
        />
        <BigStat
          label="Key"
          value={features.key}
          hint={describeKey(features.key)}
          confidence={features.key_confidence}
          tooltip="调式。由 Essentia KeyExtractor 通过 HPCP + Krumhansl 谱推断。大调写作 'C'，小调写作 'Cm'。置信度 0-100%，>70% 基本可信。"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <RadialGauge
          label="能量"
          value={features.energy}
          tooltip="音频整体响度（RMS 能量均值归一化），0 极安静、1 极响。对应歌曲的冲击力。"
        />
        <RadialGauge
          label="情绪"
          value={features.valence}
          tooltip="情绪代理值，基于频谱质心推断。高值代表明亮正面的听感（高音多、节奏跳跃），低值代表低沉深情。这是经验代理，不是真实音乐情感分析。"
        />
      </div>

      <SpectrumBars features={features} />
    </div>
  );
}

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
        padding: "32px 16px",
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
  const confLevel =
    confidence === undefined ? "none" : confidenceLevel(confidence);
  const confColor =
    confLevel === "high"
      ? "var(--theme-accent)"
      : confLevel === "medium"
        ? "rgba(230,200,120,0.85)"
        : confLevel === "low"
          ? "rgba(255,150,130,0.85)"
          : "transparent";

  const labelNode = (
    <span
      className="font-mono"
      style={{
        fontSize: 9,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: "var(--theme-label)",
        filter: "brightness(1.4)",
      }}
    >
      {label}
    </span>
  );

  return (
    <div className="flex flex-col">
      {tooltip ? <Tooltip text={tooltip}>{labelNode}</Tooltip> : labelNode}
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
              : `${Math.round(confidence * 100)}%`}
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

  const content = (
    <div className="flex items-center gap-3">
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

  return tooltip ? <Tooltip text={tooltip}>{content}</Tooltip> : content;
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
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          marginBottom: 5,
          fontFamily: "var(--font-mono)",
        }}
      >
        频谱
      </div>
      <div
        className="flex items-end justify-between gap-1"
        style={{ height: 44 }}
      >
        {bars.map((b) => (
          <Tooltip key={b.label} text={b.tooltip}>
            <div className="flex w-full flex-col items-center gap-1">
              <div
                style={{
                  width: 40,
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
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function describeTempo(bpm: number): string {
  if (bpm < 70) return "舒缓";
  if (bpm < 100) return "中速";
  if (bpm < 130) return "轻快";
  if (bpm < 160) return "快板";
  return "激烈";
}

function describeKey(key: string): string {
  return key.endsWith("m") ? `${key.slice(0, -1)} 小调` : `${key} 大调`;
}
