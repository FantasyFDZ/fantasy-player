# Melody 音乐播放器 — 实施计划

> 基于设计文档 `2026-04-12-musicplayer-design.md`

## 阶段总览

| 阶段 | 内容 | 依赖 |
|------|------|------|
| Phase 1 | 项目脚手架 + 核心播放 | 无 |
| Phase 2 | 留声机 UI + 主题系统 | Phase 1 |
| Phase 3 | 浮动面板系统 | Phase 2 |
| Phase 4 | LLM 客户端 + 音频分析 | Phase 1 |
| Phase 5 | 插件面板：AI 音乐分析 | Phase 3 + 4 |
| Phase 6 | 插件面板：AI 点评 & 氛围 | Phase 3 + 4 |
| Phase 7 | 插件面板：AI 对话选歌 | Phase 3 + 4 |
| Phase 8 | 插件面板：AI DJ 控制台 | Phase 3 + 4 |
| Phase 9 | 设置面板 + 收尾打磨 | 全部 |

---

## Phase 1：项目脚手架 + 核心播放

**目标：** 一个能播放网易云音乐的最小可运行应用

### 任务清单

1. **初始化 Tauri 2 + React + TypeScript + Vite 项目**
   - `npm create tauri-app@latest`
   - 配置 TypeScript、Tailwind CSS
   - 配置 `tauri.conf.json`（窗口大小 1480x860、标题 "Melody"、无系统标题栏）

2. **Rust 后端：网易云 API 服务 (`netease_api.rs`)**
   - 集成 `netease-cloud-music-api` npm 包
   - 启动/停止本地 Express 服务（子进程管理）
   - 封装 HTTP 请求方法：搜索、歌曲详情、歌曲 URL、歌词、用户歌单、收藏、推荐

3. **Rust 后端：登录认证 (`auth.rs`)**
   - QR 码登录流程（生成 → 轮询 → 获取 cookie）
   - Cookie 持久化

4. **Rust 后端：播放引擎 (`player.rs`)**
   - MPV 子进程管理（启动/停止）
   - Unix socket 控制（播放、暂停、跳转、音量、获取进度）
   - 事件监听（播放完成、进度更新）

5. **Rust 后端：播放队列 (`queue.rs`)**
   - 队列 CRUD（添加、删除、清空、移动位置）
   - 播放模式（顺序、随机、单曲循环）
   - 上一首/下一首逻辑

6. **Rust 后端：SQLite (`db.rs`)**
   - 数据库初始化、表创建（参见设计文档第 9 节全部表）
   - 基础 CRUD 方法

7. **Tauri Commands**
   - 暴露所有后端功能为前端可调用的 Tauri commands

8. **前端：最小 UI**
   - 搜索框 + 搜索结果列表
   - 点击播放
   - 底部播放条（进度、控制按钮）
   - 登录页面（QR 码）

### 验收标准
- 能 QR 码登录网易云账号
- 能搜索歌曲并播放
- 播放控制（播放/暂停/上一首/下一首/音量/进度拖拽）正常
- 播放队列管理正常

---

## Phase 2：留声机 UI + 主题系统

**目标：** 极简留声机界面 + 歌词 + 6 套可切换主题

### 任务清单

1. **留声机组件 (`core/Gramophone/`)**
   - 旋转唱片（CSS animation，专辑封面占 60%，黑胶纹理沟槽）
   - 唱臂（SVG，播放/暂停时旋转动画）
   - 机柜（木纹纹理、MELODY 标识）
   - 垂直拨杆开关 x2（VOL/TONE，纯装饰或绑定功能）
   - 机脚

2. **歌词组件 (`core/Lyrics/`)**
   - 获取歌词（网易云 `/lyric` 接口）
   - 解析 LRC 格式歌词
   - 时间轴滚动，当前行高亮居中
   - 双语歌词支持（翻译歌词）
   - 透明度渐变（远离当前行的歌词更透明）

