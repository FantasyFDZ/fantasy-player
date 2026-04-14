// 面板 context —— 子窗口架构。
//
// 面板作为主窗口的 child window 弹出在右侧。
// macOS 上子窗口自动跟随父窗口移动、同层显示。
// 主窗口完全不变。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, onPanelClosed } from "@/lib/api";
import type { PanelPlugin } from "@/lib/panelTypes";

interface PanelContextValue {
  plugins: PanelPlugin[];
  activeId: string | null;
  toggle: (panelId: string) => void;
  close: (panelId: string) => void;
  isOpen: (panelId: string) => boolean;
}

const PanelContext = createContext<PanelContextValue | null>(null);

interface ProviderProps {
  plugins: PanelPlugin[];
  children: React.ReactNode;
}

export function PanelProvider({ plugins, children }: ProviderProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // 启动时拉已打开的面板列表
  useEffect(() => {
    let cancelled = false;
    api
      .panelOpenList()
      .then((ids) => {
        if (cancelled) return;
        setActiveId(ids.length > 0 ? ids[0] : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 监听面板关闭事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onPanelClosed((panelId) => {
      setActiveId((prev) => (prev === panelId ? null : prev));
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  const toggle = useCallback(
    (panelId: string) => {
      const plugin = plugins.find((p) => p.id === panelId);
      if (!plugin) return;
      setActiveId((prev) => {
        if (prev === panelId) {
          api.panelClose(panelId).catch(() => {});
          return null;
        }
        if (prev) api.panelClose(prev).catch(() => {});
        api
          .panelOpen(panelId, plugin.defaultSize, { dockRight: true })
          .catch((err) => console.error("panel_open failed:", err));
        return panelId;
      });
    },
    [plugins],
  );

  const close = useCallback((panelId: string) => {
    api.panelClose(panelId).catch(() => {});
    setActiveId((prev) => (prev === panelId ? null : prev));
  }, []);

  const isOpen = useCallback(
    (panelId: string) => activeId === panelId,
    [activeId],
  );

  const value = useMemo<PanelContextValue>(
    () => ({ plugins, activeId, toggle, close, isOpen }),
    [plugins, activeId, toggle, close, isOpen],
  );

  return (
    <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
  );
}

export function usePanels() {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error("usePanels must be used inside PanelProvider");
  return ctx;
}
