// AI 对话选歌面板 —— Phase 7
//
// 用户描述场景/氛围/心情，AI 从收藏歌单中推荐歌曲。
// 聊天式交互：消息气泡 + 底部输入框 + 歌曲卡片。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { useLLM } from "@/hooks/useLLM";
import { api, type Song } from "@/lib/api";
import { extractJsonArray } from "@/lib/extractJsonArray";
import { log } from "@/lib/logger";

// ---- types ----------------------------------------------------------------

interface SongRecommendation {
  id: string;
  name: string;
  artist: string;
  reason: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** 仅 assistant 消息：解析出的推荐歌曲列表 */
  recommendations?: SongRecommendation[];
  /** 已匹配到完整 Song 对象的推荐（用于播放/入队） */
  matchedSongs?: Song[];
}

// ---- props (PanelProps) ---------------------------------------------------

interface Props {
  song: Song | null;
}

// ---- component ------------------------------------------------------------

export function AiPlaylist(_props: Props) {
  // -- 收藏歌曲库 --
  const [library, setLibrary] = useState<Song[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // -- 对话 --
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // -- LLM --
  const { provider, model, loading: providerLoading } = useActiveProvider();
  const { content, loading: llmLoading, stream, reset } = useLLM();

  // 追踪当前正在流式生成的 assistant 消息（还没 finalize）
  const pendingRef = useRef(false);

  // -- 加载收藏歌单 --
  useEffect(() => {
    let cancelled = false;
    setLibraryLoading(true);
    setLibraryError(null);

    (async () => {
      try {
        const playlists = await api.getUserPlaylists(30);
        // 只取「喜欢的音乐」（special_type === 5）
        const favorite = playlists.find((pl) => pl.special_type === 5);
        if (!favorite) {
          if (!cancelled) {
            setLibraryError("未找到「喜欢的音乐」歌单，请先在网易云中红心收藏歌曲");
            setLibraryLoading(false);
          }
          return;
        }
        const allTracks: Song[] = [];
        const seen = new Set<string>();

        if (cancelled) return;
        const detail = await api.getPlaylistDetail(favorite.id, 1000);
        for (const t of detail.tracks) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            allTracks.push(t);
          }
        }

        if (!cancelled) {
          setLibrary(allTracks);
          setLibraryLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLibraryError(
            err instanceof Error ? err.message : String(err),
          );
          setLibraryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 构建歌曲索引摘要（给 LLM 用）
  const librarySummary = useMemo(() => {
    if (library.length === 0) return "";
    // 截断到 800 首避免 token 爆炸
    const slice = library.slice(0, 800);
    return slice.map((s) => `${s.id}|${s.name}|${s.artist}`).join("\n");
  }, [library]);

  // 匹配推荐结果到完整 Song 对象
  const matchRecommendations = useCallback(
    (recs: SongRecommendation[]): Song[] => {
      const idMap = new Map(library.map((s) => [s.id, s]));
      const nameMap = new Map(
        library.map((s) => [`${s.name}|||${s.artist}`.toLowerCase(), s]),
      );

      return recs
        .map((r) => {
          // 先按 id 匹配
          const byId = idMap.get(r.id);
          if (byId) return byId;
          // 再按 name+artist 模糊匹配
          const key = `${r.name}|||${r.artist}`.toLowerCase();
          const byName = nameMap.get(key);
          if (byName) return byName;
          return null;
        })
        .filter((s): s is Song => s !== null);
    },
    [library],
  );

  // 解析 AI 返回中的 JSON 推荐
  const parseRecommendations = useCallback(
    (raw: string): { recs: SongRecommendation[]; matched: Song[] } => {
      const parsed = extractJsonArray<SongRecommendation>(raw);
      if (!parsed || parsed.length === 0) return { recs: [], matched: [] };
      const recs = parsed.filter(
        (r) => r && typeof r.name === "string" && typeof r.artist === "string",
      );
      const matched = matchRecommendations(recs);
      return { recs, matched };
    },
    [matchRecommendations],
  );

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, content]);

  // 发送消息
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || llmLoading || !provider || !model) return;
    if (libraryLoading) return;

    setInput("");
    const userMsg: ChatMessage = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    pendingRef.current = true;
    reset();

    // 构造完整对话历史
    const history = [...messages, userMsg];
    const llmMessages = [
      {
        role: "system" as const,
        content: buildSystemPrompt(librarySummary, library.length),
      },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.text,
      })),
    ];

    try {
      log("AI选歌", `用户消息: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`);
      const resp = await stream({
        provider_id: provider.id,
        model,
        messages: llmMessages,
        temperature: 0.7,
        max_tokens: 2048,
      });

      // 流结束，解析推荐并追加 assistant 消息
      const finalContent = resp?.content ?? "";
      const { recs, matched } = parseRecommendations(finalContent);
      log("AI选歌", `LLM 响应: 推荐 ${recs.length} 首, 匹配 ${matched.length} 首`);
      const assistantMsg: ChatMessage = {
        role: "assistant",
        text: finalContent,
        recommendations: recs.length > 0 ? recs : undefined,
        matchedSongs: matched.length > 0 ? matched : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : String(err);
      log("AI选歌", `LLM 失败: ${errMsg.slice(0, 80)}`, "ERROR");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `请求失败：${errMsg}` },
      ]);
    } finally {
      pendingRef.current = false;
      reset();
    }
  }, [
    input,
    llmLoading,
    provider,
    model,
    libraryLoading,
    messages,
    librarySummary,
    library.length,
    stream,
    reset,
    parseRecommendations,
  ]);

  // 播放单首
  const handlePlay = useCallback(async (song: Song) => {
    try {
      await api.playSong(song);
    } catch (err) {
      console.error("[AiPlaylist] playSong failed:", err);
    }
  }, []);

  // Enter 键发送
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ---- render ----
  const noProvider = !providerLoading && (!provider || !model);

  return (
    <div className="flex h-full flex-col" style={{ minHeight: 0 }}>
      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ padding: "8px 4px", minHeight: 0 }}
      >
        {/* 加载歌单状态 */}
        {libraryLoading && (
          <StatusBubble text="正在加载你的收藏..." />
        )}
        {libraryError && (
          <StatusBubble
            text={`加载收藏失败：${libraryError}`}
            error
          />
        )}
        {!libraryLoading && !libraryError && library.length === 0 && (
          <StatusBubble text="你的「喜欢的音乐」是空的，去网易云红心一些歌吧" />
        )}
        {!libraryLoading && !libraryError && library.length > 0 && messages.length === 0 && (
          <StatusBubble
            text={`已加载 ${library.length} 首喜欢的音乐，描述你想要的氛围吧`}
          />
        )}

        {/* 对话气泡 */}
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            onPlay={handlePlay}
          />
        ))}

        {/* 流式输出中的 pending 气泡 */}
        {llmLoading && pendingRef.current && (
          <div style={{ marginBottom: 12 }}>
            <AssistantBubble>
              {content ? (
                <StreamingBubble
                  text={content}
                  matchRecommendations={matchRecommendations}
                  onPlay={handlePlay}
                />
              ) : (
                <TypingIndicator />
              )}
            </AssistantBubble>
          </div>
        )}
      </div>

      {/* 底部输入框 */}
      <div
        style={{
          padding: "8px 4px 4px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {noProvider && (
          <div
            style={{
              fontSize: 11,
              color: "var(--theme-lyrics-mid)",
              marginBottom: 4,
              textAlign: "center",
            }}
          >
            未配置大模型
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              libraryLoading
                ? "正在加载收藏..."
                : "描述场景或氛围..."
            }
            disabled={libraryLoading || noProvider}
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(0,0,0,0.3)",
              color: "var(--text-primary, var(--theme-lyrics-next))",
              fontSize: 13,
              fontFamily: "var(--font-ui)",
              outline: "none",
              minHeight: 36,
              maxHeight: 80,
              lineHeight: 1.4,
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={
              !input.trim() || llmLoading || libraryLoading || noProvider
            }
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              background: input.trim()
                ? "var(--theme-accent, rgba(120,120,255,0.8))"
                : "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: input.trim()
                ? "#fff"
                : "var(--theme-lyrics-mid)",
              fontSize: 13,
              fontFamily: "var(--font-ui)",
              cursor: input.trim() ? "pointer" : "default",
              transition: "all 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- system prompt --------------------------------------------------------

function buildSystemPrompt(librarySummary: string, totalCount: number): string {
  return (
    `你是一个音乐推荐助手。用户会描述他想要的场景、氛围或心情，` +
    `你需要从用户的收藏歌曲库中推荐最匹配的歌曲。\n\n` +
    `用户的收藏库共 ${totalCount} 首歌，格式为 "id|歌名|歌手"：\n` +
    `${librarySummary}\n\n` +
    `要求：\n` +
    `1. 根据用户描述推荐 5-10 首最匹配的歌曲\n` +
    `2. 先用 1-2 句话回应用户的描述，然后给出推荐列表\n` +
    `3. 推荐列表必须用纯 JSON 数组格式输出（不要用 markdown 代码块包裹），格式如下：\n` +
    `[{"id": "歌曲id", "name": "歌名", "artist": "歌手", "reason": "推荐原因"}]\n` +
    `4. reason 用简短的中文描述为什么这首歌适合当前场景\n` +
    `5. 只推荐收藏库中存在的歌曲，不要编造不存在的歌\n` +
    `6. JSON 数组前后可以有普通文字，但 JSON 本身要完整可解析\n` +
    `7. 如果用户只是闲聊而非描述场景，正常回复即可，不需要输出 JSON\n` +
    `8. 当用户提到具体的音乐指标（如 BPM、节奏快慢等）时，你必须基于你对` +
    `这些歌曲的了解来严格筛选。注意：你没有精确的 BPM 数据，所以要靠你对` +
    `歌曲的音乐知识来判断。如果你不确定一首歌是否满足条件，不要推荐它。` +
    `宁可少推荐也不要推荐不符合条件的歌曲。\n` +
    `9. BPM 参考：慢歌/抒情一般 60-90 BPM，中速流行 90-120 BPM，` +
    `快歌/舞曲 120-140 BPM，高能量 140+ BPM。请据此判断。`
  );
}

// ---- helpers --------------------------------------------------------------

/**
 * Incrementally extract complete song objects from a streaming LLM response.
 *
 * As the LLM generates a JSON array token by token, this function finds all
 * complete `{...}` objects that have appeared so far inside the first `[...]`
 * block and parses each one individually. Incomplete trailing objects are
 * silently ignored — they'll be picked up once more tokens arrive.
 */
function extractPartialSongs(text: string): SongRecommendation[] {
  // Strip <think> blocks and code fences first
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  cleaned = cleaned.replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1");

  const startIdx = cleaned.indexOf("[");
  if (startIdx === -1) return [];

  const results: SongRecommendation[] = [];

  // Walk from after the '[' and find each complete top-level {...} object
  let i = startIdx + 1;
  while (i < cleaned.length) {
    // Skip whitespace and commas between objects
    const ch = cleaned[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === ",") {
      i++;
      continue;
    }
    // If we hit ']', the array is closed
    if (ch === "]") break;
    // Expect an opening brace
    if (ch !== "{") {
      i++;
      continue;
    }

    // Find the matching closing brace using balanced bracket counting
    let depth = 0;
    let inString = false;
    let escape = false;
    let endIdx = -1;

    for (let j = i; j < cleaned.length; j++) {
      const c = cleaned[j];
      if (escape) { escape = false; continue; }
      if (c === "\\" && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          endIdx = j;
          break;
        }
      }
    }

    if (endIdx === -1) {
      // Incomplete object — stop here; more tokens will complete it
      break;
    }

    const objStr = cleaned.slice(i, endIdx + 1);
    try {
      const obj = JSON.parse(objStr);
      if (obj && typeof obj.name === "string" && typeof obj.artist === "string") {
        results.push(obj as SongRecommendation);
      }
    } catch {
      // Malformed object — skip it
    }
    i = endIdx + 1;
  }

  return results;
}

