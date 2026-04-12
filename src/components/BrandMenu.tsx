// MELODY 品牌字 + 点击弹出主题选择 popover。
// 取代 Phase 2 第一版在 header 直接显示彩色圆点的做法。

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/core/ThemeProvider/ThemeProvider";
import { THEMES } from "@/themes/registry";

export function BrandMenu() {
  const { current, setTheme, all } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="brand-emboss text-[15px] transition-transform hover:scale-[1.03]"
        style={{
          letterSpacing: "0.35em",
          cursor: "pointer",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        MELODY
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+10px)] z-40"
          style={{
            minWidth: "220px",
            padding: "14px 16px 16px",
            borderRadius: "12px",
            background:
              "linear-gradient(180deg, var(--theme-wood-highlight), var(--theme-wood) 50%, var(--theme-wood-shadow))",
            boxShadow: `
              inset 0 1px 0 rgba(255,255,255,0.18),
              inset 0 -1px 0 rgba(0,0,0,0.55),
              0 24px 48px rgba(0,0,0,0.55)
            `,
            border: "1px solid rgba(0,0,0,0.4)",
          }}
        >
          <div
            className="mb-2 font-mono text-[9px] uppercase"
            style={{
              color: "var(--theme-wood-highlight)",
              letterSpacing: "0.24em",
              textShadow: "0 1px 0 var(--theme-wood-shadow)",
              filter: "brightness(1.6)",
            }}
          >
            THEME
          </div>
          <div className="flex flex-col gap-1">
            {all.map((id) => {
              const theme = THEMES[id];
              const active = id === current;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTheme(id);
                    setOpen(false);
                  }}
                  className="flex items-center gap-3 rounded px-2 py-1.5 text-left transition-colors"
                  style={{
                    background: active ? "rgba(0,0,0,0.35)" : "transparent",
                  }}
                >
                  <div
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{
                      background: `radial-gradient(circle at 30% 30%, ${theme.accent} 0%, ${theme.labelColor} 80%)`,
                      boxShadow: active
                        ? `0 0 0 2px ${theme.accent}, 0 0 10px ${theme.accent}`
                        : "0 0 0 1px rgba(0,0,0,0.55)",
                    }}
                  />
                  <span
                    className="font-display text-[15px]"
                    style={{
                      color: active
                        ? "var(--theme-accent)"
                        : "rgba(255,240,220,0.85)",
                      textShadow: "0 1px 0 rgba(0,0,0,0.7)",
                    }}
                  >
                    {theme.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
