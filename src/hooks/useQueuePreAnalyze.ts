// 队列预分析 hook。
//
// 监听队列变化，后台对所有歌曲提前做音频特征提取。
// 分析结果缓存到 SQLite song_features 表，后续
// useAudioFeatures() 命中缓存秒回，播放时只需等 LLM 生成文字。
//
// 并发控制：最多 2 路并行，避免 CPU / 网络过载。

import { useCallback, useEffect, useRef } from "react";
import { api, onSongChanged, type Song } from "@/lib/api";

/** 已知已分析完成或正在分析的歌曲 id */
const analyzed = new Set<string>();
const analyzing = new Set<string>();
const CONCURRENCY = 2;

export function useQueuePreAnalyze() {
  const queueRef = useRef<Song[]>([]);
  const runningRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      // 找出需要分析但尚未开始的歌
      const pending = queueRef.current.filter(
        (s) => !analyzed.has(s.id) && !analyzing.has(s.id),
      );

      // 分批处理
      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const batch = pending.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (song) => {
            analyzing.add(song.id);
            try {
              await api.analyzeSong(song);
              analyzed.add(song.id);
            } catch {
              // 单首失败不阻塞，下次队列变化会重试
            } finally {
              analyzing.delete(song.id);
            }
          }),
        );
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  // 拉取当前队列并触发预分析
  const refreshAndAnalyze = useCallback(async () => {
    try {
      const snap = await api.queueSnapshot();
      queueRef.current = snap.tracks;
      processQueue();
    } catch {
      // 队列获取失败（未登录等），静默忽略
    }
  }, [processQueue]);

  // 启动时拉一次
  useEffect(() => {
    refreshAndAnalyze();
  }, [refreshAndAnalyze]);

  // 歌曲切换时重新拉取（队列可能变了）
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onSongChanged(() => {
      refreshAndAnalyze();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshAndAnalyze]);
}
