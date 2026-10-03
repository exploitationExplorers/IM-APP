# Sync changed viron files to server, optionally rebuild Docker image.
# Example:
#   .\scripts\sync-changed-to-server.ps1 -HostName 1.2.3.4 -User root -Rebuild
#   .\scripts\sync-changed-to-server.ps1 -HostName 1.2.3.4 -User root -IdentityFile "$env:USERPROFILE\.ssh\id_rsa" -Rebuild

[CmdletBinding()]
param(
  [string]$HostName = $env:VIRON_DEPLOY_HOST,
  [string]$User = $(if ($env:VIRON_DEPLOY_USER) { $env:VIRON_DEPLOY_USER } else { "root" }),
  [string]$RemotePath = $(if ($env:VIRON_DEPLOY_PATH) { $env:VIRON_DEPLOY_PATH } else { "/root/IM-APP/IM-ops/viron" }),
  [string]$IdentityFile = $env:VIRON_DEPLOY_IDENTITY,
  [string]$ComposeFile = "docker-compose.full.yml",
  [switch]$Rebuild,
  [switch]$DryRun,
  [string[]]$Files = @()
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command not found: $Name. Install OpenSSH Client first."
  }
}

if (-not $HostName) {
  throw "Pass -HostName or set env VIRON_DEPLOY_HOST."
}

Require-Command scp
Require-Command ssh

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$vironRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ($Files.Count -eq 0) {
  Push-Location $repoRoot
  try {
    $status = git status --porcelain -- "IM-ops/viron"
    $Files = @(
      $status |
        ForEach-Object {
          $line = $_.TrimEnd()
          if (-not $line) { return }
          $path = if ($line -match '->\s+(.+)$') { $Matches[1].Trim() } else { $line.Substring(3).Trim().Trim('"') }
          if ($path.StartsWith("IM-ops/viron/")) {
            $path.Substring("IM-ops/viron/".Length).Replace("\", "/")
          }
        } |
        Where-Object { $_ } |
        Select-Object -Unique
    )
  } finally {
    Pop-Location
  }
}

$Files = @(
  $Files |
    Where-Object {
      $_ -and
      $_ -notmatch '(^|/)node_modules(/|$)' -and
      $_ -notmatch '(^|/)\.env$' -and
      $_ -notmatch '(^|/)data(/|$)' -and
      $_ -notmatch '(^|/)secrets(/|$)' -and
      $_ -notmatch '(^|/)dist(/|$)'
    }
)

if ($Files.Count -eq 0) {
  Write-Host "No changed files detected. Pass -Files explicitly if needed."
  exit 0
}

Write-Host "Sync target: ${User}@${HostName}:${RemotePath}"
Write-Host "Files:"
$Files | ForEach-Object { Write-Host "  - $_" }

$sshArgs = @()
if ($IdentityFile) {
  if (-not (Test-Path $IdentityFile)) { throw "Identity file not found: $IdentityFile" }
  $sshArgs += @("-i", $IdentityFile)
}
$sshArgs += @("-o", "StrictHostKeyChecking=accept-new")
$target = "${User}@${HostName}"

foreach ($rel in $Files) {
  $local = Join-Path $vironRoot ($rel -replace "/", [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path $local)) {
    throw "Local file missing: $local"
  }
  $remoteUnix = ($RemotePath.TrimEnd("/") + "/" + $rel.Replace("\", "/"))
  $remoteDir = ($remoteUnix -replace '/[^/]+$', '')

  if ($DryRun) {
    Write-Host "[dry-run] scp $rel -> ${target}:${remoteUnix}"
    continue
  }

  Write-Host "mkdir -p $remoteDir"
  & ssh @sshArgs $target "mkdir -p '$remoteDir'"
  if ($LASTEXITCODE -ne 0) { throw "Remote mkdir failed: $remoteDir" }

  Write-Host "scp $rel"
  & scp @sshArgs $local "${target}:${remoteUnix}"
  if ($LASTEXITCODE -ne 0) { throw "Upload failed: $rel" }
}

if ($DryRun) {
  Write-Host "[dry-run] skip rebuild."
  exit 0
}

if ($Rebuild) {
  Write-Host "Remote rebuild: docker compose up -d --build ..."
  $remoteCmd = "cd '$RemotePath' && docker compose -f '$ComposeFile' up -d --build"
  & ssh @sshArgs $target $remoteCmd
  if ($LASTEXITCODE -ne 0) { throw "Remote docker compose rebuild failed" }
  Write-Host "Done. Check CSP: curl -sI https://www.ke58.com/opt/ | grep -i content-security-policy"
} else {
  Write-Host ""
  Write-Host "Files uploaded. Production still needs image rebuild:"
  Write-Host "  cd $RemotePath"
  Write-Host "  docker compose -f $ComposeFile up -d --build"
  Write-Host "Or re-run this script with -Rebuild"
}