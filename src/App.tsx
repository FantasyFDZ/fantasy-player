// 主界面 —— 按 gramophone-final-v7.html 的 .scene 结构组装。
//
// 原型 scene：
//   position: relative; overflow: hidden;
//   display: flex; gap: 40px; align-items: center;
//   内部：god-rays + ambient-glows + dust + gramophone + lyrics-panel + playbar
//
// 我的适配：
//   - 顶部 header（无标题栏拖拽 + MELODY popover + search/account）
//   - scene 占满剩余高度
//   - scene 内部：LightLayer（absolute 全覆盖）+ gramophone + lyrics-panel + playbar

import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { VinylDisc } from "@/core/VinylDisc/VinylDisc";
import { useAlbumColor } from "@/core/VinylDisc/useAlbumColor";
import { applyDynamicTheme } from "@/themes/dynamicTheme";
import { Lyrics } from "@/core/Lyrics/Lyrics";
import { ThemeProvider } from "@/core/ThemeProvider/ThemeProvider";
import { PanelProvider, usePanels } from "@/core/PanelManager/PanelProvider";
import { PanelWindow } from "@/core/PanelManager/PanelWindow";
import { PlayBar } from "@/components/PlayBar";
import { SearchPanel } from "@/components/SearchPanel";
import { PlaylistPanel } from "@/components/PlaylistPanel";
import { LoginPanel } from "@/components/LoginPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useQueuePreAnalyze } from "@/hooks/useQueuePreAnalyze";
import { PANEL_PLUGINS } from "@/plugins";
import {
  api,
  onPlaybackUpdate,
  type Song,
  type UserProfile,
} from "@/lib/api";

type Overlay = "none" | "playlist" | "search" | "account" | "settings";

export default function App() {
  // URL query ?panel=<id> 指定这是一个面板窗口
  const params = new URLSearchParams(window.location.search);
  const panelId = params.get("panel");

  return (
    <ThemeProvider>
      {panelId ? (
        <PanelWindow panelId={panelId} />
      ) : (
        <PanelProvider plugins={PANEL_PLUGINS}>
          <Shell />
        </PanelProvider>
      )}
    </ThemeProvider>
  );
}

