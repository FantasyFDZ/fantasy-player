// 底部播放条。
//
// 布局（从左到右）：
//   [time] [progress bar] [time] | [prev][play][next] | [vol] | [mode] | [cover][title/artist → queue] [♥]

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  onPlaybackUpdate,
  onTrackEnded,
  type PlayMode,
  type PlaybackStatus,
  type Song,
} from "@/lib/api";
import { QueuePopup } from "./QueuePopup";

interface Props {
  currentSong: Song | null;
  onSongChange: (song: Song | null) => void;
}

export function PlayBar({ currentSong, onSongChange }: Props) {
  const [status, setStatus] = useState<PlaybackStatus>({
    state: "idle",
    position: 0,
    duration: 0,
    volume: 100,
  });
  const [mode, setMode] = useState<PlayMode>("sequential");
  const [volOpen, setVolOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [liking, setLiking] = useState(false);
  const [favPlaylistId, setFavPlaylistId] = useState<string | null>(null);
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const queueWrapperRef = useRef<HTMLDivElement>(null);

  // 加载"我喜欢的"歌单 ID + 曲目列表（用于判断是否已收藏）
  useEffect(() => {
    api.getUserPlaylists().then((playlists) => {
      const fav = playlists.find((pl) => pl.special_type === 5);
      if (fav) {
        setFavPlaylistId(fav.id);
        api.getPlaylistDetail(fav.id).then((detail) => {
          setLikedSet(new Set(detail.tracks.map((t) => t.id)));
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // 当前歌变化时检查是否已收藏
  useEffect(() => {
    if (currentSong) {
      setLiked(likedSet.has(currentSong.id));
    } else {
      setLiked(false);
    }
  }, [currentSong?.id, likedSet]);

  const toggleLike = useCallback(async () => {
    if (!currentSong || !favPlaylistId || liking) return;
    setLiking(true);
    try {
      if (liked) {
        await api.removeTracksFromPlaylist(favPlaylistId, [currentSong.id]);
        setLikedSet((prev) => {
          const next = new Set(prev);
          next.delete(currentSong.id);
          return next;
        });
        setLiked(false);
      } else {
        await api.addTracksToPlaylist(favPlaylistId, [currentSong.id]);
        setLikedSet((prev) => new Set(prev).add(currentSong.id));
        setLiked(true);
      }
    } catch {
      // ignore
    } finally {
      setLiking(false);
    }
  }, [currentSong, favPlaylistId, liked, liking]);

  useEffect(() => {
    if (!queueOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!queueWrapperRef.current?.contains(e.target as Node)) {
        setQueueOpen(false);
      }
    };
    const timer = window.setTimeout(
      () => document.addEventListener("mousedown", onDown),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
    };
  }, [queueOpen]);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    onPlaybackUpdate((s) => {
      if (!cancelled) setStatus(s);
    }).then((fn) => {
      if (cancelled) fn();
      else cleanups.push(fn);
    });

    onTrackEnded(() => {
      if (cancelled) return;
      api
        .nextTrack(true)
        .then((song) => onSongChange(song))
        .catch(() => {});
    }).then((fn) => {
      if (cancelled) fn();
      else cleanups.push(fn);
    });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [onSongChange]);

  const isPlaying = status.state === "playing";
  const progressPercent =
    status.duration > 0
      ? Math.min(100, (status.position / status.duration) * 100)
      : 0;

  const togglePlay = () => {
    if (isPlaying) api.pause().catch(() => {});
    else api.resume().catch(() => {});
  };

  const cycleMode = () => {
    const next: PlayMode =
      mode === "sequential"
        ? "shuffle"
        : mode === "shuffle"
          ? "repeat_one"
          : "sequential";
    setMode(next);
    api.queueSetMode(next).catch(() => {});
  };

  const jumpToQueueSong = (song: Song) => {
    api
      .queueSnapshot()
      .then((snap) => {
        const idx = snap.tracks.findIndex((t) => t.id === song.id);
        if (idx < 0) throw new Error("song not in queue");
        return api.queueReplace(snap.tracks, idx);
      })
      .then(() => {
        onSongChange(song);
        setQueueOpen(false);
      })
      .catch((err) => {
        console.error("跳转失败:", err);
      });
  };

  return (
    <div
      className="relative"
      style={{
        padding: "4px 30px 10px",
        zIndex: 5,
        background: "transparent",
      }}
    >
      {/* 上层：播放控制 —— 对齐唱片中心（左侧 55% 区域的中心 = 27.5%） */}
      <div
        className="flex items-center justify-center"
        style={{
          width: "55%",
          marginBottom: "6px",
          gap: "20px",
        }}
      >
        <IconButton
          glyph="⏮"
          onClick={() =>
            api
              .prevTrack()
              .then((song) => onSongChange(song))
              .catch(() => {})
          }
          label="Previous"
        />
        <PlayButton isPlaying={isPlaying} onClick={togglePlay} />
        <IconButton
          glyph="⏭"
          onClick={() =>
            api
              .nextTrack(false)
              .then((song) => onSongChange(song))
              .catch(() => {})
          }
          label="Next"
        />
      </div>

      {/* 下层：进度条（占唱片区宽度） + 右侧功能按钮 */}
      <div className="flex w-full items-center" style={{ gap: "14px" }}>
        {/* 进度条区域 —— 宽度 = 唱片区 55% */}
        <div
          className="flex items-center"
          style={{ width: "55%", gap: "8px", flexShrink: 0 }}
        >
          <TimeLabel text={formatTime(status.position)} />
          <ProgressBar
            value={progressPercent}
            onSeek={(pct) => api.seek(pct * status.duration).catch(() => {})}
          />
          <TimeLabel text={formatTime(status.duration)} />
        </div>

        {/* 音量 */}
        <VolumeControl
          volume={status.volume}
          open={volOpen}
          onToggle={() => setVolOpen((v) => !v)}
          onChange={(v) => api.setVolume(v).catch(() => {})}
        />

        {/* 模式切换 */}
        <button
          type="button"
          onClick={cycleMode}
          className="flex items-center justify-center"
          style={{
            width: "28px",
            height: "22px",
            background: "transparent",
            color: "var(--theme-playbar-icon)",
            border: "none",
            cursor: "pointer",
            padding: 0,
            opacity: 0.7,
          }}
          aria-label={`Mode: ${mode}`}
        >
          <ModeIcon mode={mode} />
        </button>

        {/* 收藏按钮 */}
        <button
          type="button"
          onClick={toggleLike}
          className="flex items-center justify-center"
          style={{
            width: "22px",
            height: "22px",
            background: "transparent",
            border: "none",
            cursor: currentSong ? "pointer" : "default",
            color: "var(--theme-playbar-icon)",
            padding: 0,
            opacity: currentSong ? 0.7 : 0.3,
          }}
          aria-label={liked ? "取消收藏" : "收藏"}
        >
          <HeartIcon liked={liked} />
        </button>

        {/* 歌曲信息 + 队列 */}
        <div className="relative" ref={queueWrapperRef} style={{ marginLeft: "4px" }}>
          <QueuePopup
            open={queueOpen}
            onJump={jumpToQueueSong}
            onAfterClear={() => setQueueOpen(false)}
          />
          <SongInfoButton
            song={currentSong}
            onClick={() => setQueueOpen((v) => !v)}
          />
        </div>
      </div>
    </div>
  );
}

// ---- subcomponents ---------------------------------------------------------

function HeartIcon({ liked }: { liked: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        fill={liked ? "#e74c5e" : "none"}
        stroke={liked ? "#e74c5e" : "currentColor"}
        style={{ transition: "fill 300ms ease, stroke 300ms ease" }}
      />
    </svg>
  );
}

function TimeLabel({ text }: { text: string }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: "13px",
        color: "var(--theme-playbar-text)",
        minWidth: "34px",
        textAlign: "center",
      }}
    >
      {text}
    </span>
  );
}

function ProgressBar({
  value,
  onSeek,
}: {
  value: number;
  onSeek: (pct: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragging = dragValue !== null;
  const displayValue = dragValue ?? value;

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current) return;
    e.preventDefault();
    const rect = barRef.current.getBoundingClientRect();
    const computePct = (clientX: number) =>
      Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

    setDragValue(computePct(e.clientX) * 100);

    const onMove = (ev: MouseEvent) => {
      setDragValue(computePct(ev.clientX) * 100);
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const finalPct = computePct(ev.clientX);
      setDragValue(null);
      onSeek(finalPct);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={barRef}
      className="group relative"
      style={{
        flex: "1 1 0",
        height: "12px",
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        userSelect: "none",
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "2px",
          borderRadius: "1px",
          background: "var(--theme-playbar-progress-track)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${displayValue}%`,
            height: "100%",
            background: "var(--theme-playbar-progress-fill)",
            borderRadius: "1px",
            transition: dragging ? "none" : "width 150ms linear",
          }}
        />
      </div>
      <div
        className="pointer-events-none group-hover:opacity-100"
        style={{
          position: "absolute",
          left: `${displayValue}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: "var(--theme-playbar-progress-fill)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
          opacity: dragging ? 1 : 0,
          transition: dragging ? "none" : "opacity 120ms ease, left 150ms linear",
        }}
      />
    </div>
  );
}

function IconButton({
  glyph,
  onClick,
  label,
}: {
  glyph: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        fontSize: "18px",
        color: "var(--theme-playbar-icon)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      {glyph}
    </button>
  );
}

function PlayButton({
  isPlaying,
  onClick,
}: {
  isPlaying: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center"
      style={{
        width: "34px",
        height: "34px",
        borderRadius: "50%",
        background: "var(--theme-playbar-btn-bg)",
        border: "var(--theme-playbar-btn-border, none)",
        color: "var(--theme-playbar-btn-color)",
        fontSize: "15px",
        cursor: "pointer",
        padding: 0,
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
      aria-label={isPlaying ? "Pause" : "Play"}
    >
      <span style={{ marginLeft: isPlaying ? 0 : 2 }}>
        {isPlaying ? "⏸" : "▶"}
      </span>
    </button>
  );
}

function VolumeIcon({ volume }: { volume: number }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      {volume >= 5 && (
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      )}
      {volume >= 50 && (
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      )}
      {volume < 5 && (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      )}
    </svg>
  );
}

function ModeIcon({ mode }: { mode: string }) {
  if (mode === "shuffle") {
    return (
      <svg width="22" height="16" viewBox="0 0 32 28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6h4c3 0 5 2 7 8s4 8 7 8h6" />
        <path d="M2 22h4c3 0 5-2 7-8s4-8 7-8h6" />
      </svg>
    );
  }
  if (mode === "repeat_one") {
    return (
      <svg width="22" height="16" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11V9a4 4 0 0 1 4-4h16" />
        <path d="M23 13v2a4 4 0 0 1-4 4H3" />
        <text x="13" y="12" fontSize="9" fill="currentColor" stroke="none" fontWeight="bold" textAnchor="middle" dominantBaseline="central">1</text>
      </svg>
    );
  }
  return (
    <svg width="22" height="16" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11V9a4 4 0 0 1 4-4h16" />
      <path d="M23 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function VolumeControl({
  volume,
  open,
  onToggle,
  onChange,
}: {
  volume: number;
  open: boolean;
  onToggle: () => void;
  onChange: (v: number) => void;
}) {
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-center"
        style={{
          width: "20px",
          height: "20px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--theme-playbar-icon)",
          padding: 0,
          opacity: 0.7,
        }}
        aria-label="Volume"
      >
        <VolumeIcon volume={volume} />
      </button>
      {open && (
        <div
          className="absolute"
          style={{
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: "10px",
            padding: "14px 10px",
            borderRadius: "10px",
            background: "var(--theme-cabinet-bg)",
            boxShadow:
              "0 12px 28px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
            border: "1px solid rgba(0,0,0,0.4)",
            zIndex: 20,
          }}
        >
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{
              writingMode: "vertical-lr" as never,
              direction: "rtl",
              width: "24px",
              height: "90px",
            }}
          />
        </div>
      )}
    </div>
  );
}

function SongInfoButton({
  song,
  onClick,
}: {
  song: Song | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center transition-all hover:scale-[1.02]"
      style={{
        gap: "10px",
        padding: "4px 8px 4px 4px",
        borderRadius: "8px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        minWidth: "200px",
        maxWidth: "260px",
      }}
      aria-label="Open queue"
    >
      <div
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "4px",
          overflow: "hidden",
          flexShrink: 0,
          background: "rgba(0,0,0,0.3)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
        }}
      >
        {song?.cover_url && (
          <img
            src={song.cover_url}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>
      <div
        className="flex flex-col overflow-hidden text-left"
        style={{ flex: 1 }}
      >
        <span
          className="truncate"
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--theme-lyrics-title)",
            lineHeight: 1.2,
          }}
        >
          {song?.name ?? "—"}
        </span>
        <span
          className="truncate font-mono"
          style={{
            fontSize: "10px",
            color: "var(--theme-playbar-text)",
            opacity: 0.8,
            lineHeight: 1.3,
            marginTop: "2px",
          }}
        >
          {song?.artist ?? "nothing playing"}
        </span>
      </div>
    </button>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
