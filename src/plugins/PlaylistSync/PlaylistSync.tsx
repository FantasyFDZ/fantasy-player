// 歌单迁移面板 —— QQ 音乐 ↔ 网易云音乐
//
// 状态机：Idle → Login → SelectPlaylists → Syncing → Report
// QQ 登录采用 cookie 粘贴模式（QR 不可用）。

import { useCallback, useEffect, useState } from "react";
import {
  api,
  onSyncProgress,
  type QQPlaylist,
  type QQSession,
  type QQUserProfile,
  type Session,
  type Song,
  type SyncProgress,
  type SyncReport,
  type SyncSource,
  type SyncTarget,
} from "@/lib/api";

// ---- types ----------------------------------------------------------------

type Phase = "idle" | "login" | "select" | "syncing" | "report";
type Direction = "qq_to_netease" | "netease_to_qq";

// ---- props (PanelProps) ---------------------------------------------------

interface Props {
  song: Song | null;
}

// ---- component ------------------------------------------------------------

export function PlaylistSync(_props: Props) {
  // -- auth state --
  const [neteaseSession, setNeteaseSession] = useState<Session | null>(null);
  const [qqSession, setQqSession] = useState<QQSession | null>(null);
  const [direction, setDirection] = useState<Direction>("qq_to_netease");

  // -- login --
  const [cookieInput, setCookieInput] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // -- playlists --
  const [playlists, setPlaylists] = useState<QQPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // -- sync --
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [reports, setReports] = useState<SyncReport[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);

  // -- phase --
  const [phase, setPhase] = useState<Phase>("idle");

  // -- expanded skip detail --
  const [expandedReport, setExpandedReport] = useState<number | null>(null);

  // -- init: load both sessions --
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ne, qq] = await Promise.all([
          api.session(),
          api.qqSession(),
        ]);
        if (cancelled) return;
        setNeteaseSession(ne);
        setQqSession(qq);
      } catch (err) {
        console.error("[PlaylistSync] session load failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // -- subscribe to sync-progress events --
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onSyncProgress((p) => setProgress(p)).then((fn) => {
      unlisten = fn;
    });
    return () => { unlisten?.(); };
  }, []);

  // -- derived state --
  const qqLoggedIn = !!(qqSession?.user);
  const neteaseLoggedIn = !!(neteaseSession?.user);
  const sourceLoggedIn = direction === "qq_to_netease" ? qqLoggedIn : neteaseLoggedIn;
  const targetLoggedIn = direction === "qq_to_netease" ? neteaseLoggedIn : qqLoggedIn;
  const bothLoggedIn = qqLoggedIn && neteaseLoggedIn;

  // -- QQ cookie login --
  const handleQqLogin = useCallback(async () => {
    const cookie = cookieInput.trim();
    if (!cookie) return;
    setLoginLoading(true);
    setLoginError(null);
    try {
      const user = await api.qqLoginCookie(cookie);
      setQqSession({ cookie, user });
      setCookieInput("");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoginLoading(false);
    }
  }, [cookieInput]);

  // -- QQ logout --
  const handleQqLogout = useCallback(async () => {
    try {
      await api.qqLogout();
      setQqSession({ cookie: "", user: null });
    } catch (err) {
      console.error("[PlaylistSync] qq logout failed:", err);
    }
  }, []);

  // -- toggle direction --
  const toggleDirection = useCallback(() => {
    setDirection((d) =>
      d === "qq_to_netease" ? "netease_to_qq" : "qq_to_netease",
    );
    setPlaylists([]);
    setSelected(new Set());
  }, []);

  // -- load source playlists --
  const handleLoadPlaylists = useCallback(async () => {
    setPlaylistsLoading(true);
    setPlaylists([]);
    setSelected(new Set());
    try {
      if (direction === "qq_to_netease") {
        const pls = await api.qqGetPlaylists();
        setPlaylists(pls);
      } else {
        // Netease → QQ: use netease playlists, mapped to QQPlaylist shape
        // for uniform rendering
        const pls = await api.getUserPlaylists(100);
        setPlaylists(
          pls.map((p) => ({
            disstid: p.id,
            name: p.name,
            song_cnt: p.track_count,
            cover: p.cover_url,
          })),
        );
      }
      setPhase("select");
    } catch (err) {
      console.error("[PlaylistSync] load playlists failed:", err);
    } finally {
      setPlaylistsLoading(false);
    }
  }, [direction]);

  // -- toggle playlist selection --
  const togglePlaylist = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // -- start sync --
  const handleSync = useCallback(async () => {
    if (selected.size === 0) return;
    setPhase("syncing");
    setProgress(null);
    setReports([]);
    setSyncError(null);

    const source: SyncSource = direction === "qq_to_netease" ? "qq" : "netease";
    const target: SyncTarget = direction === "qq_to_netease" ? "netease" : "qq";
    const playlistIds = Array.from(selected);

    try {
      const reps = await api.syncPlaylists(source, target, playlistIds);
      setReports(reps);
      setPhase("report");
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
      setPhase("report");
    }
  }, [selected, direction]);

  // -- reset to start over --
  const handleReset = useCallback(() => {
    setPhase("idle");
    setPlaylists([]);
    setSelected(new Set());
    setProgress(null);
    setReports([]);
    setSyncError(null);
    setExpandedReport(null);
  }, []);

  // ---- render --------------------------------------------------------------

  const sourceLabel = direction === "qq_to_netease" ? "QQ 音乐" : "网易云";
  const targetLabel = direction === "qq_to_netease" ? "网易云" : "QQ 音乐";

  return (
    <div className="flex h-full flex-col" style={{ minHeight: 0 }}>
      {/* Header: platform cards + direction toggle */}
      <div style={{ padding: "8px 8px 0" }}>
        <div className="flex items-center justify-center gap-3" style={{ marginBottom: 8 }}>
          <PlatformCard
            label={sourceLabel}
            loggedIn={sourceLoggedIn}
            user={
              direction === "qq_to_netease"
                ? qqSession?.user ?? null
                : neteaseSession?.user ?? null
            }
          />
          <span
            style={{
              fontSize: 16,
              color: "var(--theme-accent, rgba(120,120,255,0.8))",
            }}
          >
            {"\u2192"}
          </span>
          <PlatformCard
            label={targetLabel}
            loggedIn={targetLoggedIn}
            user={
              direction === "qq_to_netease"
                ? neteaseSession?.user ?? null
                : qqSession?.user ?? null
            }
          />
        </div>

        <div className="flex justify-center" style={{ marginBottom: 8 }}>
          <button
            type="button"
            onClick={toggleDirection}
            disabled={phase === "syncing"}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--text-secondary, var(--theme-lyrics-mid))",
              fontSize: 12,
              fontFamily: "var(--font-ui)",
              cursor: phase === "syncing" ? "default" : "pointer",
              opacity: phase === "syncing" ? 0.4 : 1,
            }}
          >
            切换方向
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: "0 8px 8px", minHeight: 0 }}
      >
        {/* QQ Cookie Login (show if QQ not logged in) */}
        {!qqLoggedIn && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "var(--text-secondary, var(--theme-lyrics-mid))",
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              请在浏览器登录 y.qq.com，按 F12 打开开发者工具，复制 Cookie
            </div>
            <textarea
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder="粘贴 QQ 音乐 Cookie"
              rows={3}
              style={{
                width: "100%",
                resize: "none",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.3)",
                color: "var(--text-primary, var(--theme-lyrics-next))",
                fontSize: 12,
                fontFamily: "var(--font-ui)",
                outline: "none",
                boxSizing: "border-box",
                lineHeight: 1.4,
              }}
            />
            {loginError && (
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,180,160,0.9)",
                  marginTop: 4,
                }}
              >
                {loginError}
              </div>
            )}
            <button
              type="button"
              onClick={handleQqLogin}
              disabled={loginLoading || !cookieInput.trim()}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "7px 0",
                borderRadius: 6,
                background: cookieInput.trim()
                  ? "var(--theme-accent, rgba(120,120,255,0.8))"
                  : "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: cookieInput.trim() ? "#fff" : "var(--theme-lyrics-mid)",
                fontSize: 12,
                fontFamily: "var(--font-ui)",
                cursor:
                  loginLoading || !cookieInput.trim() ? "default" : "pointer",
                opacity: loginLoading || !cookieInput.trim() ? 0.5 : 1,
              }}
            >
              {loginLoading ? "验证中..." : "登录"}
            </button>
          </div>
        )}

        {/* QQ logged in indicator + logout */}
        {qqLoggedIn && (
          <div
            className="flex items-center justify-between"
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              background: "rgba(40,180,100,0.1)",
              border: "1px solid rgba(40,180,100,0.2)",
              marginBottom: 10,
              fontSize: 12,
              color: "rgba(120,240,160,0.9)",
              fontFamily: "var(--font-ui)",
            }}
          >
            <span>QQ 音乐: {qqSession?.user?.nickname}</span>
            <button
              type="button"
              onClick={handleQqLogout}
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--text-secondary, var(--theme-lyrics-mid))",
                fontSize: 11,
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
              }}
            >
              退出
            </button>
          </div>
        )}

        {/* Netease login status */}
        {!neteaseLoggedIn && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(255,180,100,0.08)",
              border: "1px solid rgba(255,180,100,0.15)",
              marginBottom: 10,
              fontSize: 12,
              color: "rgba(255,200,140,0.9)",
              fontFamily: "var(--font-ui)",
            }}
          >
            网易云未登录 -- 请先在主界面登录网易云账号
          </div>
        )}

        {/* Action: load playlists (idle phase) */}
        {(phase === "idle" || phase === "login") && bothLoggedIn && (
          <button
            type="button"
            onClick={handleLoadPlaylists}
            disabled={playlistsLoading}
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: 8,
              background: "var(--theme-accent, rgba(120,120,255,0.8))",
              border: "none",
              color: "#fff",
              fontSize: 13,
              fontFamily: "var(--font-ui)",
              cursor: playlistsLoading ? "default" : "pointer",
              opacity: playlistsLoading ? 0.6 : 1,
              marginBottom: 10,
            }}
          >
            {playlistsLoading ? "加载歌单中..." : `加载${sourceLabel}歌单`}
          </button>
        )}

        {/* Select playlists phase */}
        {phase === "select" && playlists.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-secondary, var(--theme-lyrics-mid))",
                fontFamily: "var(--font-ui)",
                marginBottom: 6,
              }}
            >
              选择要迁移的歌单 ({selected.size}/{playlists.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {playlists.map((pl) => (
                <PlaylistRow
                  key={pl.disstid}
                  playlist={pl}
                  checked={selected.has(pl.disstid)}
                  onToggle={() => togglePlaylist(pl.disstid)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleSync}
              disabled={selected.size === 0}
              style={{
                marginTop: 10,
                width: "100%",
                padding: "10px 0",
                borderRadius: 8,
                background:
                  selected.size > 0
                    ? "var(--theme-accent, rgba(120,120,255,0.8))"
                    : "rgba(255,255,255,0.06)",
                border: "none",
                color: selected.size > 0 ? "#fff" : "var(--theme-lyrics-mid)",
                fontSize: 13,
                fontFamily: "var(--font-ui)",
                cursor: selected.size > 0 ? "pointer" : "default",
                opacity: selected.size > 0 ? 1 : 0.5,
              }}
            >
              开始迁移 ({selected.size} 个歌单)
            </button>
          </div>
        )}

        {phase === "select" && playlists.length === 0 && !playlistsLoading && (
          <div
            style={{
              textAlign: "center",
              padding: 16,
              fontSize: 12,
              color: "var(--theme-lyrics-mid)",
              fontFamily: "var(--font-ui)",
            }}
          >
            未找到歌单
          </div>
        )}

        {/* Syncing phase */}
        {phase === "syncing" && (
          <div style={{ padding: "12px 0" }}>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-primary, var(--theme-lyrics-next))",
                fontFamily: "var(--font-ui)",
                marginBottom: 10,
                textAlign: "center",
              }}
            >
              正在迁移...
            </div>
            {progress && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary, var(--theme-lyrics-mid))",
                    fontFamily: "var(--font-ui)",
                    marginBottom: 6,
                    textAlign: "center",
                  }}
                >
                  {progress.playlist_name} ({progress.current}/{progress.total})
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--theme-lyrics-mid)",
                    fontFamily: "var(--font-ui)",
                    marginBottom: 8,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {progress.current_song}
                </div>
                <ProgressBar
                  current={progress.current}
                  total={progress.total}
                />
              </div>
            )}
            {!progress && (
              <div
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  color: "var(--theme-lyrics-mid)",
                }}
              >
                等待后端响应...
              </div>
            )}
          </div>
        )}

        {/* Report phase */}
        {phase === "report" && (
          <div style={{ padding: "4px 0" }}>
            {syncError && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: "rgba(255,100,80,0.1)",
                  border: "1px solid rgba(255,100,80,0.2)",
                  marginBottom: 10,
                  fontSize: 12,
                  color: "rgba(255,180,160,0.95)",
                  fontFamily: "var(--font-ui)",
                  lineHeight: 1.5,
                }}
              >
                迁移出错: {syncError}
              </div>
            )}

            {reports.map((rep, i) => (
              <ReportCard
                key={i}
                report={rep}
                expanded={expandedReport === i}
                onToggleExpand={() =>
                  setExpandedReport((prev) => (prev === i ? null : i))
                }
              />
            ))}

            <button
              type="button"
              onClick={handleReset}
              style={{
                marginTop: 10,
                width: "100%",
                padding: "9px 0",
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--text-primary, var(--theme-lyrics-next))",
                fontSize: 12,
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
              }}
            >
              返回
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- sub-components -------------------------------------------------------

