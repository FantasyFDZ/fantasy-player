<div align="center">

# Fantasy Player

**AI 驱动的桌面音乐播放器**

基于 Tauri 2 + React + TypeScript，自包含、可定制、面板化。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%2013%2B%20arm64-blue.svg)](#系统要求)
[![Tauri](https://img.shields.io/badge/Tauri-2-ffc131.svg)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)

</div>

---

## ✨ 特性

### 播放与音乐库

- 🎵 **原生播放** — 基于 MPV（Unix socket IPC），稳定低延迟
- 🔍 **关键词搜索** — 网易云曲库搜索
- 🗂️ **歌单浏览** — 列出"我喜欢的"与全部用户歌单，双层选择播放
- ❤️ **收藏** — 红心一键加入/移出"我喜欢的"
- 📋 **队列管理** — 顺序 / 随机 / 单曲循环，支持追加、下一曲、移除、清空、整组替换
- 📜 **同步歌词** — LRC 逐行，支持原文 / 翻译 / 罗马音
- 🧾 **创建与编辑歌单** — 新建、批量增删曲目（网易云 / QQ 音乐均支持）

### 视觉

- 💿 **留声机 UI** — 黑胶唱片旋转 + 唱针臂，随播放进度联动
- 🎨 **动态主题** — 从专辑封面提取主色驱动全局配色，亮/暗自适应
- ✨ **光影层** — 环境光晕与"god rays"增强沉浸感

### AI 能力

- 🧠 **音绪面板** — 独立窗口，三段式呈现
  - **指标条**：曲风标签 · BPM · Key · Energy · Valence
  - **云抑热评**：网易云最热评
  - **AI 独白**：LLM 基于音频特征流式生成 80–120 字意境乐评
- 🔎 **AI 搜索** — 搜索面板内的 AI 模式，用自然语言从"我喜欢的"里推荐  
  （流式返回、边写边解析 JSON、支持"BPM / 氛围 / 场景"等描述）

### 音频分析

Python sidecar（librosa + Essentia）自动提取：

- **节奏调式**：BPM（多算法融合 + 翻倍兜底）、置信度、候选数组、Key
- **能量频谱**：RMS energy、valence、spectral centroid/bandwidth/flatness/rolloff、zero-crossing rate
- **Essentia**：LUFS 响度、dynamic complexity、danceability、onset rate、pitch mean/std/range、tuning、和弦进行、chord changes/min、MFCC 亮度/温暖度标签

特征首次分析后缓存到 SQLite，后续命中秒回。支持手动覆盖 BPM。

### 跨平台与扩展

- 🔄 **歌单迁移** — QQ 音乐 ⇄ 网易云双向迁移（模糊匹配 + 进度实时广播 + 跳过报告）
- 🔌 **多 LLM Provider** — OpenAI 兼容协议 + Anthropic 协议
  - 已验证：通义 DashScope / MiniMax / MiMo / Kimi / LM Studio (本地) / Claude / GPT
  - 配置持久化到本地 SQLite，支持同步与流式
- 🪟 **独立窗口面板** — 音绪面板可脱出主窗口，位置与尺寸持久化
- 🔐 **账号** — 网易云（二维码扫码）· QQ 音乐（Cookie 粘贴）

## 📦 安装

### macOS

1. 从 [Releases](https://github.com/FantasyFDZ/fantasy-player/releases) 下载最新 `.dmg`
2. 拖拽 `Fantasy Player.app` 到「应用程序」
3. 首次打开若提示"无法打开来自身份不明开发者的应用"：
   - 右键图标 → 选择「打开」→ 再次确认
   - 或终端执行：`xattr -d com.apple.quarantine "/Applications/Fantasy Player.app"`

> Windows / Linux / Intel Mac 目前不提供预编译产物，本地构建理论可行但未验证。

## 🖥️ 系统要求

- **macOS 13.0 (Ventura)** 或更高
- **Apple Silicon (arm64)** —— Intel 未验证
- 约 600 MB 磁盘空间（自包含 mpv / Node / Python 3.12 / librosa / Essentia）
- **无需**外部依赖 —— 所有运行时打进 `.app`

## 🚀 快速开始

1. 启动后进入「设置 → 模型」，添加至少一个 LLM Provider（Base URL + API Key + 模型名 + 协议）
2. 进入「登录」面板扫码登录网易云（QQ 音乐在「设置 → 歌单迁移」粘贴 Cookie）
3. 在搜索或歌单里选歌开始播放；从机柜按钮打开「音绪」面板查看分析与乐评

## 🛠️ 开发

```bash
git clone https://github.com/FantasyFDZ/fantasy-player.git
cd musicplayer
npm install
npm run tauri:dev
```

开发模式下 Rust 端会优先找 bundled 依赖，找不到就回退到系统安装（`/opt/homebrew/bin/mpv`、`/usr/local/bin/node`、`python3.12`）。所以不跑 `bootstrap_vendor.sh` 也能开发，只是产出的 `.app` 不是自包含的。

### 前置（开发模式回退需要）

```bash
brew install mpv node python@3.12
pip3 install librosa essentia
```

### 测试

```bash
# Rust smoke + 集成
cd src-tauri && cargo test

# 前端类型检查
npm run build
```

## 📦 发版构建（自包含 `.app`）

完整流程见 [BUILD.md](./BUILD.md)。简要：

```bash
brew install mpv dylibbundler                # 一次性 host 依赖
bash scripts/bootstrap_vendor.sh             # 生成 vendor/（~660 MB，不入 git）
npm install
npm run tauri:build
```

产出位置：

- `.app`: `src-tauri/target/release/bundle/macos/Fantasy Player.app`
- `.dmg`: `src-tauri/target/release/bundle/dmg/Fantasy Player_0.1.0_aarch64.dmg`

## 🏗️ 架构

```
┌──────────── Frontend (React 18 + TS + Tailwind) ────────────┐
│  core/     Gramophone · VinylDisc · Lyrics                  │
│            ThemeProvider · PanelManager                      │
│  components/ PlayBar · PlaylistPanel · SearchPanel          │
│              LoginPanel · SettingsPanel · QueuePopup         │
│  plugins/  MusicAnalysis (音绪：指标 + 热评 + AI 独白)     │
└────────────── Tauri IPC (invoke / event) ───────────────────┘
┌──────────── Backend (Rust, src-tauri/) ─────────────────────┐
│  player (MPV) · queue · llm_client · audio_analyzer          │
│  netease_api · qqmusic_api · sync (歌单迁移)                │
│  auth / qq_auth · db (SQLite)                                │
└───────────── Sidecars (vendor/, 自包含) ────────────────────┘
   mpv   ·   Node (netease/qq 适配器)   ·   Python 3.12       │
                          librosa / Essentia                   │
```

- **核心层**：播放 · 歌词 · 主题 · 唱片 UI —— 始终加载
- **插件层**：音绪面板 —— 按需打开（架构预留多插件扩展）
- **数据层**：`~/.config/melody/melody.db` 存曲目元数据、音频特征缓存、AI 乐评缓存、热评缓存、面板布局、Provider 配置、全局设置
- **会话**：网易云 session / QQ session 存 `~/.config/melody/*.json`

详细设计见 [docs/superpowers/specs/](./docs/superpowers/specs/)。

## 🗺️ Roadmap

- [ ] Windows / Linux 打包
- [ ] macOS 代码签名 + 公证
- [ ] 播放队列与进度持久化（当前仅保留在内存）
- [ ] Python sidecar 瘦身（当前占体积 ~66%）
- [ ] Tier 3 特征（TensorFlow：人声/性别/乐器/风格标签）
- [ ] 迁移 Node 适配器到 Rust

## 🤝 贡献

欢迎 Issue 与 PR。提交前请确保：

1. `npm run build` 通过（TypeScript strict）
2. `cd src-tauri && cargo test` 通过
3. 遵循现有代码风格（React 函数组件 + hooks / Rust 2021）

## 📄 License

[MIT](./LICENSE) © 2026 FantaDZ

## 🙏 致谢

- [Tauri](https://tauri.app) — 极简桌面框架
- [MPV](https://mpv.io) — 稳定播放引擎
- [librosa](https://librosa.org) · [Essentia](https://essentia.upf.edu) — 音频分析
- [netease-cloud-music-api-alger](https://www.npmjs.com/package/netease-cloud-music-api-alger) · [qq-music-api](https://www.npmjs.com/package/qq-music-api) — 音乐 API 适配
