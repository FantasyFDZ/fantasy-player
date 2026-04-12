// 浮动面板插件接口。
//
// 每个面板（AI 音乐分析、AI 点评、DJ 控制台等）通过实现 PanelPlugin
// 接口向 PanelProvider 注册。核心层只需要知道如何渲染一个 component，
// 不了解面板内部。

import type { ComponentType } from "react";
import type { Song } from "./api";

export interface PanelSize {
  w: number;
  h: number;
}

export interface PanelPosition {
  x: number;
  y: number;
}

/** 面板组件收到的 props —— 所有面板共享。 */
export interface PanelProps {
  /** 当前播放的歌，可能为 null */
  song: Song | null;
}

/** 插件定义，由各 plugins/ 子目录导出，集中注册到 plugins/index.ts */
export interface PanelPlugin {
  /** 唯一 id，用于持久化 panel_layout */
  id: string;
  /** 中文显示名（机柜按钮 tooltip + 面板标题栏） */
  name: string;
  /** 机柜按钮上的单字符图标（emoji 或 unicode），可选 2 字符 */
  icon: string;
  /** 最小尺寸，resize 时下限 */
  minSize: PanelSize;
  /** 首次打开时使用的尺寸 */
  defaultSize: PanelSize;
  /** 面板正文组件 */
  component: ComponentType<PanelProps>;
  /**
   * 可选：声明依赖能力，比如 ["llm", "audio-analysis"]。
   * 目前仅用于文档；将来 Phase 9 设置面板可依此显示警告。
   */
  requiredCapabilities?: string[];
}

/** 运行时面板实例（render 时使用）。 */
export interface PanelInstance {
  pluginId: string;
  visible: boolean;
  position: PanelPosition;
  size: PanelSize;
  /** 当前 z-index（每次点击置顶时 +1） */
  zIndex: number;
}