3. **播放条重设计 (`core/PlayBar/`)**
   - 适配留声机主题的底部播放条
   - 半透明模糊背景
   - 播放模式切换按钮

4. **主题系统 (`core/ThemeProvider/`)**
   - 定义 `ThemeConfig` 接口
   - 实现 6 套主题配置（午后暖阳、月光书房、黄昏爵士、晨雾森林、樱花和风、星际深空）
   - CSS 自定义属性注入
   - 光线渲染（CSS 绝对定位 + 渐变 + blur）
   - 粒子效果（CSS animation）
   - 主题切换过渡动画（0.5s ease）

5. **整体布局**
   - 左留声机 + 右歌词的默认布局
   - 响应式适配

### 验收标准
- 留声机旋转、唱臂动画正常
- 歌词同步滚动
- 6 套主题可切换，光影效果正确（光照区域更亮）
- 星际深空唱片周围有多层紫色辉光

---

## Phase 3：浮动面板系统

**目标：** 可扩展的浮动面板基础设施

### 任务清单

1. **PanelPlugin 接口定义 (`lib/types.ts`)**
   - `PanelPlugin` 接口（id, name, icon, minSize, defaultSize, component, onSongChange, requiredCapabilities）

2. **面板管理器 (`core/PanelManager/`)**
   - 面板注册/注销
   - 智能布局算法（根据已打开面板数量自动分配位置，避免重叠）
   - 拖拽移动（react-rnd 或自实现）
   - 边缘拖拽缩放
   - 位置/大小记忆（存储到 SQLite `panel_layout`）
   - 面板 z-index 管理（点击置顶）

3. **机柜按钮栏 (`core/CabinetControls/`)**
   - 留声机机柜下方的图标按钮行
   - 每个按钮对应一个已注册面板
   - 点击切换面板显示/隐藏
   - 按钮高亮状态（面板已打开时）

4. **插件宿主 (`src-tauri/src/plugin_host.rs`)**
   - 后端面板生命周期管理
   - 歌曲切换事件广播

### 验收标准
- 机柜按钮可展开/收起面板
- 面板可拖拽移动、拖拽缩放
- 多面板智能排列不重叠
- 关闭重新打开后位置被记忆

---

## Phase 4：LLM 客户端 + 音频分析

**目标：** AI 基础设施，供所有插件面板使用

### 任务清单

1. **LLM 客户端 (`src-tauri/src/llm_client.rs`)**
   - Provider 配置管理（CRUD，存储到 SQLite `providers` 表）
   - 4 个预配置 Provider（通义 DashScope、MiniMax、MiMo、LM Studio）
   - OpenAI 协议请求构造 + 响应解析
   - Anthropic 协议请求构造 + 响应解析
   - 流式输出支持（SSE 解析，通过 Tauri event 推送到前端）
   - Tauri command：`llm_request(provider, model, messages, stream)`

2. **音频分析 (`src-tauri/src/audio_analyzer.rs` + `sidecar/`)**
   - Python sidecar 进程管理（启动/停止/通信）
   - `audio_analyzer.py`：librosa 提取 BPM、能量、调性、情绪值、频谱特征
   - 分析结果缓存到 SQLite `song_features`
   - Tauri command：`analyze_song(song_id, audio_url)`

3. **前端 hooks**
   - `useLLM()`：调用 LLM、处理流式响应
   - `useAudioFeatures(songId)`：获取/触发音频分析

### 验收标准
- 4 个 Provider 都可成功调用（至少验证 1 个云端 + LM Studio）
- 流式输出正常工作
- 音频分析能提取 BPM/能量/调性等特征
- 分析结果正确缓存

---

## Phase 5：插件面板 — AI 音乐分析仪表盘

### 任务清单

1. **面板组件 (`plugins/MusicAnalysis/`)**
   - BPM 数字大显示
   - 能量/情绪仪表盘（环形或弧形图表）
   - 频谱可视化（柱状图）
   - 调性标签显示
   - LLM 生成的分析短评（风格、人声特征、旋律特点）
   - 分析中 loading 状态

