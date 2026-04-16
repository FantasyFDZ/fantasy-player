// 音频指标条 —— 单行五列：
//   左侧：风格（大字，占主要宽度）
//   右侧：BPM / Key / 能量 / 情绪（小字，均分剩余宽度）
//
// BPM 可点击编辑：点击后变为输入框，Enter 确认写回数据库。
// 没有数据时显示占位符 "—"，保持标题可见。

import { useEffect, useState } from "react";
import { api, type AudioFeatures } from "@/lib/api";
import { pickStyleLabel } from "./metricsHelpers";

interface Props {
  features: AudioFeatures | null;
  songId: string;
  onFeaturesUpdate?: (features: AudioFeatures) => void;
}

export function MetricsStrip({ features, songId, onFeaturesUpdate }: Props) {
  const genre = features ? pickStyleLabel(features) : "—";
  const bpm = features ? features.bpm.toFixed(0) : "—";
  const key = features ? features.key || "—" : "—";
  const energy = features ? `${Math.round(features.energy * 100)}%` : "—";
  const valence = features ? `${Math.round(features.valence * 100)}%` : "—";

  return (
    <div
      className="flex items-end"
      style={{
        paddingTop: 12,
        paddingBottom: 12,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        gap: 10,
      }}
    >
      {/* 左侧：风格（flex 自适应，字号大） */}
      <div
        className="flex flex-col"
        style={{ flex: "1 1 auto", minWidth: 0, alignItems: "flex-start" }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "0.1em",
            color: "var(--theme-label)",
            filter: "brightness(1.4)",
            fontFamily: "var(--font-display)",
          }}
        >
          风格
        </span>
        <span
          className="font-display"
          style={{
            fontSize: 17,
            fontWeight: 500,
            color: "var(--theme-lyrics-next)",
            marginTop: 2,
            lineHeight: 1.1,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={genre}
        >
          {genre}
        </span>
      </div>

      {/* 右侧参数 */}
      <EditableBpmCell
        value={bpm}
        songId={songId}
        hasFeatures={!!features}
        onUpdated={(f) => onFeaturesUpdate?.(f)}
      />
      <MetricCell label="Key" value={key} />
      <MetricCell label="能量" value={energy} />
      <MetricCell label="情绪" value={valence} />
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex flex-col items-center"
      style={{ flex: "0 0 auto", minWidth: 34 }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.1em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          fontFamily: "var(--font-display)",
        }}
      >
        {label}
      </span>
      <span
        className="font-display"
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--theme-lyrics-next)",
          marginTop: 2,
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          textAlign: "center",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function EditableBpmCell({
  value,
  songId,
  hasFeatures,
  onUpdated,
}: {
  value: string;
  songId: string;
  hasFeatures: boolean;
  onUpdated: (f: AudioFeatures) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 切歌或新的分析结果时同步 input
  useEffect(() => {
    if (!editing) setInput(value);
  }, [value, editing]);

  const commit = async () => {
    const bpm = Number(input);
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 300) {
      setErr("1-300");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const updated = await api.updateSongBpm(songId, bpm);
      onUpdated(updated);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const canEdit = hasFeatures && !!songId;

  return (
    <div
      className="flex flex-col items-center"
      style={{ flex: "0 0 auto", minWidth: 40 }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.1em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          fontFamily: "var(--font-display)",
        }}
      >
        BPM
      </span>
      {editing ? (
        <input
          type="number"
          autoFocus
          value={input}
          disabled={saving}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => {
            if (!saving) {
              setEditing(false);
              setErr(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              setEditing(false);
              setErr(null);
            }
          }}
          style={{
            width: 44,
            fontSize: 12,
            fontWeight: 500,
            color: err ? "rgba(255,160,140,0.95)" : "var(--theme-accent)",
            marginTop: 2,
            lineHeight: 1.1,
            textAlign: "center",
            background: "rgba(255,255,255,0.06)",
            border: `1px solid ${
              err ? "rgba(255,120,100,0.6)" : "var(--theme-accent)"
            }`,
            borderRadius: 3,
            outline: "none",
            padding: "1px 2px",
            fontFamily: "var(--font-display)",
          }}
        />
      ) : (
        <span
          className="font-display"
          onClick={() => canEdit && setEditing(true)}
          title={canEdit ? "点击修改 BPM" : value}
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--theme-lyrics-next)",
            marginTop: 2,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            textAlign: "center",
            cursor: canEdit ? "pointer" : "default",
            borderBottom: canEdit ? "1px dashed rgba(255,255,255,0.2)" : "none",
            padding: "0 1px",
          }}
        >
          {value}
        </span>
      )}
    </div>
  );
}
