// 唱臂 —— 与原型 HTML 1:1 对应。
//
// 原型结构：
//   .tonearm-wrap { position: absolute; top: -16px; right: -16px; z-index: 10 }
//   .tonearm-wrap svg { transform-origin: 88px 10px; transform: rotate(-4deg); }
//   svg viewBox="0 0 100 130" width="100" height="130"
//     <line x1="88" y1="10" x2="42" y2="95" ...>  (outer arm)
//     <line x1="88" y1="10" x2="45" y2="89" ...>  (inner highlight)
//     <rect x="36" y="93" w=10 h=14 rx=2 rotate(-8, 41, 100)>  (head)
//     <line x1="39" y1="105" x2="39" y2="111" rotate(-8, 39, 108)>  (needle)
//     <circle cx="93" cy="6" r="5">  (pivot)
//
// 状态：
//   - playing → rotate(-4deg) （原型默认，仅微调）
//   - paused → rotate(-22deg) （抬起让唱针离开唱片）
//
// 颜色全部从 CSS 变量读取（--theme-arm-*）。

interface Props {
  /** 唱臂区域宽度（= tonearm SVG 的 width, px） */
  size: number;
  playing: boolean;
}

export function Tonearm({ size, playing }: Props) {
  // 原型中 tonearm-wrap 位置 top:-16 right:-16，对应 disc 200 的 -8%
  const offset = -size * 0.16;
  // SVG 尺寸按 100:130 宽高比缩放
  const svgWidth = size;
  const svgHeight = size * 1.3;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: offset,
        right: offset,
        width: svgWidth,
        height: svgHeight,
        zIndex: 10,
      }}
    >
      <svg
        viewBox="0 0 100 130"
        width={svgWidth}
        height={svgHeight}
        style={{
          transformOrigin: "88px 10px",
          transform: playing ? "rotate(-4deg)" : "rotate(-22deg)",
          transition: "transform 1100ms cubic-bezier(0.42, 0, 0.18, 1.02)",
        }}
      >
        {/* 主臂外层（粗，低明度） */}
        <line
          x1="88"
          y1="10"
          x2="42"
          y2="95"
          stroke="var(--theme-arm-outer)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* 主臂内层（略细，高明度，形成金属光） */}
        <line
          x1="88"
          y1="10"
          x2="45"
          y2="89"
          stroke="var(--theme-arm-inner)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* 拾音头（旋转 -8°） */}
        <rect
          x="36"
          y="93"
          width="10"
          height="14"
          rx="2"
          fill="var(--theme-arm-head)"
          transform="rotate(-8, 41, 100)"
        />
        {/* 唱针 */}
        <line
          x1="39"
          y1="105"
          x2="39"
          y2="111"
          stroke="var(--theme-arm-needle)"
          strokeWidth="1.2"
          strokeLinecap="round"
          transform="rotate(-8, 39, 108)"
        />
        {/* 枢轴 */}
        <circle
          cx="93"
          cy="6"
          r="5"
          fill="var(--theme-arm-pivot-fill)"
          stroke="var(--theme-arm-pivot-stroke)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
