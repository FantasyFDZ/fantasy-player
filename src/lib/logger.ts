import { invoke } from "@tauri-apps/api/core";

/**
 * 写入一行日志到 ~/.config/melody/melody.log（通过 Rust 后端）。
 *
 * 日志永远不应阻塞或报错——失败时静默回退到 console.log。
 */
export async function log(
  module: string,
  message: string,
  level = "INFO",
): Promise<void> {
  try {
    await invoke<void>("write_log", { level, module, message });
  } catch {
    // 日志不应影响应用——回退到控制台
    console.log(`[${module}] ${message}`);
  }
}
