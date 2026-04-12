// 主窗口右边缘的展开开关 —— 点击切换 music_analysis 面板窗口。
// 打开时窗口吸附到主窗口右侧，高度等于主窗口。

import { usePanels } from "@/core/PanelManager/PanelProvider";

const TARGET_PANEL_ID = "music_analysis";

export function SidePanelSwitch() {
  const { isOpen, toggle } = usePanels();
  const open = isOpen(TARGET_PANEL_ID);

  return (
    <button
      type="button"
      onClick={() => toggle(TARGET_PANEL_ID)}
      title={open ? "收起分析面板" : "展开分析面板"}
      className="absolute flex items-center justify-center transition-all"
      style={{
        right: 0,
        top: "50%",
        transform: "translateY(-50%)",
        width: 22,
        height: 64,
        border: "none",
        borderRadius: "8px 0 0 8px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.12), -2px 0 8px rgba(0,0,0,0.4)",
        borderTop: "1px solid rgba(0,0,0,0.4)",
        borderLeft: "1px solid rgba(0,0,0,0.4)",
        borderBottom: "1px solid rgba(0,0,0,0.4)",
        color: "var(--theme-accent)",
        cursor: "pointer",
        fontSize: 14,
        zIndex: 30,
        padding: 0,
      }}
    >
      {open ? "▶" : "◀"}
    </button>
  );
}
