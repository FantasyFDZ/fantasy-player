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
import { Gramophone } from "@/core/Gramophone/Gramophone";
import { Lyrics } from "@/core/Lyrics/Lyrics";
import { ThemeProvider } from "@/core/ThemeProvider/ThemeProvider";
import { LightLayer } from "@/core/ThemeProvider/LightLayer";
import { PanelProvider } from "@/core/PanelManager/PanelProvider";
import { PanelWindow } from "@/core/PanelManager/PanelWindow";
import { PlayBar } from "@/components/PlayBar";
import { SearchPanel } from "@/components/SearchPanel";
import { LoginPanel } from "@/components/LoginPanel";
import { BrandMenu } from "@/components/BrandMenu";
import { PANEL_PLUGINS } from "@/plugins";
import {
  api,
  onPlaybackUpdate,
  type Song,
  type UserProfile,
} from "@/lib/api";

type Overlay = "none" | "search" | "account";

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

  // 窗口默认尺寸 1050×700 + minWidth/minHeight 同值锁定，
  // 见 tauri.conf.json —— 可以向上放大，不能缩小到 1050×700 以下。

  useEffect(() => {
    api.session().then((session) => {
      if (session.user) setUser(session.user);
    });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onPlaybackUpdate((status) => {
      setPlaying(status.state === "playing");
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
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

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      {/* 顶部栏 */}
      <header
        className="relative flex items-center justify-between px-8 py-3"
        style={{ zIndex: 20 }}
        data-tauri-drag-region
      >
        <div style={{ pointerEvents: "auto" }}>
          <BrandMenu />
        </div>
        <div
          className="flex items-center gap-4"
          style={{ pointerEvents: "auto" }}
        >
          <HeaderButton
            active={overlay === "search"}
            onClick={() =>
              setOverlay((o) => (o === "search" ? "none" : "search"))
            }
            label="搜索"
          />
          <HeaderButton
            active={overlay === "account"}
            onClick={() =>
              setOverlay((o) => (o === "account" ? "none" : "account"))
            }
            label={user ? user.nickname : "登录"}
          />
        </div>
      </header>

      {/* scene —— 整个主舞台 */}
      <main
        className="relative flex-1 overflow-hidden"
        style={{
          // 左右对称小 padding：gramophone 保持在自然左位，
          // 内容整体不偏移。只有 lyrics 子元素靠右。
          padding: "20px 20px 20px 20px",
        }}
      >
        {/* 光线层 */}
        <LightLayer />

        {/* 内容：gramophone 固定左位；lyrics 绝对定位到中线右侧 240px
            —— 强制独立布局，不再依赖 flex 自动分配 */}
        <div className="relative h-full" style={{ zIndex: 3 }}>
          {/* 所有位置均基于 1290px 基准，换算为 vw 比例，
              保证窗口缩放时整体同步等比移动。
              基准（vw=1290）：
                gramophone 窗口 x = 200 → 15.504vw
                lyrics     窗口 x = 750 → 58.140vw
                lyrics 宽度        = 480 → 37.209vw
              减去 main 的 padding-left 20px 得到容器内偏移。*/}
          <div
            className="absolute flex items-center"
            style={{
              // 13.599vw - 1.905vw (= -20px at 1050) = 11.694vw
              left: "calc(11.694vw - 20px)",
              top: 0,
              bottom: 0,
            }}
          >
            <Gramophone coverUrl={currentSong?.cover_url} playing={playing} />
          </div>
          <div
            className="absolute flex flex-col"
            style={{
              // 60.045vw - 1.905vw (= -20px at 1050) = 58.140vw
              left: "calc(60.045vw - 20px)",
              width: "37.209vw",
              top: 0,
              bottom: 0,
            }}
          >
            <Lyrics song={currentSong} />
          </div>
        </div>
      </main>

      {/* PlayBar —— root flex 子节点，保证全窗口宽度 */}
      <PlayBar currentSong={currentSong} onSongChange={setCurrentSong} />

      {/* overlay */}
      {overlay !== "none" && (
        <Overlay onClose={() => setOverlay("none")}>
          {overlay === "search" && <SearchPanel onPlay={handlePlay} />}
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
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
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
          maxHeight: "72vh",
          padding: "28px",
          borderRadius: "16px",
          background: "var(--theme-cabinet-bg)",
          boxShadow: "var(--theme-cabinet-shadow)",
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
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(0,0,0,0.4)",
            color: "var(--theme-label)",
            fontSize: "11px",
            cursor: "pointer",
          }}
          aria-label="关闭"
        >
          ✕
        </button>
        <div style={{ height: "60vh", overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}
