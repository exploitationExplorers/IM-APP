param([Parameter(Mandatory=$true)][string]$Manifest,[string]$BaseUrl='http://127.0.0.1:8080')
. "$PSScriptRoot/TestData.Common.ps1"
$failed = 0
Get-Content -LiteralPath $Manifest | ForEach-Object {
  $u = $_ | ConvertFrom-Json
  try {
    $auth = Invoke-ImApi POST "$BaseUrl/api/v1/auth/login" @{countryCode='+86';phone=$u.phone;password=$u.password;deviceId="verify-$($u.phone)"}
    $im = Invoke-ImApi POST "$BaseUrl/api/v1/im/token" @{platformId=5} $auth.accessToken
    if ($im.userId -ne $u.imUserId -or -not $im.token) { throw 'OpenIM 标识或 token 不匹配' }
    Write-Host "OK $($u.phone) $($im.userId)"
  } catch { $failed++; Write-Error "FAIL $($u.phone): $_" -ErrorAction Continue }
}
if ($failed -gt 0) { throw "$failed 个用户验证失败" }
