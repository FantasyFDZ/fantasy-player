// AI DJ 控制台面板 —— Phase 8
//
// 三个区域：
// 0. DJ 模式开关 + 当前/下一首预览
// 1. 曲序编排：获取队列 + 批量分析 + LLM 智能编排 + 能量曲线
// 2. Crossfade 设置：开关 + 时长滑块 + 淡出/淡入执行

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { useLLM } from "@/hooks/useLLM";
import {
  api,
  onPlaybackUpdate,
  onSongChanged,
  onTrackEnded,
  type AudioFeatures,
  type PlaybackStatus,
  type QueueSnapshot,
  type Song,
} from "@/lib/api";
import { extractJsonArray } from "@/lib/extractJsonArray";

// ---- types ----------------------------------------------------------------

interface TrackWithFeatures {
  song: Song;
  features: AudioFeatures | null;
  analyzing: boolean;
  error: string | null;
}

// ---- constants ------------------------------------------------------------

const CROSSFADE_MIN = 2;
const CROSSFADE_MAX = 8;
const CROSSFADE_DEFAULT = 5;

// ---- component ------------------------------------------------------------

interface Props {
  song: Song | null;
}

export function AiDj({ song }: Props) {
  // ---- queue + features state ----
  const [tracks, setTracks] = useState<TrackWithFeatures[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ done: 0, total: 0 });
  const [analyzing, setAnalyzing] = useState(false);

  // ---- LLM reorder state ----
  const { provider, model, loading: providerLoading } = useActiveProvider();
  const {
    loading: llmLoading,
    error: llmError,
    request: llmRequest,
    reset: llmReset,
  } = useLLM();
  const [reorderError, setReorderError] = useState<string | null>(null);

  // ---- crossfade state ----
  const [cfEnabled, setCfEnabled] = useState(false);
  const [cfDuration, setCfDuration] = useState(CROSSFADE_DEFAULT);
  const [cfFading, setCfFading] = useState(false);
  const [cfProgress, setCfProgress] = useState(0);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const savedVolumeRef = useRef<number>(100);
  const cfEnabledRef = useRef(cfEnabled);
  const cfDurationRef = useRef(cfDuration);

  // keep refs in sync
  useEffect(() => {
    cfEnabledRef.current = cfEnabled;
  }, [cfEnabled]);
  useEffect(() => {
    cfDurationRef.current = cfDuration;
  }, [cfDuration]);

  // ---- load persisted crossfade settings ----
  useEffect(() => {
    (async () => {
      try {
        const en = await api.getSetting("dj.crossfade_enabled");
        if (en === "true") setCfEnabled(true);
        const dur = await api.getSetting("dj.crossfade_duration");
        if (dur) {
          const n = Number(dur);
          if (n >= CROSSFADE_MIN && n <= CROSSFADE_MAX) setCfDuration(n);
        }
      } catch {
        // settings not yet saved, use defaults
      }
    })();
  }, []);

  // ---- persist crossfade settings on change ----
  useEffect(() => {
    api.setSetting("dj.crossfade_enabled", cfEnabled ? "true" : "false").catch(() => {});
  }, [cfEnabled]);

  useEffect(() => {
    api.setSetting("dj.crossfade_duration", String(cfDuration)).catch(() => {});
  }, [cfDuration]);

  // ---- fetch queue ----
  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    setReorderError(null);
    try {
      const snap = await api.queueSnapshot();
      const initial: TrackWithFeatures[] = snap.tracks.map((s) => ({
        song: s,
        features: null,
        analyzing: false,
        error: null,
      }));
      setTracks(initial);
      return initial;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setReorderError(`获取队列失败: ${msg}`);
      return [];
    } finally {
      setQueueLoading(false);
    }
  }, []);

  // ---- batch analyze ----
  const analyzeAll = useCallback(async (trackList: TrackWithFeatures[]) => {
    if (trackList.length === 0) return;
    setAnalyzing(true);
    setAnalyzeProgress({ done: 0, total: trackList.length });

    // analyze in parallel with concurrency limit of 4
    const CONCURRENCY = 4;
    let done = 0;
    const results = [...trackList];

    const analyzeOne = async (idx: number) => {
      const t = results[idx];
      setTracks((prev) => {
        const next = [...prev];
        if (next[idx]) next[idx] = { ...next[idx], analyzing: true };
        return next;
      });
      try {
        const features = await api.analyzeSong(t.song);
        results[idx] = { ...t, features, analyzing: false, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[idx] = { ...t, features: null, analyzing: false, error: msg };
      }
      done++;
      setAnalyzeProgress({ done, total: trackList.length });
      setTracks([...results]);
    };

    // process in batches
    for (let i = 0; i < trackList.length; i += CONCURRENCY) {
      const batch = [];
      for (let j = i; j < Math.min(i + CONCURRENCY, trackList.length); j++) {
        batch.push(analyzeOne(j));
      }
      await Promise.all(batch);
    }

    setAnalyzing(false);
  }, []);

  // ---- auto-fetch queue on mount ----
  useEffect(() => {
    fetchQueue().then((list) => {
      if (list.length > 0) analyzeAll(list);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- AI reorder ----
  const handleReorder = useCallback(async () => {
    if (!provider || !model) return;
    setReorderError(null);
    llmReset();

    const withFeatures = tracks.filter((t) => t.features);
    if (withFeatures.length < 2) {
      setReorderError("至少需要 2 首已分析的歌曲才能编排");
      return;
    }

    // build prompt
    const trackData = withFeatures.map((t) => ({
      id: t.song.id,
      name: t.song.name,
      artist: t.song.artist,
      bpm: t.features!.bpm,
      key: t.features!.key,
      energy: t.features!.energy,
      valence: t.features!.valence,
      danceability: t.features!.danceability ?? null,
      loudness: t.features!.loudness_lufs ?? null,
      onset_rate: t.features!.onset_rate ?? null,
      mood: t.features!.mood_tags ?? [],
      genre: t.features!.genre_tags ?? [],
    }));

    const systemPrompt =
      "你是一位专业 DJ，擅长歌单曲序编排。根据每首歌的 BPM、调式、" +
      "能量、情绪值、流派、响度等特征，生成一个最优播放顺序。\n\n" +
      "编排原则：\n" +
      "1. 能量曲线平滑过渡，避免相邻歌曲能量跳跃过大\n" +
      "2. 相邻歌曲 BPM 差异不宜超过 20\n" +
      "3. 调性兼容优先（五度圈相邻或平行大小调）\n" +
      "4. 整体呈现先升后降或波浪起伏的能量曲线\n" +
      "5. 相邻曲目 genre 相似度优先，同类型歌曲尽量聚在一起\n" +
      "6. mood 标签平滑过渡，不要从欢快直接跳到悲伤\n" +
      "7. 考虑 loudness 匹配，避免相邻歌曲音量落差过大\n" +
      "8. 首尾曲目可以形成风格或情绪上的呼应\n\n" +
      "【输出格式】严格要求：\n" +
      "- 只输出一个纯 JSON 数组，数组元素是歌曲 id 字符串，按播放顺序排列\n" +
      "- 不要输出任何解释、前言、注释或 markdown 格式\n" +
      "- 不要使用 ```json 代码块包裹\n" +
      "- 正确示例：[\"id1\", \"id2\", \"id3\"]\n" +
      "- 错误示例：以下是推荐... 或 ```json [...] ```";

    const userPrompt =
      "以下是歌单中的歌曲及其音频特征：\n\n" +
      JSON.stringify(trackData, null, 2) +
      "\n\n请输出最优播放顺序的 JSON 数组。";

    try {
      const resp = await llmRequest({
        provider_id: provider.id,
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      });

      // parse response - extract JSON array from content
      const ids = extractJsonArray<string>(resp.content);
      if (!ids || ids.length === 0) {
        setReorderError("LLM 返回格式错误，未找到 JSON 数组");
        return;
      }

      // reorder tracks based on ids
      const trackMap = new Map(tracks.map((t) => [t.song.id, t]));
      const reordered: TrackWithFeatures[] = [];
      for (const id of ids) {
        const stringId = String(id);
        const t = trackMap.get(stringId);
        if (t) reordered.push(t);
      }
      // add any tracks not in the LLM response at the end
      for (const t of tracks) {
        if (!reordered.find((r) => r.song.id === t.song.id)) {
          reordered.push(t);
        }
      }

      setTracks(reordered);

      // apply to queue
      await api.queueReplace(
        reordered.map((t) => t.song),
        0,
      );
    } catch (err) {
      if (!llmError) {
        const msg = err instanceof Error ? err.message : String(err);
        setReorderError(`编排失败: ${msg}`);
      }
    }
  }, [provider, model, tracks, llmRequest, llmReset, llmError]);

  // ---- crossfade: monitor playback position ----
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const startFade = (status: PlaybackStatus) => {
      if (fadeTimerRef.current) return; // already fading
      savedVolumeRef.current = status.volume;
      setCfFading(true);
      setCfProgress(0);

      const dur = cfDurationRef.current;
      const startTime = Date.now();
      const startVol = status.volume;

      fadeTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = Math.min(elapsed / dur, 1);
        setCfProgress(progress);

        const newVol = Math.round(startVol * (1 - progress));
        api.setVolume(Math.max(0, newVol)).catch(() => {});

        if (progress >= 1) {
          if (fadeTimerRef.current) {
            clearInterval(fadeTimerRef.current);
            fadeTimerRef.current = null;
          }
          setCfFading(false);
          setCfProgress(0);
        }
      }, 100);
    };

    const handleUpdate = (status: PlaybackStatus) => {
      if (!cfEnabledRef.current) return;
      if (status.state !== "playing") return;
      if (status.duration <= 0) return;

      const remaining = status.duration - status.position;
      if (remaining <= cfDurationRef.current && remaining > 0) {
        startFade(status);
      }
    };

    onPlaybackUpdate(handleUpdate).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
      if (fadeTimerRef.current) {
        clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

  // ---- crossfade: restore volume on track change ----
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const handleTrackEnded = () => {
      if (fadeTimerRef.current) {
        clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      setCfFading(false);
      setCfProgress(0);
      // restore volume
      if (cfEnabledRef.current) {
        api.setVolume(savedVolumeRef.current).catch(() => {});
      }
    };

    onTrackEnded(handleTrackEnded).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ---- DJ mode state ----
  const [djMode, setDjMode] = useState(false);
  const djModeRef = useRef(djMode);
  useEffect(() => {
    djModeRef.current = djMode;
  }, [djMode]);

  const [nowPlaying, setNowPlaying] = useState<Song | null>(song);
  const [nextUp, setNextUp] = useState<Song | null>(null);
  const [nowFeatures, setNowFeatures] = useState<AudioFeatures | null>(null);
  const [nextFeatures, setNextFeatures] = useState<AudioFeatures | null>(null);

  // sync nowPlaying with prop
  useEffect(() => {
    setNowPlaying(song);
    if (song) {
      const found = tracks.find((t) => t.song.id === song.id);
      setNowFeatures(found?.features ?? null);
    } else {
      setNowFeatures(null);
    }
  }, [song, tracks]);

  // ---- DJ mode: auto-enable crossfade ----
  useEffect(() => {
    if (djMode && !cfEnabled) setCfEnabled(true);
  }, [djMode, cfEnabled]);

  // ---- persist DJ mode setting ----
  useEffect(() => {
    api.setSetting("dj.dj_mode", djMode ? "true" : "false").catch(() => {});
  }, [djMode]);

  // ---- load persisted DJ mode ----
  useEffect(() => {
    (async () => {
      try {
        const v = await api.getSetting("dj.dj_mode");
        if (v === "true") setDjMode(true);
      } catch {
        // ignore
      }
    })();
  }, []);

  // ---- fetch next track info for DJ preview ----
  const refreshNextTrack = useCallback(async () => {
    try {
      const snap: QueueSnapshot = await api.queueSnapshot();
      if (snap.current_index != null && snap.tracks.length > 0) {
        const nextIdx = snap.current_index + 1;
        if (nextIdx < snap.tracks.length) {
          const ns = snap.tracks[nextIdx];
          setNextUp(ns);
          // find features from our local state
          const found = tracks.find((t) => t.song.id === ns.id);
          setNextFeatures(found?.features ?? null);
        } else {
          setNextUp(null);
          setNextFeatures(null);
        }
      } else {
        setNextUp(null);
        setNextFeatures(null);
      }
    } catch {
      setNextUp(null);
      setNextFeatures(null);
    }
  }, [tracks]);

  // refresh next track on mount and when tracks change
  useEffect(() => {
    if (djMode) refreshNextTrack();
  }, [djMode, refreshNextTrack]);

  // ---- crossfade: fadeIn on song change ----
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const fadeInTimerRef: { current: ReturnType<typeof setInterval> | null } = { current: null };

    onSongChanged((newSong: Song) => {
      // update DJ preview
      setNowPlaying(newSong);
      if (djModeRef.current) refreshNextTrack();

      if (!cfEnabledRef.current) return;
      // fadeIn: volume 0 -> savedVolumeRef.current over 2s
      const targetVol = savedVolumeRef.current;
      api.setVolume(0).catch(() => {});
      const fadeInDuration = 2; // seconds
      const startTime = Date.now();
      if (fadeInTimerRef.current) clearInterval(fadeInTimerRef.current);
      fadeInTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = Math.min(elapsed / fadeInDuration, 1);
        api.setVolume(Math.round(targetVol * progress)).catch(() => {});
        if (progress >= 1) {
          if (fadeInTimerRef.current) {
            clearInterval(fadeInTimerRef.current);
            fadeInTimerRef.current = null;
          }
        }
      }, 100);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
      if (fadeInTimerRef.current) {
        clearInterval(fadeInTimerRef.current);
        fadeInTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNextTrack]);

  // ---- render ----
  return (
    <div className="flex h-full flex-col gap-3">
      {/* Section 0: DJ Mode toggle + preview */}
      <SectionHeader title="DJ 模式" />
      <div style={{ paddingBottom: 4 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-secondary, var(--theme-lyrics-next))",
            }}
          >
            DJ 模式
          </span>
          <ToggleSwitch checked={djMode} onChange={setDjMode} />
        </div>

        {djMode && (
          <div className="flex gap-2" style={{ marginBottom: 4 }}>
            <DjPreviewCard
              label="正在播放"
              song={nowPlaying}
              features={nowFeatures}
              active
            />
            <DjPreviewCard
              label="下一首"
              song={nextUp}
              features={nextFeatures}
            />
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />

      {/* Section 1: Track reordering */}
      <SectionHeader title="曲序编排" />

      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {/* Loading / error states */}
        {queueLoading && <StatusText text="加载队列中..." />}

        {/* Analyze progress bar */}
        {analyzing && (
          <ProgressBar
            done={analyzeProgress.done}
            total={analyzeProgress.total}
            label="分析中"
          />
        )}

        {/* Track list */}
        {tracks.length > 0 && (
          <div className="flex flex-col gap-1" style={{ marginBottom: 8 }}>
            {tracks.map((t, i) => (
              <TrackRow key={t.song.id} track={t} index={i} isCurrent={song?.id === t.song.id} />
            ))}
          </div>
        )}

        {tracks.length === 0 && !queueLoading && (
          <StatusText text="队列为空" />
        )}

        {/* Energy curve */}
        {tracks.some((t) => t.features) && <EnergyCurve tracks={tracks} />}

        {/* Error display */}
        {(reorderError || llmError) && (
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,180,160,0.9)",
              padding: "6px 0",
            }}
          >
            {reorderError || llmError}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2" style={{ marginTop: 8, marginBottom: 12 }}>
          <ActionButton
            onClick={handleReorder}
            disabled={llmLoading || providerLoading || tracks.length < 2 || analyzing}
            loading={llmLoading}
            label={llmLoading ? "编排中..." : "AI 智能编排"}
          />
          <ActionButton
            onClick={() => {
              fetchQueue().then((list) => {
                if (list.length > 0) analyzeAll(list);
              });
            }}
            disabled={queueLoading || analyzing}
            loading={queueLoading || analyzing}
            label="刷新队列"
            secondary
          />
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />

      {/* Section 2: Crossfade */}
      <SectionHeader title="淡入淡出" />

      <div style={{ paddingBottom: 8 }}>
        {/* Toggle */}
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-secondary, var(--theme-lyrics-next))",
            }}
          >
            渐变过渡
          </span>
          <ToggleSwitch checked={cfEnabled} onChange={setCfEnabled} />
        </div>

        {/* Duration slider */}
        {cfEnabled && (
          <div style={{ marginBottom: 10 }}>
            <div
              className="flex items-center justify-between"
              style={{ marginBottom: 6 }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary, var(--theme-lyrics-mid))",
                }}
              >
                过渡时长
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-primary, var(--theme-lyrics-next))",
                }}
              >
                {cfDuration}s
              </span>
            </div>
            <input
              type="range"
              min={CROSSFADE_MIN}
              max={CROSSFADE_MAX}
              step={1}
              value={cfDuration}
              onChange={(e) => setCfDuration(Number(e.target.value))}
              className="w-full"
              style={{
                accentColor: "var(--theme-accent)",
                height: 4,
              }}
            />
          </div>
        )}

        {/* Fading progress indicator */}
        {cfFading && (
          <div style={{ marginTop: 6 }}>
            <div
              className="flex items-center justify-between"
              style={{ marginBottom: 4 }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--theme-accent)",
                }}
              >
                淡出中...
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "var(--theme-accent)",
                }}
              >
                {Math.round(cfProgress * 100)}%
              </span>
            </div>
            <div
              style={{
                height: 3,
                borderRadius: 2,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${cfProgress * 100}%`,
                  height: "100%",
                  background: "var(--theme-accent)",
                  borderRadius: 2,
                  transition: "width 0.1s linear",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- sub-components -------------------------------------------------------

function DjPreviewCard({
  label,
  song,
  features,
  active,
}: {
  label: string;
  song: Song | null;
  features: AudioFeatures | null;
  active?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: "8px 10px",
        borderRadius: 6,
        background: active
          ? "rgba(255,255,255,0.06)"
          : "rgba(255,255,255,0.03)",
        border: active
          ? "1px solid rgba(255,255,255,0.10)"
          : "1px solid rgba(255,255,255,0.05)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontFamily: "var(--font-mono)",
          color: active ? "var(--theme-accent)" : "var(--theme-lyrics-mid)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {song ? (
        <>
          <div
            style={{
              fontSize: 12,
              color: active
                ? "var(--theme-accent)"
                : "var(--text-primary, var(--theme-lyrics-next))",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {song.name}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--theme-lyrics-mid)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: 4,
            }}
          >
            {song.artist}
          </div>
          {features && (
            <div className="flex gap-1" style={{ flexWrap: "wrap" }}>
              <Badge label={`${Math.round(features.bpm)}`} title="BPM" />
              <Badge
                label={`${Math.round(features.energy * 100)}%`}
                title="Energy"
              />
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            fontSize: 11,
            color: "var(--theme-lyrics-mid)",
            opacity: 0.6,
          }}
        >
          --
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--theme-label, var(--theme-lyrics-mid))",
        filter: "brightness(1.4)",
        fontFamily: "var(--font-mono)",
        paddingBottom: 4,
      }}
    >
      {title}
    </div>
  );
}

function StatusText({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: "var(--theme-lyrics-mid)",
        padding: "12px 0",
      }}
    >
      {text}
    </div>
  );
}

function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 3 }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--theme-lyrics-mid)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--theme-lyrics-mid)",
          }}
        >
          {done}/{total}
        </span>
      </div>
      <div
        style={{
          height: 3,
          borderRadius: 2,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--theme-accent)",
            borderRadius: 2,
            transition: "width 0.2s ease",
          }}
        />
      </div>
    </div>
  );
}

function TrackRow({
  track,
  index,
  isCurrent,
}: {
  track: TrackWithFeatures;
  index: number;
  isCurrent: boolean;
}) {
  const { song, features, analyzing: isAnalyzing } = track;
  return (
    <div
      className="flex items-center gap-2"
      style={{
        padding: "5px 6px",
        borderRadius: 5,
        background: isCurrent
          ? "rgba(255,255,255,0.06)"
          : "transparent",
        border: isCurrent
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid transparent",
      }}
    >
      {/* Index */}
      <span
        style={{
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--theme-lyrics-mid)",
          width: 18,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {index + 1}
      </span>

      {/* Song info */}
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: isCurrent
              ? "var(--theme-accent)"
              : "var(--text-primary, var(--theme-lyrics-next))",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {song.name}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--theme-lyrics-mid)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {song.artist}
        </div>
      </div>

      {/* Feature badges */}
      {isAnalyzing && (
        <span
          style={{
            fontSize: 9,
            color: "var(--theme-lyrics-mid)",
            fontFamily: "var(--font-mono)",
          }}
        >
          ...
        </span>
      )}
      {features && (
        <div className="flex gap-1" style={{ flexShrink: 0 }}>
          <Badge label={`${Math.round(features.bpm)}`} title="BPM" />
          <Badge label={features.key || "?"} title="Key" />
          <Badge
            label={`${Math.round(features.energy * 100)}%`}
            title="Energy"
          />
        </div>
      )}
    </div>
  );
}

function Badge({ label, title }: { label: string; title: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        padding: "1px 4px",
        borderRadius: 3,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "var(--theme-lyrics-next)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function EnergyCurve({ tracks }: { tracks: TrackWithFeatures[] }) {
  const energies = tracks
    .map((t) => (t.features ? t.features.energy : null))
    .filter((e): e is number => e !== null);

  if (energies.length < 2) return null;

  const W = 360;
  const H = 60;
  const PAD = 8;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  const points = energies.map((e, i) => {
    const x = PAD + (i / (energies.length - 1)) * plotW;
    const y = PAD + (1 - e) * plotH;
    return `${x},${y}`;
  });

  const fillPoints = [
    `${PAD},${PAD + plotH}`,
    ...points,
    `${PAD + plotW},${PAD + plotH}`,
  ];

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--theme-lyrics-mid)",
          fontFamily: "var(--font-mono)",
          marginBottom: 4,
        }}
      >
        能量曲线
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{
          borderRadius: 4,
          background: "rgba(0,0,0,0.2)",
        }}
      >
        {/* Fill under curve */}
        <polygon
          points={fillPoints.join(" ")}
          fill="var(--theme-accent)"
          fillOpacity={0.12}
        />
        {/* Line */}
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--theme-accent)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Dots */}
        {energies.map((e, i) => {
          const x = PAD + (i / (energies.length - 1)) * plotW;
          const y = PAD + (1 - e) * plotH;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={2.5}
              fill="var(--theme-accent)"
              fillOpacity={0.8}
            />
          );
        })}
      </svg>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  loading,
  label,
  secondary,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  label: string;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="transition-all"
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        fontSize: 12,
        fontFamily: "var(--font-ui)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: secondary
          ? "rgba(255,255,255,0.05)"
          : "rgba(255,255,255,0.08)",
        border: secondary
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid var(--theme-accent)",
        color: secondary
          ? "var(--theme-lyrics-next)"
          : "var(--theme-accent)",
      }}
    >
      {loading ? (
        <span style={{ opacity: 0.7 }}>{label}</span>
      ) : (
        label
      )}
    </button>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        padding: 2,
        cursor: "pointer",
        background: checked
          ? "var(--theme-accent)"
          : "rgba(255,255,255,0.12)",
        border: "none",
        transition: "background 0.2s ease",
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          transform: checked ? "translateX(16px)" : "translateX(0)",
          transition: "transform 0.2s ease",
        }}
      />
    </button>
  );
}
