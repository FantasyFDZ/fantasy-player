#!/usr/bin/env node
/*
 * Melody QQ Music adapter — stateless CLI wrapper around qq-music-api.
 *
 * Usage: node qqmusic_adapter.cjs <command> <json-payload>
 *
 * Contract:
 *   - Reads command + JSON payload from argv.
 *   - Writes a single line to stdout: {"ok":true,"data":...} or
 *     {"ok":false,"error":"..."}
 *   - Exits 0 on success, 1 on failure (details mirrored to stderr).
 *   - Cookies are owned by the Rust side and passed through payload.cookie.
 */

const qqMusic = require("qq-music-api");
const axios = require("axios");

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

function joinSingers(singers) {
  return pickArray(singers)
    .map((s) => toStr(s?.name || s?.title))
    .filter(Boolean)
    .join(" / ");
}

function normalizeSong(record) {
  if (!record) return null;
  const mid = toStr(firstDefined(record?.songmid, record?.mid, record?.strMediaMid));
  if (!mid) return null;
  const id = toStr(firstDefined(record?.songid, record?.id));
  const name = toStr(firstDefined(record?.songname, record?.name, record?.title));
  const artist = joinSingers(firstDefined(record?.singer, record?.singers, record?.ar));
  const album = toStr(
    firstDefined(
      record?.albumname,
      record?.album?.name,
      record?.album?.title,
    ),
  );
  const durationSecs = toNum(firstDefined(record?.interval, record?.duration), 0);

  return {
    mid,
    id,
    name,
    artist,
    album,
    duration: durationSecs,
  };
}

function normalizePlaylist(record) {
  if (!record) return null;
  const disstid = toStr(
    firstDefined(record?.disstid, record?.dissid, record?.tid, record?.id),
  );
  if (!disstid) return null;
  return {
    disstid,
    name: toStr(firstDefined(record?.diss_name, record?.dissname, record?.name, record?.title)),
    song_cnt: toNum(firstDefined(record?.song_cnt, record?.songnum, record?.track_count), 0),
    cover: toStr(firstDefined(record?.diss_cover, record?.logo, record?.imgurl, record?.picUrl)),
  };
}

// ---- command handlers ------------------------------------------------------

async function setCookie({ cookie = "" }) {
  if (!cookie) throw new Error("missing cookie");
  qqMusic.setCookie(cookie);
  return { status: "cookie_set" };
}

// ---- QR login (cookie-paste fallback) ---------------------------------------

/**
 * qr_create — QQ Music QR login is not available from a headless Node.js
 * process because QQ's ptqrlogin endpoint enforces strict browser-only
 * anti-bot checks (403 on non-browser user agents).
 *
 * Instead, the Rust UI should show a "paste cookie" dialog.  The user can
 * obtain cookies from a browser session (DevTools -> Application -> Cookies
 * on y.qq.com) and paste them here.
 *
 * Returns: { method: "cookie_paste", instructions }
 */
async function qrCreate() {
  return {
    method: "cookie_paste",
    instructions:
      "QQ音乐暂不支持扫码登录（服务端反爬限制）。" +
      "请在浏览器中访问 y.qq.com 并登录，然后打开开发者工具 → " +
      "Application → Cookies → https://y.qq.com，" +
      "复制全部 cookie 字符串粘贴到输入框中。",
  };
}

/**
 * qr_check — Not applicable for cookie-paste flow.
 * Returns a fixed status telling the Rust side to use set_cookie instead.
 */
async function qrCheck() {
  return {
    status: "unsupported",
    message:
      "QQ音乐使用 cookie 粘贴登录，无需轮询二维码状态。" +
      "请调用 set_cookie 传入浏览器 cookie。",
  };
}

