import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import { applyTheme } from "@/themes/inject";
import { DEFAULT_THEME, THEMES, THEME_ORDER } from "@/themes/registry";
import type { ThemeId } from "@/themes/types";

interface ThemeContextValue {
  current: ThemeId;
  setTheme: (id: ThemeId) => void;
  cycle: () => void;
  all: ThemeId[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const SETTING_KEY = "ui.theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ThemeId>(DEFAULT_THEME);
  const hydrated = useRef(false);

  // 启动时从 settings 加载
  useEffect(() => {
    let cancelled = false;
    api
      .getSetting(SETTING_KEY)
      .then((value) => {
        if (cancelled) return;
        if (value && value in THEMES) {
          setCurrent(value as ThemeId);
        }
        hydrated.current = true;
      })
      .catch(() => {
        hydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 每次主题变化都注入 CSS 变量并保存
  useEffect(() => {
    applyTheme(current);
    if (hydrated.current) {
      api.setSetting(SETTING_KEY, current).catch(() => {});
    }
  }, [current]);

  const setTheme = useCallback((id: ThemeId) => {
    if (id in THEMES) setCurrent(id);
  }, []);

  const cycle = useCallback(() => {
    setCurrent((prev) => {
      const idx = THEME_ORDER.indexOf(prev);
      return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{ current, setTheme, cycle, all: THEME_ORDER }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
