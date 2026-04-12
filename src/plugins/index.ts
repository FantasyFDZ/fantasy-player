// 所有面板插件的中心注册表。
// 目前只有一个聚合面板 music_analysis，内含 4 个 tab：
// 音乐特征 / AI 短评 / 热评 / 设置。

import type { PanelPlugin } from "@/lib/panelTypes";
import { MusicAnalysis } from "./MusicAnalysis/MusicAnalysis";

export const PANEL_PLUGINS: PanelPlugin[] = [
  {
    id: "music_analysis",
    name: "音乐分析",
    icon: "◎",
    minSize: { w: 380, h: 500 },
    // 默认宽度够四个 tab 展示，高度由右侧开关打开时动态设为主窗口高度
    defaultSize: { w: 440, h: 700 },
    component: MusicAnalysis,
    requiredCapabilities: ["llm", "audio-analysis"],
  },
];
