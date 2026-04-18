# CI / GitHub Actions 配置指南

本项目的 `.github/workflows/release.yml` 在 push tag `v*.*.*` 时自动：

1. macOS-14 runner：构建 + Developer ID 签名 + Apple 公证 + `.dmg`
2. windows-latest runner：构建 `.msi` + NSIS `.exe`
3. ubuntu-latest runner：汇总产物，创建 **draft** Release（人工发布）

首次使用需要把**一次性的凭据**配到 GitHub Secrets 里。以下是完整清单和导出步骤。

---

## Secrets 清单（7 个）

在 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，依次添加：

| Secret 名 | 内容说明 | 参考值 |
|---|---|---|
| `APPLE_SIGNING_IDENTITY` | 证书完整名称字符串 | `Developer ID Application: Dizhao Fan (6633WR778C)` |
| `APPLE_CERTIFICATE_BASE64` | Developer ID .p12 证书的 base64 编码（单行） | 见下方 §1 导出步骤 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 .p12 时你设的密码 | 自设强随机串 |
| `KEYCHAIN_PASSWORD` | CI 临时 keychain 的密码（仅 CI 内部用） | `openssl rand -hex 20` |
| `APPLE_ID` | 你的 Apple Developer 账号邮箱 | `your@email.com` |
| `APPLE_PASSWORD` | App-specific password（**不是** Apple ID 登录密码） | `xxxx-xxxx-xxxx-xxxx` |
| `APPLE_TEAM_ID` | 10 位 Team ID | `6633WR778C` |

> Windows 打包目前**不签名**，所以没有 Windows 证书相关的 secret。
> 未来想签 Windows 要另外买 EV 证书，流程在后续文档单独写。

---

## §1 导出 Developer ID `.p12` 证书

### 打开钥匙串

```bash
open "/System/Applications/Utilities/Keychain Access.app"
```

### 找到证书

1. 左栏选 **「登录」** → **「我的证书」**（中间栏过滤）
2. 找到 `Developer ID Application: Dizhao Fan (6633WR778C)`
3. 点名字前的**三角形**展开，应该看到下面挂着一条**私钥**

### 导出两项

1. **同时选中证书本身 + 下面的私钥**（Cmd+点 两项）
2. 右键 → **「导出 2 项…」**
3. 文件格式选 **「.p12（个人信息交换）」**，保存到桌面命名 `fantasy-signing.p12`
4. 弹窗输入 **p12 保护密码**（**记下这个，就是 `APPLE_CERTIFICATE_PASSWORD`**）
5. 系统可能再弹一次让你输 macOS 登录密码 —— 输即可
6. 得到 `~/Desktop/fantasy-signing.p12`

### 验证

```bash
openssl pkcs12 -in ~/Desktop/fantasy-signing.p12 -noout -info
# 输入刚才的 p12 密码，能看到 MAC verified OK 说明成功
```

### base64 编码并拷贝到剪贴板

```bash
base64 -i ~/Desktop/fantasy-signing.p12 | pbcopy
```

粘贴到 GitHub Secrets 的 `APPLE_CERTIFICATE_BASE64` 字段。单行很长没关系，GitHub 会存。

**存完 Secret 立刻删本地 .p12**（避免散落）：

```bash
shred -u ~/Desktop/fantasy-signing.p12 2>/dev/null || rm -P ~/Desktop/fantasy-signing.p12
```

---

## §2 生成 KEYCHAIN_PASSWORD

随意强随机即可，仅用于 CI 临时 keychain：

```bash
openssl rand -hex 20 | pbcopy
```

---

## §3 App-Specific Password

https://appleid.apple.com → 登录 → **Sign-In and Security** → **App-Specific Passwords** → **Generate**

- Label: `Fantasy Player CI`
- 生成后**立刻复制**（只显示一次），格式 `xxxx-xxxx-xxxx-xxxx`
- 贴到 GitHub Secrets 的 `APPLE_PASSWORD`

---

## §4 其余三项（字符串直接贴）

- `APPLE_SIGNING_IDENTITY` = `Developer ID Application: Dizhao Fan (6633WR778C)`
- `APPLE_ID` = 你的 Apple Developer 账号邮箱
- `APPLE_TEAM_ID` = `6633WR778C`

---

## 首次试跑（强烈推荐）

不要直接推真 tag，先用 `workflow_dispatch` dry-run：

1. GitHub 仓库 → **Actions** → 左栏点 **Release** workflow → 右上 **Run workflow**
2. `Version tag` 填 `v0.1.0-dryrun`（或任何带后缀的）
3. 跑起来等 ~25-40 分钟（第一次 Rust cache miss，之后大幅加速）
4. 如果三 job 全绿 → Releases 页面看到一个 **draft** Release 带 `.dmg + .msi + .exe`
5. 手动下载 `.dmg` 到本地验证：
   ```bash
   spctl --assess --verbose=4 --type open \
     --context context:primary-signature "Fantasy Player_0.1.0_aarch64.dmg"
   ```
   期望看到 `accepted` 和 `source=Notarized Developer ID`
6. 一切 OK 后 GitHub 上把 dry-run 那个 draft **删 Release + 删 tag**

## 正式发版

```bash
git tag v0.1.0
git push origin v0.1.0
```

workflow 自动触发。完成后到 Releases 页面：
- 编辑 draft，核对标题 / 正文 / 附件
- 点 **Publish release** 发布

---

## 踩坑提醒

1. **第一次跑特别慢**：Rust 要编译全部依赖（Tauri 2 约 400+ crate），macOS 约 15 min，Windows 约 20 min。之后 `Swatinem/rust-cache@v2` 缓存命中，降到 3-5 min。
2. **Apple 公证偶发慢**：正常 3-8 min，偶尔 30 min+，极少可能超 30 min 导致 job 失败。重跑通常就好了。
3. **vendor 目录在 CI 上现生成**：每次约 5-10 min 下载 mpv/Node/Python。不被 artifact 上传，只在 runner 本地临时存。
4. **draft Release 不自动 Publish**：安全设计。人工审核产物能用再发。

---

## 本地手工发版依旧可行

如果 CI 出问题，本地仍然可以：

```bash
# macOS
cp scripts/sign.env.example scripts/sign.env   # 填凭据
bash scripts/build-macos-release.sh

# Windows  
npm run tauri:build:windows
```

产物同样在 `src-tauri/target/release/bundle/`。手动上传到 GitHub Release 即可。