/** Strip <think> blocks, markdown code fences, and the JSON array from an
 *  assistant message, leaving only the natural-language text portion. */
function stripJsonArray(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  text = text.replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1");

  // Find and remove the first balanced [...] block
  const startIdx = text.indexOf("[");
  if (startIdx !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          text = text.slice(0, startIdx) + text.slice(i + 1);
          break;
        }
      }
    }
  }

  return text.trim();
}

// ---- sub-components -------------------------------------------------------

/** 系统状态气泡（居中） */
function StatusBubble({
  text,
  error,
}: {
  text: string;
  error?: boolean;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "12px 8px",
        fontSize: 12,
        color: error ? "rgba(255,180,160,0.9)" : "var(--theme-lyrics-mid)",
        fontFamily: "var(--font-ui)",
      }}
    >
      {text}
    </div>
  );
}

/** 消息气泡路由 */
function MessageBubble({
  message,
  onPlay,
}: {
  message: ChatMessage;
  onPlay: (song: Song) => void;
}) {
  if (message.role === "user") {
    return <UserBubble text={message.text} />;
  }

  // assistant 消息
  const { recommendations, matchedSongs } = message;
  // 提取 JSON 外的文字部分：先移除 think 块和 code fences，
  // 再通过平衡括号匹配移除 JSON 数组
  const textPart = stripJsonArray(message.text);

  return (
    <div style={{ marginBottom: 12 }}>
      <AssistantBubble>
        {textPart && (
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.7,
              color: "var(--text-primary, var(--theme-lyrics-next))",
              whiteSpace: "pre-wrap",
              marginBottom:
                recommendations && recommendations.length > 0 ? 8 : 0,
            }}
          >
            {textPart}
          </div>
        )}
        {recommendations && recommendations.length > 0 && matchedSongs && (
          <RecommendationList
            recommendations={recommendations}
            matchedSongs={matchedSongs}
            onPlay={onPlay}
          />
        )}
      </AssistantBubble>
    </div>
  );
}

