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
    <div className="flex h-full flex-col gap-3">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索歌曲 / 艺人 / 专辑..."
          className="flex-1 rounded bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:bg-white/10"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-emerald-500/80 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? "搜索中..." : "搜索"}
        </button>
      </form>

      {error && (
        <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded bg-white/5">
        {results.length === 0 && !loading && (
          <div className="p-6 text-center text-sm text-white/40">
            输入关键词开始搜索
          </div>
        )}
        {results.map((song, index) => (
          <button
            key={song.id}
            onClick={() => onPlay(song, results.slice(index))}
            className="flex w-full items-center gap-3 border-b border-white/5 px-3 py-2 text-left hover:bg-white/5 disabled:opacity-40"
            disabled={!song.playable}
          >
            {song.cover_url && (
              <img
                src={song.cover_url}
                alt=""
                className="h-10 w-10 rounded"
              />
            )}
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-sm font-medium">{song.name}</div>
              <div className="truncate text-xs text-white/50">
                {song.artist} · {song.album}
              </div>
            </div>
            <div className="text-xs text-white/40">
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
