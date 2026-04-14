// 音绪面板 —— 三段式布局（从上到下）：
//   1. 指标条（风格 + BPM / Key / 能量 / 情绪 单行并排，BPM 可点击编辑）
//   2. 云抑热评
//   3. 独白（可滚动，带刷新按钮）

import { useState } from "react";
import { useAudioFeatures } from "@/hooks/useAudioFeatures";
import type { Song } from "@/lib/api";
import { CommentsSection } from "./CommentsSection";
import { MetricsStrip } from "./MetricsStrip";
import { MonologueSection } from "./MonologueSection";

interface Props {
  song: Song | null;
}

export function MusicAnalysis({ song }: Props) {
  const { features, songId, setFeatures } = useAudioFeatures(song);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="relative flex h-full flex-col">
      {/* 1. 指标条：风格 + BPM/Key/能量/情绪 单行并排 */}
      <div style={{ flexShrink: 0, padding: "0 2px" }}>
        <MetricsStrip
          features={features}
          songId={songId}
          onFeaturesUpdate={setFeatures}
        />
      </div>

      {/* 2. 云抑热评 —— 上方 2 行间距 */}
      <div
        style={{
          flexShrink: 0,
          marginTop: 32,
          padding: "0 2px",
        }}
      >
        <CommentsSection song={song} />
      </div>

      {/* 3. 独白（可滚动，占剩余空间） —— 上方 2 行间距 */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          padding: "0 2px",
          marginTop: 32,
          minHeight: 0,
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ marginBottom: 8 }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--theme-label)",
              filter: "brightness(1.4)",
              fontFamily: "var(--font-display)",
              letterSpacing: "0.1em",
            }}
          >
            独白
          </span>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="重新生成"
            className="flex items-center justify-center transition-all hover:scale-110"
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(0,0,0,0.45)",
              color: "var(--theme-label)",
              filter: "brightness(1.4)",
              fontSize: 12,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ↻
          </button>
        </div>
        <MonologueSection song={song} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
