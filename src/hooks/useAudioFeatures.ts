// 音频特征 hook。
//
// 当 song 变化时，触发后端 analyze_song（缓存命中秒回，否则下载 +
// Python sidecar 分析）。
//
// 返回 features / loading / error。

import { useEffect, useState } from "react";
import { api, type AudioFeatures, type Song } from "@/lib/api";

export interface UseAudioFeaturesState {
  features: AudioFeatures | null;
  loading: boolean;
  error: string | null;
}

export function useAudioFeatures(song: Song | null): UseAudioFeaturesState {
  const [state, setState] = useState<UseAudioFeaturesState>({
    features: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!song) {
      setState({ features: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ features: null, loading: true, error: null });
    api
      .analyzeSong(song)
      .then((features) => {
        if (cancelled) return;
        setState({ features, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ features: null, loading: false, error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [song?.id]);

  return state;
}
