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
};

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
