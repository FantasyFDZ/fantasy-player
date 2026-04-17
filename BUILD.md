# Fantasy Player 构建指南

## 发版打包（自包含 .app）

Fantasy Player 的 `.app` 把 mpv、Node、Python、以及 librosa/essentia 全部打进去，
用户安装后**无需装任何外部依赖**即可运行。

### 前置依赖（host 机）

```bash
brew install mpv dylibbundler
# Node.js（任意版本）+ Python 3.12（任意路径）
```

### 步骤

```bash
# 1. 准备 vendor 目录（一次性，约 5 分钟，产出 ~660MB）
bash scripts/bootstrap_vendor.sh

# 2. 前端 + Tauri 构建
npm install
npm run tauri build
```

产出位置：
- `.app`: `src-tauri/target/release/bundle/macos/Fantasy Player.app`
- `.dmg`: `src-tauri/target/release/bundle/dmg/Fantasy Player_0.1.0_aarch64.dmg`

### vendor 目录结构

```
src-tauri/vendor/
├── mpv/mpv + mpv/libs/*.dylib     # 独立 mpv（58 MB）
├── node                            # 单文件 Node（112 MB，裁剪到 arm64）
├── scripts/*.cjs                   # 网易云 / QQ 音乐 Node 适配器
├── node_modules/                   # 适配器运行时依赖（34 MB）
├── python/bin/python3.12 + ...     # 便携 Python + librosa + essentia（407 MB）
└── sidecar/audio_analyzer.py       # 音频分析脚本
```

注意：vendor/ **不入 git**（见 `.gitignore`），每个开发者本地跑一次 `bootstrap_vendor.sh`
即可。

## 开发模式

```bash
npm install
npm run tauri dev
```

开发时 Rust 代码会优先找 bundled 二进制，退回查找系统安装的
（`/opt/homebrew/bin/mpv`、`/usr/local/bin/node` 等）。所以即使没跑
`bootstrap_vendor.sh` 也能开发，只是跑出来的 .app 不是自包含的。

## 关键路径发现顺序

| 组件 | 查找顺序 |
|------|---------|
| mpv | `Resources/vendor/mpv/mpv` → `src-tauri/vendor/mpv/mpv` → `/opt/homebrew/bin/mpv` → `PATH` |
| node | `Resources/vendor/node` → `src-tauri/vendor/node` → `/opt/homebrew/bin/node` → `PATH` |
| python | `Resources/vendor/python/bin/python3.12` → `src-tauri/vendor/python/bin/python3.12` → `python3.12` 系统回退（校验 librosa） |
| 适配器脚本 | `Resources/vendor/scripts/*.cjs` → `src-tauri/vendor/scripts/*.cjs` → `scripts/*.cjs` |
| 音频分析脚本 | `Resources/vendor/sidecar/audio_analyzer.py` → `src-tauri/vendor/sidecar/audio_analyzer.py` → `sidecar/audio_analyzer.py` |

## 体积参考

| 配置 | 大小 |
|------|------|
| Debug .app | ~660 MB |
| Release .app（strip + LTO）| ~600 MB（预估） |
| Release .dmg | ~300 MB（压缩后）|

主要体积占比：portable Python（407 MB）> node（112 MB）> mpv+dylibs（58 MB）> 其他。

如果要进一步瘦身：
- Python：只保留 librosa/essentia 运行时必需包，剪掉 test/ 目录
- Node：考虑迁到 Rust（见实验分支 `experiment/rust-only`）
