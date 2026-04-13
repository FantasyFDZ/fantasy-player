#!/usr/bin/env node
/*
 * Melody NetEase adapter — stateless CLI wrapper around
 * netease-cloud-music-api-alger.
 *
 * Usage: node netease_adapter.cjs <command> <json-payload>
 *
 * Contract:
 *   - Reads command + JSON payload from argv.
 *   - Writes a single line to stdout: {"ok":true,"data":...} or
 *     {"ok":false,"error":"..."}
 *   - Exits 0 on success, 1 on failure (details mirrored to stderr).
 *   - Cookies are owned by the Rust side and passed through payload.cookie.
 */

const api = require("netease-cloud-music-api-alger");

// ---- helpers ---------------------------------------------------------------

function toStr(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstDefined(...values) {
  return values.find((v) => v !== undefined && v !== null);
}

function pickArray(...values) {
  for (const v of values) if (Array.isArray(v)) return v;
  return [];
}

function joinArtists(artists) {
  return pickArray(artists)
    .map((a) => toStr(a?.name))
    .filter(Boolean)
    .join(" / ");
}

function normalizeSong(record) {
  if (!record) return null;
  const id = toStr(firstDefined(record?.id, record?.songId, record?.trackId));
  if (!id) return null;
  const album = firstDefined(record?.album, record?.al, {}) || {};
  const artist = joinArtists(firstDefined(record?.artists, record?.ar));
  const durationMs = toNum(firstDefined(record?.duration, record?.dt, record?.time), 0);
  const privilegeSt = toNum(record?.privilege?.st, 0);

  return {
    id,
    name: toStr(record?.name),
    artist,
    album: toStr(firstDefined(album?.name, record?.albumName)),
    cover_url: toStr(
      firstDefined(
        album?.picUrl,
        album?.coverImgUrl,
        record?.picUrl,
        record?.coverImgUrl,
      ),
    ),
    duration_secs: Math.max(0, Math.floor(durationMs / 1000)),
    playable:
      record?.playable !== false &&
      privilegeSt !== -200 &&
      privilegeSt !== -1,
  };
}

function normalizePlaylist(record) {
  if (!record) return null;
  const id = toStr(firstDefined(record?.id, record?.playlistId));
  if (!id) return null;
  return {
    id,
    name: toStr(record?.name),
    cover_url: toStr(firstDefined(record?.coverImgUrl, record?.picUrl)),
    track_count: toNum(firstDefined(record?.trackCount, record?.songCount), 0),
    description: toStr(record?.description),
    creator_name: toStr(record?.creator?.nickname),
    creator_id: toStr(record?.creator?.userId),
    play_count: toNum(record?.playCount, 0),
    special_type: toNum(record?.specialType, 0),
  };
}

// ---- command handlers ------------------------------------------------------

async function searchSongs({ query, limit = 30, cookie = "" }) {
  const keywords = toStr(query);
  if (!keywords) return [];
  const resp = await api.cloudsearch({ keywords, limit, type: 1, cookie });
  return pickArray(resp?.body?.result?.songs, resp?.body?.songs)
    .map(normalizeSong)
    .filter(Boolean)
    .slice(0, limit);
}

async function songDetail({ id, cookie = "" }) {
  const resp = await api.song_detail({ ids: toStr(id), cookie });
  const song = firstDefined(resp?.body?.songs?.[0], resp?.body?.song, {});
  return normalizeSong(song);
}

async function songUrl({ id, level = "standard", cookie = "" }) {
  const primary = await api.song_url_v1({ id: toStr(id), level, cookie });
  const first = firstDefined(primary?.body?.data?.[0], {});
  if (toStr(first?.url)) {
    return {
      url: toStr(first.url),
      br: toNum(first.br, 0),
      size: toNum(first.size, 0),
      type: toStr(first.type),
    };
  }
  const fallback = await api.song_url({ id: toStr(id), cookie });
  const fb = firstDefined(fallback?.body?.data?.[0], {});
  return {
    url: toStr(fb?.url),
    br: toNum(fb?.br, 0),
    size: toNum(fb?.size, 0),
    type: toStr(fb?.type),
  };
}

async function lyric({ id, cookie = "" }) {
  const resp = await api.lyric({ id: toStr(id), cookie });
  return {
    lrc: toStr(resp?.body?.lrc?.lyric),
    tlyric: toStr(resp?.body?.tlyric?.lyric),
    romalrc: toStr(resp?.body?.romalrc?.lyric),
  };
}

async function qrKey() {
  const resp = await api.login_qr_key({});
  const key = toStr(
    firstDefined(resp?.body?.data?.unikey, resp?.body?.unikey, resp?.body?.data?.key),
  );
  if (!key) throw new Error("login_qr_key 未返回 unikey");
  return { unikey: key };
}

async function qrCreate({ unikey }) {
  const resp = await api.login_qr_create({
    key: toStr(unikey),
    qrimg: true,
    platform: "web",
  });
  const data = firstDefined(resp?.body?.data, resp?.body, {});
  return {
    qr_url: toStr(firstDefined(data?.qrurl, data?.qrUrl)),
    qr_img: toStr(firstDefined(data?.qrimg, data?.qrImg)),
  };
}

async function qrCheck({ unikey }) {
  const resp = await api.login_qr_check({ key: toStr(unikey) });
  const body = resp?.body || {};
  const code = toNum(body?.code, 0);
  // 800 expired, 801 waiting scan, 802 scanned waiting confirm, 803 success
  const statusMap = {
    800: "expired",
    801: "waiting",
    802: "scanned",
    803: "ok",
  };
  return {
    code,
    status: statusMap[code] || "unknown",
    cookie: code === 803 ? toStr(body?.cookie) : "",
    message: toStr(body?.message),
  };
}

async function loginStatus({ cookie = "" }) {
  if (!cookie) return { logged_in: false, user: null };
  try {
    const resp = await api.login_status({ cookie });
    const body = firstDefined(resp?.body?.data, resp?.body, {});
    const profile = body?.profile;
    if (!profile) return { logged_in: false, user: null };
    return {
      logged_in: true,
      user: {
        user_id: toStr(profile?.userId),
        nickname: toStr(profile?.nickname),
        avatar_url: toStr(profile?.avatarUrl),
        vip_type: toNum(profile?.vipType, 0),
      },
    };
  } catch {
    return { logged_in: false, user: null };
  }
}

async function logout({ cookie = "" }) {
  if (cookie) {
    try {
      await api.logout({ cookie });
    } catch {
      // best effort
    }
  }
  return { ok: true };
}

async function userPlaylists({ uid, cookie = "", limit = 100 }) {
  const resp = await api.user_playlist({ uid: toStr(uid), cookie, limit });
  return pickArray(resp?.body?.playlist, resp?.body?.data?.playlist)
    .map(normalizePlaylist)
    .filter(Boolean);
}

async function playlistDetail({ id, cookie = "", limit = 500 }) {
  const resp = await api.playlist_detail({ id: toStr(id), cookie });
  const playlist = firstDefined(resp?.body?.playlist, resp?.body?.data?.playlist, {});
  const summary = normalizePlaylist(playlist);
  const tracks = pickArray(playlist?.tracks, playlist?.songs)
    .map(normalizeSong)
    .filter(Boolean)
    .slice(0, limit);
  return { summary, tracks };
}

async function songComments({ id, cookie = "", limit = 10 }) {
  // /comment/music 热评接口，按点赞数排序
  const resp = await api.comment_music({
    id: toStr(id),
    limit,
    cookie,
  });
  const body = resp?.body || {};
  // 优先取 hotComments（热评），没有则降级到 comments
  const raw = pickArray(body?.hotComments, body?.comments).slice(0, limit);
  return raw.map((c) => ({
    comment_id: toStr(firstDefined(c?.commentId, c?.id)),
    user_id: toStr(c?.user?.userId),
    nickname: toStr(c?.user?.nickname),
    avatar_url: toStr(c?.user?.avatarUrl),
    content: toStr(c?.content),
    liked_count: toNum(c?.likedCount, 0),
    time_ms: toNum(c?.time, 0),
  }));
}

// ---- playlist write ops -----------------------------------------------------

async function createPlaylist({ name, cookie = "" }) {
  const playlistName = toStr(name) || "新建歌单";
  const resp = await api.playlist_create({ name: playlistName, cookie });
  const playlist = firstDefined(
    resp?.body?.playlist,
    resp?.body?.data,
    resp?.body,
    {},
  );
  const playlistId = toStr(firstDefined(playlist?.id, playlist?.playlistId));
  return {
    playlist_id: playlistId,
    playlist_name: toStr(firstDefined(playlist?.name, playlistName)),
  };
}

async function addTracksToPlaylist({ playlistId, trackIds, cookie = "" }) {
  const pid = toStr(playlistId);
  if (!pid) throw new Error("missing playlistId");
  const ids = pickArray(trackIds);
  if (ids.length === 0) throw new Error("trackIds is empty");
  const resp = await api.playlist_tracks({
    op: "add",
    pid,
    tracks: ids.map((id) => toStr(id)).join(","),
    cookie,
  });
  const body = resp?.body || {};
  const code = toNum(body?.code || body?.status, 0);
  if (code !== 200 && code !== 0) {
    throw new Error(
      `添加歌曲失败: code=${code}, msg=${toStr(body?.message || body?.msg)}`,
    );
  }
  return { ok: true, code };
}

// ---- dispatch --------------------------------------------------------------

const COMMANDS = {
  search_songs: searchSongs,
  song_detail: songDetail,
  song_url: songUrl,
  lyric,
  qr_key: qrKey,
  qr_create: qrCreate,
  qr_check: qrCheck,
  login_status: loginStatus,
  logout,
  user_playlists: userPlaylists,
  playlist_detail: playlistDetail,
  song_comments: songComments,
  create_playlist: createPlaylist,
  add_tracks_to_playlist: addTracksToPlaylist,
};

async function main() {
  const command = process.argv[2];
  const payloadArg = process.argv[3];

  if (!command) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: "missing command argument" }) + "\n",
    );
    process.exit(1);
  }

  const handler = COMMANDS[command];
  if (!handler) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: `unknown command: ${command}` }) + "\n",
    );
    process.exit(1);
  }

  let payload = {};
  if (payloadArg) {
    try {
      payload = JSON.parse(payloadArg);
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: `invalid JSON payload: ${error.message}`,
        }) + "\n",
      );
      process.exit(1);
    }
  }

  try {
    const data = await handler(payload);
    const json = JSON.stringify({ ok: true, data }) + "\n";
    await new Promise((resolve, reject) => {
      process.stdout.write(json, (err) => (err ? reject(err) : resolve()));
    });
    process.exit(0);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? error.message || JSON.stringify(error)
          : String(error);
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
    process.stderr.write(message + "\n");
    process.exit(1);
  }
}

main();
