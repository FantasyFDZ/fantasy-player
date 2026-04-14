// 面板切换按钮栏 —— 始终在主窗口右边缘。

import { usePanels } from "@/core/PanelManager/PanelProvider";
import { PANEL_PLUGINS } from "@/plugins";

export function SidePanelSwitch() {
  const { isOpen, toggle } = usePanels();

  return (
    <div
      className="absolute flex flex-col items-center gap-1"
      style={{
        right: 0,
        top: "50%",
        transform: "translateY(-50%)",
        padding: "6px 0",
        borderRadius: "8px 0 0 8px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.12), -2px 0 8px rgba(0,0,0,0.4)",
        borderTop: "1px solid rgba(0,0,0,0.4)",
        borderLeft: "1px solid rgba(0,0,0,0.4)",
        borderBottom: "1px solid rgba(0,0,0,0.4)",
        zIndex: 30,
        width: 28,
      }}
    >
      {PANEL_PLUGINS.map((plugin) => {
        const open = isOpen(plugin.id);
        return (
          <button
            key={plugin.id}
            type="button"
            onClick={() => toggle(plugin.id)}
            title={open ? `收起${plugin.name}` : plugin.name}
            className="flex items-center justify-center transition-all"
            style={{
              width: 22,
              height: 22,
              border: "none",
              borderRadius: 4,
              background: open ? "rgba(255,255,255,0.12)" : "transparent",
              color: open
                ? "var(--theme-accent)"
                : "var(--theme-lyrics-mid, rgba(255,255,255,0.4))",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
              lineHeight: 1,
            }}
          >
            {plugin.icon}
          </button>
        );
      })}
    </div>
  );
}