async function userDetail({ id, cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  if (!id) throw new Error("missing id (QQ number)");
  const data = await qqMusic.api("user/detail", { id });
  const creator = data?.creator || {};
  const mymusic = pickArray(data?.mymusic);
  return {
    uin: toStr(firstDefined(creator?.uin, creator?.encrypt_uin, id)),
    nickname: toStr(firstDefined(creator?.hostname, creator?.nick)),
    avatar: toStr(creator?.headpic),
    liked_count: toNum(mymusic[0]?.num0, 0),
  };
}

async function userPlaylists({ id, cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  if (!id) throw new Error("missing id (QQ number)");
  const data = await qqMusic.api("user/songlist", { id });
  return pickArray(data?.list)
    .map(normalizePlaylist)
    .filter(Boolean);
}

async function playlistDetail({ id, cookie = "", limit = 500 }) {
  if (cookie) qqMusic.setCookie(cookie);
  if (!id) throw new Error("missing id (playlist disstid)");
  const data = await qqMusic.api("songlist", { id });
  const info = {
    disstid: toStr(firstDefined(data?.disstid, data?.dissid, id)),
    name: toStr(firstDefined(data?.dissname, data?.name)),
    song_cnt: toNum(firstDefined(data?.songnum, data?.total, data?.song_cnt), 0),
    cover: toStr(firstDefined(data?.logo, data?.dir_pic_url2)),
    description: toStr(data?.desc),
    creator_name: toStr(firstDefined(data?.nickname, data?.hostname)),
    creator_uin: toStr(data?.uin),
    visit_count: toNum(data?.visitnum, 0),
  };
  const songs = pickArray(data?.songlist, data?.tracks, data?.songs)
    .map(normalizeSong)
    .filter(Boolean)
    .slice(0, limit);
  return { info, songs };
}

async function searchSongs({ keyword, limit = 30, cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  const key = toStr(keyword);
  if (!key) return [];

  // The library's built-in search endpoint is broken (QQ Music changed their
  // server-side route). Use the musicu.fcg aggregation endpoint directly.
  const reqData = {
    "music.search.SearchCgiService": {
      method: "DoSearchForQQMusicDesktop",
      module: "music.search.SearchCgiService",
      param: {
        num_per_page: limit,
        page_num: 1,
        query: key,
        search_type: 0,
      },
    },
  };
  const resp = await axios.get("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    params: { data: JSON.stringify(reqData) },
    headers: { Referer: "https://y.qq.com" },
    timeout: 10000,
  });
  const songs =
    resp?.data?.["music.search.SearchCgiService"]?.data?.body?.song?.list;
  return pickArray(songs)
    .map(normalizeSong)
    .filter(Boolean)
    .slice(0, limit);
}

async function createPlaylist({ name, cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  const playlistName = toStr(name) || "新建歌单";
  const data = await qqMusic.api("songlist/create", { name: playlistName });
  return {
    dirid: toStr(data?.dirid),
    message: toStr(data?.message || "创建成功"),
  };
}

async function addToPlaylist({ mid, dirid, cookie = "" }) {
  if (cookie) qqMusic.setCookie(cookie);
  if (!mid) throw new Error("missing mid (song mid)");
  if (!dirid) throw new Error("missing dirid (playlist dir id)");
  const midStr = Array.isArray(mid) ? mid.map(toStr).join(",") : toStr(mid);
  const data = await qqMusic.api("songlist/add", { mid: midStr, dirid: toStr(dirid) });
  return { ok: true, message: toStr(data?.message || "操作成功") };
}

// ---- dispatch --------------------------------------------------------------

const COMMANDS = {
  set_cookie: setCookie,
  qr_create: qrCreate,
  qr_check: qrCheck,
  user_detail: userDetail,
  user_playlists: userPlaylists,
  playlist_detail: playlistDetail,
  search_songs: searchSongs,
  create_playlist: createPlaylist,
  add_to_playlist: addToPlaylist,
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
    process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
    process.exit(0);
  } catch (error) {
    // qq-music-api rejects with plain {message} objects, not Error instances.
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error?.message
          ? String(error.message)
          : String(error);
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
    process.stderr.write(message + "\n");
    process.exit(1);
  }
}

main();
