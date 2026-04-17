# Fantasy Player — AI 音乐播放器

## 项目概述

基于 Tauri 2 + React + TypeScript 的桌面音乐播放器。核心设计理念：极简即高级，扩展即丰富。

## 设计文档

- 设计规格：`docs/superpowers/specs/2026-04-12-musicplayer-design.md`
- 实施计划：`docs/superpowers/specs/2026-04-12-musicplayer-implementation-plan.md`

## 技术栈

- **桌面框架：** Tauri 2 (Rust 后端)
- **前端：** React 18 + TypeScript + Vite + Tailwind CSS
- **播放引擎：** MPV (Unix socket IPC)
- **音频分析：** Python sidecar (librosa + Essentia)
- **数据库：** SQLite (rusqlite)
- **音乐 API：** netease-cloud-music-api-alger / qq-music-api（Node 适配器）
- **LLM：** 统一客户端，支持 OpenAI 兼容协议 + Anthropic 协议

## 架构

分层插件架构：核心层（留声机 + 歌词 + 播放 + 主题）+ 插件面板层。当前已注册 1 个面板：**音绪（music_analysis）** —— 指标条 + 热评 + AI 独白。预留扩展位（chat_history / dj_sessions 表已建但前端未实现）。

主要 UI 视图：主舞台 / 搜索（含 AI 模式）/ 歌单 / 登录 / 设置（模型 + 歌单迁移 Tab）。

## LLM Provider 配置

运行时在应用内设置页面配置 Provider（API Key + endpoint）。Key 持久化到本地 SQLite，不写入代码或配置文件。支持 OpenAI 兼容协议和 Anthropic 协议，典型可接入：通义 DashScope、MiniMax、MiMo、LM Studio (本地) 等。

## 实施阶段

按 Phase 1-9 顺序实施，详见实施计划文档。每个 Phase 有明确的任务清单和验收标准。
