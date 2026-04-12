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
import { api, onSongChanged, type Song } from "@/lib/api";
import { PANEL_PLUGINS } from "@/plugins";

interface Props {
  panelId: string;
}

export function PanelWindow({ panelId }: Props) {
  const plugin = PANEL_PLUGINS.find((p) => p.id === panelId);
  const [song, setSong] = useState<Song | null>(null);

  // 启动时拉当前歌，并订阅后续变化
  useEffect(() => {
    let cancelled = false;

    api
      .queueSnapshot()
      .then((snap) => {
        if (cancelled) return;
        if (snap.current_index !== null && snap.tracks[snap.current_index]) {
          setSong(snap.tracks[snap.current_index]);
        }
      })
      .catch(() => {});

    let unlisten: (() => void) | undefined;
    onSongChanged((s) => {
      if (!cancelled) setSong(s);
    }).then((fn) => (unlisten = fn));

    return () => {
      cancelled = true;
      unlisten?.();
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
