// 黑胶唱片 —— 对照 gramophone-final-v7.html 原型 1:1 还原。
//
// 层次（与原型 .disc-container → .disc-frame → .disc → grooves/art/center 一致）：
//   .disc-container (size × size)
//     .disc-frame        —— 主题色 radial 渐变 + 主题色细边，给黑胶一圈"光晕"质感
//       .disc            —— 黑胶本体 radial 同心环，负责整体黑漆光泽
//         grooves        —— 细密刻纹（repeating-radial）
//         disc-art       —— 专辑封面 label (56%)，内嵌深边 + 内阴影 → 金属压制感
//         disc-center    —— 中心主轴（银色小点）
//
// 约束：不再加粗的外缘深色环（用户明确让去掉），但 frame 的 padding / 边框 /
// 渐变必须保留，否则唱片看起来只是"一张黑图"。

interface Props {
  /** 封面 URL，没有则显示占位 */
  coverUrl?: string;
  /** 容器宽高 px，由 Gramophone 决定 */
  size: number;
  /** 正在播放 → 旋转 */
  spinning: boolean;
}

export function Disc({ coverUrl, size, spinning }: Props) {
  // 原型是 disc 200 → padding 5 / border 3 / art 112 / center 10
  // 这里按 size 等比缩放，避免 size 变大时细节被压扁。
  const framePadding = Math.max(2, size * 0.025); // ≈ 7 at size=280
  const frameBorder = Math.max(1, size * 0.015); // ≈ 4 at size=280
  const artSize = size * 0.56; // 与原型一致
  const artBorder = Math.max(2, size * 0.015); // 内嵌深边
  const centerSize = size * 0.05; // 主轴小银点

  return (
    <div
      className="disc-container relative"
      style={{ width: size, height: size, borderRadius: "50%" }}
    >
      {/* ---- disc-frame：主题色 radial 渐变 + 细边，担任"光晕圈" ---- */}
      <div
        className="disc-frame relative h-full w-full"
        style={{
          padding: framePadding,
          borderRadius: "50%",
          background: "var(--theme-disc-frame-bg)",
          border: `${frameBorder}px solid var(--theme-disc-frame-border)`,
          boxSizing: "border-box",
        }}
      >
        {/* ---- disc：黑胶本体 ---- */}
        <div
          className="disc relative h-full w-full"
          style={{
            borderRadius: "50%",
            // 原型的 radial-gradient 同心环（52/53/54/68/69/88 stops）
            // 这组断点是黑胶"光泽 + 暗环"的灵魂，请勿轻改。
            background:
              "radial-gradient(circle, #1a1a1a 52%, #111 53%, #1a1a1a 54%, #0e0e0e 68%, #1a1a1a 69%, #111 88%, #1a1a1a 100%)",
            boxShadow: "var(--theme-disc-shadow)",
            animation: spinning
              ? "melody-disc-spin 4s linear infinite"
              : "none",
            animationPlayState: spinning ? "running" : "paused",
          }}
        >
          {/* ---- 细密刻纹：repeating-radial，给黑胶"可见的圈" ---- */}
          <div
            className="disc-grooves absolute inset-0 pointer-events-none"
            style={{
              borderRadius: "50%",
              background:
                "repeating-radial-gradient(circle at center, transparent 0px, transparent 2.5px, rgba(255,255,255,0.04) 3px, transparent 3.5px)",
            }}
          />

          {/* ---- 专辑封面标签 (disc-art) ---- */}
          <div
            className="disc-art absolute overflow-hidden"
            style={{
              width: artSize,
              height: artSize,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              border: `${artBorder}px solid #282828`,
              background: "#2a1a1a",
              boxShadow:
                "inset 0 0 10px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.6)",
            }}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center"
                style={{ background: "var(--theme-disc-frame-bg)" }}
              >
                <span
                  className="font-display"
                  style={{
                    color: "var(--theme-label)",
                    opacity: 0.7,
                    fontSize: artSize * 0.42,
                  }}
                >
                  M
                </span>
              </div>
            )}
          </div>

          {/* ---- 中心主轴：金属小银点 ---- */}
          <div
            className="disc-center absolute"
            style={{
              width: centerSize,
              height: centerSize,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background: "radial-gradient(circle at 40% 35%, #bcbcbc, #6a6a6a 60%, #333)",
              boxShadow:
                "0 0 0 1px rgba(0,0,0,0.6), inset 0 0 2px rgba(0,0,0,0.5)",
              zIndex: 2,
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes melody-disc-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
