// 搜索面板 —— 两种模式（tab 切换）：
//   - Catalog Search: 网易云目录关键词搜索
//   - AI Search: 描述场景/氛围 → AI 从你的「喜欢的音乐」歌单里挑
//
// 结果区统一：AI 叙述和歌曲卡片都在同一个滚动容器里（避免长文本把
// 歌曲区挤没的"死机"问题）。
//
// 交互：
//   - 单击结果切换选中（多选），左侧彩色竖条 + checkbox 指示
//   - 双击立即播放
//   - Ask AI 按钮在流式期间变成 Cancel（中断 + 丢弃已到片段）
//   - 底部操作栏：立即播放 / 加入队列 / 加入歌单 ▾（弹出选择）

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { useLLM } from "@/hooks/useLLM";
import { api, type Playlist, type Song } from "@/lib/api";
import {
  buildAiSearchSystemPrompt,
  extractPartialSongs,
  matchRecommendationsToSongs,
  stripJsonArray,
} from "@/lib/aiSearch";
import { log } from "@/lib/logger";

type Mode = "catalog" | "ai";

interface Props {
  /** 立即播放：替换队列并开始播放 */
  onPlay: (song: Song, queue: Song[]) => void;
  /** 加入播放列表：追加到现有队列末尾 */
  onAddToQueue: (song: Song) => void;
}

