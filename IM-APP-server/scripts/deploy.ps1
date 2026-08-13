# 只把本地 IM-APP-server 同步到服务器并重建 api 容器（不同步前端）
# 用法：
#   .\scripts\deploy.ps1
#   .\scripts\deploy.ps1 -Remote root@8.210.72.157
#   .\scripts\deploy.ps1 -SkipBuild   # 只同步文件，不重建

param(
    [string]$Remote = "root@8.210.72.157",
    [string]$RemoteDir = "/root/IM-APP/IM-APP-server",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ServerRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $ServerRoot "cmd\server\main.go"))) {
    throw "未找到后端根目录: $ServerRoot"
}

Write-Host "==> 同步 $ServerRoot -> ${Remote}:$RemoteDir"

# 用 tar 打包（排除密钥、构建产物、git），经 ssh 解压到远端
# 保留远端已有 .env，不被本地覆盖
$excludes = @(
    "--exclude=.env",
    "--exclude=bin",
    "--exclude=tmp",
    "--exclude=.git",
    "--exclude=*.exe",
    "--exclude=.DS_Store"
)

$remoteCmd = "mkdir -p '$RemoteDir' && tar -xzf - -C '$RemoteDir'"
$tarArgs = @("-czf", "-", "-C", $ServerRoot) + $excludes + @(".")

& tar.exe @tarArgs | & ssh.exe $Remote $remoteCmd
if ($LASTEXITCODE -ne 0) {
    throw "同步失败 (exit $LASTEXITCODE)"
}

Write-Host "==> 同步完成"

if ($SkipBuild) {
    Write-Host "==> 已跳过重建（-SkipBuild）"
    exit 0
}

Write-Host "==> 远端重建 api 容器"
$buildCmd = "cd '$RemoteDir' && docker compose up -d --build --force-recreate api"
& ssh.exe $Remote $buildCmd
if ($LASTEXITCODE -ne 0) {
    throw "远端重建失败 (exit $LASTEXITCODE)"
}

Write-Host "==> 健康检查"
& ssh.exe $Remote "curl -sS http://127.0.0.1:8080/health"
Write-Host ""
Write-Host "部署完成。前端继续指向 http://8.210.72.157:8080 即可联调。"
