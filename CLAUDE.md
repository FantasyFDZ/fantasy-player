# Melody — AI 音乐播放器

## 项目概述

基于 Tauri 2 + React + TypeScript 的桌面音乐播放器，替代网易云音乐。核心设计理念：极简即高级，扩展即丰富。

## 设计文档

- 设计规格：`docs/superpowers/specs/2026-04-12-musicplayer-design.md`
- 实施计划：`docs/superpowers/specs/2026-04-12-musicplayer-implementation-plan.md`

## 技术栈

- **桌面框架：** Tauri 2 (Rust 后端)
- **前端：** React 18 + TypeScript + Vite + Tailwind CSS
- **播放引擎：** MPV (Unix socket)
- **音频处理：** Web Audio API + Tone.js
- **音频分析：** Python sidecar (librosa)
- **数据库：** SQLite (rusqlite)
- **网易云 API：** netease-cloud-music-api npm 包
- **LLM：** 统一客户端，支持 OpenAI / Anthropic 协议

## 架构

分层插件架构：核心层（留声机+歌词+播放+主题）+ 插件面板层（AI 分析/点评/对话/DJ）

## LLM Provider 配置

参见 `/Users/fms26/Coding/Coding_Plan.md` 获取 API Key 和端点配置。4 个 Provider：通义 DashScope、MiniMax、MiMo、LM Studio (本地)。

## 实施阶段

按 Phase 1-9 顺序实施，详见实施计划文档。每个 Phase 有明确的任务清单和验收标准。

## 旧项目参考

旧项目位于 `/Users/fms26/Coding/cloudmusic`，可参考其 Rust 后端实现（netease_cli.rs、ai_client.rs、analyzer.rs），但不复用代码，全部重写。
