// 面板独立窗口的根组件。
//
// 当 App.tsx 检测到 URL query `?panel=<id>` 时，渲染这个组件
// 而不是主 Shell。它负责：
//   - 按 id 查找 plugin 并渲染其 component
//   - 订阅 melody://song-changed 事件跟踪当前歌
//   - 启动时从 queue_snapshot() 获取初始歌
//   - 提供迷你标题栏（drag region + 关闭按钮）因为窗口 decorations=false

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  api,
  onPlaybackUpdate,
  onSongChanged,
  type Song,
} from "@/lib/api";
import { PANEL_PLUGINS } from "@/plugins";

interface Props {
  panelId: string;
}

export function PanelWindow({ panelId }: Props) {
  const plugin = PANEL_PLUGINS.find((p) => p.id === panelId);
  const [song, setSong] = useState<Song | null>(null);

  // 启动时拉当前歌 + 订阅变化。
  //
  // 跨窗口事件传递在某些 Tauri 版本上不完全可靠，所以用两条路线：
  //   1. 主路线：melody://song-changed 事件（后端切歌时广播 Song）
  //   2. 兜底：melody://playback-update 每 ~400ms 触发一次，
  //      节流到 1.5 秒调一次 queueSnapshot 检查 id 是否变化
  useEffect(() => {
    let cancelled = false;
    let lastKnownId: string | null = null;
    let lastCheckTs = 0;

    const refreshFromSnapshot = async () => {
      try {
        const snap = await api.queueSnapshot();
        if (cancelled) return;
        const next =
          snap.current_index !== null
            ? (snap.tracks[snap.current_index] ?? null)
            : null;
        const nextId = next?.id ?? null;
        if (nextId !== lastKnownId) {
          lastKnownId = nextId;
          setSong(next);
        }
      } catch {
        /* ignore */
      }
    };

    refreshFromSnapshot();

    const listeners: Array<() => void> = [];

    // 主路线
    onSongChanged((s) => {
      if (cancelled) return;
      lastKnownId = s.id;
      setSong(s);
    })
      .then((fn) => listeners.push(fn))
      .catch(() => {});

    // 兜底
    onPlaybackUpdate(() => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastCheckTs < 1500) return;
      lastCheckTs = now;
      refreshFromSnapshot();
    })
      .then((fn) => listeners.push(fn))
      .catch(() => {});

    return () => {
      cancelled = true;
      listeners.forEach((fn) => fn());
    };
  }, []);

  if (!plugin) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{
          background: "var(--theme-bg)",
          color: "var(--theme-text, #fff)",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
        }}
      >
        未知面板 id：{panelId}
      </div>
    );
  }

  const Component = plugin.component;

  return (
    <div
      className="flex h-screen flex-col"
      style={{
        background: "var(--theme-bg, #0b0d11)",
        color: "var(--theme-text, #e6e6e6)",
        fontFamily: "var(--font-ui)",
        overflow: "hidden",
      }}
    >
      {/* 迷你标题栏 —— 可拖拽 + 显示面板名 + 关闭按钮 */}
      <div
        className="relative flex items-center justify-between"
        data-tauri-drag-region
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid rgba(0,0,0,0.3)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.04), transparent)",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2"
          style={{ pointerEvents: "none" }}
        >
          <span style={{ fontSize: 13 }}>{plugin.icon}</span>
          <span
            className="font-display"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--theme-label)",
              filter: "brightness(1.4)",
              letterSpacing: "0.1em",
            }}
          >
            {plugin.name}
          </span>
        </div>
        <button
          type="button"
          onClick={() => getCurrentWindow().close()}
          className="flex items-center justify-center transition-all hover:scale-110"
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(0,0,0,0.55)",
            color: "var(--theme-label)",
            fontSize: 9,
            cursor: "pointer",
            padding: 0,
            filter: "brightness(1.4)",
          }}
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 内容区 */}
      <div style={{ padding: "14px 16px", flex: 1, overflow: "auto" }}>
        <Component song={song} />
      </div>
    </div>
  );
}
