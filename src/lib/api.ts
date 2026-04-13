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

// ---- QQ Music -------------------------------------------------------------

export interface QQUserProfile {
  uin: string;
  nickname: string;
  avatar_url: string;
}

export interface QQSession {
  cookie: string;
  user: QQUserProfile | null;
}

export interface QQSong {
  mid: string;
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
}

export interface QQPlaylist {
  disstid: string;
  name: string;
  song_cnt: number;
  cover: string;
}

export interface QQPlaylistDetail {
  info: QQPlaylist;
  songs: QQSong[];
}

// ---- Playlist sync --------------------------------------------------------

export type SyncSource = "qq" | "netease";
export type SyncTarget = "qq" | "netease";

export interface SkippedSong {
  name: string;
  artist: string;
  reason: string;
}

export interface SyncReport {
  playlist_name: string;
  total: number;
  matched: number;
  skipped: number;
  skipped_songs: SkippedSong[];
}

export interface SyncProgress {
  playlist_name: string;
  current: number;
  total: number;
  current_song: string;
}

// ---- Audio features -------------------------------------------------------

export interface AudioFeatures {
  // ---- Tier 0 ----
  bpm: number;
  /** BPM 置信度 0-1，融合后的最终结果 */
  bpm_confidence: number;
  /** 多算法候选 BPM（[multifeature, percival]），用于前端提示 */
  bpm_candidates: number[];
  /** 调式，大调 "C"，小调 "Cm" */
  key: string;
  /** 调式置信度 0-1 */
  key_confidence: number;

  // ---- Tier 1 ----
  energy: number;
  valence: number;
  spectral_centroid: number;
  spectral_bandwidth: number;
  spectral_flatness: number;
  spectral_rolloff: number;
  zero_crossing_rate: number;

  // ---- Tier 2: Essentia 拓展 ----
  loudness_lufs?: number | null;
  dynamic_complexity?: number | null;
  /** 0-3，越高越舞动 */
  danceability?: number | null;
  /** 每秒 onset 数 */
  onset_rate?: number | null;
  pitch_mean_hz?: number | null;
  pitch_std_hz?: number | null;
  pitch_range_semitones?: number | null;
  tuning_hz?: number | null;
  chord_progression?: string[] | null;
  chord_changes_per_min?: number | null;
  mfcc_brightness?: number | null;
  mfcc_warmth?: number | null;
  timbre_brightness_label?: string | null;
  timbre_warmth_label?: string | null;

  // ---- Tier 3: TF 预训练（缺模型时全为 null）----
  voice_instrumental?: string | null;
  voice_gender?: string | null;
  mood_tags?: string[] | null;
  genre_tags?: string[] | null;
  instrument_tags?: string[] | null;

  // ---- Tier 4: LLM hint ----
  llm_bpm?: number | null;
  llm_bpm_confidence?: string | null;
  llm_genre?: string | null;
  llm_genre_confidence?: string | null;
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
  async createPlaylist(name: string) {
    return invoke<{ playlist_id: string; playlist_name: string }>(
      "create_playlist",
      { name },
    );
  },
  async addTracksToPlaylist(playlistId: string, trackIds: string[]) {
    return invoke<{ ok: boolean; code: number }>(
      "add_tracks_to_playlist",
      { playlistId, trackIds },
    );
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

  // ---- QQ Music auth ----
  async qqSession() {
    return invoke<QQSession>("qq_auth_session");
  },
  async qqLoginCookie(cookie: string) {
    return invoke<QQUserProfile>("qq_auth_login_cookie", { cookie });
  },
  async qqRefresh() {
    return invoke<QQUserProfile | null>("qq_auth_refresh");
  },
  async qqLogout() {
    return invoke<void>("qq_auth_logout");
  },

  // ---- QQ Music catalog ----
  async qqGetPlaylists() {
    return invoke<QQPlaylist[]>("qq_get_playlists");
  },
  async qqGetPlaylistDetail(disstid: string) {
    return invoke<QQPlaylistDetail>("qq_get_playlist_detail", { disstid });
  },

  // ---- Playlist sync ----
  async syncPlaylists(
    source: SyncSource,
    target: SyncTarget,
    playlistIds: string[],
  ) {
    return invoke<SyncReport[]>("sync_playlists", {
      source,
      target,
      playlistIds,
    });
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

/** 订阅歌单迁移进度事件 */
export function onSyncProgress(
  handler: (progress: SyncProgress) => void,
): Promise<UnlistenFn> {
  return listen<SyncProgress>("sync-progress", (event) =>
    handler(event.payload),
  );
}
