/**
 * Robustly extract a JSON array from an LLM response string.
 *
 * Handles common LLM response patterns:
 * - Clean JSON: `[{"id": "123", ...}]`
 * - Markdown code fences: ```json\n[...]\n```
 * - Text before/after the JSON array
 * - <think>...</think> reasoning blocks (some models like DeepSeek)
 * - Nested objects inside the array (balanced bracket matching)
 */
export function extractJsonArray<T = unknown>(raw: string): T[] | null {
  // 1. Strip <think>...</think> blocks
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, "");

  // 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
  text = text.replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1");

  // 3. Trim whitespace
  text = text.trim();

  // 4. Find the first top-level JSON array using balanced bracket matching.
  //    The naive regex /\[[\s\S]*?\]/ fails on nested brackets because the
  //    non-greedy quantifier stops at the *first* `]`, which is often inside
  //    a nested object. We need to count bracket depth instead.
  const startIdx = text.indexOf("[");
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      if (inString) escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        const jsonStr = text.slice(startIdx, i + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) {
            return parsed as T[];
          }
        } catch {
          // JSON.parse failed — keep scanning for another `[`
          // (unlikely but possible if the first bracket was in prose)
          return null;
        }
      }
    }
  }

  return null;
}
