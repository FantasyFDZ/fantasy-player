import { api } from "@/lib/api";

function normalizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function reportError(context: string, err: unknown): Promise<void> {
  const message = normalizeError(err);
  console.error(`[${context}]`, err);

  try {
    await api.writeLog("ERROR", context, message);
  } catch {
    // 忽略日志写入失败，避免错误处理再次抛错
  }
}
