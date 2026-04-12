// Settings panel 的 plugin 适配器 —— 让 SettingsPanel 能被
// PANEL_PLUGINS 注册。设置 plugin 不需要 song prop，忽略它。

import type { PanelProps } from "@/lib/panelTypes";
import { SettingsPanel } from "@/components/SettingsPanel";

export function SettingsPanelPlugin(_props: PanelProps) {
  return <SettingsPanel />;
}
