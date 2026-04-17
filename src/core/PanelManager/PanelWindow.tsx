// 面板独立窗口的根组件。

import { useEffect, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  api,
  onPlaybackUpdate,
  onSongChanged,
  type Song,
} from "@/lib/api";
import { PANEL_PLUGINS } from "@/plugins";
import { applyDynamicTheme } from "@/themes/dynamicTheme";
import type { AlbumColor } from "@/core/VinylDisc/useAlbumColor";

interface Props {
  panelId: string;
}

export function PanelWindow({ panelId }: Props) {
  const plugin = PANEL_PLUGINS.find((p) => p.id === panelId);
  const [song, setSong] = useState<Song | null>(null);

  // 动态配色
  // 1. 先试 localStorage 快速路径（同 origin 时可避免首帧蓝色闪烁）
  // 2. 主动 emit 请求，主窗口会立刻 reply 当前颜色（兜底 —— Tauri 的
  //    多 webview window 并不保证共享 localStorage）
  // 3. 持续 listen 主窗口广播的颜色更新
  useEffect(() => {
    try {
      const raw = localStorage.getItem("melody.album-color");
      if (raw) applyDynamicTheme(JSON.parse(raw) as AlbumColor);
    } catch {}

    const unlisteners: Array<() => void> = [];
    listen<AlbumColor>("melody://album-color", (event) => {
      applyDynamicTheme(event.payload);
    }).then((fn) => unlisteners.push(fn));
    listen<AlbumColor>("melody://album-color-reply", (event) => {
      applyDynamicTheme(event.payload);
    }).then((fn) => unlisteners.push(fn));

    // 等 listener 挂好再 emit 请求（reply 用的是新频道，不会被自己当回声吃掉）
    window.setTimeout(() => emit("melody://album-color-request"), 50);

    return () => unlisteners.forEach((fn) => fn());
  }, []);

  // 窗口 resize / move → 500ms 去抖后持久化几何
  useEffect(() => {
    const win = getCurrentWindow();
    let timer: number | undefined;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        api.panelPersistGeometry(panelId).catch(() => {});
      }, 500);
    };
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    win.onResized(schedule).then((fn) => { unlistenResize = fn; }).catch(() => {});
    win.onMoved(schedule).then((fn) => { unlistenMove = fn; }).catch(() => {});
    return () => {
      if (timer) window.clearTimeout(timer);
      unlistenResize?.();
      unlistenMove?.();
    };
  }, [panelId]);

  // 启动时拉当前歌 + 订阅变化。
  useEffect(() => {
    let cancelled = false;
    let lastKnownId: string | null = null;
    let lastCheckTs = 0;

    const applySong = (next: Song | null) => {
      const nextId = next?.id ?? null;
      if (nextId === lastKnownId) return;
      lastKnownId = nextId;
      setSong(next);
    };

    const refreshFromSnapshot = async () => {
      try {
        const snap = await api.queueSnapshot();
        if (cancelled) return;
        const next =
          snap.current_index !== null
            ? (snap.tracks[snap.current_index] ?? null)
            : null;
        applySong(next);
      } catch {
        /* ignore */
      }
    };

    refreshFromSnapshot();

    const listeners: Array<() => void> = [];

    onSongChanged((s) => {
      if (cancelled) return;
      applySong(s);
      window.setTimeout(() => {
        if (!cancelled) refreshFromSnapshot();
      }, 250);
    })
      .then((fn) => listeners.push(fn))
      .catch(() => {});

    onPlaybackUpdate(() => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastCheckTs < 500) return;
      lastCheckTs = now;
      refreshFromSnapshot();
    })
      .then((fn) => listeners.push(fn))
      .catch(() => {});

    const pollTimer = window.setInterval(() => {
      if (!cancelled) refreshFromSnapshot();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
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
      {/* 拖拽区（无关闭按钮） */}
      <div
        data-tauri-drag-region
        style={{
          padding: "8px 14px",
          userSelect: "none",
          flexShrink: 0,
        }}
      />

      {/* 内容区 */}
      <div style={{ padding: "14px 16px", flex: 1, overflow: "auto" }}>
        <Component song={song} />
      </div>
    </div>
  );
}
