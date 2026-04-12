import { useEffect, useState } from "react";
import {
  api,
  onPlaybackUpdate,
  onTrackEnded,
  type PlayMode,
  type PlaybackStatus,
  type Song,
} from "@/lib/api";

interface Props {
  currentSong: Song | null;
}

export function PlayBar({ currentSong }: Props) {
  const [status, setStatus] = useState<PlaybackStatus>({
    state: "idle",
    position: 0,
    duration: 0,
    volume: 100,
  });
  const [mode, setMode] = useState<PlayMode>("sequential");

  // 订阅后端播放事件
  useEffect(() => {
    let unlistenUpdate: (() => void) | undefined;
    let unlistenEnded: (() => void) | undefined;

    onPlaybackUpdate(setStatus).then((fn) => (unlistenUpdate = fn));
    onTrackEnded(() => {
      api.nextTrack(true).catch(() => {});
    }).then((fn) => (unlistenEnded = fn));

    return () => {
      unlistenUpdate?.();
      unlistenEnded?.();
    };
  }, []);

  const isPlaying = status.state === "playing";

  const togglePlay = () => {
    if (isPlaying) api.pause().catch(() => {});
    else api.resume().catch(() => {});
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    api.seek(value).catch(() => {});
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    api.setVolume(value).catch(() => {});
  };

  const cycleMode = () => {
    const nextMode: PlayMode =
      mode === "sequential"
        ? "shuffle"
        : mode === "shuffle"
          ? "repeat_one"
          : "sequential";
    setMode(nextMode);
    api.queueSetMode(nextMode).catch(() => {});
  };

  const modeLabel =
    mode === "sequential" ? "顺序" : mode === "shuffle" ? "随机" : "单曲";

  return (
    <div className="flex items-center gap-4 border-t border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
      {/* song meta */}
      <div className="flex min-w-0 items-center gap-3" style={{ width: 260 }}>
        {currentSong?.cover_url ? (
          <img
            src={currentSong.cover_url}
            alt=""
            className="h-12 w-12 rounded"
          />
        ) : (
          <div className="h-12 w-12 rounded bg-white/5" />
        )}
        <div className="flex-1 overflow-hidden">
          <div className="truncate text-sm font-medium">
            {currentSong?.name ?? "未在播放"}
          </div>
          <div className="truncate text-xs text-white/50">
            {currentSong?.artist ?? ""}
          </div>
        </div>
      </div>

      {/* transport */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => api.prevTrack().catch(() => {})}
          className="rounded bg-white/5 px-3 py-1 text-sm hover:bg-white/10"
        >
          ⏮
        </button>
        <button
          onClick={togglePlay}
          className="rounded bg-white/10 px-4 py-1 text-sm hover:bg-white/20"
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button
          onClick={() => api.nextTrack(false).catch(() => {})}
          className="rounded bg-white/5 px-3 py-1 text-sm hover:bg-white/10"
        >
          ⏭
        </button>
      </div>

      {/* progress */}
      <div className="flex flex-1 items-center gap-2">
        <span className="w-10 text-right text-xs tabular-nums text-white/50">
          {formatTime(status.position)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(status.duration, 1)}
          step={0.1}
          value={Math.min(status.position, status.duration || 1)}
          onChange={handleSeek}
          className="flex-1 accent-emerald-500"
        />
        <span className="w-10 text-xs tabular-nums text-white/50">
          {formatTime(status.duration)}
        </span>
      </div>

      {/* volume */}
      <div className="flex items-center gap-2" style={{ width: 140 }}>
        <span className="text-xs text-white/50">🔊</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={status.volume}
          onChange={handleVolume}
          className="flex-1 accent-emerald-500"
        />
      </div>

      {/* mode */}
      <button
        onClick={cycleMode}
        className="rounded bg-white/5 px-3 py-1 text-xs hover:bg-white/10"
      >
        {modeLabel}
      </button>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