/** Platform status card */
function PlatformCard({
  label,
  loggedIn,
  user,
}: {
  label: string;
  loggedIn: boolean;
  user: QQUserProfile | { nickname: string } | null;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
        border: loggedIn
          ? "1px solid rgba(40,180,100,0.3)"
          : "1px solid rgba(255,255,255,0.08)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text-primary, var(--theme-lyrics-next))",
          fontFamily: "var(--font-ui)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 11,
          color: loggedIn
            ? "rgba(120,240,160,0.9)"
            : "var(--theme-lyrics-mid)",
          fontFamily: "var(--font-ui)",
        }}
      >
        {loggedIn ? (user?.nickname ?? "已登录") : "未登录"}
      </div>
    </div>
  );
}

/** Playlist row with checkbox */
function PlaylistRow({
  playlist,
  checked,
  onToggle,
}: {
  playlist: QQPlaylist;
  checked: boolean;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 8px",
        borderRadius: 6,
        background: hovered
          ? "rgba(255,255,255,0.06)"
          : "rgba(255,255,255,0.02)",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      <CheckIcon checked={checked} />
      {playlist.cover && (
        <img
          src={playlist.cover}
          alt=""
          style={{
            width: 32,
            height: 32,
            borderRadius: 4,
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-primary, var(--theme-lyrics-next))",
            fontFamily: "var(--font-ui)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {playlist.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-secondary, var(--theme-lyrics-mid))",
            fontFamily: "var(--font-ui)",
          }}
        >
          {playlist.song_cnt} 首
        </div>
      </div>
    </div>
  );
}

/** Check icon */
function CheckIcon({
  checked,
}: {
  checked: boolean;
}) {
  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        border: checked ? "none" : "1.5px solid rgba(255,255,255,0.25)",
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

/** Progress bar */
function ProgressBar({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div
      style={{
        width: "100%",
        height: 6,
        borderRadius: 3,
        background: "rgba(255,255,255,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 3,
          background: "var(--theme-accent, rgba(120,120,255,0.8))",
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

/** Sync report card */
function ReportCard({
  report,
  expanded,
  onToggleExpand,
}: {
  report: SyncReport;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const hasSkipped = report.skipped_songs.length > 0;
  const matchPct =
    report.total > 0 ? Math.round((report.matched / report.total) * 100) : 0;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 8,
      }}
    >
      {/* Playlist name */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text-primary, var(--theme-lyrics-next))",
          fontFamily: "var(--font-ui)",
          marginBottom: 6,
        }}
      >
        {report.playlist_name}
      </div>

      {/* Stats */}
      <div
        className="flex gap-4"
        style={{
          fontSize: 12,
          fontFamily: "var(--font-ui)",
          marginBottom: hasSkipped ? 6 : 0,
        }}
      >
        <span style={{ color: "var(--text-secondary, var(--theme-lyrics-mid))" }}>
          共 {report.total} 首
        </span>
        <span style={{ color: "rgba(120,240,160,0.9)" }}>
          匹配 {report.matched} ({matchPct}%)
        </span>
        {report.skipped > 0 && (
          <span style={{ color: "rgba(255,180,140,0.9)" }}>
            跳过 {report.skipped}
          </span>
        )}
      </div>

      {/* Mini progress bar */}
      <div
        style={{
          width: "100%",
          height: 4,
          borderRadius: 2,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          marginBottom: hasSkipped ? 8 : 0,
        }}
      >
        <div
          style={{
            width: `${matchPct}%`,
            height: "100%",
            borderRadius: 2,
            background: "rgba(120,240,160,0.7)",
          }}
        />
      </div>

      {/* Expandable skip detail */}
      {hasSkipped && (
        <div>
          <button
            type="button"
            onClick={onToggleExpand}
            style={{
              padding: 0,
              background: "none",
              border: "none",
              color: "var(--theme-accent, rgba(120,120,255,0.8))",
              fontSize: 11,
              fontFamily: "var(--font-ui)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {expanded ? "收起跳过详情" : "查看跳过详情"}
          </button>

          {expanded && (
            <div
              style={{
                marginTop: 6,
                maxHeight: 200,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              {report.skipped_songs.map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: "rgba(0,0,0,0.2)",
                    fontSize: 11,
                    fontFamily: "var(--font-ui)",
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-primary, var(--theme-lyrics-next))",
                    }}
                  >
                    {s.name} - {s.artist}
                  </span>
                  <span
                    style={{
                      color: "var(--theme-lyrics-mid)",
                      marginLeft: 6,
                    }}
                  >
                    {s.reason}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
