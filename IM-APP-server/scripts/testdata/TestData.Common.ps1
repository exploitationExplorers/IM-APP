Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-ImApi {
  param([string]$Method,[string]$Url,[object]$Body,[string]$Token='')
  $headers = @{}
  if ($Token) { $headers.Authorization = "Bearer $Token" }
  $args = @{ Method=$Method; Uri=$Url; Headers=$headers; ContentType='application/json' }
  if ($null -ne $Body) { $args.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
  $result = Invoke-RestMethod @args
  if ($result.code -ne 0) { throw "API failed: $Url - $($result.message)" }
  return $result.data
}

function Get-OrCreateTestUser {
  param([string]$BaseUrl,[string]$Phone,[string]$Password)
  $device = "testdata-$Phone"
  try {
    $sms = Invoke-ImApi POST "$BaseUrl/api/v1/auth/sms/send" @{countryCode='+86';phone=$Phone;scene='register';deviceId=$device}
    if (-not $sms.devCode) { throw '服务未返回 devCode；请设置 DEV_SMS_CODE，测试脚本不会读取生产短信。' }
    $auth = Invoke-ImApi POST "$BaseUrl/api/v1/auth/register" @{countryCode='+86';phone=$Phone;code=$sms.devCode;password=$Password;deviceId=$device}
  } catch {
    $auth = Invoke-ImApi POST "$BaseUrl/api/v1/auth/login" @{countryCode='+86';phone=$Phone;password=$Password;deviceId=$device}
  }
  $im = Invoke-ImApi POST "$BaseUrl/api/v1/im/token" @{platformId=5} $auth.accessToken
  if (-not $im.userId -or -not $im.token) { throw "用户 $Phone 未完成 OpenIM 注册/取 token" }
  return [ordered]@{ phone=$Phone; password=$Password; userId=$auth.user.id; publicId=$auth.user.publicId; accessToken=$auth.accessToken; imUserId=$im.userId; openIMTokenVerified=$true }
}
