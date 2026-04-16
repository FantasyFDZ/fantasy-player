// 音频特征 hook。
//
// 当 song 变化时，触发后端 analyze_song（缓存命中秒回，否则下载 +
// Python sidecar 分析）。
//
// 去重：模块级 Promise 缓存让多个组件同时 hook 同一首歌时共享一次请求，
// 避免 MusicAnalysis + MonologueSection 各自发一次分析。

import { useCallback, useEffect, useState } from "react";
import { api, type AudioFeatures, type Song } from "@/lib/api";

// 进行中的请求：songId → Promise<AudioFeatures>
// 请求成功/失败后立即从 Map 删除；下次相同 songId 的调用会重新请求，
// 但后端自带 DB 缓存，秒回。
const inFlight = new Map<string, Promise<AudioFeatures>>();

function analyzeShared(song: Song): Promise<AudioFeatures> {
  const id = song.id;
  const existing = inFlight.get(id);
  if (existing) return existing;
  const promise = api.analyzeSong(song).finally(() => {
    inFlight.delete(id);
  });
  inFlight.set(id, promise);
  return promise;
}

export interface UseAudioFeaturesState {
  features: AudioFeatures | null;
  loading: boolean;
  error: string | null;
  /** The song.id these features belong to. Use this to guard against
   *  stale features in consumers — if songId !== currentSong.id,
   *  the features are from a previous song and should not be used. */
  songId: string;
  /** 直接设置 features（BPM 手动修改后调用） */
  setFeatures: (features: AudioFeatures) => void;
}

export function useAudioFeatures(song: Song | null): UseAudioFeaturesState {
  const [state, setState] = useState<{
    features: AudioFeatures | null;
    loading: boolean;
    error: string | null;
    songId: string;
  }>({
    features: null,
    loading: false,
    error: null,
    songId: "",
  });

  useEffect(() => {
    if (!song) {
      setState({ features: null, loading: false, error: null, songId: "" });
      return;
    }
    const id = song.id;
    let cancelled = false;
    setState({ features: null, loading: true, error: null, songId: id });
    analyzeShared(song)
      .then((features) => {
        if (cancelled) return;
        setState({ features, loading: false, error: null, songId: id });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ features: null, loading: false, error: msg, songId: id });
      });
    return () => {
      cancelled = true;
    };
  }, [song?.id]);

  const setFeatures = useCallback((features: AudioFeatures) => {
    setState((prev) => ({ ...prev, features, error: null }));
  }, []);

  return { ...state, setFeatures };
}
