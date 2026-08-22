#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/testdata-common.sh"
require_testdata_tools
manifest="${1:?用法: $0 users.jsonl [群名称]}"; name="${2:-群容量与已读测试群}"
base_url="${BASE_URL:-http://127.0.0.1:8080}"
(( $(wc -l <"$manifest") >= 3 )) || { echo '至少准备 3 个用户' >&2; exit 2; }
owner="$(sed -n '1p' "$manifest")"
members="$(sed -n '2,3p' "$manifest" | jq -s '[.[].userId]')"
body="$(jq -nc --arg name "$name" --argjson members "$members" '{name:$name,memberIds:$members}')"
group="$(api_call POST "$base_url/api/v1/groups" "$body" "$(jq -r '.accessToken' <<<"$owner")")"
group_file="$(dirname "$manifest")/group.json"
jq -n --argjson group "$group" --argjson owner "$owner" --slurpfile users "$manifest" \
  '{group:$group,owner:$owner,users:$users}' >"$group_file"
echo "群已创建：$(jq -r '.id' <<<"$group")，文件：$group_file"
