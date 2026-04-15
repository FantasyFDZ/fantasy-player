// 所有面板插件的中心注册表。
//
// 注意：
//   - PlaylistSync（歌单迁移）已迁移到 SettingsPanel 的 "歌单迁移" tab
//   - AiPlaylist（AI 选歌）已废弃，改用 SearchPanel 的 AI Search 模式

import type { PanelPlugin } from "@/lib/panelTypes";
import { MusicAnalysis } from "./MusicAnalysis/MusicAnalysis";

export const PANEL_PLUGINS: PanelPlugin[] = [
  {
    id: "music_analysis",
    name: "音绪",
    icon: "◎",
    minSize: { w: 380, h: 500 },
    defaultSize: { w: 440, h: 700 },
    component: MusicAnalysis,
    requiredCapabilities: ["llm", "audio-analysis"],
  },
];
