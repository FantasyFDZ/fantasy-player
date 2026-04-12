// 聚合面板 —— 一个窗口，四个 tab：
//   音乐特征 / AI 短评 / 热评 / 设置
//
// 打开方式：主窗口右边缘的展开开关。窗口吸附到主窗口右边，
// 高度与主窗口一致。

import { useState } from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import type { Song } from "@/lib/api";
import { CommentsSection } from "./CommentsSection";
import { FeaturesSection } from "./FeaturesSection";
import { LlmReviewSection } from "./LlmReviewSection";

interface Props {
  song: Song | null;
}

type Tab = "features" | "review" | "comments" | "settings";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "features", label: "音乐特征" },
  { id: "review", label: "AI 短评" },
  { id: "comments", label: "网友热评" },
  { id: "settings", label: "模型设置" },
];

export function MusicAnalysis({ song }: Props) {
  const [tab, setTab] = useState<Tab>("features");

  return (
    <div className="flex h-full flex-col">
      {/* 顶部 tab 栏 */}
      <div
        className="flex gap-1"
        style={{
          marginBottom: 12,
          padding: "4px",
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
                fontSize: 11,
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

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {tab === "features" && <FeaturesSection song={song} />}
        {tab === "review" && <LlmReviewSection song={song} />}
        {tab === "comments" && <CommentsSection song={song} />}
        {tab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}
