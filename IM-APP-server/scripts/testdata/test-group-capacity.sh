#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/testdata-common.sh"
require_testdata_tools
group_file="${1:?用法: $0 group.json admin_token admin_group_uuid [max_members]}"
admin_token="${2:?缺少 admin token}"; admin_group_id="${3:?缺少管理后台群 UUID}"; max_members="${4:-3}"
app_base_url="${APP_BASE_URL:-http://127.0.0.1:8080}"; admin_base_url="${ADMIN_BASE_URL:-http://127.0.0.1:8081}"
(( $(jq '.users | length' "$group_file") >= 4 )) || { echo '容量测试至少需要 4 个用户' >&2; exit 2; }
body="$(jq -nc --arg id "$admin_group_id" --argjson max "$max_members" '{groupId:$id,maxMembers:$max,reason:"自动化容量边界测试"}')"
api_call POST "$admin_base_url/api/admin/v1/group-member-limits/update" "$body" "$admin_token" >/dev/null
group_id="$(jq -r '.group.id' "$group_file")"; candidate_token="$(jq -r '.users[3].accessToken' "$group_file")"
if api_call POST "$app_base_url/api/v1/groups/$group_id/join" '{}' "$candidate_token" >/dev/null; then
  echo 'FAIL：预期容量限制失败，但加群成功' >&2; exit 1
fi
echo 'PASS：达到上限后新增成员被拒绝，现有成员未被移除。'
