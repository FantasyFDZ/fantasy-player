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
import { log } from "@/lib/logger";

interface Props {
  song: Song | null;
  /** 外部递增此值可强制重新生成（用于刷新按钮） */
  refreshKey?: number;
}

export function MonologueSection({ song, refreshKey = 0 }: Props) {
  const { features, loading: featuresLoading, error: featuresError, songId: featuresSongId } =
    useAudioFeatures(song);
  const { provider, model, loading: providerLoading } = useActiveProvider();
  const { content, loading: llmLoading, error: llmError, stream, reset } =
    useLLM();

  const [lyric, setLyric] = useState<string>("");
  const [lyricReady, setLyricReady] = useState(false);
  // 是否已经针对当前歌曲发起过 LLM 请求 —— 用于区分
  // "还没开始" vs "已完成但模型返回空 content" 两种 UI 状态
  const [hasRequested, setHasRequested] = useState(false);

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

  // 切歌或外部触发刷新时清空 dedup key
  useEffect(() => {
    lastKeyRef.current = "";
    setHasRequested(false);
    reset();
  }, [song?.id, refreshKey, reset]);

  useEffect(() => {
    if (providerLoading || featuresLoading) return;
    if (!features || !song || !provider || !model) return;
    if (!lyricReady) return;
    // The hook now returns songId alongside features. During the render
    // where song changes, setState in useAudioFeatures sets songId to
    // the new id immediately (before features resolve), so stale features
    // from a previous song will have featuresSongId !== song.id.
    if (featuresSongId !== song.id) return;
    const key = `${song.id}::${provider.id}::${model}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    // buildPrompt 可能因 features 中某个意外字段抛错；try/catch 兜住。
    // 注意：失败时不要清 lastKeyRef —— 否则若 features 是问题源头，
    // useEffect 一旦被任何 dep 重新触发就会无限失败 + 无限重试。
    // 切歌的 reset effect 会在新 song 时清掉 key，那才是合理的重试时机。
    let userPrompt: string;
    try {
      userPrompt = buildPrompt(song, features, lyric);
    } catch (err) {
      console.error("[MonologueSection] buildPrompt failed:", err);
      return;
    }
    reset();
    setHasRequested(true);
    log("独白", `LLM 请求: ${song.name} - ${song.artist} | ${provider.id} / ${model}`);
    // 用 stream 而不是 request：token 会逐字流入 UI，
    // 让用户立刻看到"在生成"，避免本地慢模型让人误以为卡住。
    stream({
      provider_id: provider.id,
      model,
      messages: [
        {
          role: "system",
          content:
            "基于我提供的歌曲信息、音频特征和部分歌词，" +
            "写一段充满意境和故事感的乐评。" +
            "80-120 字，分 2-3 段，克制用「我」。\n\n" +
            "禁止：提歌手名、复述歌名、报数字/术语/和弦、" +
            "引号星号列表标题、超过 120 字。",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.85,
      max_tokens: 800,
    }).then((resp) => {
      const text = resp?.content ?? "";
      log("独白", `LLM 响应: ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`);
    }).catch((err) => {
      console.error("[MonologueSection] llm stream failed:", err);
      log("独白", `LLM 失败: ${String(err).slice(0, 80)}`, "ERROR");
      // 注意：失败时不要清 lastKeyRef —— 否则若失败原因是持续性的
      // （比如本地模型崩了），useEffect 重跑时会无限重试，
      // 用户的本地模型就会被反复轰炸。
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    song?.id,
    features,
    featuresLoading,
    featuresSongId,
    provider?.id,
    model,
    providerLoading,
    lyricReady,
    refreshKey,
  ]);

  return (
    <div className="flex flex-col">
      <div>
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
          hasRequested={hasRequested}
        />
      </div>
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

  // —— Tier 3：人声 / 风格 / 情绪 ——
  // voice_gender 和 instrument_tags 由 Essentia TF 模型生成，对中文歌曲
  // 准确率很低（性别常错、乐器误检），不传给 LLM 以免引入错误信息。
  // LLM 可从歌手名 + 歌词自行判断性别，从频谱特征推断乐器风格。
  if (features.voice_instrumental) {
    const v =
      features.voice_instrumental === "voice" ? "以人声为主" : "纯器乐";
    lines.push(`声音构成：${v}`);
  }
  if (features.mood_tags && features.mood_tags.length > 0) {
    lines.push(`情绪标签：${features.mood_tags.join("、")}`);
  }
  // 风格优先用 Tier 4 LLM 给的具体标签（kimi 测试 0 hallucination），
  // 回退到 essentia genre_tags top3
  if (
    features.llm_genre &&
    features.llm_genre_confidence &&
    features.llm_genre_confidence !== "unknown" &&
    features.llm_genre_confidence !== "low"
  ) {
    lines.push(`风格倾向：${features.llm_genre}`);
  } else if (features.genre_tags && features.genre_tags.length > 0) {
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
  hasRequested: boolean;
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
    hasRequested,
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
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    if (cleaned.length > 0) {
      body = cleaned;
    } else {
      body = "模型只输出了思考过程，正文为空 —— 换个模型再试";
      bodyStyle.color = "rgba(255,180,160,0.9)";
    }
  } else if (hasRequested && !llmLoading) {
    // 已经发起过请求，loading 已经回到 false，但 content 仍是空
    // —— 模型返回了空内容（接口可能 200 但 body 没东西）
    body = "模型返回了空内容 —— 换个模型再试";
    bodyStyle.color = "rgba(255,180,160,0.9)";
  } else {
    body = "等待生成…";
    bodyStyle.color = "var(--theme-lyrics-mid)";
  }

  return <div style={bodyStyle}>{body}</div>;
}

