# PlaylistSync — QQ 音乐 / 网易云歌单迁移插件

## 概述

Melody 内置插件，支持 QQ 音乐与网易云音乐之间的双向一次性歌单迁移。用户选择源平台歌单（含"我喜欢"和自建歌单），一键迁移到目标平台。

## 需求

- 双向迁移：QQ 音乐 → 网易云、网易云 → QQ 音乐
- 支持迁移"我喜欢"和用户创建的所有歌单
- 一次性手动触发，非持续同步
- 歌曲匹配采用精确策略，不匹配则跳过并报告
- 迁移完成后生成报告（成功数/跳过数/跳过详情）

## 架构

### 分层结构

```
前端 PlaylistSync 插件面板 (React)
        ↓ invoke()
Tauri Commands (Rust)
  ├── qq_auth_* — QQ 认证
  ├── qq_* — QQ 音乐数据接口
  └── sync_* — 迁移编排逻辑
        ↓ spawn node
Node Adapters
  ├── qqmusic_adapter.cjs (新增, qq-music-api)
  └── netease_adapter.cjs (已有)
```

### 新增文件

| 文件 | 职责 |
|------|------|
| `scripts/qqmusic_adapter.cjs` | QQ 音乐 Node CLI 适配器 |
| `src-tauri/src/qqmusic_api.rs` | Rust QQ 音乐 API 封装 |
| `src-tauri/src/qq_auth.rs` | QQ 认证状态管理 |
| `src-tauri/src/sync.rs` | 迁移编排逻辑 |
| `src/plugins/PlaylistSync/PlaylistSync.tsx` | 前端插件主组件 |
| `src/plugins/PlaylistSync/index.ts` | 插件注册导出 |

### 修改文件

| 文件 | 修改 |
|------|------|
| `src/plugins/index.ts` | 注册 PlaylistSync 插件 |
| `src-tauri/src/lib.rs` | 注册新 Tauri commands |
| `src-tauri/src/commands.rs` | 新增 QQ 认证 + 迁移 commands |
| `src/lib/api.ts` | 新增 QQ 相关前端 API 函数 |
| `package.json` | 新增 `qq-music-api` 依赖 |

## QQ 音乐 Node 适配器

### 技术选型

使用 `qq-music-api` npm 包（jsososo/QQMusicApi，1500+ stars，活跃维护）。架构与现有 `netease_adapter.cjs` 完全对称：CLI 模式，`node qqmusic_adapter.cjs <command> <json-payload>`，返回单行 JSON。

### 命令清单

| 命令 | 输入 | 输出 |
|------|------|------|
| `qr_create` | `{}` | `{ qrsig, ptqrtoken, qr_img }` |
| `qr_check` | `{ qrsig, ptqrtoken }` | `{ code, cookie? }` |
| `set_cookie` | `{ cookie }` | `{ ok }` |
| `user_detail` | `{ id }` | `{ nickname, avatar, uin }` |
| `user_playlists` | `{ id }` | `{ list: QQPlaylist[] }` |
| `playlist_detail` | `{ disstid }` | `{ info, songs: QQSong[] }` |
| `search_songs` | `{ keyword, limit? }` | `{ list: QQSong[] }` |
| `create_playlist` | `{ name }` | `{ dirid }` |
| `add_to_playlist` | `{ dirid, mid_list }` | `{ ok }` |

### 数据类型

```
QQSong { mid, name, artist, album, duration }
QQPlaylist { disstid, name, song_cnt, cover }
```

## QQ 音乐认证

### 状态持久化

`QQAuthState` 结构体，持久化到 `~/.config/melody/qq_session.json`。字段：

- `cookie: Option<String>` — QQ 音乐 cookie
- `pending_qrsig: Option<String>` — 扫码中的签名
- `user: Option<QQUserProfile>` — 用户信息（uin, nickname, avatar_url）

### QR 码登录流程

1. `qq_auth_qr_start` → 调用 Node `qr_create`，返回 QR 码图片(base64) + qrsig
2. 前端显示 QR 码，每 2 秒轮询 `qq_auth_qr_check`
3. 扫码状态：`waiting`(未扫) / `scanned`(已扫未确认) / `expired`(过期) / `ok`(成功)
4. 成功后：提取 cookie → 调用 `user_detail` 获取用户信息 → 写入 qq_session.json

### Tauri Commands

