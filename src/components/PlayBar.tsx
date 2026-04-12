// 底部播放条。
//
// 布局（从左到右）：
//   [time] [progress bar] [time] | [prev][play][next] | [vol btn popover] | [mode btn] | [cover][title/artist → queue]
//
// 设计原则：
//   - 不使用斜体
//   - 主题色驱动（--theme-playbar-*）
//   - 半透明毛玻璃背景

import { useEffect, useState } from "react";
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

  useEffect(() => {
    let unlistenUpdate: (() => void) | undefined;
    let unlistenEnded: (() => void) | undefined;
    onPlaybackUpdate(setStatus).then((fn) => (unlistenUpdate = fn));
    onTrackEnded(() => {
      api
        .nextTrack(true)
        .then((song) => onSongChange(song))
        .catch(() => {});
    }).then((fn) => (unlistenEnded = fn));
    return () => {
      unlistenUpdate?.();
      unlistenEnded?.();
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

  const modeGlyph =
    mode === "sequential" ? "↻" : mode === "shuffle" ? "⇌" : "①";

  const jumpToQueueSong = (song: Song) => {
    api
      .queueSnapshot()
      .then((snap) => {
        const idx = snap.tracks.findIndex((t) => t.id === song.id);
        if (idx < 0) throw new Error("song not in queue");
        return api.queueReplace(snap.tracks, idx);
      })
      .then(() => {
        // queueReplace 成功后才同步 UI，保持显示 = 实际播放
        onSongChange(song);
        setQueueOpen(false);
      })
      .catch((err) => {
        console.error("跳转失败:", err);
      });
  };

  return (
    <div
      className="relative flex items-center"
      style={{
        padding: "10px 30px",
        gap: "14px",
        zIndex: 5,
        background: "var(--theme-playbar-bg)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      {/* 时间 · 进度条 · 时间 */}
      <TimeLabel text={formatTime(status.position)} />
      <ProgressBar
        value={progressPercent}
        onSeek={(pct) => api.seek(pct * status.duration).catch(() => {})}
      />
      <TimeLabel text={formatTime(status.duration)} />

      {/* 主控（上一首 / 播放 / 下一首） */}
      <div className="flex items-center" style={{ gap: "14px" }}>
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

      {/* 音量（按钮 + hover popover 滑块） */}
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
          width: "26px",
          height: "26px",
          borderRadius: "50%",
          background: "transparent",
          color: "var(--theme-playbar-icon)",
          fontSize: "14px",
          border: "1px solid rgba(255,255,255,0.08)",
          cursor: "pointer",
          padding: 0,
        }}
        aria-label={`Mode: ${mode}`}
      >
        {modeGlyph}
      </button>

      {/* 右侧：歌曲信息按钮 + 队列 popup */}
      <div className="relative">
        <QueuePopup
          open={queueOpen}
          onClose={() => setQueueOpen(false)}
          onJump={jumpToQueueSong}
        />
        <SongInfoButton
          song={currentSong}
          onClick={() => setQueueOpen((v) => !v)}
        />
      </div>
    </div>
  );
}

// ---- subcomponents ---------------------------------------------------------

function TimeLabel({ text }: { text: string }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: "10px",
        color: "var(--theme-playbar-text)",
        minWidth: "28px",
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
  return (
    <div
      className="relative flex-1 cursor-pointer"
      style={{
        height: "2px",
        borderRadius: "1px",
        overflow: "hidden",
        background: "var(--theme-playbar-progress-track)",
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek((e.clientX - rect.left) / rect.width);
      }}
    >
      <div
        style={{
          width: `${value}%`,
          height: "100%",
          background: "var(--theme-playbar-progress-fill)",
          borderRadius: "1px",
          transition: "width 150ms linear",
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
        fontSize: "13px",
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
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        background: "var(--theme-playbar-btn-bg)",
        border: "var(--theme-playbar-btn-border, none)",
        color: "var(--theme-playbar-btn-color)",
        fontSize: "10px",
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
  const icon = volume < 5 ? "🔇" : volume < 50 ? "🔈" : "🔊";
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-center"
        style={{
          width: "26px",
          height: "26px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--theme-playbar-icon)",
          fontSize: "12px",
          padding: 0,
          lineHeight: 1,
        }}
        aria-label="Volume"
      >
        {icon}
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
              // 竖直音量滑块
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
        border: "1px solid rgba(255,255,255,0.06)",
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
