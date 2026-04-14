// 音绪面板共享工具：风格推导 + 标签映射。
// 从 MonologueSection.tsx 抽出以便 GenreHeadline 和 MetricsStrip 共用。

import type { AudioFeatures } from "@/lib/api";

/**
 * 风格栏标签来源（按优先级）：
 *  1) Tier 4 LLM 给出的具体风格（最准）
 *  2) Tier 3 genre_tags top1（essentia TF 模型）
 *  3) Tier 3 mood_tags top1
 *  4) Tier 2 启发式（danceability + 调式 + 能量）
 */
export function pickStyleLabel(f: AudioFeatures): string {
  if (
    f.llm_genre &&
    f.llm_genre_confidence &&
    f.llm_genre_confidence !== "unknown" &&
    f.llm_genre_confidence !== "low"
  ) {
    return shortenStyle(f.llm_genre);
  }
  if (f.genre_tags && f.genre_tags.length > 0) {
    return shortenStyle(f.genre_tags[0]);
  }
  if (f.mood_tags && f.mood_tags.length > 0) {
    return moodTagToZh(f.mood_tags[0]);
  }
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

export function shortenStyle(raw: string): string {
  // genre_discogs400 标签形如 "Electronic---House"
  const tail = raw.split("---").pop() ?? raw;
  return tail.length > 24 ? tail.slice(0, 24) + "…" : tail;
}

export function moodTagToZh(tag: string): string {
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
