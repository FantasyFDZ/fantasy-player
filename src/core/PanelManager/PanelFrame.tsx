// 面板外壳：标题栏（可拖拽）+ 关闭按钮 + 4 边缘缩放手柄 + 插件 body。
//
// 视觉语言：与 Cabinet 呼应——木纹渐变背景 + 金属边框 + 底部阴影。
// 使用 pointer events 自己实现拖拽和缩放，避免引入 react-rnd 依赖。

import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelPlugin } from "@/lib/panelTypes";
import { usePanels } from "./PanelProvider";

interface Props {
  plugin: PanelPlugin;
  children: React.ReactNode;
}

type DragKind =
  | { type: "move" }
  | { type: "resize"; edge: "e" | "s" | "se" | "n" | "w" | "nw" | "ne" | "sw" };

interface DragState {
  kind: DragKind;
  startX: number;
  startY: number;
  startPanelX: number;
  startPanelY: number;
  startPanelW: number;
  startPanelH: number;
}

export function PanelFrame({ plugin, children }: Props) {
  const {
    instances,
    close,
    bringToFront,
    updatePosition,
    updateSize,
  } = usePanels();
  const instance = instances[plugin.id];
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const beginDrag = useCallback(
    (kind: DragKind, e: React.PointerEvent) => {
      if (!instance) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        startPanelX: instance.position.x,
        startPanelY: instance.position.y,
        startPanelW: instance.size.w,
        startPanelH: instance.size.h,
      };
      setDragging(true);
      bringToFront(plugin.id);
    },
    [instance, bringToFront, plugin.id],
  );

  // 全局 pointermove / pointerup —— 挂在 window 上确保 capture 之外也能接收
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (state.kind.type === "move") {
        updatePosition(plugin.id, {
          x: state.startPanelX + dx,
          y: state.startPanelY + dy,
        });
        return;
      }

      // resize
      let newX = state.startPanelX;
      let newY = state.startPanelY;
      let newW = state.startPanelW;
      let newH = state.startPanelH;
      const edge = state.kind.edge;
      if (edge.includes("e")) newW = state.startPanelW + dx;
      if (edge.includes("s")) newH = state.startPanelH + dy;
      if (edge.includes("w")) {
        newW = state.startPanelW - dx;
        newX = state.startPanelX + dx;
      }
      if (edge.includes("n")) {
        newH = state.startPanelH - dy;
        newY = state.startPanelY + dy;
      }
      // 夹到 minSize
      const minW = plugin.minSize.w;
      const minH = plugin.minSize.h;
      if (newW < minW) {
        if (edge.includes("w")) newX -= minW - newW;
        newW = minW;
      }
      if (newH < minH) {
        if (edge.includes("n")) newY -= minH - newH;
        newH = minH;
      }
      updateSize(plugin.id, { w: newW, h: newH });
      if (edge.includes("n") || edge.includes("w")) {
        updatePosition(plugin.id, { x: newX, y: newY });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, plugin.id, plugin.minSize, updatePosition, updateSize]);

  if (!instance) return null;

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: instance.position.x,
        top: instance.position.y,
        width: instance.size.w,
        height: instance.size.h,
        zIndex: instance.zIndex,
        borderRadius: "14px",
        overflow: "hidden",
        background: "var(--theme-cabinet-bg)",
        boxShadow: `
          inset 0 1px 0 rgba(255,255,255,0.14),
          inset 0 -1px 0 rgba(0,0,0,0.55),
          inset 0 0 22px rgba(0,0,0,0.35),
          0 24px 56px rgba(0,0,0,0.55)
        `,
        // 拖拽时禁用过渡，保证跟随光标
        transition: dragging ? "none" : "box-shadow 300ms ease",
      }}
      onPointerDown={() => bringToFront(plugin.id)}
    >
      {/* 标题栏（drag handle） */}
      <div
        className="flex items-center justify-between"
        onPointerDown={(e) => beginDrag({ type: "move" }, e)}
        style={{
          padding: "10px 14px",
          cursor: dragging ? "grabbing" : "grab",
          borderBottom: "1px solid rgba(0,0,0,0.35)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.06), transparent)",
          userSelect: "none",
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 14 }}>{plugin.icon}</span>
          <span
            className="font-display"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--theme-label)",
              filter: "brightness(1.4)",
              letterSpacing: "0.08em",
            }}
          >
            {plugin.name}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            close(plugin.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex items-center justify-center"
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(0,0,0,0.5)",
            color: "var(--theme-label)",
            fontSize: 9,
            cursor: "pointer",
            padding: 0,
            filter: "brightness(1.4)",
          }}
          aria-label="关闭面板"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "12px 14px",
          height: "calc(100% - 40px)",
          overflow: "auto",
        }}
      >
        {children}
      </div>

      {/* 缩放手柄：4 边 + 4 角 */}
      <ResizeHandle edge="n" onBegin={beginDrag} />
      <ResizeHandle edge="s" onBegin={beginDrag} />
      <ResizeHandle edge="e" onBegin={beginDrag} />
      <ResizeHandle edge="w" onBegin={beginDrag} />
      <ResizeHandle edge="ne" onBegin={beginDrag} />
      <ResizeHandle edge="nw" onBegin={beginDrag} />
      <ResizeHandle edge="se" onBegin={beginDrag} />
      <ResizeHandle edge="sw" onBegin={beginDrag} />
    </div>
  );
}

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function ResizeHandle({
  edge,
  onBegin,
}: {
  edge: Edge;
  onBegin: (kind: DragKind, e: React.PointerEvent) => void;
}) {
  const thick = 6;
  const corner = 12;
  const styles: Record<Edge, React.CSSProperties> = {
    n: { top: 0, left: corner, right: corner, height: thick, cursor: "ns-resize" },
    s: { bottom: 0, left: corner, right: corner, height: thick, cursor: "ns-resize" },
    e: { right: 0, top: corner, bottom: corner, width: thick, cursor: "ew-resize" },
    w: { left: 0, top: corner, bottom: corner, width: thick, cursor: "ew-resize" },
    ne: { top: 0, right: 0, width: corner, height: corner, cursor: "nesw-resize" },
    nw: { top: 0, left: 0, width: corner, height: corner, cursor: "nwse-resize" },
    se: { bottom: 0, right: 0, width: corner, height: corner, cursor: "nwse-resize" },
    sw: { bottom: 0, left: 0, width: corner, height: corner, cursor: "nesw-resize" },
  };
  return (
    <div
      style={{ position: "absolute", ...styles[edge] }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onBegin({ type: "resize", edge }, e);
      }}
    />
  );
}
