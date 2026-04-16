#!/usr/bin/env bash
# bootstrap_vendor.sh —— 准备打包自包含 .app 所需的全部外部二进制。
#
# 生成 src-tauri/vendor/ 下：
#   mpv/mpv + mpv/libs/*                         — 独立 mpv（dylibbundler 收齐依赖）
#   node                                         — 单文件 node 可执行
#   scripts/*.cjs + node_modules/                — 网易云 / QQ 音乐适配器
#   python/                                      — python-build-standalone 便携 Python
#   sidecar/audio_analyzer.py + models/          — 音频分析 Python 脚本
#
# 依赖（host）：
#   brew install mpv dylibbundler
#   Node.js（任意版本，Homebrew 或 nvm）
#   Python 3.12（任意路径）
#   curl、tar
#
# 最终体积约 660MB。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR="$REPO/src-tauri/vendor"

echo "[vendor] target dir: $VENDOR"
rm -rf "$VENDOR"
mkdir -p "$VENDOR"

# ---- mpv ------------------------------------------------------------------
echo "[vendor] bundling mpv + dylibs..."
MPV_SRC="$(which mpv || true)"
if [[ -z "$MPV_SRC" ]]; then
  echo "error: mpv not on PATH. run: brew install mpv" >&2
  exit 1
fi
if ! command -v dylibbundler >/dev/null; then
  echo "error: dylibbundler not on PATH. run: brew install dylibbundler" >&2
  exit 1
fi
mkdir -p "$VENDOR/mpv"
cp -L "$MPV_SRC" "$VENDOR/mpv/mpv"
chmod +w "$VENDOR/mpv/mpv"
(
  cd "$VENDOR/mpv"
  dylibbundler -of -cd -b -x ./mpv -d ./libs -p @executable_path/libs/ >/dev/null
  # dylibbundler 会附带一个多余的 @executable_path/libs/ rpath，删掉
  install_name_tool -delete_rpath "@executable_path/libs/" mpv 2>/dev/null || true
  codesign --force --sign - mpv >/dev/null 2>&1
)
echo "[vendor] mpv ready: $(du -sh "$VENDOR/mpv" | cut -f1)"

# ---- node + scripts + node_modules ---------------------------------------
echo "[vendor] bundling node + scripts..."
NODE_SRC="$(which node || true)"
if [[ -z "$NODE_SRC" ]]; then
  echo "error: node not on PATH" >&2
  exit 1
fi
cp -L "$NODE_SRC" "$VENDOR/node"
chmod +x "$VENDOR/node"
# macOS universal node → 裁剪到当前架构，省一半体积
ARCH="$(uname -m)"
if file "$VENDOR/node" | grep -q "universal"; then
  lipo -thin "$ARCH" "$VENDOR/node" -output "$VENDOR/node.arch"
  mv "$VENDOR/node.arch" "$VENDOR/node"
fi

mkdir -p "$VENDOR/scripts"
cp "$REPO/scripts/netease_adapter.cjs" "$VENDOR/scripts/"
cp "$REPO/scripts/qqmusic_adapter.cjs" "$VENDOR/scripts/"

# 在 vendor/ 里 npm install 仅 runtime 依赖（让 node_modules 紧挨 scripts/）
(
  cd "$VENDOR"
  cat > package.json <<'EOF'
{
  "name": "melody-vendor",
  "private": true,
  "version": "1.0.0"
}
EOF
  npm install --silent netease-cloud-music-api-alger qq-music-api axios --production
  rm -f package-lock.json
)
echo "[vendor] node ready: $(du -sh "$VENDOR/node" | cut -f1), modules: $(du -sh "$VENDOR/node_modules" | cut -f1)"

# ---- python + librosa/essentia -------------------------------------------
echo "[vendor] downloading portable Python..."
PY_VERSION_TAG="20260414"
PY_FILE="cpython-3.12.13+${PY_VERSION_TAG}-${ARCH}-apple-darwin-install_only.tar.gz"
# python-build-standalone 用 aarch64 指代 arm64
case "$ARCH" in
  arm64) PY_ARCH="aarch64" ;;
  x86_64) PY_ARCH="x86_64" ;;
  *) echo "error: unsupported arch $ARCH"; exit 1 ;;
esac
PY_FILE="cpython-3.12.13+${PY_VERSION_TAG}-${PY_ARCH}-apple-darwin-install_only.tar.gz"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_VERSION_TAG}/${PY_FILE}"
curl -sL "$PY_URL" -o /tmp/melody-python.tar.gz
mkdir -p "$VENDOR/python"
tar -xzf /tmp/melody-python.tar.gz -C "$VENDOR/python" --strip-components=1
rm -f /tmp/melody-python.tar.gz

echo "[vendor] installing librosa + essentia + scipy..."
"$VENDOR/python/bin/python3.12" -m pip install --quiet librosa essentia numpy scipy >/dev/null

# sidecar 脚本（含 models/ 目录）
mkdir -p "$VENDOR/sidecar"
cp "$REPO/sidecar/audio_analyzer.py" "$VENDOR/sidecar/"
if [[ -d "$REPO/sidecar/models" ]]; then
  cp -r "$REPO/sidecar/models" "$VENDOR/sidecar/"
fi
echo "[vendor] python ready: $(du -sh "$VENDOR/python" | cut -f1)"

echo ""
echo "[vendor] done. total size: $(du -sh "$VENDOR" | cut -f1)"
