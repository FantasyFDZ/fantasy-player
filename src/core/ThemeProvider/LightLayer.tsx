// 全局光线层。
//
// DynamicLightLayer：根据专辑主色动态生成辉光效果。
// LightLayer：保留兼容，从静态 registry 读取 per-theme 配置。

import { THEMES } from "@/themes/registry";
import { useTheme } from "./ThemeProvider";
import type { AlbumColor } from "@/core/VinylDisc/useAlbumColor";

interface DynamicProps {
  color: AlbumColor;
}

/** 动态光线层 —— 辉光颜色跟随专辑封面 */
export function DynamicLightLayer({ color }: DynamicProps) {
  const { r, g, b } = color;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 1 }}
    >
      {/* 左上环境辉光 */}
      <div
        className="absolute"
        style={{
          top: "-5%",
          left: "-5%",
          width: "55%",
          height: "65%",
          background: `radial-gradient(ellipse at 40% 30%,
            rgba(${r},${g},${b},0.10) 0%,
            rgba(${r},${g},${b},0.03) 50%,
            transparent 70%
          )`,
          filter: "blur(40px)",
          transition: "background 2s ease",
        }}
      />

      {/* 右下微弱辉光 */}
      <div
        className="absolute"
        style={{
          bottom: "-10%",
          right: "-5%",
          width: "45%",
          height: "50%",
          background: `radial-gradient(ellipse at 60% 70%,
            rgba(${r},${g},${b},0.06) 0%,
            transparent 60%
          )`,
          filter: "blur(50px)",
          transition: "background 2s ease",
        }}
      />

      {/* 微光粒子 */}
      {[0, 1, 2].map((i) => (
        <div
          key={`dust-dyn-${i}`}
          className="absolute"
          style={{
            top: `${20 + i * 18}%`,
            left: `${8 + i * 6}%`,
            width: 2 + i,
            height: 2 + i,
            background: `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},0.4)`,
            borderRadius: "50%",
            animation: "melody-dust-shimmer 3s ease-in-out infinite",
            animationDelay: `${i * 0.8}s`,
            transition: "background 2s ease",
            zIndex: 2,
          }}
        />
      ))}

      <style>{`
        @keyframes melody-dust-shimmer {
          0%, 100% { opacity: 0.2; }
          50%      { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

/** 静态光线层（兼容旧 per-theme 配置，PanelWindow 等场景使用） */
export function LightLayer() {
  const { current } = useTheme();
  const theme = THEMES[current];

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 1 }}
    >
      {theme.ambientGlows.map((g, i) => (
        <div
          key={`glow-${current}-${i}`}
          className="absolute"
          style={{
            top: g.top,
            left: g.left,
            width: g.width,
            height: g.height,
            inset: g.inset,
            background: g.background,
            filter: g.blur ? `blur(${g.blur}px)` : undefined,
            zIndex: 1,
          }}
        />
      ))}
      {theme.godRays.map((ray, i) => (
        <div
          key={`ray-${current}-${i}`}
          className="absolute"
          style={{
            top: ray.top,
            left: ray.left,
            width: ray.width,
            height: ray.height,
            background: ray.background,
            filter: `blur(${ray.blur}px)`,
            transform: `rotate(${ray.rotate}deg)`,
            zIndex: 1,
          }}
        />
      ))}
      {theme.dust.map((p, i) => (
        <div
          key={`dust-${current}-${i}`}
          className="absolute"
          style={{
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.petal ? "50% 0 50% 50%" : "50%",
            transform: p.petal ? "rotate(45deg)" : undefined,
            animation: "melody-dust-shimmer 3s ease-in-out infinite",
            animationDelay: `${p.delay}s`,
            zIndex: 2,
          }}
        />
      ))}
      <style>{`
        @keyframes melody-dust-shimmer {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
