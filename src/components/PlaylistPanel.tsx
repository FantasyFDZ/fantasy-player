// 歌单面板 —— 顶部"歌单"按钮触发。
//
// 两层视图:
//   1. 歌单列表: 「我喜欢的」置顶 + 用户所有歌单(创建 + 收藏)
//   2. 歌曲列表: 选中歌单的曲目,支持多选 / 全选 / 立即播放 / 加入队列
//
// 交互:
//   - 歌单列表点击 → 进入该歌单详情
//   - 歌曲单击切换选中,双击立即播放(从该首开始)
//   - 底部: 全选 · 立即播放 · 加入队列

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Playlist, type Song } from "@/lib/api";

interface Props {
  /** 立即播放: 替换队列并开始播放 */
  onPlay: (song: Song, queue: Song[]) => void;
  /** 加入播放列表: 追加到现有队列末尾 */
  onAddToQueue: (song: Song) => void;
}

export function PlaylistPanel({ onPlay, onAddToQueue }: Props) {
  // ---- 歌单列表 ----
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);

  // ---- 歌单详情 ----
  const [active, setActive] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Song[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);

  // ---- 多选 ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [toast, setToast] = useState("");

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 1800);
  }, []);

  // 拉取歌单列表
  useEffect(() => {
    let cancelled = false;
    setPlaylistsLoading(true);
    setPlaylistsError(null);
    api
      .getUserPlaylists(80)
      .then((pls) => {
        if (cancelled) return;
        setPlaylists(pls);
        setPlaylistsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setPlaylistsError(err instanceof Error ? err.message : String(err));
        setPlaylistsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中歌单后拉取详情
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setTracksLoading(true);
    setTracksError(null);
    setTracks([]);
    setSelectedIds(new Set());
    api
      .getPlaylistDetail(active.id, 1000)
      .then((detail) => {
        if (cancelled) return;
        // 去重 —— 网易云偶尔会返回同 id 重复条目
        const seen = new Set<string>();
        const list: Song[] = [];
        for (const t of detail.tracks) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            list.push(t);
          }
        }
        setTracks(list);
        setTracksLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setTracksError(err instanceof Error ? err.message : String(err));
        setTracksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  // 把"我喜欢的"置顶(special_type === 5)
  const orderedPlaylists = useMemo(() => {
    if (!playlists) return [];
    const fav = playlists.filter((pl) => pl.special_type === 5);
    const rest = playlists.filter((pl) => pl.special_type !== 5);
    return [...fav, ...rest];
  }, [playlists]);

  const selectedSongs = useMemo(
    () => tracks.filter((s) => selectedIds.has(s.id)),
    [tracks, selectedIds],
  );
  const allSelected = tracks.length > 0 && selectedIds.size === tracks.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(tracks.map((s) => s.id)));
  };

  const handlePlayNow = () => {
    if (selectedSongs.length === 0) return;
    const [first, ...rest] = selectedSongs;
    onPlay(first, [first, ...rest]);
  };

  const handleAddToQueueAll = () => {
    if (selectedSongs.length === 0) return;
    try {
      for (const s of selectedSongs) onAddToQueue(s);
      showToast(`已加入 ${selectedSongs.length} 首到播放列表`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const back = () => {
    setActive(null);
    setTracks([]);
    setTracksError(null);
    setSelectedIds(new Set());
  };

  // ==================== render: 歌单列表视图 ====================
  if (!active) {
    return (
      <div className="flex h-full flex-col gap-4">
        <div
          className="flex items-center justify-between"
          style={{ flexShrink: 0 }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: "10px",
              letterSpacing: "0.24em",
              color: "var(--theme-label)",
              filter: "brightness(1.4)",
              textTransform: "uppercase",
            }}
          >
            我的歌单{playlists ? ` · ${playlists.length}` : ""}
          </div>
        </div>

        {playlistsError && (
          <NotificationBar tone="error">{playlistsError}</NotificationBar>
        )}

        <div
          className="flex-1 overflow-y-auto rounded-md"
          style={{
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(0,0,0,0.45)",
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6)",
            minHeight: 0,
          }}
        >
          {playlistsLoading && orderedPlaylists.length === 0 && (
            <div
              className="flex h-full items-center justify-center"
              style={{
                color: "var(--theme-label)",
                filter: "brightness(1.3)",
                fontFamily: "var(--font-display)",
                fontSize: "12px",
              }}
            >
              加载歌单...
            </div>
          )}
          {!playlistsLoading &&
            !playlistsError &&
            orderedPlaylists.length === 0 && (
              <div
                className="flex h-full items-center justify-center"
                style={{
                  color: "var(--theme-label)",
                  filter: "brightness(1.3)",
                  fontFamily: "var(--font-display)",
                  fontSize: "12px",
                }}
              >
                没有歌单 —— 请先登录网易云
              </div>
            )}
          {orderedPlaylists.map((pl) => {
            const isFav = pl.special_type === 5;
            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => setActive(pl)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5"
                style={{
                  borderBottom: "1px solid rgba(0,0,0,0.3)",
                  background: "transparent",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 4,
                    overflow: "hidden",
                    flexShrink: 0,
                    background: "rgba(0,0,0,0.3)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.6)",
                    position: "relative",
                  }}
                >
                  {pl.cover_url && (
                    <img
                      src={pl.cover_url}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                  {isFav && (
                    <span
                      style={{
                        position: "absolute",
                        right: 2,
                        bottom: 1,
                        fontSize: 10,
                        color: "rgba(255,120,140,0.95)",
                        textShadow: "0 1px 2px rgba(0,0,0,0.7)",
                      }}
                    >
                      ♥
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <div
                    className="truncate"
                    style={{
                      fontSize: "14px",
                      color: isFav
                        ? "var(--theme-accent)"
                        : "rgba(255,240,220,0.95)",
                      fontFamily: "var(--font-display)",
                      fontWeight: 500,
                    }}
                  >
                    {pl.name}
                  </div>
                  <div
                    className="truncate"
                    style={{
                      fontSize: "11px",
                      color: "rgba(255,220,180,0.55)",
                      fontFamily: "var(--font-mono)",
                      letterSpacing: "0.08em",
                      marginTop: 2,
                    }}
                  >
                    {pl.track_count} 首 · {pl.creator_name}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 14,
                    color: "rgba(255,220,180,0.4)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  ›
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ==================== render: 歌曲列表视图 ====================
  return (
    <div className="flex h-full flex-col gap-4">
      {/* 标题栏 —— 返回按钮 + 歌单名 */}
      <div
        className="flex items-center gap-3"
        style={{ flexShrink: 0 }}
      >
        <button
          type="button"
          onClick={back}
          className="font-mono transition-colors hover:brightness-125"
          style={{
            fontSize: "10px",
            letterSpacing: "0.2em",
            padding: "4px 10px",
            color: "var(--theme-accent)",
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          ← 返回
        </button>
        <div className="flex-1 overflow-hidden">
          <div
            className="truncate"
            style={{
              fontSize: "14px",
              color: "rgba(255,240,220,0.95)",
              fontFamily: "var(--font-display)",
              fontWeight: 500,
            }}
          >
            {active.name}
          </div>
          <div
            className="truncate"
            style={{
              fontSize: "10px",
              color: "rgba(255,220,180,0.55)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
            }}
          >
            {active.track_count} 首 · {active.creator_name}
          </div>
        </div>
      </div>

      {tracksError && (
        <NotificationBar tone="error">{tracksError}</NotificationBar>
      )}

      {/* 曲目列表 */}
      <div
        className="flex-1 overflow-y-auto rounded-md"
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(0,0,0,0.45)",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6)",
          minHeight: 0,
        }}
      >
        {tracksLoading && tracks.length === 0 && (
          <div
            className="flex h-full items-center justify-center"
            style={{
              color: "var(--theme-label)",
              filter: "brightness(1.3)",
              fontFamily: "var(--font-display)",
              fontSize: "12px",
            }}
          >
            加载歌曲...
          </div>
        )}
        {!tracksLoading && !tracksError && tracks.length === 0 && (
          <div
            className="flex h-full items-center justify-center"
            style={{
              color: "var(--theme-label)",
              filter: "brightness(1.3)",
              fontFamily: "var(--font-display)",
              fontSize: "12px",
            }}
          >
            空歌单
          </div>
        )}
        {tracks.map((song) => {
          const selected = selectedIds.has(song.id);
          return (
            <button
              key={song.id}
              type="button"
              onClick={() => toggleSelect(song.id)}
              onDoubleClick={() => {
                const idx = tracks.findIndex((s) => s.id === song.id);
                onPlay(song, tracks.slice(idx));
              }}
              className="relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5 disabled:opacity-40"
              style={{
                borderBottom: "1px solid rgba(0,0,0,0.3)",
                background: selected
                  ? "rgba(255,255,255,0.05)"
                  : "transparent",
              }}
              disabled={!song.playable}
            >
              {selected && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 6,
                    bottom: 6,
                    width: 3,
                    background: "var(--theme-accent)",
                    borderRadius: "0 2px 2px 0",
                  }}
                />
              )}
              <Checkbox checked={selected} />
              {song.cover_url && (
                <img
                  src={song.cover_url}
                  alt=""
                  className="h-10 w-10 rounded-sm"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.6)" }}
                />
              )}
              <div className="flex-1 overflow-hidden">
                <div
                  className="truncate text-[14px]"
                  style={{
                    color: selected
                      ? "var(--theme-accent)"
                      : "rgba(255,240,220,0.95)",
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                  }}
                >
                  {song.name}
                </div>
                <div
                  className="truncate text-[11px]"
                  style={{
                    color: "rgba(255,220,180,0.55)",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.08em",
                  }}
                >
                  {song.artist} · {song.album}
                </div>
              </div>
              <div
                className="text-[10px]"
                style={{
                  color: "rgba(255,220,180,0.5)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {formatDuration(song.duration_secs)}
              </div>
            </button>
          );
        })}
      </div>

      {/* 底部操作栏 */}
      <div
        className="flex items-center gap-3"
        style={{ flexShrink: 0, minHeight: 40 }}
      >
        {tracks.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-1.5"
            style={{
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              color: "rgba(255,220,180,0.7)",
              letterSpacing: "0.08em",
              padding: "4px 6px",
              borderRadius: 4,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <Checkbox checked={allSelected} />
            <span>全选</span>
          </button>
        )}
        <div
          className="flex-1 text-[11px]"
          style={{
            color: toast ? "var(--theme-accent)" : "rgba(255,220,180,0.5)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            transition: "color 0.2s",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {toast ||
            (selectedSongs.length > 0
              ? `已选 ${selectedSongs.length} 首`
              : "点击选中 · 双击立即播放")}
        </div>
        <ActionButton
          onClick={handlePlayNow}
          disabled={selectedSongs.length === 0}
        >
          立即播放
        </ActionButton>
        <ActionButton
          onClick={handleAddToQueueAll}
          disabled={selectedSongs.length === 0}
          accent
        >
          加入队列
        </ActionButton>
      </div>
    </div>
  );
}

// ---- sub-components --------------------------------------------------------

function ActionButton({
  onClick,
  disabled,
  accent,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-4 py-2 text-sm transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        fontSize: "11px",
        color: "var(--theme-accent)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
        border: accent
          ? "1px solid var(--theme-accent)"
          : "1px solid rgba(255,255,255,0.15)",
        boxShadow: accent
          ? "inset 0 1px 0 rgba(255,255,255,0.15), 0 2px 4px rgba(0,0,0,0.5)"
          : "inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.4)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function NotificationBar({
  tone,
  children,
}: {
  tone: "error" | "warn";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? {
          background: "rgba(120,20,20,0.35)",
          color: "rgba(255,200,180,0.95)",
          border: "1px solid rgba(180,50,40,0.5)",
        }
      : {
          background: "rgba(60,40,0,0.35)",
          color: "rgba(255,220,160,0.95)",
          border: "1px solid rgba(180,140,40,0.4)",
        };
  return (
    <div className="rounded-md px-3 py-2 text-xs" style={styles}>
      {children}
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        border: checked ? "none" : "1.5px solid rgba(255,255,255,0.3)",
        background: checked
          ? "var(--theme-accent, rgba(120,120,255,0.9))"
          : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "all 0.15s",
      }}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path
            d="M1 3.5L3.5 6L9 1"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
