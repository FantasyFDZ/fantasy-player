// 所有面板插件的中心注册表。
// 新增面板只需：
//   1. 实现组件并从子目录导出
//   2. 在这里加一条 PanelPlugin entry

import type { PanelPlugin } from "@/lib/panelTypes";
import { MusicAnalysis } from "./MusicAnalysis/MusicAnalysis";
import { SettingsPanelPlugin } from "./Settings/SettingsPanelPlugin";

export const PANEL_PLUGINS: PanelPlugin[] = [
  {
    id: "music_analysis",
    name: "音乐分析",
    icon: "◎",
    minSize: { w: 320, h: 400 },
    defaultSize: { w: 380, h: 540 },
    component: MusicAnalysis,
    requiredCapabilities: ["llm", "audio-analysis"],
  },
  {
    id: "settings",
    name: "设置",
    icon: "⚙",
    minSize: { w: 380, h: 400 },
    defaultSize: { w: 480, h: 580 },
    component: SettingsPanelPlugin,
  },
];
