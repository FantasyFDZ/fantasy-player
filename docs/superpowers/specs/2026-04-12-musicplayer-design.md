# Melody — AI 音乐播放器设计文档

## 1. 项目概述

基于 Tauri 2 + React 构建的桌面音乐播放器，替代网易云音乐大部分功能。核心设计理念：**极简即高级，扩展即丰富**。默认界面是一个带有艺术光影效果的留声机 + 歌词播放器，用户通过机柜上的按钮展开浮动面板来解锁 AI 分析、DJ 混音、对话选歌等高级功能。

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 (Rust 后端) |
| 前端 | React 18 + TypeScript + Vite |
| 样式 | Tailwind CSS |
| 播放引擎 | MPV (Unix socket 控制) |
| 音频处理 | Web Audio API + Tone.js (DJ 混音) |
| 音频分析 | Python sidecar (librosa) |
| 数据库 | SQLite (via rusqlite) |
| 网易云 API | netease-cloud-music-api npm 包（本地 Express 服务） |
| LLM | 统一客户端，支持 OpenAI / Anthropic 协议 |

## 3. 架构：分层插件架构

```
┌─ Core Layer ────────────────────────────┐
│  留声机 + 歌词 + 播放控制 + 主题系统      │
│  网易云 API 服务 + 用户登录               │
│  LLM 客户端 + 音频分析引擎               │
│  浮动面板管理器                          │
└─────────────┬───────────────────────────┘
              │ PanelPlugin Interface
┌─────────────┴───────────────────────────┐
│  AI 音乐分析仪表盘                       │
│  AI 点评 & 氛围                          │
│  AI 对话选歌                             │
│  AI DJ 控制台                            │
└──────────────────────────────────────────┘
```

核心层保持极简，所有扩展功能以插件面板形式接入。面板之间解耦，各自独立开发和测试。

## 4. 默认界面：留声机 + 歌词

### 4.1 布局

左侧为留声机，右侧为歌词面板，底部为播放控制条。

### 4.2 留声机组件

- **旋转唱片：** 专辑封面占唱片约 60%，外圈为带纹理沟槽的黑胶纹理。播放时旋转（约 4s/圈），暂停时停止。CSS animation 实现。
- **唱臂：** SVG 绘制，位于唱片右上方边缘位置。播放时唱针落在唱片外缘，暂停时唱臂抬起（CSS transition 旋转）。
- **机柜：** 唱片下方的木质机柜，带木纹纹理。中间显示 "MELODY" 品牌标识。
- **拨杆开关：** 机柜上左右各一个垂直拨杆（VOL / TONE），中间轴心固定，杆体垂直向上伸出，顶端金属圆球。两个拨杆分列 MELODY 标识两侧。
- **机脚：** 机柜底部 4 个小圆脚。
- **机柜按钮栏：** 机柜下方一排小图标按钮，用于展开/收起各插件面板。

### 4.3 歌词面板

- 时间轴滚动歌词，当前行高亮居中、字号放大加粗
- 支持中英/中日双语歌词
- 非当前行按距离递减透明度

### 4.4 底部播放条

- 歌曲信息（封面缩略图、歌名、歌手）
- 进度条（可拖拽）
- 播放控制（上一首、播放/暂停、下一首）
- 音量控制
- 播放模式切换（顺序/随机/单曲循环）

## 5. 主题系统

### 5.1 六套内置主题

| 主题 | 氛围 | 光线特征 |
|------|------|---------|
| 午后暖阳 | 奶茶暖色调 | 暖白色丁达尔光束从上方斜打，照亮区域更亮 |
| 月光书房 | 深蓝冷调 | 冷白月光从上方投射，优雅的明暗对比 |
| 黄昏爵士 | 深棕偏红暖调 | 广散的黄昏暖光，强烈的明暗层次，暗角效果 |
| 晨雾森林 | 草绿清新 | 纯白色丁达尔光柱穿过薄雾，光束边缘锐利 |
| 樱花和风 | 粉色柔美 | 白色偏暖春光，花瓣形粒子飘落 |
| 星际深空 | 紫色神秘 | 紫色星云辉光衍射，唱片周围多层发光（4层 box-shadow） |

### 5.2 光线规则

- 光线应使照射区域**更亮**（白色/高亮度），而不是仅仅添加主题色
- 有光的区域明显亮于无光区域，形成自然的明暗对比
- 光线位置统一从唱片上方偏右斜向下打
- 每个主题包含空气粒子/尘埃效果（CSS animation shimmer）

### 5.3 技术实现

- `ThemeConfig` 对象定义所有视觉参数（背景渐变、光线配置、粒子效果、各组件颜色）
- CSS 自定义属性实现主题切换，过渡动画 0.5s ease
- 光线用 CSS 绝对定位 + 线性渐变 + filter blur 实现，无需 Canvas

