# Changelog

本文档遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] — 2026-04-17

首个公开发布版本。

### 播放核心
- 基于 MPV（Unix socket IPC）的原生播放引擎
- 播放控制：播放 / 暂停 / 继续 / 跳转 / 音量 / 停止
- 上一曲 / 下一曲（支持自动推进）
- 队列管理：顺序 · 随机 · 单曲循环；追加 / 下一曲 / 移除 / 清空 / 整组替换
- LRC 歌词同步（原文 / 翻译 / 罗马音）

### UI
- 留声机 UI：黑胶唱片 + 唱针臂动画
- 现代唱片 UI（VinylDisc）及可视化音频电平
- 动态主题：从专辑封面提取主色驱动全局配色
- 光影层（LightLayer）：环境光晕 + god rays
- 亮 / 暗自适应

### 音乐源
- **网易云音乐**：关键词搜索、歌单浏览、播放 URL（standard + 回退）、LRC 歌词、前 10 条热评、创建 / 增删歌单
- **QQ 音乐**：搜索、歌单浏览 / 详情、创建 / 增删
- **账号**：网易云二维码扫码登录（1.5s 轮询）；QQ 音乐 Cookie 粘贴登录

### 音绪面板（独立窗口，插件化）
- **指标条**：曲风标签 + BPM / Key / Energy / Valence
- **云抑热评**：网易云前 10 条热评
- **AI 独白**：LLM 基于音频特征流式生成 80–120 字意境乐评
- 面板支持吸附、拖拽、独立窗口、位置与尺寸持久化

### 音频分析（Python sidecar：librosa + Essentia）
- BPM：RhythmExtractor2013 + Percival 融合、翻倍兜底、置信度、候选数组
- 调式（Key）及置信度
- 能量 / 频谱：RMS energy、valence、spectral centroid/bandwidth/flatness/rolloff、zero-crossing rate
- Essentia：LUFS 响度、dynamic complexity、danceability、onset rate、pitch mean/std/range、tuning、和弦进行、chord changes/min、MFCC 亮度 & 温暖度标签
- 特征首次分析后写入 SQLite 缓存，后续命中秒回
- 支持手动覆盖 BPM

### AI 搜索
- 搜索面板内置"AI 模式"：自然语言描述场景 → 从"我喜欢的"里推荐
- 流式响应 + 增量 JSON 解析（边生成边显示候选）
- 可取消进行中的请求

### 歌单迁移
- 设置面板 →「歌单迁移」Tab
- QQ 音乐 ⇄ 网易云双向迁移
- 模糊匹配（忽略括号、大小写）
- 速率控制（1.5s / 首，避免 405）
- `sync-progress` 事件实时广播，含跳过报告

### LLM 客户端
- 统一客户端支持 OpenAI 兼容协议 + Anthropic 协议
- 多 Provider 并存，运行时切换
- 同步 / 流式 两种调用
- 已验证：通义 DashScope、MiniMax、MiMo、Kimi、LM Studio（本地）、Claude、GPT
- Provider 配置、活跃模型持久化到 SQLite

### 持久化
- `~/.config/melody/melody.db`（SQLite）
  - songs · song_features · song_ai_content · comments_cache
  - panel_layout · settings · providers
  - playlists / playlist_songs / chat_history / dj_sessions（预留）
- `~/.config/melody/session.json` — 网易云会话
- `~/.config/melody/qq_session.json` — QQ 音乐会话

### 打包与分发
- 自包含 `.app`：mpv / Node / Python 3.12 / librosa / Essentia 全部内嵌
- DMG 产物（macOS arm64）
- 首次启动无需安装任何外部依赖

### 已知限制

- **仅支持 macOS 13+ (arm64)** —— Windows / Linux / Intel Mac 未提供预编译产物
- **未代码签名 / 公证** —— 首次打开需在"系统设置 → 隐私与安全性"中允许，或用 `xattr -d com.apple.quarantine` 去除隔离标记
- **播放队列与进度不持久化** —— 当前仅保留在内存，App 重启后丢失
- **体积偏大** —— DMG ~300 MB，Python 依赖占 66%，后续会瘦身
- **Tier 3 / 4 音频特征未实现** —— 数据库字段预留：TensorFlow 预测（人声 / 性别 / 乐器 / 风格）与 LLM BPM 校准
- **chat_history / dj_sessions** —— 数据库表预留，当前版本无对应前端功能

[Unreleased]: https://github.com/FantasyFDZ/musicplayer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/FantasyFDZ/musicplayer/releases/tag/v0.1.0
