// 所有 AI 面板插件的中心注册表。
// 新增面板只需：
//   1. 实现组件并从子目录导出
//   2. 在这里加一条 PanelPlugin entry

import type { PanelPlugin } from "@/lib/panelTypes";
import { MusicAnalysis } from "./MusicAnalysis/MusicAnalysis";

export const PANEL_PLUGINS: PanelPlugin[] = [
  {
    id: "music_analysis",
    name: "音乐分析",
    icon: "◎",
    minSize: { w: 280, h: 320 },
    defaultSize: { w: 360, h: 480 },
    component: MusicAnalysis,
    requiredCapabilities: ["llm", "audio-analysis"],
  },
];
