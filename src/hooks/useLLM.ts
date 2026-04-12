// LLM 请求 hook。
//
// 用法：
//   const { request, stream, loading, error, content } = useLLM();
//   await request({ provider_id, model, messages });
//
//   // 流式：content 会随 chunk 逐步填充
//   await stream({ provider_id, model, messages });

import { useCallback, useRef, useState } from "react";
import {
  api,
  onLlmChunk,
  type LlmRequestParams,
  type LlmUsage,
} from "@/lib/api";

export interface UseLlmState {
  loading: boolean;
  error: string | null;
  content: string;
  usage: LlmUsage | null;
}

let nextRequestId = 1;

export function useLLM() {
  const [state, setState] = useState<UseLlmState>({
    loading: false,
    error: null,
    content: "",
    usage: null,
  });
  const unlistenRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  const request = useCallback(async (params: LlmRequestParams) => {
    cleanup();
    setState({ loading: true, error: null, content: "", usage: null });
    try {
      const resp = await api.llmRequest(params);
      setState({
        loading: false,
        error: null,
        content: resp.content,
        usage: resp.usage,
      });
      return resp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, loading: false, error: msg }));
      throw err;
    }
  }, [cleanup]);

  const stream = useCallback(
    async (params: LlmRequestParams) => {
      cleanup();
      const requestId = `r${Date.now()}-${nextRequestId++}`;
      setState({ loading: true, error: null, content: "", usage: null });

      // 先订阅 event，再发起请求 —— 避免错过 chunk
      const unlisten = await onLlmChunk(requestId, (chunk) => {
        if (chunk.done) {
          setState((prev) => ({
            ...prev,
            usage: chunk.usage ?? prev.usage,
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          content: prev.content + chunk.delta,
        }));
      });
      unlistenRef.current = unlisten;

      try {
        const resp = await api.llmStream(requestId, params);
        // 最终 state 用 backend 返回的累积内容覆盖（确保完整）
        setState({
          loading: false,
          error: null,
          content: resp.content,
          usage: resp.usage,
        });
        return resp;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, loading: false, error: msg }));
        throw err;
      } finally {
        cleanup();
      }
    },
    [cleanup],
  );

  const reset = useCallback(() => {
    cleanup();
    setState({ loading: false, error: null, content: "", usage: null });
  }, [cleanup]);

  return { ...state, request, stream, reset };
}
