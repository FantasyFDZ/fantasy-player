# bootstrap_vendor.ps1 -- Windows vendor bootstrap script.
#
# Produces src-tauri\vendor\:
#   mpv\mpv.exe + mpv\*.dll           - standalone mpv
#   node.exe                          - single-file Node binary
#   scripts\*.cjs + node_modules\     - netease / QQ Music adapter
#   python\python.exe + python\Lib\.. - portable Python (python-build-standalone)
#   sidecar\audio_analyzer.py + ..    - audio analyzer Python script
#
# Host prerequisites:
#   - Windows 10 1803+ (built-in tar)
#   - Node.js (npm.cmd on PATH)
#   - 7-Zip CLI (auto-discovered at default install path if not on PATH)
#       winget install -e --id 7zip.7zip
#
# Usage:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\bootstrap_vendor.ps1
#
# Final size ~700 MB.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest progress bar slows 10x

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Vendor   = Join-Path $RepoRoot 'src-tauri\vendor'
$TempDir  = Join-Path $env:TEMP 'melody-vendor'

Write-Host "[vendor] target dir: $Vendor" -ForegroundColor Cyan

# ---- dependency detection ---------------------------------------------------

function Require-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "[ERR] missing dependency: $name" -ForegroundColor Red
        Write-Host "      $hint" -ForegroundColor Yellow
        exit 1
    }
}

function Resolve-7z {
    # 1. on PATH
    $cmd = Get-Command 7z -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # 2. default Program Files locations
    $candidates = @(
        "${env:ProgramFiles}\7-Zip\7z.exe",
        "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    Write-Host "[ERR] 7-Zip (7z.exe) not found." -ForegroundColor Red
    Write-Host "      Install: winget install -e --id 7zip.7zip" -ForegroundColor Yellow
    Write-Host "      Or download from https://7-zip.org and add install dir to PATH" -ForegroundColor Yellow
    exit 1
}

Require-Command 'node' 'Install: winget install -e --id OpenJS.NodeJS.LTS'
Require-Command 'npm'  'npm.cmd should come with Node.js'
Require-Command 'tar'  'Built into Windows 10 1803+'
$SevenZip = Resolve-7z
Write-Host "[vendor] using 7-Zip: $SevenZip" -ForegroundColor Cyan

# ---- clean + create ---------------------------------------------------------
if (Test-Path $Vendor) { Remove-Item -Recurse -Force $Vendor }
New-Item -ItemType Directory -Force -Path $Vendor  | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# =============================================================================
# 1. mpv for Windows
# =============================================================================
# shinchiro 每天新 release 一次，文件名含 git hash，没法硬编码。
# 用 GitHub API 查最新 release，挑 x86_64-v3 的 mpv（非 dev、非 aarch64/i686）。
Write-Host "[vendor] querying latest mpv release from shinchiro/mpv-winbuild-cmake..."
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest" -UseBasicParsing
} catch {
    Write-Host "[ERR] GitHub API query failed: $_" -ForegroundColor Red
    Write-Host "      Check network / possibly rate-limited (60/h unauth). Retry later." -ForegroundColor Yellow
    exit 1
}
# 优先挑 v3（更现代的 CPU baseline），否则退到通用 x86_64
$asset = $release.assets | Where-Object { $_.name -match '^mpv-x86_64-v3-\d+-git-[a-f0-9]+\.7z$' } | Select-Object -First 1
if (-not $asset) {
    $asset = $release.assets | Where-Object { $_.name -match '^mpv-x86_64-\d+-git-[a-f0-9]+\.7z$' } | Select-Object -First 1
}
if (-not $asset) {
    Write-Host "[ERR] No x86_64 mpv build found in release '$($release.tag_name)'" -ForegroundColor Red
    exit 1
}
$MpvFile    = $asset.name
$MpvUrl     = $asset.browser_download_url
$MpvArchive = Join-Path $TempDir $MpvFile
Write-Host "[vendor] downloading $MpvFile ..."
Invoke-WebRequest -Uri $MpvUrl -OutFile $MpvArchive -UseBasicParsing

