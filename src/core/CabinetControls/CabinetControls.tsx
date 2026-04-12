// 机柜下方按钮栏 —— 每个按钮对应一个已注册面板。
// 按钮 highlight 状态跟随面板的 visible。

import { usePanels } from "@/core/PanelManager/PanelProvider";

export function CabinetControls() {
  const { plugins, instances, toggle } = usePanels();

  if (plugins.length === 0) return null;

  return (
    <div
      className="flex items-center justify-center"
      style={{
        marginTop: 8,
        gap: 10,
      }}
    >
      {plugins.map((plugin) => {
        const active = instances[plugin.id]?.visible ?? false;
        return (
          <button
            key={plugin.id}
            type="button"
            onClick={() => toggle(plugin.id)}
            title={plugin.name}
            className="flex items-center justify-center transition-all hover:scale-110"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              fontSize: 13,
              cursor: "pointer",
              padding: 0,
              color: active
                ? "var(--theme-accent)"
                : "var(--theme-label)",
              background: active
                ? "rgba(0,0,0,0.45)"
                : "rgba(0,0,0,0.25)",
              border: `1px solid ${
                active ? "var(--theme-accent)" : "rgba(0,0,0,0.45)"
              }`,
              boxShadow: active
                ? `0 0 10px var(--theme-accent), inset 0 1px 0 rgba(255,255,255,0.15)`
                : "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 3px rgba(0,0,0,0.4)",
              filter: active ? "brightness(1.2)" : "brightness(1)",
            }}
            aria-pressed={active}
          >
            {plugin.icon}
          </button>
        );
      })}
    </div>
  );
}
