#!/usr/bin/env bash
#
# macOS Release 构建：签名 + 公证 + 验证。
#
# 前置：
#   1. brew install mpv dylibbundler
#   2. bash scripts/bootstrap_vendor.sh        （一次性，生成 vendor/）
#   3. cp scripts/sign.env.example scripts/sign.env
#      填入 APPLE_SIGNING_IDENTITY / APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID
#
# 运行：
#   bash scripts/build-macos-release.sh

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# ── 1. 加载签名凭据 ────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/sign.env" ]; then
  echo "❌ 未找到 scripts/sign.env"
  echo "   cp scripts/sign.env.example scripts/sign.env  然后填入凭据"
  exit 1
fi
# shellcheck source=/dev/null
source "$SCRIPT_DIR/sign.env"

: "${APPLE_SIGNING_IDENTITY:?sign.env 中未设置 APPLE_SIGNING_IDENTITY}"
: "${APPLE_ID:?sign.env 中未设置 APPLE_ID}"
: "${APPLE_PASSWORD:?sign.env 中未设置 APPLE_PASSWORD}"
: "${APPLE_TEAM_ID:?sign.env 中未设置 APPLE_TEAM_ID}"

# ── 2. 证书存在性检查 ──────────────────────────────────────────
if ! security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY"; then
  echo "❌ 钥匙串里找不到证书：$APPLE_SIGNING_IDENTITY"
  echo "   security find-identity -v -p codesigning"
  exit 1
fi

# ── 3. vendor 目录存在性 ───────────────────────────────────────
if [ ! -d "$ROOT_DIR/src-tauri/vendor/mpv" ]; then
  echo "❌ 缺少 vendor/mpv，先跑 bash scripts/bootstrap_vendor.sh"
  exit 1
fi

cd "$ROOT_DIR"

# ── 3.5. 清理 vendor 里对公证无用的脏数据 ─────────────────────
# joblib test 数据是 .gz 归档，公证会 warn"无法解包"，还白占空间
rm -rf "$ROOT_DIR/src-tauri/vendor/python/lib/python3.12/site-packages/joblib/test" 2>/dev/null || true

# ── 3.6. 预签所有 Mach-O（mpv / libs / python / node / *.so / *.dylib）──
# Apple 公证要求 .app 里每一个 Mach-O 文件都用 Developer ID 签 + secure timestamp。
# dylibbundler 和 pip wheel 里带来的共享库都是未签名的，必须在 tauri build 把
# vendor 拷进 .app 前先就地重签，否则 notarization 会列出几百条 "not signed"。
echo "🔏 预签 vendor/ 下所有 Mach-O 文件（可能弹一次钥匙串授权，点『始终允许』）…"
SIGN_OK=0
SIGN_FAIL=0
while IFS= read -r -d '' f; do
    if file "$f" 2>/dev/null | grep -q "Mach-O"; then
        if codesign --force --options runtime --timestamp \
                    --sign "$APPLE_SIGNING_IDENTITY" "$f" >/dev/null 2>&1; then
            SIGN_OK=$((SIGN_OK + 1))
        else
            SIGN_FAIL=$((SIGN_FAIL + 1))
            echo "  ⚠️  签名失败: ${f#$ROOT_DIR/}"
        fi
    fi
done < <(find "$ROOT_DIR/src-tauri/vendor" -type f -print0)
echo "   完成：$SIGN_OK 个签名成功，$SIGN_FAIL 个失败"
if [ "$SIGN_FAIL" -gt 0 ]; then
    echo "❌ 有文件签名失败，中止构建（公证一定会被拒）"
    exit 1
fi

# ── 4. 构建（Tauri 检测到签名 + 公证凭据后自动执行）──────────
echo "⚙️  Tauri build 开始（含签名 + 公证，公证环节会上传到 Apple，通常 2-5 分钟）…"
npm run tauri:build

# ── 5. 验证 .app ───────────────────────────────────────────────
APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/Fantasy Player.app"
if [ ! -d "$APP_PATH" ]; then
  echo "❌ 没找到 .app 产物：$APP_PATH"
  exit 1
fi

echo ""
echo "🔍 签名信息"
codesign -dv --verbose=4 "$APP_PATH" 2>&1 | grep -E "Authority|TeamIdentifier|Signature size" || true

echo ""
echo "🔍 公证 ticket（stapler）"
if xcrun stapler validate "$APP_PATH" 2>&1; then
  echo "✅ 公证 ticket 已 staple"
else
  echo "⚠️  未 staple —— 可能公证还在排队，稍后再跑：xcrun stapler staple '$APP_PATH'"
fi

echo ""
echo "🔍 Gatekeeper 评估"
spctl --assess --verbose=4 --type execute "$APP_PATH" 2>&1 || true

# ── 6. 汇总产物 ────────────────────────────────────────────────
DMG_PATH="$ROOT_DIR/src-tauri/target/release/bundle/dmg/Fantasy Player_0.1.0_aarch64.dmg"
echo ""
echo "══════════════════════════════════════════════"
echo "✅ Release 构建完成"
echo ""
echo "  .app  $APP_PATH"
[ -f "$DMG_PATH" ] && echo "  .dmg  $DMG_PATH"
echo "══════════════════════════════════════════════"
