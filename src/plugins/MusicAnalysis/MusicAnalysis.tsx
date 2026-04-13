// 音绪面板 —— 三段式布局：
//   上：独白（可滚动）
//   中：云抑（固定位置）
//   底：音频指标条（固定底部）
//
// 右上角齿轮 ⚙ 打开模型设置 modal

import { useState } from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import type { Song } from "@/lib/api";
import { CommentsSection } from "./CommentsSection";
import { MetricsStrip, MonologueSection } from "./MonologueSection";

interface Props {
  song: Song | null;
}

export function MusicAnalysis({ song }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { features } = useAudioFeatures(song);

  return (
    <div className="relative flex h-full flex-col">
      {/* 顶栏 —— 齿轮 */}
      <div
        className="flex items-center justify-end"
        style={{ marginBottom: 8, flexShrink: 0 }}
      >
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="模型设置"
          className="flex items-center justify-center transition-all hover:scale-110"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(0,0,0,0.45)",
            color: "var(--theme-label)",
            filter: "brightness(1.4)",
            fontSize: 14,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ⚙
        </button>
      </div>

      {/* 独白（按内容高度，超出时可滚动，最多占 50%） */}
      <div
        className="overflow-y-auto"
        style={{ padding: "4px 2px", minHeight: 0, maxHeight: "50%" }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: "0.18em",
            color: "var(--theme-label)",
            filter: "brightness(1.4)",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          独白
        </div>
        <MonologueSection song={song} />
      </div>

      {/* 弹性间距 —— 把云抑推到中间 */}
      <div style={{ flex: 1 }} />

      {/* 云抑（固定） */}
      <div style={{ flexShrink: 0, padding: "0 2px" }}>
        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.06)",
            marginBottom: 8,
          }}
        />
        <CommentsSection song={song} />
      </div>

      {/* 弹性间距 —— 把指标条推到底部 */}
      <div style={{ flex: 1 }} />

      {/* 音频指标条（固定底部） */}
      {features && (
        <div style={{ flexShrink: 0, padding: "0 2px" }}>
          <MetricsStrip features={features} />
        </div>
      )}

      {/* 设置 modal */}
      {settingsOpen && (
        <div
          className="absolute inset-0 flex flex-col"
          style={{
            background: "var(--theme-bg, #0b0d11)",
            zIndex: 10,
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{
              padding: "6px 2px 10px",
              marginBottom: 6,
              borderBottom: "1px solid rgba(0,0,0,0.35)",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.18em",
                color: "var(--theme-label)",
                filter: "brightness(1.4)",
                textTransform: "uppercase",
              }}
            >
              Model Settings
            </span>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="flex items-center justify-center"
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(0,0,0,0.55)",
                color: "var(--theme-label)",
                filter: "brightness(1.4)",
                fontSize: 11,
                cursor: "pointer",
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SettingsPanel />
          </div>
        </div>
      )}
    </div>
  );
}
