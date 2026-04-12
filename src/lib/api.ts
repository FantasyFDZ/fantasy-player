// 前端与 Rust 后端之间的类型化 Tauri command 绑定。
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ---- types ---------------------------------------------------------------

export type PlayMode = "sequential" | "shuffle" | "repeat_one";
export type PlayState = "idle" | "playing" | "paused";

export interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  cover_url: string;
  duration_secs: number;
  playable: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  cover_url: string;
  track_count: number;
  description: string;
  creator_name: string;
  creator_id: string;
  play_count: number;
  special_type: number;
}

export interface PlaylistDetail {
  summary: Playlist;
  tracks: Song[];
}

export interface SongComment {
  comment_id: string;
  user_id: string;
  nickname: string;
  avatar_url: string;
  content: string;
  liked_count: number;
  time_ms: number;
}

export interface UserProfile {
  user_id: string;
  nickname: string;
  avatar_url: string;
  vip_type: number;
}

export interface Session {
  cookie: string;
  pending_unikey: string;
  user: UserProfile | null;
}

export interface QrStartReceipt {
  unikey: string;
  qr_url: string;
  qr_img: string;
}

export type QrCheckOutcome =
  | { status: "waiting"; message: string }
  | { status: "scanned"; message: string }
  | { status: "expired"; message: string }
  | { status: "ok"; user: UserProfile };

export interface PlaybackStatus {
  state: PlayState;
  position: number;
  duration: number;
  volume: number;
}

export interface Lyric {
  lrc: string;
  tlyric: string;
  romalrc: string;
}

export interface QueueSnapshot {
  tracks: Song[];
  current_index: number | null;
  mode: PlayMode;
}

// ---- LLM -----------------------------------------------------------------

export type LlmProtocol = "openai" | "anthropic";

