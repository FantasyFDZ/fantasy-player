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
  // 当前活跃请求的 id。reset() 会把它清成 null —— 这样任何
  // 之前 in-flight 的 stream() promise 结算时会发现 id 不匹配，
  // 不再往 state 里写陈旧结果，避免 cancel 被后到的响应覆盖。
  const activeRequestIdRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  const request = useCallback(async (params: LlmRequestParams) => {
    cleanup();
    const requestId = `r${Date.now()}-${nextRequestId++}`;
    activeRequestIdRef.current = requestId;
    setState({ loading: true, error: null, content: "", usage: null });
    try {
      const resp = await api.llmRequest(params);
      if (activeRequestIdRef.current === requestId) {
        setState({
          loading: false,
          error: null,
          content: resp.content,
          usage: resp.usage,
        });
      }
      return resp;
    } catch (err) {
      if (activeRequestIdRef.current === requestId) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, loading: false, error: msg }));
      }
      throw err;
    }
  }, [cleanup]);

  const stream = useCallback(
    async (params: LlmRequestParams) => {
      cleanup();
      const requestId = `r${Date.now()}-${nextRequestId++}`;
      activeRequestIdRef.current = requestId;
      setState({ loading: true, error: null, content: "", usage: null });

      // 先订阅 event，再发起请求 —— 避免错过 chunk
      const unlisten = await onLlmChunk(requestId, (chunk) => {
        // 被 reset() 作废后不再写 state
        if (activeRequestIdRef.current !== requestId) return;
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
        if (activeRequestIdRef.current === requestId) {
          setState({
            loading: false,
            error: null,
            content: resp.content,
            usage: resp.usage,
          });
        }
        return resp;
      } catch (err) {
        if (activeRequestIdRef.current === requestId) {
          const msg = err instanceof Error ? err.message : String(err);
          setState((prev) => ({ ...prev, loading: false, error: msg }));
        }
        throw err;
      } finally {
        if (activeRequestIdRef.current === requestId) {
          cleanup();
        }
      }
    },
    [cleanup],
  );

  const reset = useCallback(() => {
    activeRequestIdRef.current = null;
    cleanup();
    setState({ loading: false, error: null, content: "", usage: null });
  }, [cleanup]);

  return { ...state, request, stream, reset };
}
