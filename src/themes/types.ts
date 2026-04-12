// 主题数据模型 —— 与 gramophone-final-v7.html 原型一一对应。
//
// 和之前版本的区别：
//   - 废弃 light.{origin,color,angle,blur,intensity} 单参数配置
//   - 改为 per-theme 独立 god-rays 和 ambient glow 配置，由 LightLayer 按需渲染
//   - 机柜 / 唱片 / 唱臂的具体色号全部原生采自原型 HTML
//
// 这样 UI 组件只需使用 CSS 变量，而 LightLayer 可直接消费 rays/glows 数组
// 得到原型几乎像素级的还原。

export type ThemeId =
  | "afternoon_sun"
  | "moonlit_study"
  | "sunset_jazz"
  | "misty_forest"
  | "sakura_wafu"
  | "deep_space";

/** 一条 god-ray 光柱（绝对定位在 scene 上） */
export interface GodRay {
  top: string; // 例如 "-80px"
  left: string; // 例如 "18%"
  width: string; // 例如 "70px"
  height: string; // 例如 "520px"
  /** CSS background 完整字符串（通常是 linear 或 radial gradient） */
  background: string;
  /** filter blur px 值 */
  blur: number;
  /** CSS rotate deg 值 */
  rotate: number;
}

/** 环境辉光（大片柔和 radial） */
export interface AmbientGlow {
  top?: string;
  left?: string;
  width?: string;
  height?: string;
  inset?: string; // 优先 inset，有就覆盖 top/left/w/h
  background: string;
  blur?: number;
}

/** 浮尘粒子 */
export interface DustParticle {
  top: string;
  left: string;
  size: number; // px
  color: string;
  delay: number; // s
  /** 樱花主题用花瓣形状 */
  petal?: boolean;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;

  /** scene 大背景渐变 */
  background: string;

  /** 机柜主色 */
  cabinet: {
    /** 180deg linear-gradient 完整值 */
    background: string;
    /** box-shadow */
    shadow: string;
    /** 内顶高光 inset */
    innerTop: string;
  };

  /** 唱片外框（disc-frame，围绕 disc 的淡色环） */
  discFrame: {
    background: string; // radial-gradient
    border: string; // "3px solid rgba(...)"
  };

  /** 唱片自身（disc）—— 只有 box-shadow 主题有差异 */
  disc: {
    shadow: string;
  };

  /** 拨杆金属色 */
  lever: {
    /** 顶端金属球 */
    ballBg: string; // radial-gradient
    /** 杆身 */
    stemBg: string; // linear-gradient
    /** 底座插槽 */
    slotBg: string;
    slotBorder: string;
    tagColor: string;
  };

  /** MELODY 标签颜色 */
  labelColor: string;

  /** 机脚颜色 */
  footColor: string;

  /** 唱臂颜色组（原型每主题 tonearm SVG 使用不同暖/冷调色） */
  tonearm: {
    /** 主线 stroke */
    armOuter: string;
    /** 内层高光线 stroke */
    armInner: string;
    /** 头部 rect fill */
    head: string;
    /** 唱针 stroke */
    needle: string;
    /** 枢轴 fill + stroke */
    pivotFill: string;
    pivotStroke: string;
  };

  /** 主 accent（播放按钮、进度条主色） */
  accent: string;

  /** 歌词颜色（原型每主题有 5 级 color） */
  lyrics: {
    title: string;
    artist: string;
    active: string; // 当前行
    nextLine: string; // 当前行前后一行（中等强调）
    mid: string; // 次一级
    far: string; // 最远的行
  };

  /** 播放条半透明背景 */
  playbar: {
    background: string;
    progressTrack: string;
    progressFill: string; // linear-gradient
    playBtnBg: string;
    playBtnColor: string;
    textColor: string;
    iconColor: string;
    playBtnBorder?: string;
  };

  /** per-theme 灯光合成 */
  godRays: GodRay[];
  ambientGlows: AmbientGlow[];
  dust: DustParticle[];
}
