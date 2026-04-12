// 渲染所有已打开的面板。
// 这个 host 是一个全窗口覆盖的浮层，PanelFrame 里的坐标相对于
// 整个 viewport，可以放到留声机/歌词/header/playbar 的任何位置。
//
// 本身 pointer-events:none 避免遮挡下层 UI，PanelFrame 内部恢复
// 为 auto 以接收拖拽和点击事件。

import type { Song } from "@/lib/api";
import { PanelFrame } from "./PanelFrame";
import { usePanels } from "./PanelProvider";

interface Props {
  song: Song | null;
}

export function PanelHost({ song }: Props) {
  const { plugins, instances } = usePanels();

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 15 }}
    >
      {plugins.map((plugin) => {
        const instance = instances[plugin.id];
        if (!instance?.visible) return null;
        const Component = plugin.component;
        return (
          <PanelFrame key={plugin.id} plugin={plugin}>
            <Component song={song} />
          </PanelFrame>
        );
      })}
    </div>
  );
}
