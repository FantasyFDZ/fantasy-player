# bootstrap-windows.ps1 —— Windows 一键环境自举脚本
#
# 功能：
#   1. 检测 + 安装所有工具链（git / node / python3.12 / 7-Zip / rustup / MSVC BuildTools）
#   2. npm install
#   3. 跑 bootstrap_vendor.ps1 生成 src-tauri\vendor\
#   4. 汇总结果
#
# 使用方法：
#   1. git clone https://github.com/FantasyFDZ/musicplayer.git
#   2. cd musicplayer
#   3. 以【管理员身份】打开 PowerShell
#   4. Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   5. .\scripts\bootstrap-windows.ps1
#
# 期望时长：15-25 分钟（取决于网速 + 是否已装部分工具）
# 可重复运行：已装的会跳过，只做增量工作

#Requires -Version 5.1
#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Fantasy Player — Windows 环境一键自举"         -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── 0. 前置检查 ───────────────────────────────────────────────

# 确认在仓库根目录
if (-not (Test-Path 'package.json') -or -not (Test-Path 'src-tauri')) {
    Write-Host "❌ 当前目录不是 musicplayer 仓库根。" -ForegroundColor Red
    Write-Host "   请先：" -ForegroundColor Yellow
    Write-Host "     cd \$HOME" -ForegroundColor Yellow
    Write-Host "     git clone https://github.com/FantasyFDZ/musicplayer.git" -ForegroundColor Yellow
    Write-Host "     cd musicplayer" -ForegroundColor Yellow
    Write-Host "     .\scripts\bootstrap-windows.ps1" -ForegroundColor Yellow
    exit 1
}

# 确认 winget 可用
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "❌ winget 未安装（Windows 10 旧版本缺少）。" -ForegroundColor Red
    Write-Host "   请打开 Microsoft Store 搜索 'App Installer' 安装，或：" -ForegroundColor Yellow
    Write-Host "     https://apps.microsoft.com/detail/9nblggh4nns1" -ForegroundColor Yellow
    exit 1
}

# 刷新当前 PowerShell 的 PATH（winget 装完后才能在本 shell 找到新工具）
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# ── 1. 工具链检测 + 安装 ─────────────────────────────────────

function Install-Tool {
    param(
        [string]$Command,
        [string]$WingetId,
        [string]$DisplayName,
        [string[]]$ExtraArgs = @()
    )
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        $version = & $Command --version 2>&1 | Select-Object -First 1
        Write-Host "✅ $DisplayName  ($version)" -ForegroundColor Green
        return
    }
    Write-Host "⚙️  安装 $DisplayName ..." -ForegroundColor Cyan
    $args = @('install', '-e', '--id', $WingetId, '--silent',
              '--accept-source-agreements', '--accept-package-agreements') + $ExtraArgs
    & winget @args
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ winget 装 $DisplayName 失败（退出码 $LASTEXITCODE）" -ForegroundColor Red
        exit 1
    }
    Refresh-Path
    Write-Host "✅ $DisplayName 安装完成" -ForegroundColor Green
}

Write-Host "── 检测工具链 ─────────────────────────────────" -ForegroundColor Cyan

Install-Tool -Command 'git'  -WingetId 'Git.Git'            -DisplayName 'Git'
Install-Tool -Command 'node' -WingetId 'OpenJS.NodeJS.LTS'  -DisplayName 'Node.js LTS'
Install-Tool -Command 'py'   -WingetId 'Python.Python.3.12' -DisplayName 'Python 3.12'
Install-Tool -Command '7z'   -WingetId '7zip.7zip'          -DisplayName '7-Zip'

# Rust：winget 有时不稳，用官方 rustup-init 更可靠
if (Get-Command rustc -ErrorAction SilentlyContinue) {
    $ver = (rustc --version) -replace '\s+',' '
    Write-Host "✅ Rust  ($ver)" -ForegroundColor Green
} else {
    Write-Host "⚙️  安装 Rust (rustup-init) ..." -ForegroundColor Cyan
    $rustupInit = Join-Path $env:TEMP 'rustup-init.exe'
    Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile $rustupInit -UseBasicParsing
    & $rustupInit -y --default-toolchain stable --profile default --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ rustup-init 失败（退出码 $LASTEXITCODE）" -ForegroundColor Red
        exit 1
    }
    # rustup 装到 %USERPROFILE%\.cargo\bin
    $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
    Refresh-Path
    Write-Host "✅ Rust 安装完成" -ForegroundColor Green
}

# MSVC Build Tools：Rust 在 Windows 必须有；检测 cl.exe 或安装路径
$msvcInstalled = (Test-Path "$env:ProgramFiles\Microsoft Visual Studio\2022\BuildTools") -or
                 (Test-Path "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools")
if ($msvcInstalled) {
    Write-Host "✅ MSVC Build Tools 2022" -ForegroundColor Green
} else {
    Write-Host "⚙️  安装 MSVC Build Tools 2022（约 2 GB，下载 + 安装 5-10 分钟）..." -ForegroundColor Cyan
    winget install -e --id Microsoft.VisualStudio.2022.BuildTools `
        --silent --accept-source-agreements --accept-package-agreements `
        --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ MSVC Build Tools 安装失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ MSVC Build Tools 安装完成" -ForegroundColor Green
}

# ── 2. 前端依赖 ───────────────────────────────────────────────

Write-Host ""
Write-Host "── npm install ────────────────────────────────" -ForegroundColor Cyan
if (Test-Path 'node_modules') {
    Write-Host "✅ node_modules 已存在，跳过" -ForegroundColor Green
} else {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ npm install 失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ npm install 完成" -ForegroundColor Green
}

# ── 3. vendor 打包（最长一步）──────────────────────────────

Write-Host ""
Write-Host "── bootstrap_vendor.ps1（约 10 分钟）──────────" -ForegroundColor Cyan

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
try {
    & .\scripts\bootstrap_vendor.ps1
} catch {
    Write-Host "❌ bootstrap_vendor 失败：$_" -ForegroundColor Red
    exit 1
}

# ── 4. 汇总 ──────────────────────────────────────────────────

$VendorRoot = 'src-tauri\vendor'
if (-not (Test-Path "$VendorRoot\mpv")) {
    Write-Host ""
    Write-Host "❌ vendor 目录不完整 —— 缺 $VendorRoot\mpv" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ Windows 环境就绪"                          -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "vendor 目录结构：" -ForegroundColor Cyan
Get-ChildItem -Path $VendorRoot | Format-Table Name, Mode, @{
    Name='Size'; Expression={
        if ($_.PSIsContainer) {
            $s = (Get-ChildItem $_.FullName -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
            if ($s) { "{0:N1} MB" -f ($s / 1MB) } else { "-" }
        } else {
            "{0:N1} MB" -f ($_.Length / 1MB)
        }
    }
}

$totalBytes = (Get-ChildItem $VendorRoot -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
$totalSize = "{0:N1} MB" -f ($totalBytes / 1MB)
Write-Host ""
Write-Host "📦 vendor 总大小: $totalSize" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：等 tauri.conf.json 的跨平台 resources 配置就位后，跑 tauri build" -ForegroundColor Yellow
Write-Host ""
