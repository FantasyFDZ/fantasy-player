// 搜索面板 —— 单选模式：
//   - 点击搜索结果只选中（左侧彩色竖条高亮），不立即播放
//   - 底部操作栏两个按钮：立即播放 / 加入播放列表

import { useState } from "react";
import { api, type Song } from "@/lib/api";

interface Props {
  /** 立即播放：替换队列并开始播放 */
  onPlay: (song: Song, queue: Song[]) => void;
  /** 加入播放列表：追加到现有队列末尾 */
  onAddToQueue: (song: Song) => void;
}

export function SearchPanel({ onPlay, onAddToQueue }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setSelectedId(null);
    try {
      const songs = await api.searchSongs(query, 30);
      setResults(songs);
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const selectedSong = selectedId
    ? results.find((s) => s.id === selectedId) ?? null
    : null;

  const handlePlay = () => {
    if (!selectedSong) return;
    const index = results.findIndex((s) => s.id === selectedSong.id);
    onPlay(selectedSong, results.slice(index));
  };

  const handleAdd = async () => {
    if (!selectedSong) return;
    try {
      onAddToQueue(selectedSong);
      setToast(`已加入：${selectedSong.name}`);
      window.setTimeout(() => setToast(""), 1600);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div
        className="mb-1 font-mono text-[10px] uppercase"
        style={{
          color: "var(--theme-wood-highlight)",
          letterSpacing: "0.24em",
          filter: "brightness(1.4)",
          textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        }}
      >
        Catalog Search
      </div>

      {/* 搜索框 */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索歌曲 / 艺人 / 专辑..."
          className="flex-1 rounded-md px-4 py-2.5 text-sm outline-none transition-all"
          style={{
            fontFamily: "var(--font-ui)",
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(0,0,0,0.45)",
            boxShadow:
              "inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.08)",
            color: "rgba(255,240,220,0.95)",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md px-5 py-2.5 text-sm transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--theme-accent)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
            border: "1px solid var(--theme-accent)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.15), 0 2px 4px rgba(0,0,0,0.5)",
          }}
        >
          {loading ? "..." : "Search"}
        </button>
      </form>

      {error && (
        <div
          className="rounded-md px-3 py-2 text-xs"
          style={{
            background: "rgba(120,20,20,0.35)",
            color: "rgba(255,200,180,0.95)",
            border: "1px solid rgba(180,50,40,0.5)",
          }}
        >
          {error}
        </div>
      )}

      {/* 结果列表 */}
      <div
        className="flex-1 overflow-y-auto rounded-md"
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(0,0,0,0.45)",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6)",
          minHeight: 0,
        }}
      >
        {results.length === 0 && !loading && (
          <div
            className="flex h-full items-center justify-center text-sm"
            style={{
              color: "var(--theme-label)",
              filter: "brightness(1.3)",
              fontFamily: "var(--font-display)",
            }}
          >
            输入关键词开始搜索
          </div>
        )}
        {results.map((song) => {
          const selected = selectedId === song.id;
          return (
            <button
              key={song.id}
              type="button"
              onClick={() => setSelectedId(song.id)}
              onDoubleClick={() => {
                const index = results.findIndex((s) => s.id === song.id);
                onPlay(song, results.slice(index));
              }}
              className="relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5 disabled:opacity-40"
              style={{
                borderBottom: "1px solid rgba(0,0,0,0.3)",
                background: selected ? "rgba(255,255,255,0.05)" : "transparent",
              }}
              disabled={!song.playable}
            >
              {/* 左侧高亮竖条 */}
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
              {song.cover_url && (
                <img
                  src={song.cover_url}
                  alt=""
                  className="h-10 w-10 rounded-sm"
                  style={{
                    boxShadow: "0 1px 3px rgba(0,0,0,0.6)",
                  }}
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
        style={{
          flexShrink: 0,
          minHeight: 40,
        }}
      >
        <div
          className="flex-1 text-[11px]"
          style={{
            color: toast ? "var(--theme-accent)" : "rgba(255,220,180,0.5)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            transition: "color 0.2s",
          }}
        >
          {toast ||
            (selectedSong
              ? `已选中：${selectedSong.name} — ${selectedSong.artist}`
              : "点击结果选中歌曲，双击立即播放")}
        </div>
        <button
          type="button"
          onClick={handlePlay}
          disabled={!selectedSong}
          className="rounded-md px-4 py-2 text-sm transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontSize: "11px",
            color: "var(--theme-accent)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
            border: "1px solid rgba(255,255,255,0.15)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.4)",
          }}
        >
          立即播放
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!selectedSong}
          className="rounded-md px-4 py-2 text-sm transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontSize: "11px",
            color: "var(--theme-accent)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
            border: "1px solid var(--theme-accent)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.15), 0 2px 4px rgba(0,0,0,0.5)",
          }}
        >
          加入播放列表
        </button>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
