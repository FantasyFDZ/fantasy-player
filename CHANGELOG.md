# Changelog

本文档遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] — 2026-04-18

首个公开发布版本。**macOS + Windows 双平台**。

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

**macOS (Apple Silicon)**
- 自包含 `.app`：mpv + dylibs / Node / Python 3.12 / librosa / Essentia 全部内嵌
- `.dmg` 产物（arm64，~220 MB）
- 用 Developer ID Application 证书签名（Team `6633WR778C`），Gatekeeper 可验身份
- 首次启动无需安装任何外部依赖

**Windows (x64)**
- 自包含 `.exe`：mpv + DLLs / Node / Python 3.12 / librosa 内嵌
- NSIS installer (`Fantasy Player_0.1.0_x64-setup.exe`) + MSI (`Fantasy Player_0.1.0_x64_en-US.msi`)
- Python 版的 Essentia 没有 Windows wheel，音绪面板部分高级特征会降级（见"已知限制"）

**GitHub Actions CI**
- `.github/workflows/release.yml`：tag 推送触发，双 runner 自动打包 + macOS 签名公证 + 创建 draft Release
- 配合 `docs/ci-setup.md` 一次性配 7 个 Secrets

### 已知限制

- **macOS .app 未公证**（Apple 公证服务在发布期间持续异常，提交 5 次均 timeout；后续 v0.1.0.1 会补公证 ticket）
  - 首次打开会弹 Gatekeeper 警告 "来自身份不明开发者"
  - 解决：右键图标 → 打开 → 再次确认（**一次永久放行**，Gatekeeper 会记住该证书身份）
  - 或终端：`xattr -d com.apple.quarantine "/Applications/Fantasy Player.app"`
- **Windows 未代码签名** —— SmartScreen 首次会警告"未知发行者"；点"更多信息 → 仍要运行"即可
- **Windows 音绪面板不吸附主窗口** —— macOS 用 `objc2-app-kit` 的 NSWindow 私有 API 实现，Windows 需要 HWND 另写一套，列入 v0.2.0
- **Windows 上 Essentia 特征降级** —— PyPI 无 Windows wheel；BPM / Key / Energy / 频谱用 librosa 兜底，LUFS / 和弦 / danceability / MFCC 标签为 null
- **仅 Apple Silicon 和 x64** —— Intel Mac / Linux / ARM Windows 未提供预编译产物（本地构建理论可行）
- **播放队列与进度不持久化** —— 当前仅保留在内存，App 重启后丢失
- **体积偏大** —— DMG ~220 MB / MSI+EXE ~300 MB，Python 依赖占大头，后续会瘦身
- **Tier 3 / 4 音频特征未实现** —— 数据库字段预留：TensorFlow 预测（人声 / 性别 / 乐器 / 风格）与 LLM BPM 校准
- **chat_history / dj_sessions** —— 数据库表预留，当前版本无对应前端功能

[Unreleased]: https://github.com/FantasyFDZ/musicplayer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/FantasyFDZ/musicplayer/releases/tag/v0.1.0