export interface LlmProvider {
  id: string;
  name: string;
  api_key: string;
  base_url: string;
  protocol: LlmProtocol;
  models: string[];
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequestParams {
  provider_id: string;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LlmResponse {
  content: string;
  model: string;
  usage: LlmUsage | null;
}

// ---- Audio features -------------------------------------------------------

export interface AudioFeatures {
  bpm: number;
  /** BPM 置信度 0-1，融合后的最终结果 */
  bpm_confidence: number;
  /** 多算法候选 BPM（[multifeature, percival]），用于前端提示 */
  bpm_candidates: number[];
  energy: number;
  valence: number;
  /** 调式，大调 "C"，小调 "Cm" */
  key: string;
  /** 调式置信度 0-1 */
  key_confidence: number;
  spectral_centroid: number;
  spectral_bandwidth: number;
  spectral_flatness: number;
  spectral_rolloff: number;
  zero_crossing_rate: number;
}

// ---- auth ---------------------------------------------------------------

export const api = {
  async session() {
    return invoke<Session>("auth_session");
  },
  async qrStart() {
    return invoke<QrStartReceipt>("auth_qr_start");
  },
  async qrCheck() {
    return invoke<QrCheckOutcome>("auth_qr_check");
  },
  async refresh() {
    return invoke<UserProfile | null>("auth_refresh");
  },
  async logout() {
    return invoke<void>("auth_logout");
  },

  // ---- catalog ----
  async searchSongs(query: string, limit = 30) {
    return invoke<Song[]>("search_songs", { query, limit });
  },
  async getLyric(id: string) {
    return invoke<Lyric>("get_lyric", { id });
  },
  async getUserPlaylists(limit = 100) {
    return invoke<Playlist[]>("get_user_playlists", { limit });
  },
  async getPlaylistDetail(id: string, limit = 500) {
    return invoke<PlaylistDetail>("get_playlist_detail", { id, limit });
  },
  async getSongComments(id: string, limit = 10) {
    return invoke<SongComment[]>("get_song_comments", { id, limit });
  },

  // ---- playback ----
  async playSong(song: Song) {
    return invoke<PlaybackStatus>("play_song", { song });
  },
  async pause() {
    return invoke<void>("pause");
  },
  async resume() {
    return invoke<void>("resume");
  },
  async seek(position: number) {
    return invoke<void>("seek", { position });
  },
  async setVolume(volume: number) {
    return invoke<void>("set_volume", { volume });
  },
  async stop() {
    return invoke<void>("stop");
  },
  async playbackStatus() {
    return invoke<PlaybackStatus>("playback_status");
  },

  // ---- queue ----
  async queueSnapshot() {
    return invoke<QueueSnapshot>("queue_snapshot");
  },
  async queueSetMode(mode: PlayMode) {
    return invoke<void>("queue_set_mode", { mode });
  },
  async queueAppend(song: Song) {
    return invoke<void>("queue_append", { song });
  },
  async queuePlayNext(song: Song) {
    return invoke<void>("queue_play_next", { song });
  },
  async queueRemove(index: number) {
    return invoke<boolean>("queue_remove", { index });
  },
  async queueClear() {
    return invoke<void>("queue_clear");
  },
  async queueReplace(tracks: Song[], startIndex = 0) {
    return invoke<void>("queue_replace", { tracks, startIndex });
  },
  async nextTrack(autoAdvance = false) {
    return invoke<Song | null>("next_track", { autoAdvance });
  },
  async prevTrack() {
    return invoke<Song | null>("prev_track");
  },

  // ---- settings ----
  async getSetting(key: string) {
    return invoke<string | null>("get_setting", { key });
  },
  async setSetting(key: string, value: string) {
    return invoke<void>("set_setting", { key, value });
  },

  // ---- LLM ----
  async llmProvidersList() {
    return invoke<LlmProvider[]>("llm_providers_list");
  },
  async llmProviderUpsert(provider: LlmProvider) {
    return invoke<void>("llm_provider_upsert", { provider });
  },
  async llmProviderDelete(id: string) {
    return invoke<void>("llm_provider_delete", { id });
  },
  async llmRequest(req: LlmRequestParams) {
    return invoke<LlmResponse>("llm_request", { req });
  },
  async llmStream(requestId: string, req: LlmRequestParams) {
    return invoke<LlmResponse>("llm_stream", { requestId, req });
  },

  // ---- Audio analysis ----
  async analyzeSong(song: Song) {
    return invoke<AudioFeatures>("analyze_song", { song });
  },

  // ---- Panel layout ----
  async panelLayoutList() {
    return invoke<PanelLayoutRow[]>("panel_layout_list");
  },
  async panelLayoutUpsert(row: PanelLayoutRow) {
    return invoke<void>("panel_layout_upsert", { row });
  },
  async panelLayoutDelete(panelId: string) {
    return invoke<void>("panel_layout_delete", { panelId });
  },

  // ---- Panel windows (multi-window architecture) ----
  async panelOpen(
    panelId: string,
    defaultSize: { w: number; h: number },
    opts: { dockRight?: boolean } = {},
  ) {
    return invoke<void>("panel_open", {
      panelId,
      defaultWidth: defaultSize.w,
      defaultHeight: defaultSize.h,
      dockRight: opts.dockRight ?? false,
    });
  },
  async panelClose(panelId: string) {
    return invoke<void>("panel_close", { panelId });
  },
  async panelOpenList() {
    return invoke<string[]>("panel_open_list");
  },
  async panelPersistGeometry(panelId: string) {
    return invoke<void>("panel_persist_geometry", { panelId });
  },
};

export interface PanelLayoutRow {
  panel_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface LlmStreamChunk {
  request_id: string;
  delta: string;
  done: boolean;
  usage?: LlmUsage | null;
}

// ---- events ----

export function onPlaybackUpdate(
  handler: (status: PlaybackStatus) => void,
): Promise<UnlistenFn> {
  return listen<PlaybackStatus>("melody://playback-update", (event) =>
    handler(event.payload),
  );
}

export function onTrackEnded(handler: () => void): Promise<UnlistenFn> {
  return listen("melody://track-ended", () => handler());
}

export function onLlmChunk(
  requestId: string,
  handler: (chunk: LlmStreamChunk) => void,
): Promise<UnlistenFn> {
  return listen<LlmStreamChunk>(`melody://llm-chunk/${requestId}`, (event) =>
    handler(event.payload),
  );
}

/**
 * 订阅当前歌曲变化事件。后端在任何 play/next/prev/queue_replace
 * 成功后广播 melody://song-changed，所有窗口（主 + 面板）都能收到。
 */
export function onSongChanged(
  handler: (song: Song) => void,
): Promise<UnlistenFn> {
  return listen<Song>("melody://song-changed", (event) => handler(event.payload));
}

/** 订阅面板窗口关闭事件（主窗口用来同步 CabinetControls 按钮状态）*/
export function onPanelClosed(
  handler: (panelId: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("melody://panel-closed", (event) =>
    handler(event.payload),
  );
}
