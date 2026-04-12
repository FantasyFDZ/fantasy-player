// 浮动面板 context —— 多窗口架构版。
//
// 面板现在是真正的独立 Tauri WebviewWindow，不再由前端 CSS 绘制浮层。
// 本 provider 的职责退化为：
//   - 跟踪哪些面板当前打开（openIds: Set<string>）
//   - toggle(id) 调用后端 panel_open / panel_close
//   - 监听后端 melody://panel-closed 事件（用户用 OS chrome 关掉窗口）
//     同步 openIds 以更新 CabinetControls 按钮高亮
//
// PanelProvider 只在主窗口挂载；面板窗口自己不用它。

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
  openIds: Set<string>;
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
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  // 启动时从后端拉当前已打开的窗口列表（HMR reload 场景保留状态）
  useEffect(() => {
    let cancelled = false;
    api
      .panelOpenList()
      .then((ids) => {
        if (cancelled) return;
        setOpenIds(new Set(ids));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 监听后端 melody://panel-closed 事件（用户点 OS 窗口 ✕）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onPanelClosed((panelId) => {
      setOpenIds((prev) => {
        if (!prev.has(panelId)) return prev;
        const next = new Set(prev);
        next.delete(panelId);
        return next;
      });
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  const toggle = useCallback(
    (panelId: string) => {
      const plugin = plugins.find((p) => p.id === panelId);
      if (!plugin) return;
      setOpenIds((prev) => {
        if (prev.has(panelId)) {
          api.panelClose(panelId).catch(() => {});
          const next = new Set(prev);
          next.delete(panelId);
          return next;
        }
        api
          .panelOpen(panelId, plugin.defaultSize, { dockRight: true })
          .catch((err) => console.error("panel_open failed:", err));
        const next = new Set(prev);
        next.add(panelId);
        return next;
      });
    },
    [plugins],
  );

  const close = useCallback((panelId: string) => {
    api.panelClose(panelId).catch(() => {});
    setOpenIds((prev) => {
      if (!prev.has(panelId)) return prev;
      const next = new Set(prev);
      next.delete(panelId);
      return next;
    });
  }, []);

  const isOpen = useCallback(
    (panelId: string) => openIds.has(panelId),
    [openIds],
  );

  const value = useMemo<PanelContextValue>(
    () => ({ plugins, openIds, toggle, close, isOpen }),
    [plugins, openIds, toggle, close, isOpen],
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
