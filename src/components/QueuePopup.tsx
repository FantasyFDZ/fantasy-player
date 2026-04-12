// 播放列表浮层 —— 点击 PlayBar 右侧歌曲信息弹出。
// 显示当前队列，当前播放行高亮，点击其他行跳转。

import { useEffect, useRef, useState } from "react";
import { api, type QueueSnapshot, type Song } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onJump: (song: Song) => void;
}

export function QueuePopup({ open, onClose, onJump }: Props) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 打开时拉取队列
  useEffect(() => {
    if (!open) return;
    api
      .queueSnapshot()
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟一 tick 以避免触发开启点击立即被判定为"外部"
    const timer = setTimeout(
      () => document.addEventListener("mousedown", onDown),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const tracks = snapshot?.tracks ?? [];
  const currentIdx = snapshot?.current_index ?? null;

  return (
    <div
      ref={containerRef}
      className="absolute"
      style={{
        bottom: "100%",
        right: "20px",
        marginBottom: "14px",
        width: "380px",
        maxHeight: "420px",
        borderRadius: "12px",
        background: "var(--theme-cabinet-bg)",
        boxShadow:
          "0 24px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
        border: "1px solid rgba(0,0,0,0.4)",
        overflow: "hidden",
        zIndex: 40,
      }}
    >
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid rgba(0,0,0,0.3)",
        }}
      >
        <div
          className="font-mono"
          style={{
            fontSize: "10px",
            letterSpacing: "0.24em",
            color: "var(--theme-label)",
            filter: "brightness(1.4)",
            textTransform: "uppercase",
          }}
        >
          Queue · {tracks.length}
        </div>
        <button
          type="button"
          onClick={() => {
            api.queueClear().catch(() => {});
            onClose();
          }}
          className="font-mono"
          style={{
            fontSize: "9px",
            letterSpacing: "0.12em",
            padding: "3px 8px",
            borderRadius: "4px",
            color: "var(--theme-playbar-text)",
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(0,0,0,0.45)",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          clear
        </button>
      </div>

      {/* 列表 */}
      <div
        style={{
          maxHeight: "360px",
          overflowY: "auto",
          padding: "6px 8px",
        }}
      >
        {tracks.length === 0 ? (
          <div
            className="text-center"
            style={{
              padding: "32px 16px",
              fontSize: "12px",
              color: "var(--theme-playbar-text)",
              opacity: 0.7,
            }}
          >
            暂无播放队列
          </div>
        ) : (
          tracks.map((song, i) => {
            const active = i === currentIdx;
            return (
              <button
                key={`${song.id}-${i}`}
                type="button"
                onClick={() => {
                  onJump(song);
                }}
                className="flex w-full items-center gap-3 transition-colors"
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  background: active ? "rgba(0,0,0,0.4)" : "transparent",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: "10px",
                    width: "22px",
                    color: active
                      ? "var(--theme-accent)"
                      : "var(--theme-playbar-text)",
                  }}
                >
                  {active ? "▶" : i + 1}
                </span>
                {song.cover_url && (
                  <img
                    src={song.cover_url}
                    alt=""
                    className="rounded-sm"
                    style={{
                      width: "32px",
                      height: "32px",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.5)",
                    }}
                  />
                )}
                <div className="flex-1 overflow-hidden">
                  <div
                    className="truncate"
                    style={{
                      fontSize: "12px",
                      color: active
                        ? "var(--theme-lyrics-active)"
                        : "var(--theme-lyrics-title)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {song.name}
                  </div>
                  <div
                    className="truncate font-mono"
                    style={{
                      fontSize: "10px",
                      color: "var(--theme-playbar-text)",
                      opacity: 0.7,
                    }}
                  >
                    {song.artist}
                  </div>
                </div>
                <span
                  className="font-mono"
                  style={{
                    fontSize: "10px",
                    color: "var(--theme-playbar-text)",
                    opacity: 0.5,
                  }}
                >
                  {formatDuration(song.duration_secs)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
