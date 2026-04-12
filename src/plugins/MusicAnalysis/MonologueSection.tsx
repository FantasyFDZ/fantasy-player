// "独白" tab —— 合并原来的 解析 + 氛围。
//
// 一次 LLM 调用同时给出：
//   - 音色/旋律/乐器感性描述
//   - 情感氛围
//   - 适合的听歌场景
// 全部用诗意散文风格输出。底部挂一个紧凑的指标行（BPM/Key/能量/情绪）。

import { useEffect, useRef, useState } from "react";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import { useLLM } from "@/hooks/useLLM";
import { api, type AudioFeatures, type Song } from "@/lib/api";

interface Props {
  song: Song | null;
}

export function MonologueSection({ song }: Props) {
  const { features, loading: featuresLoading, error: featuresError } =
    useAudioFeatures(song);
  const { provider, model, loading: providerLoading } = useActiveProvider();
  const { content, loading: llmLoading, error: llmError, request, reset } =
    useLLM();

  const [lyric, setLyric] = useState<string>("");
  const [lyricReady, setLyricReady] = useState(false);

  // 获取歌词 —— lyricReady 门禁保证 LLM 只在歌词请求结束后触发一次
  useEffect(() => {
    if (!song) {
      setLyric("");
      setLyricReady(false);
      return;
    }
    let cancelled = false;
    setLyricReady(false);
    api
      .getLyric(song.id)
      .then((l) => {
        if (cancelled) return;
        setLyric(l.lrc);
        setLyricReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLyric("");
          setLyricReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [song?.id]);

  // 幂等去重：同一 (song, provider, model) 组合只发一次
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    if (providerLoading) return;
    if (!features || !song || !provider || !model) return;
    if (!lyricReady) return;
    const key = `${song.id}::${provider.id}::${model}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    reset();
    request({
      provider_id: provider.id,
      model,
      messages: [
        {
          role: "system",
          content:
            "你是资深乐评人，也是一位文笔优美的作家。基于我提供的" +
            "歌曲信息、音频特征和部分歌词，写一段 6-8 句的中文独白，" +
            "自然融合以下三部分：\n" +
            "1. 音色、旋律、乐器配置的感性描述（主奏乐器、人声性质、" +
            "旋律走向、节奏感、音场）\n" +
            "2. 这首歌营造的情感氛围\n" +
            "3. 推荐 1-2 个适合听这首歌的具体场景（比如雨夜窗前读书、" +
            "深秋黄昏散步、夜晚独自开车）\n\n" +
            "要求：\n" +
            "- 全文像散文式独白，段落连贯，不要分小节标题\n" +
            "- 有诗意，可以用意象、比喻、画面感\n" +
            "- 不要报数字、不要复述我给的参数、不要用 BPM 或 Hz 等专业术语\n" +
            "- 不要用引号、星号、列表符号等装饰",
        },
        {
          role: "user",
          content: buildPrompt(song, features, lyric),
        },
      ],
      temperature: 0.85,
      max_tokens: 1024,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    features?.bpm,
    song?.id,
    provider?.id,
    model,
    providerLoading,
    lyricReady,
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
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
      </div>
      {features && <MetricsStrip features={features} />}
    </div>
  );
}

// ---- prompt 构造 --------------------------------------------------------
//
// 写作素材的筛选原则：把"能让 LLM 写出画面感"的高信号字段都喂进去，
// 但全部转成感性词汇，不让模型看到原始数字。

function buildPrompt(
  song: Song,
  features: AudioFeatures,
  lyric: string,
): string {
  const cleanedLyric = lyric
    .split(/\r?\n/)
    .map((line) => line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 40)
    .join("\n");

  const lines: string[] = [];
  lines.push(`歌曲：${song.name} - ${song.artist}`);

  // —— 节奏感 ——
  lines.push(`节奏感：${describeTempo(features.bpm)}`);

  // 舞动性（Tier 2）
  if (typeof features.danceability === "number") {
    lines.push(`舞动性：${describeDanceability(features.danceability)}`);
  }

  // Onset 密度（节拍打击感）
  if (typeof features.onset_rate === "number") {
    lines.push(`击感密度：${describeOnsetRate(features.onset_rate)}`);
  }

  // —— 调式 / 和声 ——
  const keyMood = features.key.endsWith("m")
    ? "小调（偏忧郁内省）"
    : "大调（偏明朗开阔）";
  lines.push(`调式氛围：${keyMood}`);
  if (
    features.chord_progression &&
    features.chord_progression.length > 0 &&
    typeof features.chord_changes_per_min === "number"
  ) {
    const chords = features.chord_progression.slice(0, 4).join(" / ");
    lines.push(
      `主导和弦：${chords}（${describeChordChangeRate(features.chord_changes_per_min)}）`,
    );
  }

  // —— 能量 / 响度 / 动态 ——
  lines.push(`能量：${describeEnergy(features.energy)}`);
  if (typeof features.loudness_lufs === "number") {
    lines.push(`响度感：${describeLoudness(features.loudness_lufs)}`);
  }
  if (typeof features.dynamic_complexity === "number") {
    lines.push(`动态层次：${describeDynamicComplexity(features.dynamic_complexity)}`);
  }

  // —— 音色 ——
  lines.push(`音色明度：${describeBrightness(features.spectral_centroid)}`);
  if (features.timbre_brightness_label) {
    lines.push(`高频质感：${features.timbre_brightness_label}`);
  }
  if (features.timbre_warmth_label) {
    lines.push(`共鸣温度：${features.timbre_warmth_label}`);
  }

  // —— 主旋律走向 ——
  if (
    typeof features.pitch_range_semitones === "number" &&
    typeof features.pitch_std_hz === "number"
  ) {
    lines.push(
      `主旋律走向：${describeMelodyContour(features.pitch_range_semitones, features.pitch_std_hz)}`,
    );
  }

  // —— Tier 3：人声 / 风格 / 情绪 / 乐器 ——
  if (features.voice_instrumental) {
    const v =
      features.voice_instrumental === "voice"
        ? `以人声为主${features.voice_gender ? `（${features.voice_gender === "male" ? "男声" : "女声"}）` : ""}`
        : "纯器乐";
    lines.push(`声音构成：${v}`);
  }
  if (features.instrument_tags && features.instrument_tags.length > 0) {
    lines.push(`主要乐器：${features.instrument_tags.slice(0, 4).join("、")}`);
  }
  if (features.mood_tags && features.mood_tags.length > 0) {
    lines.push(`情绪标签：${features.mood_tags.join("、")}`);
  }
  if (features.genre_tags && features.genre_tags.length > 0) {
    lines.push(`风格倾向：${features.genre_tags.slice(0, 3).join(" / ")}`);
  }

  return (
    lines.join("\n") +
    "\n\n" +
    (cleanedLyric
      ? `歌词片段（前 40 行）：\n${cleanedLyric}\n`
      : "（无歌词）\n")
  );
}

function describeTempo(bpm: number): string {
  if (bpm < 70) return "非常舒缓";
  if (bpm < 100) return "中速";
  if (bpm < 130) return "轻快";
  if (bpm < 160) return "快板";
  return "激烈";
}

function describeBrightness(centroid: number): string {
  if (centroid < 1500) return "暗沉偏低频，低音丰满";
  if (centroid < 2500) return "中性音色，人声清晰";
  if (centroid < 3500) return "明亮偏高频，空气感强";
  return "非常明亮，高频突出";
}

function describeEnergy(e: number): string {
  if (e < 0.3) return "低能量、安静";
  if (e < 0.6) return "中等能量";
  return "高能量、动感";
}

function describeDanceability(d: number): string {
  // Essentia Danceability 范围约 0-3
  if (d < 0.8) return "几乎不舞动，更像静态聆听";
  if (d < 1.4) return "可轻轻摇摆";
  if (d < 2.0) return "明显的律动感";
  return "强烈舞曲性，身体很难不跟着动";
}

function describeOnsetRate(r: number): string {
  if (r < 1.5) return "稀疏（长音保持，留白多）";
  if (r < 3.5) return "常规密度";
  if (r < 6) return "密集（打击连贯）";
  return "极密集（高频敲击或快速分解）";
}

function describeLoudness(lufs: number): string {
  // 流媒体平均 ~-14 LUFS；爵士古典常 -20 以下；现代流行可达 -8
  if (lufs < -22) return "极动态、保留呼吸感";
  if (lufs < -16) return "动态饱满、呼吸自然";
  if (lufs < -10) return "压实、紧凑";
  return "极度压缩、几乎是音墙";
}

function describeDynamicComplexity(dc: number): string {
  if (dc < 2) return "几乎无起伏，单一情绪";
  if (dc < 5) return "层次柔和，偶有强弱变化";
  if (dc < 10) return "明显的强弱起伏";
  return "戏剧性反差强烈";
}

function describeChordChangeRate(per_min: number): string {
  if (per_min < 20) return "和声极慢，长段铺陈";
  if (per_min < 50) return "和声从容";
  if (per_min < 100) return "常规节奏的和弦推进";
  return "和声密集，转折频繁";
}

function describeMelodyContour(range_semi: number, std_hz: number): string {
  if (range_semi < 6) return "旋律窄幅，几乎贴着主音游移";
  if (range_semi < 12) return "旋律中幅，起伏克制";
  if (range_semi < 20) return "旋律宽幅，有明显起落";
  if (std_hz > 200) return "极宽音域且大开大合";
  return "宽幅而沉稳的长线条";
}

// ---- 通用 AI 文字展示组件 -------------------------------------------------

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

function AiTextDisplay(props: DisplayProps) {
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
  const bodyStyle: React.CSSProperties = {
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

// ---- 底部紧凑指标行 -----------------------------------------------------

function MetricsStrip({ features }: { features: AudioFeatures }) {
  // 风格栏：优先用 Tier 3 genre_tags 的 top1，其次用 mood_tags 的 top1，
  // 最后回退到根据 danceability + 调式给一个粗略标签
  const styleLabel = pickStyleLabel(features);
  const items: Array<{ label: string; value: string; flex: number; size: number }> = [
    { label: "风格", value: styleLabel, flex: 1.5, size: 12 },
    { label: "BPM", value: features.bpm.toFixed(0), flex: 1, size: 15 },
    { label: "Key", value: features.key || "—", flex: 1, size: 15 },
    { label: "能量", value: `${Math.round(features.energy * 100)}%`, flex: 1, size: 15 },
    { label: "情绪", value: `${Math.round(features.valence * 100)}%`, flex: 1, size: 15 },
  ];
  return (
    <div
      className="flex items-center justify-between"
      style={{
        marginTop: 14,
        paddingTop: 10,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        gap: 4,
      }}
    >
      {items.map((it) => (
        <div
          key={it.label}
          className="flex flex-col items-center"
          style={{ flex: it.flex, minWidth: 0 }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--theme-lyrics-mid)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {it.label}
          </span>
          <span
            className="font-display"
            style={{
              fontSize: it.size,
              fontWeight: 500,
              color: "var(--theme-lyrics-next)",
              marginTop: 2,
              lineHeight: 1.1,
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "center",
            }}
            title={it.value}
          >
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 风格栏的标签来源：
 *  1) Tier 3 genre_tags top1（最权威，需 TF 模型）
 *  2) Tier 3 mood_tags top1
 *  3) Tier 2 启发式（danceability + 调式 + 能量）
 *  4) "—"
 */
function pickStyleLabel(f: AudioFeatures): string {
  if (f.genre_tags && f.genre_tags.length > 0) {
    return shortenStyle(f.genre_tags[0]);
  }
  if (f.mood_tags && f.mood_tags.length > 0) {
    return moodTagToZh(f.mood_tags[0]);
  }
  // 启发式回退：基于已有的 Tier 2 字段
  const isMinor = f.key.endsWith("m");
  const dance = typeof f.danceability === "number" ? f.danceability : null;
  if (dance !== null && dance > 1.8 && f.energy > 0.55) {
    return isMinor ? "暗黑舞曲" : "舞曲";
  }
  if (f.energy < 0.3 && (dance === null || dance < 1.2)) {
    return isMinor ? "民谣抒情" : "轻音乐";
  }
  if (f.bpm < 80 && isMinor) return "慢歌抒情";
  if (f.bpm > 130 && f.energy > 0.6) return "动感流行";
  return isMinor ? "小调流行" : "流行";
}

function shortenStyle(raw: string): string {
  // genre_discogs400 标签形如 "Electronic---House" / "Rock---Indie Rock"
  const tail = raw.split("---").pop() ?? raw;
  return tail.length > 8 ? tail.slice(0, 8) + "…" : tail;
}

function moodTagToZh(tag: string): string {
  const map: Record<string, string> = {
    happy: "愉悦",
    sad: "忧伤",
    aggressive: "激烈",
    relaxed: "松弛",
    acoustic: "原声",
    electronic: "电子",
    party: "派对",
  };
  return map[tag] ?? tag;
}
