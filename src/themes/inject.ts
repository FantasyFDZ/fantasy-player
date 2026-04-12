// 把 ThemeDefinition 翻译成 CSS 自定义属性。
// 组件使用 CSS 变量，LightLayer 使用 rays/glows/dust 数组（见 LightLayer.tsx）。

import { THEMES } from "./registry";
import type { ThemeId } from "./types";

export function applyTheme(id: ThemeId) {
  const t = THEMES[id];
  const root = document.documentElement;
  root.dataset.theme = id;
  const set = (k: string, v: string) => root.style.setProperty(k, v);

  // 全局背景
  set("--theme-bg", t.background);

  // 机柜
  set("--theme-cabinet-bg", t.cabinet.background);
  set("--theme-cabinet-shadow", t.cabinet.shadow);

  // 唱片外框
  set("--theme-disc-frame-bg", t.discFrame.background);
  set("--theme-disc-frame-border", t.discFrame.border);
  set("--theme-disc-shadow", t.disc.shadow);

  // 拨杆
  set("--theme-lever-ball", t.lever.ballBg);
  set("--theme-lever-stem", t.lever.stemBg);
  set("--theme-lever-slot", t.lever.slotBg);
  set("--theme-lever-slot-border", t.lever.slotBorder);
  set("--theme-lever-tag", t.lever.tagColor);

  // MELODY / 机脚
  set("--theme-label", t.labelColor);
  set("--theme-foot", t.footColor);

  // 唱臂
  set("--theme-arm-outer", t.tonearm.armOuter);
  set("--theme-arm-inner", t.tonearm.armInner);
  set("--theme-arm-head", t.tonearm.head);
  set("--theme-arm-needle", t.tonearm.needle);
  set("--theme-arm-pivot-fill", t.tonearm.pivotFill);
  set("--theme-arm-pivot-stroke", t.tonearm.pivotStroke);

  set("--theme-accent", t.accent);

  // 歌词
  set("--theme-lyrics-title", t.lyrics.title);
  set("--theme-lyrics-artist", t.lyrics.artist);
  set("--theme-lyrics-active", t.lyrics.active);
  set("--theme-lyrics-next", t.lyrics.nextLine);
  set("--theme-lyrics-mid", t.lyrics.mid);
  set("--theme-lyrics-far", t.lyrics.far);

  // 播放条
  set("--theme-playbar-bg", t.playbar.background);
  set("--theme-playbar-progress-track", t.playbar.progressTrack);
  set("--theme-playbar-progress-fill", t.playbar.progressFill);
  set("--theme-playbar-btn-bg", t.playbar.playBtnBg);
  set("--theme-playbar-btn-color", t.playbar.playBtnColor);
  set("--theme-playbar-btn-border", t.playbar.playBtnBorder ?? "none");
  set("--theme-playbar-text", t.playbar.textColor);
  set("--theme-playbar-icon", t.playbar.iconColor);

  // 全局文本（from lyrics.title）— 用于顶部栏等通用 UI 场景
  set("--theme-text", t.lyrics.title);
  set("--theme-text-muted", t.lyrics.artist);
}
