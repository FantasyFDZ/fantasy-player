// 所有面板插件的中心注册表。

import type { PanelPlugin } from "@/lib/panelTypes";
import { AiDj } from "./AiDj/AiDj";
import { AiPlaylist } from "./AiPlaylist/AiPlaylist";
import { MusicAnalysis } from "./MusicAnalysis/MusicAnalysis";
import { PlaylistSync } from "./PlaylistSync/PlaylistSync";

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
  {
    id: "ai_playlist",
    name: "AI 选歌",
    icon: "💬",
    minSize: { w: 380, h: 500 },
    defaultSize: { w: 440, h: 700 },
    component: AiPlaylist,
    requiredCapabilities: ["llm"],
  },
  {
    id: "ai_dj",
    name: "AI DJ",
    icon: "🎛",
    minSize: { w: 400, h: 550 },
    defaultSize: { w: 460, h: 750 },
    component: AiDj,
    requiredCapabilities: ["llm", "audio-analysis"],
  },
  {
    id: "playlist_sync",
    name: "歌单迁移",
    icon: "🔄",
    minSize: { w: 360, h: 500 },
    defaultSize: { w: 420, h: 650 },
    component: PlaylistSync,
    requiredCapabilities: [],
  },
];
