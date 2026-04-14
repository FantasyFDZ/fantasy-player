// 音频特征 hook。
//
// 当 song 变化时，触发后端 analyze_song（缓存命中秒回，否则下载 +
// Python sidecar 分析）。
//
// 返回 features / loading / error / songId / setFeatures（直接更新状态）

import { useCallback, useEffect, useState } from "react";
import { api, type AudioFeatures, type Song } from "@/lib/api";

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
    api
      .analyzeSong(song)
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
