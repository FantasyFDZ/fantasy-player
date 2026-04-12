// 浮动面板 context 提供者。
//
// 职责：
//   - 从 plugins 注册表读取所有可用面板
//   - 管理每个面板的 open/close 状态、位置、大小、z-index
//   - 启动时从 SQLite panel_layout 恢复状态，变更时写回（debounced）
//   - togglePanel / closePanel / bringToFront / updatePosition / updateSize
//   - 新面板首次打开时使用智能摆放算法避免重叠

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, type PanelLayoutRow } from "@/lib/api";
import type {
  PanelInstance,
  PanelPlugin,
  PanelPosition,
  PanelSize,
} from "@/lib/panelTypes";

interface PanelContextValue {
  plugins: PanelPlugin[];
  /** 每个 plugin 的运行时状态（panel_id → instance） */
  instances: Record<string, PanelInstance>;
  /** 切换面板显隐 */
  toggle: (panelId: string) => void;
  /** 强制关闭 */
  close: (panelId: string) => void;
  /** 把面板置于最上层 */
  bringToFront: (panelId: string) => void;
  /** 拖拽位置更新 */
  updatePosition: (panelId: string, pos: PanelPosition) => void;
  /** 缩放更新 */
  updateSize: (panelId: string, size: PanelSize) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

interface ProviderProps {
  plugins: PanelPlugin[];
  children: React.ReactNode;
}

/** 默认 z-index 起点 —— 给其他 UI 留出空间 */
const Z_BASE = 40;

/** 智能摆放：从左上角开始级联偏移，避免和已打开面板重合 */
function pickInitialPosition(
  defaultSize: PanelSize,
  taken: PanelInstance[],
): PanelPosition {
  const startX = 30;
  const startY = 70;
  const step = 40;
  for (let i = 0; i < 20; i++) {
    const pos = { x: startX + i * step, y: startY + i * step };
    const collide = taken.some((t) => {
      if (!t.visible) return false;
      return (
        pos.x < t.position.x + t.size.w &&
        pos.x + defaultSize.w > t.position.x &&
        pos.y < t.position.y + t.size.h &&
        pos.y + defaultSize.h > t.position.y
      );
    });
    if (!collide) return pos;
  }
  // fallback
  return { x: startX, y: startY };
}

export function PanelProvider({ plugins, children }: ProviderProps) {
  const [instances, setInstances] = useState<Record<string, PanelInstance>>(
    () =>
      Object.fromEntries(
        plugins.map((p) => [
          p.id,
          {
            pluginId: p.id,
            visible: false,
            position: { x: 30, y: 70 },
            size: p.defaultSize,
            zIndex: Z_BASE,
          } as PanelInstance,
        ]),
      ),
  );
  const topZ = useRef(Z_BASE);
  const hydrated = useRef(false);
  const writebackTimer = useRef<number | null>(null);

  // 启动时从 DB 恢复
  useEffect(() => {
    let cancelled = false;
    api
      .panelLayoutList()
      .then((rows) => {
        if (cancelled) return;
        setInstances((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            if (!next[row.panel_id]) continue;
            next[row.panel_id] = {
              ...next[row.panel_id],
              visible: row.visible,
              position: { x: row.x, y: row.y },
              size: { w: row.width, h: row.height },
            };
          }
          return next;
        });
        hydrated.current = true;
      })
      .catch(() => {
        hydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 写回 DB —— debounce 200ms 避免拖拽时狂写
  const persist = useCallback((next: Record<string, PanelInstance>) => {
    if (!hydrated.current) return;
    if (writebackTimer.current !== null) {
      window.clearTimeout(writebackTimer.current);
    }
    writebackTimer.current = window.setTimeout(() => {
      for (const inst of Object.values(next)) {
        const row: PanelLayoutRow = {
          panel_id: inst.pluginId,
          x: inst.position.x,
          y: inst.position.y,
          width: inst.size.w,
          height: inst.size.h,
          visible: inst.visible,
        };
        api.panelLayoutUpsert(row).catch(() => {});
      }
    }, 200);
  }, []);

  const mutate = useCallback(
    (updater: (prev: Record<string, PanelInstance>) => Record<string, PanelInstance>) => {
      setInstances((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const toggle = useCallback(
    (panelId: string) => {
      mutate((prev) => {
        const inst = prev[panelId];
        if (!inst) return prev;
        const plugin = plugins.find((p) => p.id === panelId);
        if (!plugin) return prev;

        if (inst.visible) {
          // 隐藏
          return { ...prev, [panelId]: { ...inst, visible: false } };
        }

        // 显示 —— 如果从未被摆过，计算智能位置
        const openOthers = Object.values(prev).filter(
          (i) => i.visible && i.pluginId !== panelId,
        );
        const hasSaved =
          inst.position.x !== 30 || inst.position.y !== 70;
        const position = hasSaved
          ? inst.position
          : pickInitialPosition(plugin.defaultSize, openOthers);
        topZ.current += 1;
        return {
          ...prev,
          [panelId]: {
            ...inst,
            visible: true,
            position,
            zIndex: topZ.current,
          },
        };
      });
    },
    [mutate, plugins],
  );

  const close = useCallback(
    (panelId: string) => {
      mutate((prev) => {
        const inst = prev[panelId];
        if (!inst || !inst.visible) return prev;
        return { ...prev, [panelId]: { ...inst, visible: false } };
      });
    },
    [mutate],
  );

  const bringToFront = useCallback(
    (panelId: string) => {
      mutate((prev) => {
        const inst = prev[panelId];
        if (!inst) return prev;
        topZ.current += 1;
        return {
          ...prev,
          [panelId]: { ...inst, zIndex: topZ.current },
        };
      });
    },
    [mutate],
  );

  const updatePosition = useCallback(
    (panelId: string, pos: PanelPosition) => {
      mutate((prev) => {
        const inst = prev[panelId];
        if (!inst) return prev;
        return { ...prev, [panelId]: { ...inst, position: pos } };
      });
    },
    [mutate],
  );

  const updateSize = useCallback(
    (panelId: string, size: PanelSize) => {
      mutate((prev) => {
        const inst = prev[panelId];
        if (!inst) return prev;
        return { ...prev, [panelId]: { ...inst, size } };
      });
    },
    [mutate],
  );

  const value = useMemo<PanelContextValue>(
    () => ({
      plugins,
      instances,
      toggle,
      close,
      bringToFront,
      updatePosition,
      updateSize,
    }),
    [plugins, instances, toggle, close, bringToFront, updatePosition, updateSize],
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
