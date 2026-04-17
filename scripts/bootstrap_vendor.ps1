# bootstrap_vendor.ps1 —— Windows 版 vendor 打包脚本。
#
# 生成 src-tauri\vendor\ 下：
#   mpv\mpv.exe + mpv\*.dll              — 独立 mpv
#   node.exe                              — 单文件 Node 可执行
#   scripts\*.cjs + node_modules\         — 网易云 / QQ 音乐适配器
#   python\python.exe + python\Lib\...    — python-build-standalone 便携 Python
#   sidecar\audio_analyzer.py + models\   — 音频分析 Python 脚本
#
# 前置依赖（host）：
#   - Windows 10 1803+（内置 tar 命令）
#   - Node.js 任意版本（PATH 能找到 npm.cmd）
#   - 7-Zip CLI（mpv 用 .7z 分发）
#       winget install -e --id 7zip.7zip
#       或从 https://7-zip.org 下载后把安装目录加入 PATH
#
# 用法：
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\bootstrap_vendor.ps1
#
# 最终体积约 700 MB。

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest 进度条慢 10 倍

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Vendor = Join-Path $RepoRoot 'src-tauri\vendor'
$TempDir = Join-Path $env:TEMP 'melody-vendor'

Write-Host "[vendor] target dir: $Vendor" -ForegroundColor Cyan

# ── 前置依赖检测 ───────────────────────────────────────────────
function Require-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "❌ 缺少依赖：$name" -ForegroundColor Red
        Write-Host "   $hint" -ForegroundColor Yellow
        exit 1
    }
}

Require-Command 'node' 'Install: winget install -e --id OpenJS.NodeJS.LTS'
Require-Command 'npm'  'Node.js 安装后应自动带上 npm.cmd'
Require-Command 'tar'  'Windows 10 1803+ 内置，升级系统或改用 bsdtar'
Require-Command '7z'   'Install: winget install -e --id 7zip.7zip'

# ── 清理并建立目录 ─────────────────────────────────────────────
if (Test-Path $Vendor) { Remove-Item -Recurse -Force $Vendor }
New-Item -ItemType Directory -Force -Path $Vendor  | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# ══════════════════════════════════════════════════════════════
# 1. mpv for Windows
# ══════════════════════════════════════════════════════════════
Write-Host "[vendor] downloading mpv (x86_64, latest shinchiro build)..."

# 最新版信息页：https://github.com/shinchiro/mpv-winbuild-cmake/releases
# 这里用一个已验证的稳定版本（需要时手动升级此常量）
$MpvVersion = '20260101'
$MpvFile = "mpv-x86_64-v3-$MpvVersion-git.7z"
$MpvUrl = "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/$MpvVersion/$MpvFile"
$MpvArchive = Join-Path $TempDir $MpvFile

try {
    Invoke-WebRequest -Uri $MpvUrl -OutFile $MpvArchive -UseBasicParsing
} catch {
    Write-Host "❌ 下载 mpv 失败。请到 https://github.com/shinchiro/mpv-winbuild-cmake/releases" -ForegroundColor Red
    Write-Host "   手动下载一个 x86_64 版本，放到 $MpvArchive" -ForegroundColor Yellow
    if (-not (Test-Path $MpvArchive)) { exit 1 }
}

