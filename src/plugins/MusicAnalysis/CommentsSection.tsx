// 网易云高赞点评 section —— 调用 /comment/music 接口
// 显示 Top N 热评：头像 + 昵称 + 内容 + 点赞数

import { useEffect, useState } from "react";
import { api, type Song, type SongComment } from "@/lib/api";

interface Props {
  song: Song | null;
}

export function CommentsSection({ song }: Props) {
  const [comments, setComments] = useState<SongComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!song) {
      setComments([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getSongComments(song.id, 8)
      .then((list) => {
        if (cancelled) return;
        setComments(list);
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

  if (!song) {
    return (
      <div
        style={{
          padding: "24px 16px",
          textAlign: "center",
          color: "var(--theme-lyrics-mid)",
          fontSize: 12,
        }}
      >
        选一首歌查看热评
      </div>
    );
  }
  if (loading) {
    return (
      <div
        style={{
          padding: "20px 16px",
          textAlign: "center",
          color: "var(--theme-lyrics-mid)",
          fontSize: 12,
        }}
      >
        正在获取热评…
      </div>
    );
  }
  if (error) {
    return (
      <div
        style={{
          padding: "20px 16px",
          color: "rgba(255,180,160,0.9)",
          fontSize: 12,
        }}
      >
        获取失败：{error}
      </div>
    );
  }
  if (comments.length === 0) {
    return (
      <div
        style={{
          padding: "20px 16px",
          textAlign: "center",
          color: "var(--theme-lyrics-mid)",
          fontSize: 12,
        }}
      >
        暂无热评
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "var(--theme-label)",
          filter: "brightness(1.4)",
          fontFamily: "var(--font-mono)",
          marginBottom: 4,
        }}
      >
        网易云 · 高赞评论 · Top {comments.length}
      </div>
      {comments.map((c) => (
        <CommentCard key={c.comment_id} comment={c} />
      ))}
    </div>
  );
}

function CommentCard({ comment }: { comment: SongComment }) {
  return (
    <div
      className="flex gap-3"
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(0,0,0,0.45)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)",
      }}
    >
      {comment.avatar_url && (
        <img
          src={comment.avatar_url}
          alt=""
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            flexShrink: 0,
            boxShadow: "0 1px 2px rgba(0,0,0,0.5)",
          }}
        />
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between">
          <span
            style={{
              fontSize: 11,
              color: "var(--theme-accent)",
              fontFamily: "var(--font-display)",
              fontWeight: 500,
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
            ♥ {formatCount(comment.liked_count)}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--theme-lyrics-next)",
            lineHeight: 1.6,
            marginTop: 3,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {comment.content}
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
