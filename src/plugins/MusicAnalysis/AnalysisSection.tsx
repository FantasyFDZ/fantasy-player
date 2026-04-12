// "解析" tab —— AI 基于音频特征解读音色、旋律、乐器。
//
// 原始参数（BPM、Key、能量、频谱）对用户不可见，只作为 prompt 的
// 上下文传给 LLM，让它翻译成人话。

import { useEffect } from "react";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { useLLM } from "@/hooks/useLLM";
import type { AudioFeatures, Song } from "@/lib/api";

interface Props {
  song: Song | null;
}

export function AnalysisSection({ song }: Props) {
  const { features, loading: featuresLoading, error: featuresError } =
    useAudioFeatures(song);
  const { provider, model, loading: providerLoading } = useActiveProvider();
  const { content, loading: llmLoading, error: llmError, request, reset } =
    useLLM();

  useEffect(() => {
    if (providerLoading) return;
    if (!features || !song || !provider || !model) return;
    reset();
    request({
      provider_id: provider.id,
      model,
      messages: [
        {
          role: "system",
          content:
            "你是资深音乐制作人和乐评人。基于我提供的音频特征数据，" +
            "用中文写 3-4 句话解读这首歌的音色、旋律和乐器配置。" +
            "重点描述：主奏乐器/人声性质、旋律走向、节奏感、整体音场。" +
            "不要报数字、不要复述我给的参数、不要用 BPM 或 Hz 这种专业术语，" +
            "直接用感性的中文描述听感。",
        },
        {
          role: "user",
          content: buildAnalysisPrompt(song, features),
        },
      ],
      temperature: 0.8,
      max_tokens: 1024,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features?.bpm, features?.key, song?.id, provider?.id, model, providerLoading]);

  return (
    <AiTextDisplay
      hasSong={!!song}
      featuresLoading={featuresLoading}
      featuresError={featuresError}
      hasFeatures={!!features}
      providerLoading={providerLoading}
      hasProvider={!!provider && !!model}
      llmLoading={llmLoading}
      llmError={llmError}
      content={content}
    />
  );
}

function buildAnalysisPrompt(song: Song, features: AudioFeatures): string {
  const tempoLabel = describeTempo(features.bpm);
  const energyLabel = describeLevel(features.energy, "能量");
  const brightnessLabel = describeBrightness(features.spectral_centroid);
  const rhythmLabel = describeRhythm(features.zero_crossing_rate);
  return (
    `歌曲信息：${song.name} - ${song.artist}\n` +
    `节奏感：${tempoLabel}（BPM ${features.bpm.toFixed(0)}）\n` +
    `调式：${features.key}\n` +
    `能量：${energyLabel}\n` +
    `音色明度：${brightnessLabel}\n` +
    `节奏密度：${rhythmLabel}`
  );
}

function describeTempo(bpm: number): string {
  if (bpm < 70) return "非常舒缓";
  if (bpm < 100) return "中速";
  if (bpm < 130) return "轻快";
  if (bpm < 160) return "快板";
  return "激烈";
}

function describeLevel(v: number, name: string): string {
  if (v < 0.3) return `低${name}`;
  if (v < 0.6) return `中${name}`;
  return `高${name}`;
}

function describeBrightness(centroid: number): string {
  if (centroid < 1500) return "暗沉偏低频，低音丰满";
  if (centroid < 2500) return "中性音色，人声清晰";
  if (centroid < 3500) return "明亮偏高频，空气感强";
  return "非常明亮，高频突出";
}

function describeRhythm(zcr: number): string {
  if (zcr < 0.05) return "节奏稀疏（长音为主）";
  if (zcr < 0.12) return "常规密度";
  return "节奏密集（打击乐/噪声成分多）";
}

// ---- 通用展示组件（AnalysisSection + AtmosphereSection 共用） -----------

interface DisplayProps {
  hasSong: boolean;
  featuresLoading: boolean;
  featuresError: string | null;
  hasFeatures: boolean;
  providerLoading: boolean;
  hasProvider: boolean;
  llmLoading: boolean;
  llmError: string | null;
  content: string;
}

export function AiTextDisplay(props: DisplayProps) {
  const {
    hasSong,
    featuresLoading,
    featuresError,
    hasFeatures,
    providerLoading,
    hasProvider,
    llmLoading,
    llmError,
    content,
  } = props;

  let body: React.ReactNode;
  let bodyStyle: React.CSSProperties = {
    fontSize: 13,
    lineHeight: 1.9,
    color: "var(--theme-lyrics-next)",
    whiteSpace: "pre-wrap",
    letterSpacing: "0.02em",
  };

  if (!hasSong) {
    body = "选一首歌开始";
    bodyStyle.color = "var(--theme-lyrics-mid)";
  } else if (featuresLoading || providerLoading) {
    body = "正在读取…";
    bodyStyle.color = "var(--theme-lyrics-mid)";
  } else if (featuresError) {
    body = `音频分析失败：${featuresError}`;
    bodyStyle.color = "rgba(255,180,160,0.9)";
  } else if (!hasFeatures) {
    body = "等待音频特征";
    bodyStyle.color = "var(--theme-lyrics-mid)";
  } else if (!hasProvider) {
    body = "未配置大模型 —— 点右上角齿轮 ⚙ 配置后返回此页";
    bodyStyle.color = "var(--theme-lyrics-mid)";
  } else if (llmLoading && !content) {
    body = "正在生成…";
    bodyStyle.color = "var(--theme-lyrics-mid)";
  } else if (llmError) {
    body = `生成失败：${llmError}`;
    bodyStyle.color = "rgba(255,180,160,0.9)";
  } else if (content) {
    body = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  } else {
    body = "等待生成…";
    bodyStyle.color = "var(--theme-lyrics-mid)";
  }

  return <div style={bodyStyle}>{body}</div>;
}
