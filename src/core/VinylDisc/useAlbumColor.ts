// 从专辑封面提取主色调 —— 用于唱片光晕、背景染色等动态效果。
//
// 策略：将封面缩小到 64×64 采样，跳过过暗/过亮像素，
// 按饱和度加权平均得到"视觉主色"。

import { useEffect, useRef, useState } from "react";

export interface AlbumColor {
  r: number;
  g: number;
  b: number;
  /** 完整 CSS rgb 字符串 */
  css: string;
  /** 是否偏暖色（红/橙/黄系） */
  warm: boolean;
}

// 默认主色：深蓝灰 —— 没有封面 / 提取失败时的 UI 基调。
// 之前用亮 sky blue，在独立面板窗口（情绪/歌词）首次打开无歌曲时，整块染成
// 亮蓝与主窗口暗色基调不协调；改成暗色让默认态两个窗口观感一致，一旦用户
// 选歌就会被真正的封面主色覆盖。
const NEUTRAL: AlbumColor = {
  r: 30,
  g: 36,
  b: 50,
  css: "rgb(30, 36, 50)",
  warm: false,
};

export function useAlbumColor(coverUrl?: string): AlbumColor {
  const [color, setColor] = useState<AlbumColor>(NEUTRAL);
  const urlRef = useRef(coverUrl);

  useEffect(() => {
    urlRef.current = coverUrl;
    if (!coverUrl) {
      setColor(NEUTRAL);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // 防止异步回调和最新 URL 不匹配
      if (urlRef.current !== coverUrl) return;

      try {
        const canvas = document.createElement("canvas");
        const S = 64;
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, S, S);
        const data = ctx.getImageData(0, 0, S, S).data;

        let rSum = 0,
          gSum = 0,
          bSum = 0,
          wSum = 0;

        // 每 4 个像素采一次（stride 16 bytes = 4 channels × 4 pixels）
        for (let i = 0; i < data.length; i += 16) {
          const r = data[i],
            g = data[i + 1],
            b = data[i + 2];
          const brightness = (r + g + b) / 3;
          if (brightness < 15 || brightness > 242) continue;

          // 饱和度加权 —— 让鲜艳颜色占更大比重
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const sat = mx > 0 ? (mx - mn) / mx : 0;
          const w = 0.3 + sat * 2.5;

          rSum += r * w;
          gSum += g * w;
          bSum += b * w;
          wSum += w;
        }

        if (wSum > 0) {
          const rv = Math.round(rSum / wSum);
          const gv = Math.round(gSum / wSum);
          const bv = Math.round(bSum / wSum);
          setColor({
            r: rv,
            g: gv,
            b: bv,
            css: `rgb(${rv}, ${gv}, ${bv})`,
            warm: rv > bv && rv > gv * 0.85,
          });
        }
      } catch {
        // CORS 或其他错误 —— 保持默认中性色
        setColor(NEUTRAL);
      }
    };

    img.onerror = () => {
      if (urlRef.current === coverUrl) setColor(NEUTRAL);
    };

    img.src = coverUrl;
  }, [coverUrl]);

  return color;
}
