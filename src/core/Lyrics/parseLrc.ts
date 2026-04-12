// LRC 歌词解析。
//
// LRC 格式：每行可能有多个时间戳和一行文字。
//   [00:18.85]今天我 寒夜里看雪飘过
//   [00:25.50]怀着冷却了的心窝漂远方
// 同一首歌可能同时有 lrc（原文）和 tlyric（翻译），我们合并成
// 按时间对齐的 {time, text, translation?} 数组。

export interface LyricLine {
  time: number; // 秒
  text: string;
  translation?: string;
}

const TIME_RE = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

function parse(text: string): Array<{ time: number; text: string }> {
  const lines: Array<{ time: number; text: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const timestamps: number[] = [];
    // 剥离所有时间戳，留下文字
    let content = line;
    for (const match of line.matchAll(TIME_RE)) {
      const [, m, s, ms] = match;
      const time =
        Number(m) * 60 + Number(s) + (ms ? Number(ms) / 10 ** ms.length : 0);
      timestamps.push(time);
    }
    content = line.replace(TIME_RE, "").trim();
    if (!timestamps.length || !content) continue;
    for (const t of timestamps) {
      lines.push({ time: t, text: content });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

export function parseLyrics(lrc: string, tlyric?: string): LyricLine[] {
  const main = parse(lrc);
  if (!tlyric) {
    return main.map((l) => ({ time: l.time, text: l.text }));
  }
  const trans = parse(tlyric);
  const transByTime = new Map<number, string>();
  for (const t of trans) transByTime.set(Math.round(t.time * 100), t.text);

  return main.map((l) => ({
    time: l.time,
    text: l.text,
    translation: transByTime.get(Math.round(l.time * 100)),
  }));
}

/** 找到指定时刻应显示的行索引（二分法），返回 -1 表示在第一行之前。 */
export function findActiveLineIndex(
  lines: LyricLine[],
  currentTime: number,
): number {
  if (!lines.length) return -1;
  if (currentTime < lines[0].time) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].time <= currentTime) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