| Command | 功能 |
|---------|------|
| `qq_auth_session` | 获取当前 QQ 登录态 |
| `qq_auth_qr_start` | 开始 QR 登录 |
| `qq_auth_qr_check` | 轮询扫码状态 |
| `qq_auth_refresh` | 验证/刷新 cookie |
| `qq_auth_logout` | 登出清除 session |

## 迁移编排逻辑

### 迁移流程

```
sync_start(source_platform, playlist_ids, target_platform)
  │
  ├── 1. 逐个加载源歌单详情（获取完整歌曲列表）
  │
  ├── 2. 对每首歌：用 "歌名 歌手" 搜索目标平台
  │   ├── 搜索结果第一条与原曲比较（歌名+歌手，忽略大小写/空格/括号后缀）
  │   ├── 匹配 → 收集目标平台 song ID
  │   └── 不匹配 → 记入 skipped 列表（歌名、歌手、原因）
  │   └── 请求间隔 200ms 防限流
  │
  ├── 3. 在目标平台创建同名歌单
  │
  ├── 4. 批量添加匹配到的歌曲 ID 到新歌单
  │
  └── 5. 返回迁移报告
```

### 迁移报告数据结构

```
SyncReport {
  playlist_name: String,
  total: usize,
  matched: usize,
  skipped: usize,
  skipped_songs: Vec<SkippedSong>,  // { name, artist, reason }
}
```

### Tauri Commands

| Command | 输入 | 输出 |
|---------|------|------|
| `qq_get_playlists` | `{}` | `Vec<QQPlaylist>` |
| `qq_get_playlist_detail` | `{ disstid }` | `QQPlaylistDetail` |
| `sync_playlists` | `{ source, target, playlist_ids }` | `Vec<SyncReport>` |

`sync_playlists` 通过 Tauri event 推送实时进度到前端：

```
Event: "sync-progress"
Payload: { playlist_name, current, total, current_song }
```

## 前端插件

### 插件注册

```typescript
{
  id: 'playlist_sync',
  name: '歌单迁移',
  icon: '🔄',
  defaultSize: { w: 420, h: 650 },
  minSize: { w: 360, h: 500 },
  requiredCapabilities: []
}
```

### UI 状态机

```
Idle → Login → SelectPlaylists → Syncing → Report
```

- **Idle**: 检测两平台登录态
- **Login**: 未登录的平台显示 QR 码扫码（QQ 用新的 QR 流程，网易云复用已有）
- **SelectPlaylists**: 显示源平台歌单列表，勾选要迁移的，可切换方向
- **Syncing**: 进度条 + 当前歌曲名，监听 `sync-progress` 事件
- **Report**: 成功/跳过统计，可展开跳过详情列表

### 面板布局

```
┌──────────────────────────────────┐
│  🔄 歌单迁移                      │
├──────────────────────────────────┤
│  ┌──────────┐    ┌──────────┐   │
│  │ QQ 音乐  │ →  │ 网易云   │   │
│  │ ✅ 已登录 │    │ ✅ 已登录 │   │
│  └──────────┘    └──────────┘   │
│       [切换方向 ⇄]              │
├──────────────────────────────────┤
│  源平台歌单：                     │
│  ☑ 我喜欢的音乐 (326首)         │
│  ☑ 深夜电台 (48首)               │
│  ☐ 跑步歌单 (62首)               │
│            [开始迁移]             │
├──────────────────────────────────┤
│  迁移进度：                       │
│  ████████░░ 80%  246/308         │
│  当前：周杰伦 - 晴天              │
├──────────────────────────────────┤
│  迁移报告：                       │
│  ✅ 成功 246  ⚠️ 跳过 62          │
│  [查看跳过详情]                   │
└──────────────────────────────────┘
```

## 歌曲匹配细节

### 搜索策略

搜索关键词：`{歌名} {第一歌手名}`

### 匹配判定

对搜索结果第一条，标准化后比较：
1. 去除括号及其内容：`晴天(Live)` → `晴天`
2. 转小写
3. 去除首尾空格、合并连续空格
4. 歌名完全一致 且 歌手名完全一致 → 匹配通过
5. 否则 → 跳过，原因记为 "目标平台未找到匹配"

### 限流保护

- 搜索请求间隔 200ms
- 批量添加歌曲使用平台原生批量接口
- QQ 音乐和网易云各自的 cookie 独立管理，互不影响
