// 聚合面板 —— 三个 tab：解析 / 氛围 / 网抑云
// 右上角齿轮 ⚙ 打开模型设置 modal（覆盖在当前 tab 之上）
//
// 打开方式：主窗口右边缘的展开开关。窗口吸附到主窗口右侧，
// 高度与主窗口一致。

import { useState } from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import type { Song } from "@/lib/api";
import { CommentsSection } from "./CommentsSection";
import { MonologueSection } from "./MonologueSection";

interface Props {
  song: Song | null;
}

type Tab = "monologue" | "comments";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "monologue", label: "独白" },
  { id: "comments", label: "网抑云" },
];

export function MusicAnalysis({ song }: Props) {
  const [tab, setTab] = useState<Tab>("monologue");
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="relative flex h-full flex-col">
      {/* 顶部 tab 栏 —— 左边 3 个 tab，右边齿轮 */}
      <div
        className="flex items-center"
        style={{
          marginBottom: 12,
          gap: 6,
        }}
      >
        <div
          className="flex flex-1 gap-1"
          style={{
            padding: 4,
            borderRadius: 8,
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(0,0,0,0.45)",
          }}
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="flex-1 transition-all"
                style={{
                  padding: "6px 10px",
                  borderRadius: 5,
                  fontSize: 12,
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                  color: active
                    ? "var(--theme-accent)"
                    : "var(--theme-lyrics-mid)",
                  background: active
                    ? "rgba(255,255,255,0.08)"
                    : "transparent",
                  border: active
                    ? "1px solid var(--theme-accent)"
                    : "1px solid transparent",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
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

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "4px 2px" }}>
        {tab === "monologue" && <MonologueSection song={song} />}
        {tab === "comments" && <CommentsSection song={song} />}
      </div>

      {/* 设置 modal —— 覆盖整个面板内容 */}
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
