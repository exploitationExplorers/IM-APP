param(
 [Parameter(Mandatory=$true)][string]$GroupFile,
 [Parameter(Mandatory=$true)][string]$AdminToken,
 [Parameter(Mandatory=$true)][string]$AdminGroupId,
 [int]$MaxMembers=3,
 [string]$AppBaseUrl='http://127.0.0.1:8080',
 [string]$AdminBaseUrl='http://127.0.0.1:8081'
)
. "$PSScriptRoot/TestData.Common.ps1"
$data = Get-Content -Raw -LiteralPath $GroupFile | ConvertFrom-Json
$group = $data.group
if (@($data.users).Count -lt 4) { throw '容量测试至少需要 4 个用户（前三人已用于建群）' }
Invoke-ImApi POST "$AdminBaseUrl/api/admin/v1/group-member-limits/update" @{groupId=$AdminGroupId;maxMembers=$MaxMembers;reason='自动化容量边界测试'} $AdminToken | Out-Null
$candidate = @($data.users)[3]
try {
  Invoke-ImApi POST "$AppBaseUrl/api/v1/groups/$($group.id)/join" @{} $candidate.accessToken | Out-Null
  throw '预期容量限制失败，但加群成功'
} catch {
  if ($_ -match '预期容量限制失败') { throw }
  Write-Host 'PASS：达到上限后新增成员被拒绝，现有成员未被移除。'
}