$MpvDir = Join-Path $Vendor 'mpv'
New-Item -ItemType Directory -Force -Path $MpvDir | Out-Null
& $SevenZip x $MpvArchive -o"$MpvDir" -y | Out-Null
if (-not (Test-Path (Join-Path $MpvDir 'mpv.exe'))) {
    Write-Host "[ERR] mpv.exe not found in extracted files" -ForegroundColor Red
    exit 1
}
$MpvSize = "{0:N1} MB" -f ((Get-ChildItem $MpvDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "[vendor] mpv ready: $MpvSize"

# =============================================================================
# 2. Node.js portable
# =============================================================================
Write-Host "[vendor] downloading Node.js Windows binary..."
$NodeVersion = '22.14.0'   # 22 LTS
$NodeZip     = "node-v$NodeVersion-win-x64.zip"
$NodeUrl     = "https://nodejs.org/dist/v$NodeVersion/$NodeZip"
$NodeArchive = Join-Path $TempDir $NodeZip

Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeArchive -UseBasicParsing
Expand-Archive -Path $NodeArchive -DestinationPath $TempDir -Force
$NodeExtracted = Join-Path $TempDir "node-v$NodeVersion-win-x64\node.exe"
if (-not (Test-Path $NodeExtracted)) {
    Write-Host "[ERR] node.exe not found after extract" -ForegroundColor Red
    exit 1
}
Copy-Item $NodeExtracted (Join-Path $Vendor 'node.exe')

# =============================================================================
# 3. Adapter scripts + node_modules
# =============================================================================
Write-Host "[vendor] installing Node runtime deps..."
$ScriptsOut = Join-Path $Vendor 'scripts'
New-Item -ItemType Directory -Force -Path $ScriptsOut | Out-Null
Copy-Item (Join-Path $RepoRoot 'scripts\netease_adapter.cjs') $ScriptsOut
Copy-Item (Join-Path $RepoRoot 'scripts\qqmusic_adapter.cjs') $ScriptsOut

# minimal npm install into vendor/ so node_modules sits next to scripts/
Push-Location $Vendor
@'
{ "name": "melody-vendor", "private": true, "version": "1.0.0" }
'@ | Set-Content -Path 'package.json' -Encoding UTF8

& npm install --silent netease-cloud-music-api-alger qq-music-api axios --production 2>&1 | Out-Null
Remove-Item -Force 'package-lock.json' -ErrorAction SilentlyContinue
Pop-Location

$NodeSize    = "{0:N1} MB" -f ((Get-Item (Join-Path $Vendor 'node.exe')).Length / 1MB)
$ModulesSize = "{0:N1} MB" -f ((Get-ChildItem (Join-Path $Vendor 'node_modules') -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "[vendor] node.exe: $NodeSize, node_modules: $ModulesSize"

# =============================================================================
# 4. Portable Python 3.12 + librosa (+ optional essentia)
# =============================================================================
Write-Host "[vendor] downloading portable Python 3.12..."
$PyTag  = '20260414'   # kept in sync with bootstrap_vendor.sh
$PyVer  = '3.12.13'
$PyFile = "cpython-$PyVer+$PyTag-x86_64-pc-windows-msvc-install_only.tar.gz"
$PyUrl  = "https://github.com/astral-sh/python-build-standalone/releases/download/$PyTag/$PyFile"
$PyArchive = Join-Path $TempDir $PyFile

Invoke-WebRequest -Uri $PyUrl -OutFile $PyArchive -UseBasicParsing

$PyDir = Join-Path $Vendor 'python'
New-Item -ItemType Directory -Force -Path $PyDir | Out-Null
# Windows 10+ tar supports tar.gz; strip top-level python/ dir
& tar -xzf $PyArchive -C $PyDir --strip-components=1
if (-not (Test-Path (Join-Path $PyDir 'python.exe'))) {
    Write-Host "[ERR] python.exe not found after extract" -ForegroundColor Red
    exit 1
}

Write-Host "[vendor] installing librosa + scipy + numpy (may take several minutes)..."
$PyExe = Join-Path $PyDir 'python.exe'
& $PyExe -m pip install --quiet numpy scipy librosa
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERR] librosa install failed" -ForegroundColor Red
    exit 1
}

Write-Host "[vendor] essentia is optional (no prebuilt Windows wheel on PyPI); trying anyway..."
& $PyExe -m pip install --quiet essentia 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[vendor] essentia install failed -- graceful degrade: BPM/Key fall back to librosa, Tier-2 features null." -ForegroundColor Yellow
    Write-Host "[vendor] This is expected on Windows; the rest of the app is unaffected." -ForegroundColor Yellow
    $global:LASTEXITCODE = 0
} else {
    Write-Host "[vendor] essentia installed (full feature set available)" -ForegroundColor Green
}

# ---- sidecar script ---------------------------------------------------------
$SidecarOut = Join-Path $Vendor 'sidecar'
New-Item -ItemType Directory -Force -Path $SidecarOut | Out-Null
Copy-Item (Join-Path $RepoRoot 'sidecar\audio_analyzer.py') $SidecarOut
if (Test-Path (Join-Path $RepoRoot 'sidecar\models')) {
    Copy-Item (Join-Path $RepoRoot 'sidecar\models') $SidecarOut -Recurse
}

$PySize = "{0:N1} MB" -f ((Get-ChildItem $PyDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "[vendor] python ready: $PySize"

# ---- cleanup temp -----------------------------------------------------------
Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue

$TotalSize = "{0:N1} MB" -f ((Get-ChildItem $Vendor -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host ""
Write-Host "[vendor] done. total size: $TotalSize" -ForegroundColor Green