2. **注册为 PanelPlugin**
   - requiredCapabilities: ['llm', 'audio-analysis']
   - onSongChange 触发重新分析

### 验收标准
- 切换歌曲时自动分析并展示特征数据
- LLM 短评正常生成
- 已分析歌曲从缓存加载

---

## Phase 6：插件面板 — AI 点评 & 氛围

### 任务清单

1. **面板组件 (`plugins/AiReview/`)**
   - 上半部分：网易热评 Top 1-3（用户头像 + 昵称 + 内容 + 点赞数）
   - 下半部分：AI 生成内容区
   - 内容类型切换（氛围描述 / 现代诗 / 短文散文）
   - "重新生成" 按钮
   - AI 生成内容缓存（按 type + provider + model）

2. **后端**
   - 网易云 `/comment/music` 热评获取 + 24h 缓存
   - LLM prompt 模板（歌曲元数据 + 歌词 → 氛围/诗歌/短文）

### 验收标准
- 热评正常显示，按点赞数排序
- AI 可生成三种类型内容
- 切换歌曲自动刷新

---

## Phase 7：插件面板 — AI 对话选歌

### 任务清单

1. **面板组件 (`plugins/AiPlaylist/`)**
   - 聊天界面（消息气泡、输入框）
   - 用户描述场景/氛围
   - AI 推荐结果展示（歌曲列表，带封面/歌手/匹配原因）
   - "创建歌单并导回网易云" 按钮
   - 对话历史持久化

2. **后端**
   - 加载用户收藏歌单的所有歌曲元数据
   - 构造 LLM prompt（用户意图 + 歌曲库摘要 → 推荐筛选）
   - 网易云 API：创建歌单 + 添加歌曲

### 验收标准
- 对话交互流畅
- AI 能从收藏中合理推荐歌曲
- 一键创建歌单成功导回网易云

---

## Phase 8：插件面板 — AI DJ 控制台

### 任务清单

1. **基础层**
   - 批量音频特征提取（复用 Phase 4 的分析引擎）
   - LLM 曲序编排（prompt：特征向量 + 编排规则 → 最优播放顺序）
   - Web Audio API crossfade 实现（GainNode 交叉淡化，过渡时长 2-8s）
   - 面板 UI：曲序时间线、能量曲线图、当前+下一首预览、过渡进度

2. **实验层（Beta）**
   - Tone.js 集成
   - 节拍对齐：BPM 差异 <10% 时尝试 beatmatching
   - EQ 过渡：BiquadFilter 低频先切、高频渐入
   - UI 上标记 "⚗️ 实验性功能"，用户可开关

3. **一键重新编排**
   - 重新调用 LLM 生成新曲序

### 验收标准
- 智能曲序编排合理（能量曲线流畅）
- crossfade 过渡自然
- 实验性混音可开关，不影响基础层

---

## Phase 9：设置面板 + 收尾打磨

### 任务清单

1. **设置面板**
   - 主题选择（6 套预览 + 切换）
   - LLM Provider 管理（查看/编辑/新增/删除 Provider，配置 API Key/URL/协议/模型）
   - 播放设置（默认音量、crossfade 开关、播放模式）
   - 面板布局重置

2. **全局打磨**
   - 窗口拖拽（无标题栏的 Tauri 窗口拖拽区域）
   - 快捷键绑定（空格播放/暂停、左右方向键切歌）
   - 错误处理和 toast 提示
   - 加载状态和骨架屏
   - 性能优化（面板懒加载、分析结果缓存命中率）

3. **系统集成**
   - macOS 媒体键支持（播放/暂停/上下首）
   - 系统通知（歌曲切换通知）
   - 托盘图标

### 验收标准
- 设置可正常保存和应用
- 无标题栏窗口可正常拖拽
- 快捷键响应正常
- 整体体验流畅
