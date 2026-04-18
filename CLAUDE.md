# Fantasy Player — Claude Code 协作指令

项目概况 / 安装 / 构建 / 架构请看 [README.md](./README.md)。  
本文件只记录 Claude Code / AI 协作时需要知道的约定。

## 目录约定

- `src-tauri/vendor/` —— 由 `scripts/bootstrap_vendor.sh` / `.ps1` 生成，**不要手动改**，会被 re-bootstrap 重置
- `scripts/sign.env` —— 本地 macOS 签名凭据，**已 gitignore 绝不入库**，只能在 `scripts/sign.env.example` 为模板
- `docs/superpowers/plans/` / `reviews/` —— 内部规划文档，gitignore 不公开
- `src-tauri/tauri.conf.json` —— 跨平台通用配置，不放 `bundle.resources`
  - macOS 专用 resources 在 `tauri.macos.conf.json`
  - Windows 专用在 `tauri.windows.conf.json`

## 常用命令

| 场景 | 命令 |
|---|---|
| 前端类型检查 + 构建 | `npm run build` |
| Rust 单元 / 集成测试 | `cd src-tauri && cargo test` |
| 开发运行（Tauri dev） | `npm run tauri:dev` |
| macOS 发版（签名 + 公证） | `bash scripts/build-macos-release.sh`（需先 `cp sign.env.example sign.env` 填凭据） |
| Windows 发版 | `npm run tauri:build:windows` |
| GitHub Actions 发版自动化 | 见 [docs/ci-setup.md](./docs/ci-setup.md) |

## 跨平台改动约束

任何新的 `Command::spawn` / `std::os::unix::net::*` / `GetLastError` 等系统调用，**都要加 `#[cfg(unix)]` / `#[cfg(windows)]` 对应分支**。Windows 上 spawn 子进程必须用 `crate::platform::hide_console(&mut cmd)` 隐藏 console 窗口。

## LLM Provider

运行时由用户在设置面板配置（Base URL + API Key + 模型名 + 协议）。Key 持久化到本地 SQLite `~/.config/melody/melody.db`，**不写入代码、conf 文件或环境变量**。首次启动 Provider 列表为空，不预植入默认值。

## 已知降级路径

- **Windows 无 Essentia** —— PyPI 无 Windows wheel，`sidecar/audio_analyzer.py` 顶部 try-import essentia 失败后走 librosa-only 路径，BPM/Key 仍可用但 Tier 2 特征（LUFS / 和弦 / danceability 等）为 null
- **macOS 未公证** —— v0.1.0 发版期间 Apple 公证 pipeline 异常，首发 Release 仅签名未公证，后续 v0.1.0.1 或 v0.1.1 补
- **Windows 音绪面板不吸附主窗口** —— macOS 用 `objc2-app-kit` NSWindow 私有 API 实现，Windows 需 HWND + SetWindowPos，列入 v0.2.0