## 6. 浮动面板系统

### 6.1 面板入口

留声机机柜下方的一排图标按钮，每个按钮对应一个插件面板，点击切换显示/隐藏。

### 6.2 智能布局

- 系统根据当前已打开面板数量自动分配位置，避免重叠
- 用户可手动拖拽调整位置、拖拽边缘调整大小
- 面板位置和大小记忆到 SQLite `panel_layout` 表

### 6.3 插件面板接口

```typescript
interface PanelPlugin {
  id: string;
  name: string;
  icon: string;
  minSize: { w: number; h: number };
  defaultSize: { w: number; h: number };
  component: React.ComponentType;
  onSongChange?: (song: Song) => void;
  requiredCapabilities?: string[];
}
```

面板通过此接口注册到 PanelManager，核心层不依赖任何具体面板实现。

## 7. 四个插件面板

> 注：歌词面板属于核心层（默认显示，见 4.3 节），不是插件面板。

### 7.1 AI 音乐分析仪表盘

- 数据来源：Python sidecar 提取音频特征（BPM、能量、调性、情绪值、频谱特征） + LLM 生成分析短评
- 可视化：BPM 数字显示、能量/情绪仪表盘、频谱图、调性标签
- LLM 生成：风格分析、人声特征、旋律特点短评
- 分析结果缓存到 SQLite `song_features` + `song_ai_content`

### 7.2 AI 点评 & 氛围

- 上半部分：网易热评 Top 1-3 条（`/comment/music` 接口，按点赞数排序，显示用户头像+昵称+点赞数）
- 下半部分：AI 生成内容（氛围描述 / 现代诗 / 短文散文，可切换类型，可重新生成）
- 真实听众共鸣 + AI 艺术诠释的对照
- 热评缓存 24 小时过期

### 7.3 AI 对话选歌

- 聊天界面，用户描述场景/氛围（如"下雨天适合听的安静歌曲"）
- AI 仅从用户已收藏/已有歌单中筛选推荐
- 生成推荐歌单后，一键通过网易云 API 创建歌单并添加歌曲，导回网易云
- 对话历史保存到 SQLite `chat_history`

### 7.4 AI DJ 控制台

**基础层（确认实现）：**
- Python sidecar 批量提取播放列表所有歌曲的音频特征
- LLM 根据 BPM/能量/调性/情绪编排最佳曲序（考虑能量曲线、调性兼容、情绪渐变）
- Web Audio API GainNode 实现 crossfade 过渡（根据 BPM 差异计算过渡时长 2-8 秒）
- 面板 UI：曲序可视化时间线、能量曲线图、当前+下一首预览、过渡进度条

**实验层（Beta 标记）：**
- Tone.js 节拍对齐：两首歌 BPM 差异 <10% 时尝试 beatmatching
- EQ 过渡：BiquadFilter 实现低频先切、高频渐入
- 面板显示 "实验性功能" 标识，用户可开关
- 技术风险：节拍对齐依赖 BPM 检测精度（librosa beat_track 约 85-90%）

## 8. LLM 客户端架构

### 8.1 统一客户端

Rust 后端 `llm_client.rs` 实现统一的 LLM 请求路由：
- 根据 Provider 选择协议（OpenAI / Anthropic）
- 构造对应格式的 HTTP 请求
- 统一响应解析
- 支持流式输出（SSE）

### 8.2 预配置 Provider

| Provider | 协议 | Base URL | 模型 |
|----------|------|----------|------|
| 通义 DashScope | OpenAI / Anthropic | `coding.dashscope.aliyuncs.com/v1` | qwen3.5-plus, glm-5, kimi-k2.5, MiniMax-M2.5 |
| MiniMax | OpenAI / Anthropic | `api.minimaxi.com/v1` | MiniMax-M2.7-highspeed |
| MiMo | OpenAI / Anthropic | `token-plan-cn.xiaomimimo.com/v1` | MiMo-V2-Pro, MiMo-V2-Omni, MiMo-V2-TTS |
| LM Studio (本地) | OpenAI | `localhost:1234/v1` | 用户自定义 |

### 8.3 用户可配置

每个 Provider 可配置：API Key、Base URL、协议类型、模型列表。支持新增自定义 Provider。配置存储在 SQLite `providers` 表。

### 8.4 面板调用方式

面板通过 Tauri command `llm_request(provider, model, prompt, stream)` 调用，后端路由到对应 Provider 并返回结果。

## 9. 数据模型

### 9.1 SQLite 表结构

