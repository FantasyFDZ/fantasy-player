// 模拟音频电平 —— 播放时逐帧更新 ref，不触发 React 重渲染。
//
// 电平范围更广：经常触及接近 0 的低谷和接近 1 的峰值。

import { useEffect, useRef } from "react";

export function useAudioLevelRef(playing: boolean): React.RefObject<number> {
  const levelRef = useRef(0);
  const rafRef = useRef(0);
  const burstRef = useRef({ target: 0.5, lastT: 0 });

  useEffect(() => {
    if (!playing) {
      levelRef.current = 0;
      return;
    }

    const start = performance.now();

    const tick = () => {
      const t = (performance.now() - start) / 1000;

      // 主节拍 —— 尖脉冲，常归零
      const kick = Math.pow(Math.abs(Math.sin(t * 8.5)), 0.3) * 0.50;
      // 副节拍
      const snare = Math.pow(Math.abs(Math.sin(t * 5.8 + 1.8)), 0.4) * 0.35;
      // 高频
      const hi = Math.sin(t * 24) * 0.12;
      // 慢呼吸 —— 周期性拉低整体，制造安静段
      const breath = Math.sin(t * 1.3) * 0.30;

      // 随机突变
      const burst = burstRef.current;
      if (t - burst.lastT > 0.12 + Math.random() * 0.3) {
        burst.target = Math.random();
        burst.lastT = t;
      }
      const burstContrib = burst.target * 0.25;

      const raw = kick + snare + hi + breath + burstContrib;
      // 不 clamp 到 0.03，允许真正的低谷
      levelRef.current = Math.max(0, Math.min(1.0, raw));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  return levelRef;
}
