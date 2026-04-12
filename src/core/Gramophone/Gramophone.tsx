// 整装留声机 —— 按 gramophone-final-v7.html 原型紧凑比例。
//
// 原型尺寸（flex: 0 0 270px）：
//   disc-container: 200×200
//   cabinet:        250×75
//   feet container: 230px
//
// 我按 1.4x 缩放放入 1480×860 窗口：
//   disc-container: 280×280
//   cabinet:        约 350×105
//   整个 gramophone 宽约 378px

import { Cabinet } from "./Cabinet";
import { Disc } from "./Disc";
import { Tonearm } from "./Tonearm";

const DISC_SIZE = 280;
const CABINET_WIDTH = 350;

interface Props {
  coverUrl?: string;
  playing: boolean;
}

export function Gramophone({ coverUrl, playing }: Props) {
  return (
    <div className="relative flex flex-col items-center">
      {/* 唱片 + 唱臂：绝对定位 wrapper，保持 280×280 固定尺寸 */}
      <div
        className="relative"
        style={{
          width: DISC_SIZE,
          height: DISC_SIZE,
        }}
      >
        <Disc coverUrl={coverUrl} size={DISC_SIZE} spinning={playing} />
        {/* Tonearm 以 DISC_SIZE 的 50% 作为 SVG 尺寸，即放大 2.8x 于原型 */}
        <Tonearm size={DISC_SIZE * 0.5} playing={playing} />
      </div>

      {/* 机柜（紧跟在 disc 下方，margin-top -5px 与原型一致） */}
      <Cabinet width={CABINET_WIDTH} />
    </div>
  );
}