$MpvDir = Join-Path $Vendor 'mpv'
New-Item -ItemType Directory -Force -Path $MpvDir | Out-Null
& 7z x $MpvArchive -o"$MpvDir" -y | Out-Null
if (-not (Test-Path (Join-Path $MpvDir 'mpv.exe'))) {
    Write-Host "❌ mpv.exe 未在解压结果中找到" -ForegroundColor Red
    exit 1
}
$MpvSize = "{0:N1} MB" -f ((Get-ChildItem $MpvDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "[vendor] mpv ready: $MpvSize"

# ══════════════════════════════════════════════════════════════
# 2. Node.js 便携二进制
# ══════════════════════════════════════════════════════════════
Write-Host "[vendor] downloading Node.js Windows binary..."
$NodeVersion = '22.14.0'  # 22 LTS；升级前先验证 netease-cloud-music-api-alger 兼容性
$NodeZip = "node-v$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeZip"
$NodeArchive = Join-Path $TempDir $NodeZip

Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeArchive -UseBasicParsing
Expand-Archive -Path $NodeArchive -DestinationPath $TempDir -Force
$NodeExtracted = Join-Path $TempDir "node-v$NodeVersion-win-x64\node.exe"
if (-not (Test-Path $NodeExtracted)) {
    Write-Host "❌ 解压后未找到 node.exe" -ForegroundColor Red
    exit 1
}
Copy-Item $NodeExtracted (Join-Path $Vendor 'node.exe')

# ══════════════════════════════════════════════════════════════
# 3. 适配器脚本 + node_modules
# ══════════════════════════════════════════════════════════════
Write-Host "[vendor] installing Node runtime deps..."
$ScriptsOut = Join-Path $Vendor 'scripts'
New-Item -ItemType Directory -Force -Path $ScriptsOut | Out-Null
Copy-Item (Join-Path $RepoRoot 'scripts\netease_adapter.cjs') $ScriptsOut
Copy-Item (Join-Path $RepoRoot 'scripts\qqmusic_adapter.cjs') $ScriptsOut

# 在 vendor 里做最小 npm install（仅运行时依赖）
Push-Location $Vendor
@'
{ "name": "melody-vendor", "private": true, "version": "1.0.0" }
'@ | Set-Content -Path 'package.json' -Encoding UTF8

& npm install --silent netease-cloud-music-api-alger qq-music-api axios --production 2>&1 | Out-Null
Remove-Item -Force 'package-lock.json' -ErrorAction SilentlyContinue
Pop-Location

$NodeSize = "{0:N1} MB" -f ((Get-Item (Join-Path $Vendor 'node.exe')).Length / 1MB)
$ModulesSize = "{0:N1} MB" -f ((Get-ChildItem (Join-Path $Vendor 'node_modules') -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "[vendor] node.exe: $NodeSize, node_modules: $ModulesSize"

# ══════════════════════════════════════════════════════════════
# 4. 便携 Python 3.12 + librosa + essentia
# ══════════════════════════════════════════════════════════════
Write-Host "[vendor] downloading portable Python 3.12..."
$PyTag = '20260414'    # 与 macOS 脚本保持一致
$PyVer = '3.12.13'
$PyFile = "cpython-$PyVer+$PyTag-x86_64-pc-windows-msvc-install_only.tar.gz"
$PyUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/$PyTag/$PyFile"
$PyArchive = Join-Path $TempDir $PyFile

Invoke-WebRequest -Uri $PyUrl -OutFile $PyArchive -UseBasicParsing

$PyDir = Join-Path $Vendor 'python'
New-Item -ItemType Directory -Force -Path $PyDir | Out-Null
# Windows 10+ 自带 tar 能处理 tar.gz；strip-components=1 去掉顶层 python/ 目录
& tar -xzf $PyArchive -C $PyDir --strip-components=1
if (-not (Test-Path (Join-Path $PyDir 'python.exe'))) {
    Write-Host "❌ python.exe 未在解压结果中找到" -ForegroundColor Red
    exit 1
}

Write-Host "[vendor] installing librosa + essentia + scipy (may take several minutes)..."
$PyExe = Join-Path $PyDir 'python.exe'
# 依次装，如果 essentia 失败，给出明确提示让用户降级到 librosa-only 构建
& $PyExe -m pip install --quiet numpy scipy librosa
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ librosa 安装失败" -ForegroundColor Red
    exit 1
}

Write-Host "[vendor] essentia 是可选依赖（PyPI 暂无 Windows wheel），尝试安装…"
& $PyExe -m pip install --quiet essentia 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[vendor] essentia 安装失败 —— 已设计降级路径，BPM / Key 改由 librosa 估算，Tier 2 特征为 null。" -ForegroundColor Yellow
    Write-Host "[vendor] 这是 Windows 构建的预期情况，不影响其余功能。" -ForegroundColor Yellow
    $LASTEXITCODE = 0  # 重置，避免脚本后续 set -e 触发
} else {
    Write-Host "[vendor] essentia 安装成功（意外惊喜）—— 将使用完整特征集合" -ForegroundColor Green
}

# ── sidecar 脚本 ───────────────────────────────────────────────
$SidecarOut = Join-Path $Vendor 'sidecar'
New-Item -ItemType Directory -Force -Path $SidecarOut | Out-Null
Copy-Item (Join-Path $RepoRoot 'sidecar\audio_analyzer.py') $SidecarOut
if (Test-Path (Join-Path $RepoRoot 'sidecar\models')) {
    Copy-Item (Join-Path $RepoRoot 'sidecar\models') $SidecarOut -Recurse
}

$PySize = "{0:N1} MB" -f ((Get-ChildItem $PyDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "[vendor] python ready: $PySize"

# ── 清理 temp ──────────────────────────────────────────────────
Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue

$TotalSize = "{0:N1} MB" -f ((Get-ChildItem $Vendor -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host ""
Write-Host "[vendor] done. total size: $TotalSize" -ForegroundColor Green
