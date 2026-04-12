// 面板独立窗口的根组件。
//
// 当 App.tsx 检测到 URL query `?panel=<id>` 时，渲染这个组件
// 而不是主 Shell。它负责：
//   - 按 id 查找 plugin 并渲染其 component
//   - 订阅 melody://song-changed 事件跟踪当前歌
//   - 启动时从 queue_snapshot() 获取初始歌
//   - 提供最小的窗口装饰（木纹卡片背景，方便用户识别这是 Melody 面板）

import { useEffect, useState } from "react";
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

    api.queueSnapshot().then((snap) => {
      if (cancelled) return;
      if (snap.current_index !== null && snap.tracks[snap.current_index]) {
        setSong(snap.tracks[snap.current_index]);
      }
    }).catch(() => {});

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
      {/* 内容区：直接 padding 容纳 plugin component */}
      <div style={{ padding: 16, height: "100%", overflow: "auto" }}>
        <Component song={song} />
      </div>
    </div>
  );
}
