// 搜索面板 —— Phase 2 主题化。
//
// 视觉：沿用父 Overlay 的木纹卡片背景；内部用半透明深色覆盖层
// 以保证歌曲列表的可读性。

import { useState } from "react";
import { api, type Song } from "@/lib/api";

interface Props {
  onPlay: (song: Song, queue: Song[]) => void;
}

export function SearchPanel({ onPlay }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
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
        {results.map((song, index) => (
          <button
            key={song.id}
            type="button"
            onClick={() => onPlay(song, results.slice(index))}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5 disabled:opacity-40"
            style={{
              borderBottom: "1px solid rgba(0,0,0,0.3)",
            }}
            disabled={!song.playable}
          >
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
                  color: "rgba(255,240,220,0.95)",
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
        ))}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
