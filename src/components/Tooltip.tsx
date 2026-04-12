// 自定义 tooltip 组件。
//
// 对比原生 HTML title 属性：
//   - 无问号光标变化（保持 default，不强制 cursor:help）
//   - 悬停 1 秒后才显示（而不是各 OS 不同的延迟）
//   - 可以样式化（主题色、圆角、阴影）
//   - 可以包含富文本
//
// 用法：
//   <Tooltip text="解释文字">
//     <span>能量</span>
//   </Tooltip>

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  text: string;
  children: React.ReactNode;
  /** 延迟毫秒数，默认 1000 */
  delay?: number;
  /** 相对于 trigger 的位置，默认 top */
  placement?: "top" | "bottom";
}

export function Tooltip({
  text,
  children,
  delay = 1000,
  placement = "top",
}: Props) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        x: rect.left + rect.width / 2,
        y: placement === "top" ? rect.top : rect.bottom,
      });
      setVisible(true);
    }, delay);
  }, [clearTimer, delay, placement]);

  const handleLeave = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return (
    <>
      <span
        ref={wrapperRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{ display: "inline-block" }}
      >
        {children}
      </span>
      {visible && coords && (
        <div
          style={{
            position: "fixed",
            left: coords.x,
            top: coords.y,
            transform:
              placement === "top"
                ? "translate(-50%, calc(-100% - 8px))"
                : "translate(-50%, 8px)",
            maxWidth: 280,
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(20, 20, 28, 0.96)",
            color: "rgba(255, 240, 220, 0.95)",
            fontSize: 11,
            lineHeight: 1.55,
            fontFamily: "var(--font-ui)",
            boxShadow:
              "0 12px 28px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)",
            border: "1px solid rgba(0, 0, 0, 0.5)",
            zIndex: 9999,
            pointerEvents: "none",
            whiteSpace: "normal",
          }}
        >
          {text}
        </div>
      )}
    </>
  );
}
