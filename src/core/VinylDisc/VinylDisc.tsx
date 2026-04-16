// 唱片组件。
//
// 视觉结构（由后到前）：
//   1. 棱镜色散光环（外缘彩虹旋转）
//   2. 唱片本体（旋转）
//      a. 毛玻璃底（backdrop-blur）
//      b. 同心圆刻纹（粗，圆润）
//      c. 封面主色反光（opacity 由 rAF 直接驱动，零延迟）
//      d. 封面
//   3. 外缘细边

import { useEffect, useRef } from "react";
import { useAlbumColor } from "./useAlbumColor";
import { useAudioLevelRef } from "./useAudioLevel";

interface Props {
  coverUrl?: string;
  playing: boolean;
}

const DISC_SIZE = 340;
const ART_SIZE = 231;
const GLOW_EXT = 30;
const TOTAL = DISC_SIZE + GLOW_EXT * 2;

export function VinylDisc({ coverUrl, playing }: Props) {
  const color = useAlbumColor(coverUrl);
  const levelRef = useAudioLevelRef(playing);
  const reflectRef = useRef<HTMLDivElement>(null);
  const { r, g, b } = color;

  // rAF 循环直接写 DOM opacity —— 零延迟，不经过 React
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (reflectRef.current) {
        const alpha = (levelRef.current ?? 0) * 0.50;
        reflectRef.current.style.opacity = alpha.toFixed(3);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  const p = (base: number, off: number) => cl(base + off);

  return (
    <div
      className="relative"
      style={{ width: TOTAL, height: TOTAL, flexShrink: 0 }}
    >
      {/* 1. 棱镜色散光环 */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: GLOW_EXT - 14,
          left: GLOW_EXT - 14,
          width: DISC_SIZE + 28,
          height: DISC_SIZE + 28,
          borderRadius: "50%",
          background: `conic-gradient(
            from 0deg,
            rgba(${p(r, 50)},${p(g, -30)},${p(b, 70)},0.30),
            rgba(${p(r, -30)},${p(g, 50)},${p(b, 30)},0.25),
            rgba(${p(r, 70)},${p(g, 30)},${p(b, -40)},0.30),
            rgba(${p(r, 30)},${p(g, -20)},${p(b, 60)},0.25),
            rgba(${p(r, 50)},${p(g, -30)},${p(b, 70)},0.30)
          )`,
          mask: "radial-gradient(circle, transparent 82%, black 86%, black 95%, transparent 100%)",
          WebkitMask:
            "radial-gradient(circle, transparent 82%, black 86%, black 95%, transparent 100%)",
          filter: "blur(10px)",
          animation: playing ? "vinyl-glow-rotate 8s linear infinite" : "none",
          transition: "background 1.8s ease",
        }}
      />

      {/* 2. 唱片本体 */}
      <div
        className="absolute"
        style={{
          top: GLOW_EXT,
          left: GLOW_EXT,
          width: DISC_SIZE,
          height: DISC_SIZE,
          borderRadius: "50%",
          overflow: "hidden",
          animation: playing ? "melody-disc-spin 16s linear infinite" : "none",
          animationPlayState: playing ? "running" : "paused",
        }}
      >
        {/* 2a. 毛玻璃底层 */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: "50%",
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(32px) saturate(1.2)",
            WebkitBackdropFilter: "blur(32px) saturate(1.2)",
          }}
        />

        {/* 2b. 同心圆刻纹 */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: "50%",
            background: `repeating-radial-gradient(circle at center,
              rgba(255,255,255,0.12) 0px,
              rgba(255,255,255,0.09) 2.4px,
              transparent 2.4px,
              transparent 5px
            )`,
            mask: `radial-gradient(circle,
              transparent ${ART_SIZE / 2 - 2}px,
              black ${ART_SIZE / 2 + 4}px
            )`,
            WebkitMask: `radial-gradient(circle,
              transparent ${ART_SIZE / 2 - 2}px,
              black ${ART_SIZE / 2 + 4}px
            )`,
          }}
        />

        {/* 2c. 封面主色反光 —— opacity 由 rAF 直接驱动 */}
        <div
          ref={reflectRef}
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: "50%",
            opacity: 0.08,
            background: `conic-gradient(
              from 0deg at 50% 50%,
              rgb(${p(r, 40)},${p(g, 40)},${p(b, 40)}) 0deg,
              rgb(${p(r, 70)},${p(g, 70)},${p(b, 70)}) 60deg,
              rgb(${p(r, 90)},${p(g, 90)},${p(b, 90)}) 120deg,
              rgb(${p(r, 70)},${p(g, 70)},${p(b, 70)}) 180deg,
              rgb(${p(r, 40)},${p(g, 40)},${p(b, 40)}) 240deg,
              rgb(${p(r, 60)},${p(g, 60)},${p(b, 60)}) 300deg,
              rgb(${p(r, 40)},${p(g, 40)},${p(b, 40)}) 360deg
            )`,
            mask: `radial-gradient(circle,
              transparent ${ART_SIZE / 2 - 2}px,
              black ${ART_SIZE / 2 + 4}px
            )`,
            WebkitMask: `radial-gradient(circle,
              transparent ${ART_SIZE / 2 - 2}px,
              black ${ART_SIZE / 2 + 4}px
            )`,
          }}
        />

        {/* 2d. 封面 */}
        <div
          className="absolute overflow-hidden"
          style={{
            width: ART_SIZE,
            height: ART_SIZE,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            boxShadow: `
              0 0 0 2px rgba(255,255,255,0.08),
              inset 0 0 20px rgba(255,255,255,0.06)
            `,
          }}
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
              crossOrigin="anonymous"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{
                background: "radial-gradient(circle, #3a3a3a, #1a1a1a)",
              }}
            >
              <span
                className="font-display"
                style={{
                  color: "#555",
                  fontSize: ART_SIZE * 0.32,
                  opacity: 0.5,
                }}
              >
                M
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3. 外缘细边 */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: GLOW_EXT - 1,
          left: GLOW_EXT - 1,
          width: DISC_SIZE + 2,
          height: DISC_SIZE + 2,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: `
            inset 0 1px 0 rgba(255,255,255,0.06),
            inset 0 -1px 0 rgba(0,0,0,0.20),
            0 2px 10px rgba(0,0,0,0.30)
          `,
        }}
      />

      <style>{`
        @keyframes melody-disc-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes vinyl-glow-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export { useAlbumColor } from "./useAlbumColor";
export type { AlbumColor } from "./useAlbumColor";

function cl(v: number): number {
  return Math.max(0, Math.min(255, v));
}
