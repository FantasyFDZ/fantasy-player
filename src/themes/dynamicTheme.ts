// 动态主题 —— 从专辑封面主色推导全部 CSS 变量。
//
// 核心设计：背景明度和饱和度都跟随封面变化。
// 亮色封面 → 偏亮的背景，暗色封面 → 偏暗的背景。
// 高饱和封面 → 浓郁色彩，低饱和 → 素雅。
// 文本颜色根据背景明暗自动切换深/浅色保持可读。

import type { AlbumColor } from "@/core/VinylDisc/useAlbumColor";

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = 0;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hsl(h: number, s: number, l: number): string {
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  return `hsl(${h.toFixed(0)}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(0)}%)`;
}

function hsla(h: number, s: number, l: number, a: number): string {
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  return `hsla(${h.toFixed(0)}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(0)}%, ${a})`;
}

export function applyDynamicTheme(color: AlbumColor) {
  const [h, rawS, rawL] = rgbToHsl(color.r, color.g, color.b);
  const s = Math.max(rawS, 0.20);

  // 背景明度跟随封面明度：暗封面 → 0.12，亮封面 → 0.34
  // 基线从 0.08 抬到 0.12，范围拉大 —— 整体 UI 观感更亮,
  // 默认 sky blue 下背景更清透
  const bgL = 0.12 + rawL * 0.22;
  // 背景饱和度跟随封面
  const bgS = s * 0.85;
  // 背景是否偏亮（决定文本用深色还是浅色）
  const isLight = bgL > 0.18;

  const root = document.documentElement;
  const set = (k: string, v: string) => root.style.setProperty(k, v);

  // ---- 全局背景 ----
  set("--theme-bg", hsl(h, bgS, bgL));

  // ---- 弹窗 ----
  set(
    "--theme-cabinet-bg",
    `linear-gradient(180deg, ${hsl(h, bgS * 0.9, bgL + 0.06)}, ${hsl(h, bgS * 0.8, bgL + 0.02)})`,
  );
  set(
    "--theme-cabinet-shadow",
    `0 6px 25px rgba(0,0,0,0.4), inset 0 1px 0 ${hsla(h, s * 0.6, 0.5, 0.08)}`,
  );

  // ---- 兼容旧组件 ----
  set("--theme-disc-frame-bg", `radial-gradient(circle, ${hsla(h, s * 0.5, 0.5, 0.10)}, ${hsla(h, s * 0.3, 0.15, 0.1)})`);
  set("--theme-disc-frame-border", `3px solid ${hsla(h, s * 0.5, 0.4, 0.18)}`);
  set("--theme-disc-shadow", `0 4px 25px rgba(0,0,0,0.5)`);
  set("--theme-lever-ball", `radial-gradient(circle at 40% 35%, ${hsl(h, s * 0.4, 0.7)}, ${hsl(h, s * 0.4, 0.4)})`);
  set("--theme-lever-stem", `linear-gradient(90deg, ${hsl(h, s * 0.3, 0.3)}, ${hsl(h, s * 0.4, 0.5)}, ${hsl(h, s * 0.3, 0.3)})`);
  set("--theme-lever-slot", hsl(h, s * 0.35, bgL * 0.5));
  set("--theme-lever-slot-border", `1px solid ${hsla(h, s * 0.5, 0.5, 0.12)}`);
  set("--theme-lever-tag", hsl(h, s * 0.4, 0.4));
  set("--theme-label", hsl(h, s * 0.4, isLight ? 0.30 : 0.55));
  set("--theme-foot", hsl(h, s * 0.35, bgL * 0.6));
  set("--theme-arm-outer", hsl(h, s * 0.3, 0.35));
  set("--theme-arm-inner", hsl(h, s * 0.3, 0.50));
  set("--theme-arm-head", hsl(h, s * 0.25, 0.28));
  set("--theme-arm-needle", hsl(h, s * 0.25, 0.55));
  set("--theme-arm-pivot-fill", hsl(h, s * 0.25, 0.28));
  set("--theme-arm-pivot-stroke", hsl(h, s * 0.25, 0.35));

  // ---- Accent ----
  set("--theme-accent", hsl(h, Math.min(s * 1.8, 0.90), 0.65));

  // ---- 歌词 —— 统一浅色，保证对比度 ----
  set("--theme-lyrics-title", hsl(h, s * 0.35, 0.90));
  set("--theme-lyrics-artist", hsl(h, s * 0.30, 0.62));
  set("--theme-lyrics-active", hsl(h, s * 0.25, 0.96));
  set("--theme-lyrics-next", hsl(h, s * 0.25, 0.78));
  set("--theme-lyrics-mid", hsl(h, s * 0.20, 0.52));
  set("--theme-lyrics-far", hsl(h, s * 0.15, 0.36));

  // ---- 播放条 ----
  set("--theme-playbar-bg", hsla(h, bgS, bgL - 0.02, 0.5));
  set("--theme-playbar-progress-track", hsla(h, s * 0.4, 0.35, 0.20));
  set(
    "--theme-playbar-progress-fill",
    `linear-gradient(90deg, ${hsl(h, s * 1.4, 0.45)}, ${hsl(h, s * 1.8, 0.62)})`,
  );
  set("--theme-playbar-btn-bg", hsla(h, s * 1.0, 0.50, 0.30));
  set("--theme-playbar-btn-border", `1px solid ${hsla(h, s * 0.6, 0.5, 0.25)}`);
  set("--theme-playbar-btn-color", hsl(h, s * 0.3, 0.92));
  set("--theme-playbar-text", hsl(h, s * 0.25, 0.60));
  set("--theme-playbar-icon", hsl(h, s * 0.25, 0.60));

  // ---- 全局文本 ----
  set("--theme-text", hsl(h, s * 0.35, 0.90));
  set("--theme-text-muted", hsl(h, s * 0.30, 0.62));
}
