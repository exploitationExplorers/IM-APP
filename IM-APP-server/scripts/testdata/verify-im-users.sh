#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/testdata-common.sh"
require_testdata_tools
manifest="${1:?用法: $0 users.jsonl}"
base_url="${BASE_URL:-http://127.0.0.1:8080}"
failed=0
while IFS= read -r user; do
  [[ -n "$user" ]] || continue
  phone="$(jq -r '.phone' <<<"$user")"; password="$(jq -r '.password' <<<"$user")"
  body="$(jq -nc --arg p "$phone" --arg pw "$password" --arg d "verify-$phone" '{countryCode:"+86",phone:$p,password:$pw,deviceId:$d}')"
  if auth="$(api_call POST "$base_url/api/v1/auth/login" "$body")" \
    && im="$(api_call POST "$base_url/api/v1/im/token" '{"platformId":5}' "$(jq -r '.accessToken' <<<"$auth")")" \
    && [[ "$(jq -r '.userId' <<<"$im")" == "$(jq -r '.imUserId' <<<"$user")" ]]; then
    echo "OK $phone $(jq -r '.userId' <<<"$im")"
  else
    echo "FAIL $phone" >&2; failed=$((failed + 1))
  fi
done <"$manifest"
(( failed == 0 )) || { echo "$failed 个用户验证失败" >&2; exit 1; }
