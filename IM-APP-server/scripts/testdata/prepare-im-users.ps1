param(
  [int]$Count = 10,
  [string]$BaseUrl = 'http://127.0.0.1:8080',
  [string]$PhonePrefix = '1990000',
  [string]$Password = 'Test123456!',
  [string]$Batch = (Get-Date -Format 'yyyyMMdd-HHmmss')
)
. "$PSScriptRoot/TestData.Common.ps1"
if ($Count -lt 1 -or $Count -gt 4000) { throw 'Count 必须在 1..4000' }
$outDir = Join-Path $PSScriptRoot "../../.tmp/testdata/$Batch"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$manifest = Join-Path $outDir 'users.jsonl'
$users = @()
$existing = @{}
if (Test-Path -LiteralPath $manifest) {
  Get-Content -LiteralPath $manifest | ForEach-Object { $row=$_ | ConvertFrom-Json; $existing[$row.phone]=$true }
}
for ($i=0; $i -lt $Count; $i++) {
  $suffix = $i.ToString('0000')
  $phone = "$PhonePrefix$suffix"
  if ($phone.Length -ne 11) { throw "生成手机号不是 11 位：$phone" }
  if ($existing.ContainsKey($phone)) { Write-Host "SKIP $phone（清单已存在）"; continue }
  $user = Get-OrCreateTestUser -BaseUrl $BaseUrl -Phone $phone -Password $Password
  $users += $user
  $user | ConvertTo-Json -Compress | Add-Content -Encoding utf8 $manifest
  Write-Progress -Activity '创建并验证业务/OpenIM 用户' -Status "$($i+1)/$Count" -PercentComplete ((($i+1)*100)/$Count)
}
Write-Host "完成：$($users.Count) 个用户；清单：$manifest"