function Shell() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const panels = usePanels();

  // 从封面提取主色 → 驱动全局配色 + 广播给面板窗口
  const albumColor = useAlbumColor(currentSong?.cover_url);
  useEffect(() => {
    applyDynamicTheme(albumColor);
    emit("melody://album-color", albumColor);
  }, [albumColor]);

  // 面板窗口打开时主动请求当前颜色 → 回复
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("melody://album-color-request", () => {
        emit("melody://album-color-reply", albumColor);
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  });

  // 队列预分析：后台提前提取音频特征，播放时只需等 LLM 文字生成
  useQueuePreAnalyze();

  useEffect(() => {
    api.session().then((session) => {
      if (session.user) setUser(session.user);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onPlaybackUpdate((status) => {
      if (!cancelled) setPlaying(status.state === "playing");
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handlePlay = useCallback(async (song: Song, queue: Song[]) => {
    // 先调后端 —— 只有后端确认成功（URL 拿到、mpv 加载成功）之后
    // 才更新 UI 的 currentSong，避免 UI 显示一首歌而实际播放另一首。
    try {
      await api.queueReplace(queue, 0);
      setCurrentSong(song);
      setOverlay("none");
    } catch (err) {
      console.error("播放失败:", err);
      // UI 保持不变 —— 继续显示上一首正在播放的歌
    }
  }, []);

  const handleAddToQueue = useCallback(async (song: Song) => {
    try {
      await api.queueAppend(song);
    } catch (err) {
      console.error("加入队列失败:", err);
    }
  }, []);

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden"
      style={{
        // 整个主窗口单一背景色，LightLayer 覆盖全窗口保证光效一致
        background: "var(--theme-bg)",
      }}
    >
      {/* 顶部栏 */}
      <header
          className="relative flex items-center justify-between px-8 py-3"
          style={{ zIndex: 20 }}
          data-tauri-drag-region
        >
          {/* 左侧：账号（原 BrandMenu 位置） */}
          <div style={{ pointerEvents: "auto" }}>
            <HeaderButton
              active={overlay === "account"}
              onClick={() =>
                setOverlay((o) => (o === "account" ? "none" : "account"))
              }
              label={user ? user.nickname : "登录"}
            />
          </div>
          <div
            className="flex items-center gap-4"
            style={{ pointerEvents: "auto" }}
          >
            <HeaderButton
              active={overlay === "playlist"}
              onClick={() =>
                setOverlay((o) => (o === "playlist" ? "none" : "playlist"))
              }
              label="歌单"
            />
            <HeaderButton
              active={overlay === "search"}
              onClick={() =>
                setOverlay((o) => (o === "search" ? "none" : "search"))
              }
              label="搜索"
            />
            <HeaderButton
              active={panels.isOpen("music_analysis")}
              onClick={() => panels.toggle("music_analysis")}
              label="情绪"
            />
            {/* 窗口控制：设置 + 最小化 + 关闭 */}
            <div
              className="flex items-center"
              style={{ gap: 4, marginLeft: 8 }}
            >
              <WindowButton
                onClick={() =>
                  setOverlay((o) => (o === "settings" ? "none" : "settings"))
                }
                glyph="⚙"
                hoverColor="rgba(255,255,255,0.1)"
                label="模型设置"
              />
              <WindowButton
                onClick={() => getCurrentWindow().minimize()}
                glyph="−"
                hoverColor="rgba(255,255,255,0.1)"
                label="最小化"
              />
              <WindowButton
                onClick={() => getCurrentWindow().close()}
                glyph="✕"
                hoverColor="rgba(255, 80, 80, 0.7)"
                label="关闭"
              />
            </div>
          </div>
        </header>

        {/* scene —— 整个主舞台 */}
        <main
          className="relative flex-1 overflow-hidden"
          style={{ padding: "20px" }}
        >
          <div
            className="relative flex h-full"
            style={{ zIndex: 3 }}
          >
            {/* 左侧：唱片 */}
            <div
              className="flex items-center justify-center"
              style={{ width: "55%" }}
            >
              <VinylDisc
                coverUrl={currentSong?.cover_url}
                playing={playing}
              />
            </div>
            {/* 右侧：歌词 */}
            <div
              className="flex flex-col"
              style={{ width: "45%", paddingLeft: "20px" }}
            >
              <Lyrics song={currentSong} />
            </div>
          </div>
        </main>

        {/* PlayBar */}
        <PlayBar currentSong={currentSong} onSongChange={setCurrentSong} />

      {/* overlay */}
      {overlay !== "none" && (
        <Overlay onClose={() => setOverlay("none")}>
          {overlay === "playlist" && (
            <PlaylistPanel
              onPlay={handlePlay}
              onAddToQueue={handleAddToQueue}
            />
          )}
          {overlay === "search" && (
            <SearchPanel onPlay={handlePlay} onAddToQueue={handleAddToQueue} />
          )}
          {overlay === "account" && (
            <LoginPanel
              user={user}
              onLogin={(u) => {
                setUser(u);
                setOverlay("none");
              }}
              onLogout={() => setUser(null)}
            />
          )}
          {overlay === "settings" && <SettingsPanel />}
        </Overlay>
      )}

    </div>
  );
}

function HeaderButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="transition-all"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.18em",
        fontSize: "11px",
        textTransform: "uppercase",
        padding: "6px 12px",
        borderRadius: "999px",
        color: active ? "var(--theme-accent)" : "var(--theme-text-muted)",
        background: active ? "rgba(255,255,255,0.06)" : "transparent",
        border:
          "1px solid " + (active ? "var(--theme-accent)" : "transparent"),
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function WindowButton({
  onClick,
  glyph,
  hoverColor,
  label,
}: {
  onClick: () => void;
  glyph: string;
  hoverColor: string;
  label: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={label}
      className="transition-all"
      style={{
        width: 28,
        height: 22,
        borderRadius: 4,
        background: hovered ? hoverColor : "transparent",
        border: "none",
        color: hovered && glyph === "✕" ? "#fff" : "var(--theme-text-muted)",
        fontSize: 13,
        lineHeight: 1,
        cursor: "pointer",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {glyph}
    </button>
  );
}

function Overlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        zIndex: 30,
        background: "var(--theme-bg)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative"
        style={{
          width: "580px",
          maxWidth: "calc(100% - 4rem)",
          maxHeight: "80vh",
          padding: "28px",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute"
          style={{
            right: "16px",
            top: "16px",
            width: "26px",
            height: "26px",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.06)",
            color: "var(--theme-text-muted)",
            fontSize: "11px",
            cursor: "pointer",
          }}
          aria-label="关闭"
        >
          ✕
        </button>
        <div style={{ height: "70vh", overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}
