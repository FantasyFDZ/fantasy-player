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

# ── 4. 构建（只 sign，公证自己做）──────────────────────────────
# 原先把 APPLE_ID/PASSWORD/TEAM_ID export 给 Tauri，会走它自带的
# 公证流程 —— 提交 .app.zip 给 notarytool 后等到 timeout。这条路
# 上 Apple 服务器对大体积 zip 偶尔卡 1 小时+，没法 cancel。
# 改为：Tauri 只做签名 + 打包 .dmg，我们自己把 .dmg 提交公证。
# .dmg 是压缩固定 image，Apple 端处理更稳，且 stapler 可直接
# 贴到 .dmg 上，用户下载拿到就是 Gatekeeper 可验的。
NOTARIZE_APPLE_ID="$APPLE_ID"
NOTARIZE_APPLE_PASSWORD="$APPLE_PASSWORD"
NOTARIZE_TEAM_ID="$APPLE_TEAM_ID"
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID

echo "⚙️  Tauri build（只 sign，随后我们自己 notarize .dmg）…"
npm run tauri:build:macos

export APPLE_ID="$NOTARIZE_APPLE_ID"
export APPLE_PASSWORD="$NOTARIZE_APPLE_PASSWORD"
export APPLE_TEAM_ID="$NOTARIZE_TEAM_ID"

# ── 5. 验证 .app / .dmg 产物 ───────────────────────────────────
APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/Fantasy Player.app"
DMG_PATH="$ROOT_DIR/src-tauri/target/release/bundle/dmg/Fantasy Player_0.1.0_aarch64.dmg"
if [ ! -d "$APP_PATH" ]; then
  echo "❌ 没找到 .app 产物：$APP_PATH"
  exit 1
fi
if [ ! -f "$DMG_PATH" ]; then
  echo "❌ 没找到 .dmg 产物：$DMG_PATH"
  exit 1
fi

echo ""
echo "🔏 .app 签名信息："
codesign -dv --verbose=4 "$APP_PATH" 2>&1 | grep -E "Authority|TeamIdentifier|Signature size" || true

# ── 6. 手动公证 .dmg（阻塞至完成，30 分钟超时）────────────────
echo ""
echo "☁️  提交 .dmg 给 Apple 公证（阻塞至完成，最长 30 分钟）…"
SUBMIT_OUT=$(xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait --timeout 30m 2>&1)
echo "$SUBMIT_OUT"

if echo "$SUBMIT_OUT" | grep -q "status: Accepted"; then
  echo ""
  echo "🏷️  公证通过，staple ticket 到 .dmg + .app…"
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler staple "$APP_PATH"
  echo ""
  echo "🔍 Gatekeeper 评估 (.app)："
  spctl --assess --verbose=4 --type execute "$APP_PATH" 2>&1 || true
  echo ""
  echo "🔍 Gatekeeper 评估 (.dmg)："
  spctl --assess --verbose=4 --type open --context context:primary-signature "$DMG_PATH" 2>&1 || true
else
  echo ""
  echo "❌ 公证未通过。拿 log 看具体原因："
  SUBMIT_ID=$(echo "$SUBMIT_OUT" | awk '/id:/ {print $2; exit}')
  if [ -n "$SUBMIT_ID" ]; then
    xcrun notarytool log "$SUBMIT_ID" \
      --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
  fi
  exit 1
fi

# ── 7. 汇总产物 ────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "✅ Release 构建完成"
echo ""
echo "  .app  $APP_PATH"
echo "  .dmg  $DMG_PATH"
echo "══════════════════════════════════════════════"
