param([Parameter(Mandatory=$true)][string]$Manifest,[string]$BaseUrl='http://127.0.0.1:8080',[string]$Name='群容量与已读测试群')
. "$PSScriptRoot/TestData.Common.ps1"
$users = @(Get-Content -LiteralPath $Manifest | ForEach-Object { $_ | ConvertFrom-Json })
if ($users.Count -lt 3) { throw '至少准备 3 个用户' }
$owner = $users[0]
$group = Invoke-ImApi POST "$BaseUrl/api/v1/groups" @{name=$Name;memberIds=@($users[1].userId,$users[2].userId)} $owner.accessToken
$result = [ordered]@{ group=$group; owner=$owner; users=$users }
$path = Join-Path (Split-Path $Manifest) 'group.json'
$result | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $path
Write-Host "群已创建：$($group.id)，文件：$path"
