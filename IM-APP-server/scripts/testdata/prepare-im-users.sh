#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/testdata-common.sh"
require_testdata_tools

count="${1:-${COUNT:-10}}"
batch="${2:-${BATCH:-$(date +%Y%m%d-%H%M%S)}}"
base_url="${BASE_URL:-http://127.0.0.1:8080}"
phone_prefix="${PHONE_PREFIX:-1990000}"
password="${TEST_PASSWORD:-Test123456!}"
[[ "$count" =~ ^[0-9]+$ ]] && (( count >= 1 && count <= 4000 )) || { echo 'count 必须在 1..4000' >&2; exit 2; }

out_dir="$script_dir/../../.tmp/testdata/$batch"
mkdir -p "$out_dir"
manifest="$out_dir/users.jsonl"
touch "$manifest"
for ((i=0; i<count; i++)); do
  printf -v suffix '%04d' "$i"
  phone="${phone_prefix}${suffix}"
  [[ ${#phone} -eq 11 ]] || { echo "生成手机号不是 11 位：$phone" >&2; exit 2; }
  if jq -e --arg phone "$phone" 'select(.phone == $phone)' "$manifest" >/dev/null; then
    echo "SKIP $phone（清单已存在）"
    continue
  fi
  get_or_create_test_user "$base_url" "$phone" "$password" >>"$manifest"
  echo "OK $((i + 1))/$count $phone"
done
echo "完成；清单：$manifest"