/** 用户气泡 —— 右对齐 */
function UserBubble({ text }: { text: string }) {
  return (
    <div
      className="flex justify-end"
      style={{ marginBottom: 12, padding: "0 2px" }}
    >
      <div
        style={{
          maxWidth: "80%",
          padding: "8px 12px",
          borderRadius: "12px 12px 2px 12px",
          background: "var(--theme-accent, rgba(120,120,255,0.7))",
          color: "#fff",
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** assistant 气泡容器 —— 左对齐 */
function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex justify-start"
      style={{ marginBottom: 0, padding: "0 2px" }}
    >
      <div
        style={{
          maxWidth: "92%",
          padding: "8px 12px",
          borderRadius: "12px 12px 12px 2px",
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(0,0,0,0.45)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 歌曲推荐列表（自包含选中状态 + 操作） */
function RecommendationList({
  recommendations,
  matchedSongs,
  onPlay,
}: {
  recommendations: SongRecommendation[];
  matchedSongs: Song[];
  onPlay: (song: Song) => void;
}) {
  // 建立 id -> Song 映射
  const songMap = useMemo(
    () => new Map(matchedSongs.map((s) => [s.id, s])),
    [matchedSongs],
  );

  // 选中状态
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(matchedSongs.map((s) => s.id)),
  );

  // 歌单创建状态
  const [showNameInput, setShowNameInput] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [creating, setCreating] = useState(false);

  // 成功提示
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }, []);

  // 选中的 Song 对象列表
  const selectedSongs = useMemo(
    () => matchedSongs.filter((s) => selected.has(s.id)),
    [matchedSongs, selected],
  );

  const allSelected =
    matchedSongs.length > 0 && matchedSongs.every((s) => selected.has(s.id));

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(matchedSongs.map((s) => s.id)));
    }
  }, [allSelected, matchedSongs]);

  // 加入播放列表
  const handleQueue = useCallback(async () => {
    if (selectedSongs.length === 0) return;
    try {
      for (const s of selectedSongs) {
        await api.queueAppend(s);
      }
      showToast(`已加入 ${selectedSongs.length} 首到播放列表`);
    } catch (err) {
      console.error("[AiPlaylist] queueAppend failed:", err);
    }
  }, [selectedSongs, showToast]);

  // 创建歌单
  const handleCreatePlaylist = useCallback(async () => {
    if (selectedSongs.length === 0 || !playlistName.trim()) return;
    setCreating(true);
    try {
      const receipt = await api.createPlaylist(playlistName.trim());
      if (receipt.playlist_id) {
        await api.addTracksToPlaylist(
          receipt.playlist_id,
          selectedSongs.map((s) => s.id),
        );
      }
      showToast(`歌单创建成功：《${playlistName.trim()}》`);
      setShowNameInput(false);
    } catch (err) {
      console.error("[AiPlaylist] createPlaylist failed:", err);
    } finally {
      setCreating(false);
    }
  }, [selectedSongs, playlistName, showToast]);

  const openNameInput = useCallback(() => {
    setPlaylistName(`Melody ${new Date().toLocaleDateString("zh-CN")}`);
    setShowNameInput(true);
  }, []);

  const hasSelection = selectedSongs.length > 0;

  return (
    <div>
      {/* 全选 / 已选计数 */}
      {matchedSongs.length > 0 && (
        <div
          className="flex items-center justify-between"
          style={{
            padding: "4px 8px 6px",
            fontSize: 11,
            color: "var(--text-secondary, var(--theme-lyrics-mid))",
            fontFamily: "var(--font-ui)",
          }}
        >
          <div
            className="flex items-center gap-1"
            style={{ cursor: "pointer" }}
            onClick={toggleAll}
          >
            <CustomCheckbox checked={allSelected} onChange={toggleAll} />
            <span style={{ marginLeft: 2 }}>全选</span>
          </div>
          <span>已选 {selectedSongs.length} 首</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {recommendations.map((rec, i) => {
          const song = songMap.get(rec.id);
          return (
            <SongCard
              key={`${rec.id}-${i}`}
              rec={rec}
              song={song ?? null}
              checked={selected.has(rec.id)}
              onToggle={() => toggleOne(rec.id)}
              onPlay={onPlay}
            />
          );
        })}
      </div>

      {/* 操作按钮 */}
      {matchedSongs.length > 0 && (
        <div className="flex gap-2" style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={handleQueue}
            disabled={!hasSelection}
            className="transition-all hover:brightness-110"
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: 6,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: hasSelection
                ? "var(--theme-accent, rgba(120,120,255,0.9))"
                : "var(--theme-lyrics-mid)",
              fontSize: 12,
              fontFamily: "var(--font-ui)",
              cursor: hasSelection ? "pointer" : "default",
              opacity: hasSelection ? 1 : 0.5,
            }}
          >
            加入播放列表
          </button>
          <button
            type="button"
            onClick={openNameInput}
            disabled={!hasSelection}
            className="transition-all hover:brightness-110"
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: 6,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: hasSelection
                ? "var(--theme-accent, rgba(120,120,255,0.9))"
                : "var(--theme-lyrics-mid)",
              fontSize: 12,
              fontFamily: "var(--font-ui)",
              cursor: hasSelection ? "pointer" : "default",
              opacity: hasSelection ? 1 : 0.5,
            }}
          >
            创建歌单
          </button>
        </div>
      )}

      {/* 歌单名称输入框 */}
      {showNameInput && (
        <div
          style={{
            marginTop: 6,
            padding: "8px",
            borderRadius: 6,
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <input
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            placeholder="输入歌单名称"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreatePlaylist();
              if (e.key === "Escape") setShowNameInput(false);
            }}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(0,0,0,0.3)",
              color: "var(--text-primary, var(--theme-lyrics-next))",
              fontSize: 12,
              fontFamily: "var(--font-ui)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div className="flex gap-2" style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={handleCreatePlaylist}
              disabled={creating || !playlistName.trim()}
              style={{
                flex: 1,
                padding: "5px 0",
                borderRadius: 4,
                background: "var(--theme-accent, rgba(120,120,255,0.8))",
                border: "none",
                color: "#fff",
                fontSize: 11,
                fontFamily: "var(--font-ui)",
                cursor:
                  creating || !playlistName.trim() ? "default" : "pointer",
                opacity: creating || !playlistName.trim() ? 0.5 : 1,
              }}
            >
              {creating ? "创建中..." : "确认"}
            </button>
            <button
              type="button"
              onClick={() => setShowNameInput(false)}
              style={{
                flex: 1,
                padding: "5px 0",
                borderRadius: 4,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--text-secondary, var(--theme-lyrics-mid))",
                fontSize: 11,
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 成功提示 Toast */}
      {toast && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(40,180,100,0.18)",
            border: "1px solid rgba(40,180,100,0.3)",
            color: "rgba(120,240,160,0.95)",
            fontSize: 11,
            fontFamily: "var(--font-ui)",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/** 单首歌曲卡片 */
function SongCard({
  rec,
  song,
  checked,
  onToggle,
  onPlay,
}: {
  rec: SongRecommendation;
  song: Song | null;
  checked: boolean;
  onToggle: () => void;
  onPlay: (song: Song) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const canPlay = song !== null && song.playable;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        background: hovered
          ? "rgba(255,255,255,0.06)"
          : "rgba(255,255,255,0.02)",
        cursor: canPlay ? "pointer" : "default",
        transition: "background 0.15s",
      }}
    >
      {/* 自定义 Checkbox */}
      <CustomCheckbox checked={checked} onChange={onToggle} />

      {/* 可点击播放区域 */}
      <div
        onClick={() => canPlay && song && onPlay(song)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          cursor: canPlay ? "pointer" : "default",
        }}
      >
        {/* 封面缩略图 */}
        {song?.cover_url ? (
          <img
            src={`${song.cover_url}?param=40y40`}
            alt=""
            style={{
              width: 36,
              height: 36,
              borderRadius: 4,
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 4,
              background: "rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          />
        )}

        {/* 歌曲信息 */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-primary, var(--theme-lyrics-next))",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {rec.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-secondary, var(--theme-lyrics-mid))",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {rec.artist}
          </div>
          {rec.reason && (
            <div
              style={{
                fontSize: 10,
                color: "var(--theme-accent, rgba(120,120,255,0.7))",
                marginTop: 2,
                lineHeight: 1.3,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {rec.reason}
            </div>
          )}
        </div>

        {/* 播放指示 */}
        {canPlay && hovered && (
          <span
            style={{
              fontSize: 14,
              color: "var(--theme-accent, rgba(120,120,255,0.9))",
              flexShrink: 0,
            }}
          >
            ▶
          </span>
        )}
        {!canPlay && song && (
          <span
            style={{
              fontSize: 10,
              color: "var(--theme-lyrics-mid)",
              flexShrink: 0,
            }}
          >
            不可播
          </span>
        )}
      </div>
    </div>
  );
}

/** 自定义 Checkbox */
function CustomCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        border: checked
          ? "none"
          : "1.5px solid rgba(255,255,255,0.25)",
        background: checked
          ? "var(--theme-accent, rgba(120,120,255,0.9))"
          : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
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

/** 打字指示器 */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1" style={{ padding: "4px 0" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--theme-lyrics-mid)",
            opacity: 0.6,
            animation: `aipl-dot 1.2s ${i * 0.2}s infinite ease-in-out`,
          }}
        />
      ))}
      <style>{`
        @keyframes aipl-dot {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
          30% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}

/**
 * Streaming assistant bubble — displays stripped text + incrementally parsed
 * song cards as the LLM generates tokens.
 */
function StreamingBubble({
  text,
  matchRecommendations,
  onPlay,
}: {
  text: string;
  matchRecommendations: (recs: SongRecommendation[]) => Song[];
  onPlay: (song: Song) => void;
}) {
  const textPart = stripJsonArray(text);

  // Incrementally parse complete song objects from the stream
  const partialRecs = useMemo(() => extractPartialSongs(text), [text]);
  const matchedSongs = useMemo(
    () => (partialRecs.length > 0 ? matchRecommendations(partialRecs) : []),
    [partialRecs, matchRecommendations],
  );

  // Build id -> Song map for the cards
  const songMap = useMemo(
    () => new Map(matchedSongs.map((s) => [s.id, s])),
    [matchedSongs],
  );

  const hasText = textPart.length > 0;
  const hasCards = partialRecs.length > 0;

  return (
    <div>
      {hasText && (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.7,
            color: "var(--text-primary, var(--theme-lyrics-next))",
            whiteSpace: "pre-wrap",
            marginBottom: hasCards ? 8 : 0,
          }}
        >
          {textPart}
        </div>
      )}
      {hasCards && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {partialRecs.map((rec, i) => {
            const song = songMap.get(rec.id) ?? null;
            return (
              <SongCard
                key={`${rec.id}-${i}`}
                rec={rec}
                song={song}
                checked={false}
                onToggle={() => {}}
                onPlay={onPlay}
              />
            );
          })}
        </div>
      )}
      {!hasText && !hasCards && <TypingIndicator />}
    </div>
  );
}

