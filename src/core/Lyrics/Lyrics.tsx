// 歌词面板。
//
// 设计决策：
//   - 高度撑满父容器（h-full flex col）
//   - 顶部固定 header（歌名 + 艺人）
//   - body flex-1，上下居中，显示 11 行（当前行上下各 5 行）
//   - 不做 translateY 滚动，React 在 activeIndex 变化时直接重渲染
//   - 行距显著加大（line-height ~2.8）；字号略放大
//   - 距离当前行的距离映射 opacity + color

import { useEffect, useRef, useState } from "react";
import {
  api,
  onPlaybackUpdate,
  type PlaybackStatus,
  type Song,
} from "@/lib/api";
import {
  findActiveLineIndex,
  parseLyrics,
  type LyricLine,
} from "./parseLrc";

interface Props {
  song: Song | null;
}

/** 当前行上下各显示多少行 */
const WINDOW = 5;

export function Lyrics({ song }: Props) {
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const lastIdxRef = useRef(-1);

  // 拉歌词
  useEffect(() => {
    if (!song) {
      setLines([]);
      setActiveIndex(-1);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getLyric(song.id)
      .then((lyric) => {
        if (cancelled) return;
        setLines(parseLyrics(lyric.lrc, lyric.tlyric));
        setActiveIndex(-1);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLines([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [song]);

  // 播放事件驱动当前行
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onPlaybackUpdate((status: PlaybackStatus) => {
      const next = findActiveLineIndex(lines, status.position);
      if (next !== lastIdxRef.current) {
        lastIdxRef.current = next;
        setActiveIndex(next);
      }
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, [lines]);

  // 选取当前行前后 WINDOW 行 —— 共 2*WINDOW + 1 条
  const visible: Array<{ line: LyricLine | null; distance: number }> = [];
  if (lines.length) {
    for (let d = -WINDOW; d <= WINDOW; d++) {
      const i = activeIndex + d;
      visible.push({
        line: i >= 0 && i < lines.length ? lines[i] : null,
        distance: d,
      });
    }
  }

  return (
    <div
      className="flex h-full flex-col"
      style={{ paddingTop: "12px", paddingBottom: "8px" }}
    >
      {/* Header —— 固定在顶部 */}
      <div
        className="font-bold"
        style={{
          fontSize: "26px",
          marginBottom: "6px",
          color: "var(--theme-lyrics-title)",
          fontFamily: "var(--font-display)",
          lineHeight: 1.2,
        }}
      >
        {song?.name ?? "—"}
      </div>
      <div
        style={{
          fontSize: "13px",
          opacity: 0.6,
          marginBottom: "24px",
          color: "var(--theme-lyrics-artist)",
          fontFamily: "var(--font-ui)",
          letterSpacing: "0.02em",
        }}
      >
        {song?.artist ?? "nothing playing"}
        {song?.album ? ` · ${song.album}` : ""}
      </div>

      {/* Body —— 上下居中，占据剩余空间 */}
      <div
        className="flex flex-1 flex-col justify-center"
        style={{ overflow: "hidden" }}
      >
        {loading && <Placeholder text="正在获取歌词…" />}
        {!loading && !lines.length && song && <Placeholder text="暂无歌词" />}
        {!song && <Placeholder text="选一首歌开始播放" />}
        {!loading &&
          lines.length > 0 &&
          visible.map((v, i) => (
            <Line key={i} line={v.line} distance={v.distance} />
          ))}
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: "14px",
        opacity: 0.5,
        color: "var(--theme-lyrics-mid)",
      }}
    >
      {text}
    </div>
  );
}

function Line({
  line,
  distance,
}: {
  line: LyricLine | null;
  distance: number;
}) {
  const isActive = distance === 0;
  const absD = Math.abs(distance);

  // 距离映射：active → active 色、bold、大字；越远越淡
  const color = isActive
    ? "var(--theme-lyrics-active)"
    : absD === 1
      ? "var(--theme-lyrics-next)"
      : absD === 2
        ? "var(--theme-lyrics-mid)"
        : "var(--theme-lyrics-far)";

  const opacity = isActive
    ? 1
    : absD === 1
      ? 0.78
      : absD === 2
        ? 0.52
        : absD === 3
          ? 0.32
          : absD === 4
            ? 0.18
            : 0.1;

  // 空行（歌词不足时）
  if (!line) {
    return (
      <div
        style={{
          lineHeight: 2.8,
          fontSize: "15px",
          minHeight: "2.8em",
        }}
      >
        &nbsp;
      </div>
    );
  }

  return (
    <div
      style={{
        fontSize: isActive ? "22px" : "15px",
        lineHeight: 2.8,
        fontWeight: isActive ? 700 : 400,
        color,
        opacity,
        transition: "all 500ms ease",
        fontFamily: "var(--font-ui)",
        letterSpacing: isActive ? "0.01em" : "0",
      }}
    >
      {line.text}
      {line.translation && (
        <span
          style={{
            display: "block",
            fontSize: isActive ? "14px" : "12px",
            opacity: 0.75,
            marginTop: "3px",
            lineHeight: 1.5,
          }}
        >
          {line.translation}
        </span>
      )}
    </div>
  );
}
