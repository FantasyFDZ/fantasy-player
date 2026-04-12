// 机柜 —— 与 gramophone-final-v7.html 原型对齐。
//
// 原型结构：
//   .cabinet { 250×75, border-radius: 8px 8px 6px 6px; margin-top: -5px;
//              display: flex; align-items: center; justify-content: center; gap: 16px }
//     .cabinet-wood (repeating-linear 木纹 overlay)
//     .lever-unit VOL
//     .cabinet-label MELODY (font-size 7px, letter-spacing 3px, opacity 0.4)
//     .lever-unit TONE
//
//   .lever-unit (vertical column)
//     .lever-tip-ball (7×7)
//     .lever-stem (3×10)
//     .lever-slot (10×6)
//     .lever-tag (6px text)
//
//   .feet (230px wide, flex between)
//     .foot (9×5, radius 0 0 4px 4px)

interface Props {
  /** cabinet 宽度 px，通常 = Gramophone 容器宽度的 ~93% */
  width: number;
}

export function Cabinet({ width }: Props) {
  // 原型基准 cabinet 250×75 → height / width 比例 0.3
  const height = width * 0.3;
  // 原型基准 feet 230px wide, foot 9×5
  const feetWidth = width * 0.92;
  // 根据原型比例推断缩放系数
  const scale = width / 250;

  return (
    <div
      className="relative flex flex-col items-center"
      style={{ width: "100%" }}
    >
      {/* 主 cabinet */}
      <div
        className="relative flex items-center justify-center"
        style={{
          width,
          height,
          marginTop: -5 * scale,
          borderRadius: "8px 8px 6px 6px",
          background: "var(--theme-cabinet-bg)",
          boxShadow: "var(--theme-cabinet-shadow)",
          gap: 16 * scale,
        }}
      >
        {/* 木纹 overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: "inherit",
            opacity: 0.2,
            background:
              "repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(0,0,0,0.05) 8px, rgba(0,0,0,0.05) 9px)",
          }}
        />

        <LeverUnit label="VOL" scale={scale} />

        <span
          style={{
            position: "relative",
            zIndex: 1,
            fontSize: 7 * scale,
            letterSpacing: `${3 * scale}px`,
            opacity: 0.4,
            color: "var(--theme-label)",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
          }}
        >
          MELODY
        </span>

        <LeverUnit label="TONE" scale={scale} />
      </div>

      {/* 机脚 */}
      <div
        className="flex justify-between"
        style={{
          width: feetWidth,
          marginTop: 2 * scale,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              width: 9 * scale,
              height: 5 * scale,
              borderRadius: `0 0 ${4 * scale}px ${4 * scale}px`,
              background: "var(--theme-foot)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function LeverUnit({ label, scale }: { label: string; scale: number }) {
  return (
    <div
      className="relative flex flex-col items-center"
      style={{ zIndex: 1 }}
    >
      {/* 顶端金属球（7x7） */}
      <div
        style={{
          width: 7 * scale,
          height: 7 * scale,
          borderRadius: "50%",
          marginBottom: 1 * scale,
          background: "var(--theme-lever-ball)",
          boxShadow: "0 -1px 3px rgba(0,0,0,0.3)",
        }}
      />
      {/* 杆身（3x10） */}
      <div
        style={{
          width: 3 * scale,
          height: 10 * scale,
          borderRadius: `${1.5 * scale}px`,
          background: "var(--theme-lever-stem)",
        }}
      />
      {/* 插槽（10x6） */}
      <div
        style={{
          width: 10 * scale,
          height: 6 * scale,
          borderRadius: `${2 * scale}px`,
          background: "var(--theme-lever-slot)",
          border: "var(--theme-lever-slot-border)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)",
        }}
      />
      {/* 标签 */}
      <span
        style={{
          fontSize: 6 * scale,
          letterSpacing: `${1 * scale}px`,
          opacity: 0.35,
          marginTop: 3 * scale,
          color: "var(--theme-lever-tag)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}
