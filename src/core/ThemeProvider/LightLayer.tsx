// 全局光线层 —— 直接渲染 registry 里 per-theme godRays / ambientGlows / dust。
// 每个主题的光线几何都是独立配置，不再用通用参数。
//
// 这样做的原因：原型每个主题的光线合成完全不同（数量、角度、位置、模糊、
// 形状），用通用参数根本还原不出来。直接 1:1 映射原型 HTML。

import { THEMES } from "@/themes/registry";
import { useTheme } from "./ThemeProvider";

export function LightLayer() {
  const { current } = useTheme();
  const theme = THEMES[current];

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 1 }}
    >
      {/* 1. 环境辉光（radial ellipses） */}
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

      {/* 2. god-ray 光柱 */}
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

      {/* 3. 浮尘粒子（shimmer 闪烁） */}
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
            animation: `melody-dust-shimmer 3s ease-in-out infinite`,
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