export function SearchPanel({ onPlay, onAddToQueue }: Props) {
  const [mode, setMode] = useState<Mode>("catalog");

  // 两种模式共享的结果 / 选中 / 反馈 状态
  const [results, setResults] = useState<Song[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<string>("");

  // ---- Catalog 模式 ----
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);

  // ---- AI 模式 ----
  const [aiQuery, setAiQuery] = useState("");
  const [library, setLibrary] = useState<Song[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [aiNarration, setAiNarration] = useState("");

  // ---- 加入歌单菜单 ----
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[] | null>(null);
  const [userPlaylistsLoading, setUserPlaylistsLoading] = useState(false);
  const [userPlaylistsError, setUserPlaylistsError] = useState<string | null>(
    null,
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showNewPlaylistInput, setShowNewPlaylistInput] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [playlistMutating, setPlaylistMutating] = useState(false);

  const { provider, model, loading: providerLoading } = useActiveProvider();
  const { content, loading: aiLoading, stream, reset: resetLlm } = useLLM();

  // 用于判断 AI 请求是否被用户手动取消，取消后 stream() 的最终结果不再落到
  // results / aiNarration 上（useLLM.reset 已经保证自己内部 state 不会被覆写，
  // 这里只是让 handleAiSearch 的 resolve 路径也跳过 setResults）。
  const aiReqTokenRef = useRef(0);

  // 切模式时清空共享结果
  const switchMode = useCallback(
    (m: Mode) => {
      if (m === mode) return;
      setMode(m);
      setResults([]);
      setSelectedIds(new Set());
      setError("");
      setAiNarration("");
      setAddMenuOpen(false);
      resetLlm();
    },
    [mode, resetLlm],
  );

  // 一次性加载 session（拿到 current user id，用于过滤"我的"歌单）
  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((s) => {
        if (!cancelled && s.user) setCurrentUserId(s.user.user_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // AI 模式：首次进入时懒加载用户「喜欢的音乐」歌单
  //
  // StrictMode 注意：用 ref 标记「已发起过加载」避免重复请求。
  // 不用 cancelled 标记 —— 让 setState 自然落到 preserved state 上，
  // 避免第一次挂载的 async 被 cleanup 作废导致状态永远卡在 loading。
  const loadStartedRef = useRef(false);
  useEffect(() => {
    if (mode !== "ai") return;
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    setLibraryLoading(true);
    setLibraryError(null);
    log("AI搜索", "开始加载收藏库");
    (async () => {
      try {
        const playlists = await api.getUserPlaylists(30);
        log("AI搜索", `取到 ${playlists.length} 个歌单`);
        // 顺便把加载到的歌单缓存给"加入歌单"菜单用
        setUserPlaylists(playlists);
        const favorite = playlists.find((pl) => pl.special_type === 5);
        if (!favorite) {
          setLibraryError(
            "未找到「喜欢的音乐」歌单，请先在网易云中红心收藏歌曲",
          );
          setLibraryLoading(false);
          loadStartedRef.current = false;
          return;
        }
        const detail = await api.getPlaylistDetail(favorite.id, 1000);
        // 去重
        const seen = new Set<string>();
        const tracks: Song[] = [];
        for (const t of detail.tracks) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            tracks.push(t);
          }
        }
        log("AI搜索", `收藏库加载完成 ${tracks.length} 首`);
        setLibrary(tracks);
        setLibraryLoading(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("AI搜索", `收藏加载失败: ${msg.slice(0, 100)}`, "ERROR");
        setLibraryError(msg);
        setLibraryLoading(false);
        // 失败时允许切 tab 再回来重试
        loadStartedRef.current = false;
      }
    })();
  }, [mode]);

  // 收藏库摘要（供 LLM system prompt 用）
  const librarySummary = useMemo(() => {
    if (library.length === 0) return "";
    // 截断到 800 首避免 token 爆炸
    const slice = library.slice(0, 800);
    return slice.map((s) => `${s.id}|${s.name}|${s.artist}`).join("\n");
  }, [library]);

  // AI 流式中：增量解析部分推荐 + 匹配到完整 Song
  const partialRecs = useMemo(
    () => (aiLoading && mode === "ai" ? extractPartialSongs(content) : []),
    [aiLoading, mode, content],
  );
  const streamingSongs = useMemo(
    () => matchRecommendationsToSongs(partialRecs, library),
    [partialRecs, library],
  );
  const streamingNarration = useMemo(
    () => (aiLoading && mode === "ai" ? stripJsonArray(content) : ""),
    [aiLoading, mode, content],
  );

  // 显示：AI 流式中用实时结果，否则用已 finalize 的 results
  const displayResults =
    aiLoading && mode === "ai" ? streamingSongs : results;
  const displayNarration =
    aiLoading && mode === "ai" ? streamingNarration : aiNarration;

  // 从当前展示的结果中取出被选中的歌 (保持与 displayResults 同顺序)
  const selectedSongs = useMemo(
    () => displayResults.filter((s) => selectedIds.has(s.id)),
    [displayResults, selectedIds],
  );
  const allSelected =
    displayResults.length > 0 && selectedIds.size === displayResults.length;

  // 选中集合里偏移到结果列表的某些 id 可能已经不存在（例如切 tab），
  // 这里不自动清理 —— 只在实际操作时过滤即可。

  // ---- Catalog 搜索 ----
  const handleCatalogSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!catalogQuery.trim()) return;
    setCatalogLoading(true);
    setError("");
    setSelectedIds(new Set());
    try {
      const songs = await api.searchSongs(catalogQuery, 30);
      setResults(songs);
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setCatalogLoading(false);
    }
  };

  // ---- AI 选歌 ----
  const noProvider = !providerLoading && (!provider || !model);
  const canSendAi =
    !!aiQuery.trim() &&
    !aiLoading &&
    !libraryLoading &&
    !noProvider &&
    library.length > 0;

  const handleCancelAi = useCallback(() => {
    // 作废当前 token，然后让 useLLM 丢掉正在订阅的 chunks 并清空其 state
    aiReqTokenRef.current++;
    log("AI搜索", "用户取消");
    resetLlm();
  }, [resetLlm]);

  const handleAiSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!canSendAi || !provider || !model) return;
      const myToken = ++aiReqTokenRef.current;
      const text = aiQuery.trim();
      setError("");
      setSelectedIds(new Set());
      setResults([]);
      setAiNarration("");
      resetLlm();
      try {
        log(
          "AI搜索",
          `查询: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`,
        );
        const resp = await stream({
          provider_id: provider.id,
          model,
          messages: [
            {
              role: "system",
              content: buildAiSearchSystemPrompt(
                librarySummary,
                library.length,
              ),
            },
            { role: "user", content: text },
          ],
          temperature: 0.7,
          max_tokens: 2048,
        });
        // 被取消或被新搜索覆盖 —— 不写回 results
        if (aiReqTokenRef.current !== myToken) return;
        const raw = resp?.content ?? "";
        const recs = extractPartialSongs(raw);
        const matched = matchRecommendationsToSongs(recs, library);
        log("AI搜索", `推荐 ${recs.length} 首, 匹配 ${matched.length} 首`);
        setResults(matched);
        setAiNarration(stripJsonArray(raw));
      } catch (err) {
        if (aiReqTokenRef.current !== myToken) return;
        const errMsg = err instanceof Error ? err.message : String(err);
        log("AI搜索", `失败: ${errMsg.slice(0, 80)}`, "ERROR");
        setError(errMsg);
      }
    },
    [
      canSendAi,
      provider,
      model,
      aiQuery,
      librarySummary,
      library,
      stream,
      resetLlm,
    ],
  );

  // 统一的 AI 表单提交：aiLoading 时充当 Cancel，否则触发搜索
  const handleAiFormSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (aiLoading) {
      handleCancelAi();
      return;
    }
    void handleAiSearch();
  };

  // ---- 多选辅助 ----
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayResults.map((s) => s.id)));
    }
  };

  // ---- 共享操作 ----
  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 1800);
  }, []);

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
      setError(String(err));
    }
  };

  // ---- 加入歌单 ----
  const loadUserPlaylists = useCallback(async () => {
    if (userPlaylistsLoading) return;
    setUserPlaylistsLoading(true);
    setUserPlaylistsError(null);
    try {
      const pls = await api.getUserPlaylists(50);
      setUserPlaylists(pls);
    } catch (err) {
      setUserPlaylistsError(err instanceof Error ? err.message : String(err));
    } finally {
      setUserPlaylistsLoading(false);
    }
  }, [userPlaylistsLoading]);

  const openAddMenu = () => {
    if (selectedSongs.length === 0) {
      showToast("请先选中歌曲");
      return;
    }
    setAddMenuOpen(true);
    setShowNewPlaylistInput(false);
    if (userPlaylists === null && !userPlaylistsLoading) {
      void loadUserPlaylists();
    }
  };

  const closeAddMenu = () => {
    setAddMenuOpen(false);
    setShowNewPlaylistInput(false);
  };

  const addToExistingPlaylist = async (playlist: Playlist) => {
    const songs = selectedSongs;
    if (songs.length === 0) return;
    setPlaylistMutating(true);
    try {
      const result = await api.addTracksToPlaylist(
        playlist.id,
        songs.map((s) => s.id),
      );
      if (result.ok) {
        showToast(`已加入「${playlist.name}」${songs.length} 首`);
      } else {
        showToast(`加入失败 (code=${result.code})`);
      }
      closeAddMenu();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setPlaylistMutating(false);
    }
  };

  const addToFavorites = async () => {
    const fav = (userPlaylists ?? []).find((pl) => pl.special_type === 5);
    if (!fav) {
      showToast("未找到「我喜欢的」歌单");
      return;
    }
    await addToExistingPlaylist(fav);
  };

  const handleCreateAndAdd = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    const songs = selectedSongs;
    if (songs.length === 0) return;
    setPlaylistMutating(true);
    try {
      const receipt = await api.createPlaylist(name);
      if (!receipt.playlist_id) {
        setError("歌单创建失败：后端未返回 playlist_id");
        return;
      }
      await api.addTracksToPlaylist(
        receipt.playlist_id,
        songs.map((s) => s.id),
      );
      showToast(`已创建「${name}」并加入 ${songs.length} 首`);
      void loadUserPlaylists();
      closeAddMenu();
      setNewPlaylistName("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setPlaylistMutating(false);
    }
  };

  // 点击菜单外部关闭
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!addMenuRef.current) return;
      if (!addMenuRef.current.contains(e.target as Node)) {
        closeAddMenu();
      }
    };
    // defer 一帧，避免 "打开按钮的同一次 click" 就关掉
    const id = window.setTimeout(
      () => document.addEventListener("mousedown", onDocClick),
      0,
    );
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [addMenuOpen]);

  const anyLoading = catalogLoading || aiLoading;

  // 从 userPlaylists 里挑"我的（非 favorites）" —— 过滤掉 subscribed 的
  const myPlaylists = useMemo(() => {
    if (!userPlaylists) return [];
    return userPlaylists.filter(
      (pl) =>
        pl.special_type !== 5 &&
        (currentUserId === null || pl.creator_id === currentUserId),
    );
  }, [userPlaylists, currentUserId]);

  const favoritesPlaylist = useMemo(
    () => userPlaylists?.find((pl) => pl.special_type === 5) ?? null,
    [userPlaylists],
  );

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 模式切换 */}
      <div className="flex items-center gap-2">
        <TabButton
          active={mode === "catalog"}
          onClick={() => switchMode("catalog")}
        >
          Catalog Search
        </TabButton>
        <TabButton active={mode === "ai"} onClick={() => switchMode("ai")}>
          AI Search
        </TabButton>
      </div>

      {/* 搜索输入 —— 按模式切换 */}
      {mode === "catalog" ? (
        <form onSubmit={handleCatalogSearch} className="flex gap-3">
          <input
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
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
          <SubmitButton loading={catalogLoading} label="Search" />
        </form>
      ) : (
        <form onSubmit={handleAiFormSubmit} className="flex gap-3">
          <input
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            placeholder={
              libraryLoading
                ? "正在加载收藏..."
                : library.length === 0 && !libraryError
                  ? "等待收藏加载..."
                  : "描述场景 / 氛围 / 心情，AI 从你的收藏里挑..."
            }
            disabled={libraryLoading || aiLoading || noProvider}
            className="flex-1 rounded-md px-4 py-2.5 text-sm outline-none transition-all disabled:opacity-60"
            style={{
              fontFamily: "var(--font-ui)",
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(0,0,0,0.45)",
              boxShadow:
                "inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.08)",
              color: "rgba(255,240,220,0.95)",
            }}
          />
          <AiSubmitButton
            loading={aiLoading}
            canSend={canSendAi}
          />
        </form>
      )}

      {/* 状态提示 */}
      {error && <NotificationBar tone="error">{error}</NotificationBar>}
      {mode === "ai" && noProvider && (
        <NotificationBar tone="warn">
          未配置大模型 —— 点右上角齿轮 ⚙ 配置 Provider 后回来
        </NotificationBar>
      )}
      {mode === "ai" && libraryError && (
        <NotificationBar tone="error">{libraryError}</NotificationBar>
      )}

      {/* 统一结果区 —— 叙述 + 歌曲在同一个滚动容器里 */}
      <div
        className="flex-1 overflow-y-auto rounded-md"
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(0,0,0,0.45)",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6)",
          minHeight: 0,
        }}
      >
        {/* AI 叙述（放在列表顶部，随列表一起滚动）*/}
        {mode === "ai" && displayNarration && (
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              color: "rgba(255,240,220,0.85)",
              fontFamily: "var(--font-ui)",
              fontSize: "12px",
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {displayNarration}
            {aiLoading && <TypingDots />}
          </div>
        )}

        {/* 空态 */}
        {displayResults.length === 0 && !anyLoading && !displayNarration && (
          <div
            className="flex h-full items-center justify-center text-sm"
            style={{
              color: "var(--theme-label)",
              filter: "brightness(1.3)",
              fontFamily: "var(--font-display)",
              padding: "12px 20px",
              textAlign: "center",
            }}
          >
            {mode === "catalog"
              ? "输入关键词开始搜索"
              : libraryLoading
                ? "正在加载收藏..."
                : library.length === 0
                  ? "加载收藏后开始 AI 选歌"
                  : "描述你想要的场景，AI 会从收藏里挑歌"}
          </div>
        )}
        {displayResults.length === 0 &&
          aiLoading &&
          mode === "ai" &&
          !displayNarration && (
            <div
              className="flex h-full items-center justify-center text-sm"
              style={{
                color: "var(--theme-label)",
                filter: "brightness(1.3)",
                fontFamily: "var(--font-display)",
              }}
            >
              AI 正在挑选
              <TypingDots />
            </div>
          )}
        {displayResults.map((song) => {
          const selected = selectedIds.has(song.id);
          return (
            <button
              key={song.id}
              type="button"
              onClick={() => toggleSelect(song.id)}
              onDoubleClick={() => {
                const index = displayResults.findIndex(
                  (s) => s.id === song.id,
                );
                onPlay(song, displayResults.slice(index));
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
              <Checkbox checked={selected} />
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

      {/* 底部操作栏 —— 多选模式 */}
      <div
        className="flex items-center gap-3"
        style={{ flexShrink: 0, minHeight: 40, position: "relative" }}
      >
        {/* 全选 checkbox + 状态 / toast */}
        {displayResults.length > 0 && (
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
        <div style={{ position: "relative" }} ref={addMenuRef}>
          <ActionButton
            onClick={addMenuOpen ? closeAddMenu : openAddMenu}
            disabled={selectedSongs.length === 0}
            accent
          >
            加入歌单 ▾
          </ActionButton>
          {addMenuOpen && (
            <AddToPlaylistMenu
              favoritesPlaylist={favoritesPlaylist}
              myPlaylists={myPlaylists}
              loading={userPlaylistsLoading}
              error={userPlaylistsError}
              mutating={playlistMutating}
              showNewInput={showNewPlaylistInput}
              newName={newPlaylistName}
              onNewNameChange={setNewPlaylistName}
              onToggleNewInput={() => {
                setShowNewPlaylistInput((v) => {
                  if (!v && !newPlaylistName) {
                    setNewPlaylistName(
                      `Fantasy Player ${new Date().toLocaleDateString("zh-CN")}`,
                    );
                  }
                  return !v;
                });
              }}
              onPickFavorites={addToFavorites}
              onPickExisting={addToExistingPlaylist}
              onCreateAndAdd={handleCreateAndAdd}
              onRetry={() => void loadUserPlaylists()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- sub-components --------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono uppercase transition-all"
      style={{
        fontSize: "10px",
        letterSpacing: "0.24em",
        padding: "4px 12px",
        color: active
          ? "var(--theme-accent)"
          : "var(--theme-wood-highlight)",
        filter: active ? "brightness(1.5)" : "brightness(1.1)",
        textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        background: active ? "rgba(255,255,255,0.05)" : "transparent",
        border: active
          ? "1px solid rgba(255,255,255,0.15)"
          : "1px solid transparent",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function SubmitButton({
  loading,
  disabled,
  label,
}: {
  loading: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
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
      {loading ? "..." : label}
    </button>
  );
}

/** AI 提交按钮 —— loading 时变成 Cancel，依然 type=submit 由表单兜住 */
function AiSubmitButton({
  loading,
  canSend,
}: {
  loading: boolean;
  canSend: boolean;
}) {
  const isCancel = loading;
  return (
    <button
      type="submit"
      disabled={isCancel ? false : !canSend}
      className="rounded-md px-5 py-2.5 text-sm transition-all hover:scale-[1.02] disabled:opacity-50"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: isCancel ? "rgba(255,200,180,0.95)" : "var(--theme-accent)",
        background: isCancel
          ? "linear-gradient(180deg, rgba(120,40,30,0.5), rgba(60,20,15,0.6))"
          : "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
        border: isCancel
          ? "1px solid rgba(200,80,60,0.7)"
          : "1px solid var(--theme-accent)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.15), 0 2px 4px rgba(0,0,0,0.5)",
        minWidth: 76,
      }}
    >
      {isCancel ? "Cancel" : "Ask AI"}
    </button>
  );
}

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

function TypingDots() {
  return (
    <span style={{ display: "inline-block", marginLeft: 4 }}>
      <span className="typing-dot">.</span>
      <span className="typing-dot">.</span>
      <span className="typing-dot">.</span>
    </span>
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

function AddToPlaylistMenu({
  favoritesPlaylist,
  myPlaylists,
  loading,
  error,
  mutating,
  showNewInput,
  newName,
  onNewNameChange,
  onToggleNewInput,
  onPickFavorites,
  onPickExisting,
  onCreateAndAdd,
  onRetry,
}: {
  favoritesPlaylist: Playlist | null;
  myPlaylists: Playlist[];
  loading: boolean;
  error: string | null;
  mutating: boolean;
  showNewInput: boolean;
  newName: string;
  onNewNameChange: (v: string) => void;
  onToggleNewInput: () => void;
  onPickFavorites: () => void;
  onPickExisting: (pl: Playlist) => void;
  onCreateAndAdd: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(100% + 6px)",
        right: 0,
        width: 260,
        maxHeight: 340,
        background: "rgba(20,16,14,0.98)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        padding: "6px",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* 我喜欢的 */}
      {favoritesPlaylist && (
        <MenuItem
          onClick={onPickFavorites}
          disabled={mutating}
          icon={
            <span
              style={{
                display: "inline-block",
                color: "rgba(255,120,140,0.95)",
              }}
            >
              ♥
            </span>
          }
          label="我喜欢的"
          hint={`${favoritesPlaylist.track_count} 首`}
        />
      )}

      {/* 新建歌单 */}
      <MenuItem
        onClick={onToggleNewInput}
        disabled={mutating}
        icon={<span>+</span>}
        label={showNewInput ? "收起" : "新建歌单..."}
      />
      {showNewInput && (
        <div
          style={{
            padding: "6px 8px 10px",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <input
            value={newName}
            onChange={(e) => onNewNameChange(e.target.value)}
            placeholder="歌单名"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCreateAndAdd();
              }
            }}
            style={{
              flex: 1,
              fontSize: 12,
              padding: "5px 8px",
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "rgba(255,240,220,0.95)",
              outline: "none",
              fontFamily: "var(--font-ui)",
            }}
          />
          <button
            type="button"
            onClick={onCreateAndAdd}
            disabled={!newName.trim() || mutating}
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "5px 10px",
              color: "var(--theme-accent)",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
              border: "1px solid var(--theme-accent)",
              borderRadius: 4,
              cursor: "pointer",
              opacity: !newName.trim() || mutating ? 0.4 : 1,
            }}
          >
            创建
          </button>
        </div>
      )}

      {/* 分隔 */}
      <div
        style={{
          height: 1,
          background: "rgba(255,255,255,0.08)",
          margin: "4px 6px",
        }}
      />

      {/* 现有歌单 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 40,
        }}
      >
        {loading && (
          <div
            style={{
              padding: "12px",
              fontSize: 11,
              color: "rgba(255,220,180,0.6)",
              fontFamily: "var(--font-mono)",
              textAlign: "center",
            }}
          >
            加载歌单...
          </div>
        )}
        {error && (
          <div style={{ padding: "8px 10px" }}>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,180,160,0.9)",
                marginBottom: 6,
              }}
            >
              加载失败: {error.slice(0, 80)}
            </div>
            <button
              type="button"
              onClick={onRetry}
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                padding: "3px 8px",
                color: "var(--theme-accent)",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              重试
            </button>
          </div>
        )}
        {!loading &&
          !error &&
          myPlaylists.length === 0 && (
            <div
              style={{
                padding: "12px",
                fontSize: 11,
                color: "rgba(255,220,180,0.5)",
                fontFamily: "var(--font-mono)",
                textAlign: "center",
              }}
            >
              暂无自建歌单
            </div>
          )}
        {!loading &&
          myPlaylists.map((pl) => (
            <MenuItem
              key={pl.id}
              onClick={() => onPickExisting(pl)}
              disabled={mutating}
              label={pl.name}
              hint={`${pl.track_count} 首`}
            />
          ))}
      </div>
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  icon,
  label,
  hint,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="transition-colors hover:bg-white/5 disabled:opacity-40"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "7px 10px",
        background: "transparent",
        border: "none",
        borderRadius: 4,
        color: "rgba(255,240,220,0.92)",
        fontSize: 12,
        fontFamily: "var(--font-ui)",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
      }}
    >
      {icon && (
        <span
          style={{
            width: 16,
            display: "inline-flex",
            justifyContent: "center",
            color: "rgba(255,220,180,0.8)",
          }}
        >
          {icon}
        </span>
      )}
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {hint && (
        <span
          style={{
            fontSize: 10,
            color: "rgba(255,220,180,0.45)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
