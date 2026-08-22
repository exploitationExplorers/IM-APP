param(
 [Parameter(Mandatory=$true)][string]$ConversationId,
 [Parameter(Mandatory=$true)][string]$GroupPublicId,
 [Parameter(Mandatory=$true)][Int64]$MessageSeq,
 [Parameter(Mandatory=$true)][string]$SenderToken,
 [Parameter(Mandatory=$true)][string]$ReaderToken,
 [string]$BaseUrl='http://127.0.0.1:8080'
)
. "$PSScriptRoot/TestData.Common.ps1"
$before = Invoke-ImApi GET "$BaseUrl/api/v1/im/group-read-state?conversationId=$([uri]::EscapeDataString($ConversationId))" $null $SenderToken
Invoke-ImApi POST "$BaseUrl/api/v1/im/conversations/group/$GroupPublicId/read" @{} $ReaderToken | Out-Null
$report = Invoke-ImApi POST "$BaseUrl/api/v1/im/group-read-cursors/report" @{conversationId=$ConversationId} $ReaderToken
$after = Invoke-ImApi GET "$BaseUrl/api/v1/im/group-read-state?conversationId=$([uri]::EscapeDataString($ConversationId))" $null $SenderToken
if ([int64]$after.maxOtherReadSeq -lt $MessageSeq) { throw "FAIL：最大已读游标 $($after.maxOtherReadSeq) 小于消息 seq $MessageSeq" }
Write-Host "PASS：before=$($before.maxOtherReadSeq), reader=$($report.hasReadSeq), after=$($after.maxOtherReadSeq)"
