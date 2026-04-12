// 黑胶唱片 —— 对照 gramophone-final-v7.html 原型 1:1 还原，
// 然后按 Gramophone.tsx 里的 SCALE 整体缩放。
//
// 层次（与原型一致）：
//   .disc-container (size × size)
//     .disc-frame (padding 5px*SCALE, 渐变外环)
//       .disc (radial-gradient 同心环)
//         .disc-grooves (repeating-radial 细纹)
//         .disc-art (封面 56%)
//         .disc-center (小银点)

interface Props {
  /** 封面 URL，没有则显示占位 */
  coverUrl?: string;
  /** 容器宽高 px，Gramophone 决定 */
  size: number;
  /** 正在播放 → 旋转 */
  spinning: boolean;
}

export function Disc({ coverUrl, size, spinning }: Props) {
  // 原型 disc 200 → disc-art 112（56%）
  // 原型 disc 200 → disc-center 10 / disc-frame padding 5 / frame border 3
  const artSize = size * 0.56;
  const centerSize = size * 0.05;
  const framePadding = 0;

  return (
    <div
      className="disc-container relative"
      style={{ width: size, height: size, borderRadius: "50%" }}
    >
      <div
        className="disc-frame relative h-full w-full"
        style={{
          padding: framePadding,
          borderRadius: "50%",
          background: "var(--theme-disc-frame-bg)",
        }}
      >
        <div
          className="disc relative h-full w-full"
          style={{
            borderRadius: "50%",
            // 原型的 radial-gradient 同心环（52/53/54/68/69/88 stops）
            background:
              "radial-gradient(circle, #1a1a1a 52%, #111 53%, #1a1a1a 54%, #0e0e0e 68%, #1a1a1a 69%, #111 88%, #1a1a1a 100%)",
            boxShadow: "var(--theme-disc-shadow)",
            animation: spinning
              ? "melody-disc-spin 4s linear infinite"
              : "none",
            animationPlayState: spinning ? "running" : "paused",
          }}
        >
          {/* 细密刻纹（repeating-radial） */}
          <div
            className="absolute inset-0"
            style={{
              borderRadius: "50%",
              background:
                "repeating-radial-gradient(circle at center, transparent 0px, transparent 2.5px, rgba(255,255,255,0.02) 3px, transparent 3.5px)",
            }}
          />

          {/* 专辑封面标签 */}
          <div
            className="disc-art absolute overflow-hidden"
            style={{
              width: artSize,
              height: artSize,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              border: "3px solid #282828",
              background: "#2a1a1a",
              boxShadow: "inset 0 0 10px rgba(0,0,0,0.3)",
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
              <div className="flex h-full w-full items-center justify-center">
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

          {/* 中心主轴（小银点） */}
          <div
            className="absolute"
            style={{
              width: centerSize,
              height: centerSize,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background: "radial-gradient(circle, #888, #444)",
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
