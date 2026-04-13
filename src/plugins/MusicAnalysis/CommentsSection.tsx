// 云抑 —— 只展示最高赞的一条网易云热评

import { useEffect, useState } from "react";
import { api, type Song, type SongComment } from "@/lib/api";

interface Props {
  song: Song | null;
}

export function CommentsSection({ song }: Props) {
  const [comment, setComment] = useState<SongComment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!song) {
      setComment(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getSongComments(song.id, 1)
      .then((list) => {
        if (cancelled) return;
        setComment(list.length > 0 ? list[0] : null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [song?.id]);

  const dimStyle: React.CSSProperties = {
    textAlign: "center",
    color: "var(--theme-lyrics-mid)",
    fontSize: 11,
  };

  if (!song) return null;
  if (loading) return <div style={dimStyle}>...</div>;
  if (error) return null;
  if (!comment) return null;

  return (
    <div className="flex flex-col gap-2">
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.18em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
        }}
      >
        云抑
      </div>
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(0,0,0,0.45)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--theme-lyrics-next)",
            lineHeight: 1.8,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {comment.content}
        </div>
        <div
          className="flex items-center justify-between"
          style={{ marginTop: 6 }}
        >
          <span
            style={{
              fontSize: 10,
              color: "var(--theme-lyrics-mid)",
              fontFamily: "var(--font-display)",
            }}
          >
            {comment.nickname}
          </span>
          <span
            style={{
              fontSize: 9,
              color: "var(--theme-lyrics-mid)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {"\u2665"} {formatCount(comment.liked_count)}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}