| 表 | 用途 | 关键字段 |
|---|------|---------|
| `songs` | 歌曲缓存 | id, netease_id, name, artist, album, cover_url, duration |
| `song_features` | 音频特征缓存 | song_id, bpm, energy, key, valence, spectral_*, analyzed_at |
| `song_ai_content` | AI 生成内容缓存 | song_id, type(analysis/poem/atmosphere), content, provider, model, created_at |
| `playlists` | 用户歌单 | id, name, description, netease_id, created_at |
| `playlist_songs` | 歌单歌曲关联 | playlist_id, song_id, position |
| `comments_cache` | 热评缓存 | song_id, comments_json, fetched_at |
| `chat_history` | AI 对话记录 | id, role, content, created_at |
| `dj_sessions` | DJ 编排记录 | id, queue_json, arrangement_json, created_at |
| `panel_layout` | 面板布局记忆 | panel_id, x, y, width, height, visible |
| `settings` | 用户配置 | key, value |
| `providers` | LLM Provider 配置 | id, name, api_key, base_url, protocol, models_json |

### 9.2 缓存策略

- `song_features`：永久缓存，同一首歌不重复分析
- `song_ai_content`：按 provider+model 缓存，换模型重新生成
- `comments_cache`：24 小时过期刷新
- `panel_layout`：实时保存拖拽位置

## 10. 项目结构

```
musicplayer/
├── src/                          # React 前端
│   ├── core/                     # 核心组件
│   │   ├── Gramophone/           # 留声机（唱片、唱臂、机柜、拨杆）
│   │   ├── Lyrics/               # 歌词组件
│   │   ├── PlayBar/              # 底部播放条
│   │   ├── ThemeProvider/        # 主题系统
│   │   ├── PanelManager/         # 浮动面板管理器
│   │   └── CabinetControls/     # 机柜按钮栏
│   ├── plugins/                  # 插件面板
│   │   ├── MusicAnalysis/        # AI 音乐分析仪表盘
│   │   ├── AiReview/             # AI 点评 & 氛围
│   │   ├── AiPlaylist/           # AI 对话选歌
│   │   └── DjConsole/            # AI DJ 控制台
│   ├── hooks/                    # React hooks
│   ├── lib/                      # 工具函数、类型定义
│   ├── themes/                   # 6 套主题配置
│   └── App.tsx
├── src-tauri/                    # Tauri Rust 后端
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── netease_api.rs        # 网易云 API 服务管理
│       ├── player.rs             # MPV 播放引擎
│       ├── queue.rs              # 播放队列
│       ├── auth.rs               # 登录认证
│       ├── llm_client.rs         # 统一 LLM 客户端
│       ├── audio_analyzer.rs     # 音频分析调度
│       ├── plugin_host.rs        # 插件宿主
│       └── db.rs                 # SQLite
├── sidecar/                      # Python 音频分析
│   ├── audio_analyzer.py
│   └── requirements.txt
├── package.json
├── vite.config.ts
└── tauri.conf.json
```

## 11. 网易云音乐功能覆盖

| 网易云功能 | 实现方式 |
|-----------|---------|
| 搜索（歌曲/专辑/歌手/歌单） | `/search` 接口 |
| 播放 | MPV + `/song/url` 获取流地址 |
| 歌词 | `/lyric` 接口 |
| 登录 | QR 码登录（`/login/qr/*`） |
| 用户歌单 | `/user/playlist` |
| 收藏/喜欢 | `/like` 接口 |
| 每日推荐 | `/recommend/songs` |
| 私人 FM | `/personal_fm` |
| 评论 | `/comment/music` |
| 创建歌单 | `/playlist/create` + `/playlist/tracks` |
| 播放历史 | 本地 SQLite 记录 |

## 12. 可行性评估总结

| 功能 | 可行性 | 风险 | 说明 |
|------|--------|------|------|
| 留声机 + 歌词播放器 | 高 | 低 | CSS 动画 + Web Audio |
| 6 套主题系统 | 高 | 低 | CSS 变量 + 渐变 |
| 浮动面板系统 | 高 | 低 | React 拖拽库 |
| AI 音乐分析 | 高 | 低 | librosa + LLM，旧项目已验证 |
| AI 点评 & 氛围 | 高 | 低 | API + LLM 直接可用 |
| AI 对话选歌 | 高 | 低 | LLM + 本地歌单数据 |
| 歌单导回网易云 | 高 | 低 | API 直接支持 |
| AI DJ 智能曲序 + crossfade | 高 | 低 | 音频特征 + LLM + GainNode |
| AI DJ 节拍对齐（实验性） | 中 | 中 | 依赖 BPM 检测精度 (~85-90%) |
| AI DJ EQ 过渡（实验性） | 中 | 低 | Tone.js BiquadFilter 可用 |
