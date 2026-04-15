// AI 选歌的共享逻辑 —— 被 SearchPanel 的 AI Search 模式使用。
//
// 主要职责：
//   - 构造 LLM system prompt（从用户收藏库中挑歌）
//   - 流式地从 LLM 响应中解析完整的歌曲对象
//   - 剥除 JSON 仅保留自然语言叙述
//   - 把推荐结果匹配到完整 Song 对象

import type { Song } from "@/lib/api";

export interface SongRecommendation {
  id: string;
  name: string;
  artist: string;
  reason: string;
}

/** 构造给 LLM 的 system prompt —— 从用户收藏库中挑歌。 */
export function buildAiSearchSystemPrompt(
  librarySummary: string,
  totalCount: number,
): string {
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

/**
 * 从 LLM 流式返回中增量解析完整的歌曲对象。
 *
 * 当 LLM 一边生成 JSON 数组时，此函数会扫描所有已经出现在首个 `[...]` 块里
 * 的完整 `{...}` 对象并逐个解析。半成品尾部对象会被跳过 —— 等后续 token
 * 到达后自然会被处理。
 */
export function extractPartialSongs(text: string): SongRecommendation[] {
  // 先去掉 think 块和 markdown 代码围栏
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  cleaned = cleaned.replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1");

  const startIdx = cleaned.indexOf("[");
  if (startIdx === -1) return [];

  const results: SongRecommendation[] = [];

  // 从 `[` 之后开始，逐个找完整的 top-level `{...}` 对象
  let i = startIdx + 1;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === ",") {
      i++;
      continue;
    }
    if (ch === "]") break;
    if (ch !== "{") {
      i++;
      continue;
    }

    // 用平衡括号计数找匹配的 `}`
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
      // 当前对象还没写完 —— 停下等下一次调用
      break;
    }

    const objStr = cleaned.slice(i, endIdx + 1);
    try {
      const obj = JSON.parse(objStr);
      if (obj && typeof obj.name === "string" && typeof obj.artist === "string") {
        results.push(obj as SongRecommendation);
      }
    } catch {
      // 半成品对象 —— 跳过
    }
    i = endIdx + 1;
  }

  return results;
}

/** 剥除 <think> 块、代码围栏和 JSON 数组，仅保留自然语言叙述。
 *
 *  流式安全：如果找到 `[` 但配对的 `]` 还未到达，就把 `[` 到结尾全部切掉，
 *  这样用户永远看不到半成品 JSON。歌卡渲染由 extractPartialSongs 驱动，
 *  所以从部分 JSON 里解析到的歌仍会正常显示。 */
export function stripJsonArray(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  text = text.replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1");

  const startIdx = text.indexOf("[");
  if (startIdx !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let closedAt = -1;
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
          closedAt = i;
          break;
        }
      }
    }
    if (closedAt !== -1) {
      // 完整 JSON：剪掉平衡块，保留 JSON 前后的叙述
      text = text.slice(0, startIdx) + text.slice(closedAt + 1);
    } else {
      // 流式中：只保留 `[` 之前的文字
      text = text.slice(0, startIdx);
    }
  }

  return text.trim();
}

/** 把 AI 推荐映射到真实的 Song 对象。
 *
 *  匹配策略：先按 id 精确匹配，再按 `name + artist` 模糊匹配（忽略大小写）。
 *  找不到的推荐会被过滤掉，保证返回的每一项都是收藏库里真实存在的歌。 */
export function matchRecommendationsToSongs(
  recs: SongRecommendation[],
  library: Song[],
): Song[] {
  const idMap = new Map(library.map((s) => [s.id, s]));
  const nameMap = new Map(
    library.map((s) => [`${s.name}|||${s.artist}`.toLowerCase(), s]),
  );

  return recs
    .map((r) => {
      const byId = idMap.get(r.id);
      if (byId) return byId;
      const key = `${r.name}|||${r.artist}`.toLowerCase();
      const byName = nameMap.get(key);
      if (byName) return byName;
      return null;
    })
    .filter((s): s is Song => s !== null);
}
