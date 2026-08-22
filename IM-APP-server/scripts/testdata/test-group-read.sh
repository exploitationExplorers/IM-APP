#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/testdata-common.sh"
require_testdata_tools
conversation_id="${1:?用法: $0 conversation_id group_public_id message_seq sender_token reader_token}"
group_public_id="${2:?缺少群公开 ID}"; message_seq="${3:?缺少消息 seq}"; sender_token="${4:?缺少发送者 token}"; reader_token="${5:?缺少阅读者 token}"
base_url="${BASE_URL:-http://127.0.0.1:8080}"; encoded="$(jq -rn --arg v "$conversation_id" '$v|@uri')"
before="$(api_call GET "$base_url/api/v1/im/group-read-state?conversationId=$encoded" '' "$sender_token")"
api_call POST "$base_url/api/v1/im/conversations/group/$group_public_id/read" '{}' "$reader_token" >/dev/null
report="$(api_call POST "$base_url/api/v1/im/group-read-cursors/report" "$(jq -nc --arg id "$conversation_id" '{conversationId:$id}')" "$reader_token")"
after="$(api_call GET "$base_url/api/v1/im/group-read-state?conversationId=$encoded" '' "$sender_token")"
actual="$(jq -r '.maxOtherReadSeq // 0' <<<"$after")"
(( actual >= message_seq )) || { echo "FAIL：最大已读游标 $actual 小于消息 seq $message_seq" >&2; exit 1; }
echo "PASS：before=$(jq -r '.maxOtherReadSeq // 0' <<<"$before"), reader=$(jq -r '.hasReadSeq // 0' <<<"$report"), after=$actual"
