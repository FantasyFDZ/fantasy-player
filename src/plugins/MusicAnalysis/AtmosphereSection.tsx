// "氛围" tab —— AI 基于歌曲信息 + 歌词写诗意的氛围描述和听歌场景。

import { useEffect, useState } from "react";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { useLLM } from "@/hooks/useLLM";
import { api, type AudioFeatures, type Song } from "@/lib/api";
import { AiTextDisplay } from "./AnalysisSection";

interface Props {
  song: Song | null;
}

export function AtmosphereSection({ song }: Props) {
  const { features, loading: featuresLoading, error: featuresError } =
    useAudioFeatures(song);
  const { provider, model, loading: providerLoading } = useActiveProvider();
  const { content, loading: llmLoading, error: llmError, request, reset } =
    useLLM();
  const [lyric, setLyric] = useState<string>("");

  // 获取歌词
  useEffect(() => {
    if (!song) {
      setLyric("");
      return;
    }
    let cancelled = false;
    api
      .getLyric(song.id)
      .then((l) => {
        if (cancelled) return;
        setLyric(l.lrc);
      })
      .catch(() => {
        if (!cancelled) setLyric("");
      });
    return () => {
      cancelled = true;
    };
  }, [song?.id]);

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
            "你是一位懂音乐、文笔优美的作家。基于我提供的歌曲信息、" +
            "音频特征和部分歌词，用中文写一段 4-6 句话的氛围描述，" +
            "要求：1) 描绘这首歌营造的情感氛围；" +
            "2) 推荐 1-2 个适合听这首歌的具体场景（比如夜晚独自开车、" +
            "雨夜窗前读书、深秋黄昏散步）；" +
            "3) 文字要有诗意，可以用意象、比喻和画面感；" +
            "4) 不要报数字、不要复述数据、不要用专业术语；" +
            "5) 不要用引号、星号之类的标点装饰，直接散文式输出。",
        },
        {
          role: "user",
          content: buildAtmospherePrompt(song, features, lyric),
        },
      ],
      temperature: 0.9,
      max_tokens: 1024,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features?.bpm, song?.id, provider?.id, model, providerLoading, lyric]);

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

function buildAtmospherePrompt(
  song: Song,
  features: AudioFeatures,
  lyric: string,
): string {
  // 歌词需要剥离时间戳和不必要的 metadata
  const cleanedLyric = lyric
    .split(/\r?\n/)
    .map((line) => line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 40) // 最多 40 行避免 prompt 过长
    .join("\n");

  const energyLabel =
    features.energy < 0.3 ? "安静" : features.energy < 0.6 ? "中等" : "激烈";
  const tempoLabel =
    features.bpm < 80 ? "舒缓" : features.bpm < 120 ? "中速" : "快速";
  const keyMood = features.key.endsWith("m") ? "小调（偏忧郁内省）" : "大调（偏明朗开阔）";

  return (
    `歌曲：${song.name}\n艺人：${song.artist}\n` +
    `整体速度：${tempoLabel}\n能量：${energyLabel}\n调式氛围：${keyMood}\n\n` +
    (cleanedLyric
      ? `歌词片段：\n${cleanedLyric}\n`
      : `（无歌词）\n`)
  );
}
