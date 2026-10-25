#!/usr/bin/env bash
# Read-only self-check for the im-app OSS/CDN deployment.
#
# Usage:
#   bash deploy/verify-cdn.sh [business-cdn-url] [chat-oss-url]
#
#   business-cdn-url : any object under https://oss-business.<domain>/... (optional)
#                      e.g. https://oss-business.whs188.xin/im-app-production/business/avatars/xxx.jpg
#   chat-oss-url     : any real chat object (optional). It may be a signed URL, quote it.
#
# It never mutates anything. It prints PASS/FAIL lines and exits 1 if any FAIL.

set -uo pipefail

API="${API_CONTAINER:-im-app-api}"
OPENIM="${OPENIM_CONTAINER:-openim-api}"
OVERLAY="${OVERLAY:-/root/im-app-oss-production/oss-production-bundle/private/api.compose.json}"
OPENIM_CFG="${OPENIM_CFG:-/root/im-app-oss-production/oss-production-bundle/private/openim-rpc-third.yml}"
BUSINESS_URL="${1:-}"
CHAT_URL="${2:-}"

FAILS=0
pass() { printf '\033[32m[PASS]\033[0m %s\n' "$1"; }
fail() { printf '\033[31m[FAIL]\033[0m %s\n' "$1"; FAILS=$((FAILS + 1)); }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$1"; }
info() { printf '       %s\n' "$1"; }
section() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

expect_eq() { # label actual expected
  if [[ "$2" == "$3" ]]; then pass "$1 = $2"; else fail "$1 = '$2' (expected '$3')"; fi
}
expect_nonempty() { # label value
  if [[ -n "$2" ]]; then pass "$1 = $2"; else fail "$1 is EMPTY"; fi
}

section "1. containers"
for c in "$API" "$OPENIM"; do
  status="$(docker ps --filter "name=^/${c}$" --format '{{.Status}}' 2>/dev/null)"
  if [[ -n "$status" ]]; then
    if [[ "$status" =~ ^Up ]]; then pass "$c -> $status"; else fail "$c -> $status"; fi
  else
    fail "$c not running"
  fi
done

section "2. api health"
code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:8080/health 2>/dev/null)"
expect_eq "GET /health" "$code" "200"

section "3. api container env (authoritative)"
if docker exec "$API" true >/dev/null 2>&1; then
  env_dump="$(docker inspect "$API" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -a -E '^(STORAGE_PROVIDER|OSS_BUCKET|OSS_PUBLIC_BASE_URL|OSS_MEDIA_PROXY_URL|OSS_MEDIA_SIGNING_KEY|MEDIA_SOURCE_URL_PREFIXES|GROUP_RETENTION_ADAPTER_URL|GROUP_RETENTION_MODE)=' )"
  get_env() { printf '%s\n' "$env_dump" | sed -n "s/^$1=//p" | head -1; }
  expect_eq "STORAGE_PROVIDER" "$(get_env STORAGE_PROVIDER)" "oss"
  expect_eq "OSS_BUCKET" "$(get_env OSS_BUCKET)" "yikeliao-188-business-hk-test"
  expect_nonempty "OSS_PUBLIC_BASE_URL" "$(get_env OSS_PUBLIC_BASE_URL)"
  expect_nonempty "OSS_MEDIA_SIGNING_KEY" "$(get_env OSS_MEDIA_SIGNING_KEY)"
  prefixes="$(get_env MEDIA_SOURCE_URL_PREFIXES)"
  if [[ -n "$prefixes" ]]; then
    pass "MEDIA_SOURCE_URL_PREFIXES has $(( $(printf '%s' "$prefixes" | tr -cd ',' | wc -c) + 1 )) prefixes"
    for want in https://oss-business.whs188.xin/ https://oss-chat.whs188.xin/; do
      if printf '%s' "$prefixes" | grep -qF "$want"; then pass "  includes $want"; else warn "  missing $want (GC may not protect new-domain objects)"; fi
    done
  else
    fail "MEDIA_SOURCE_URL_PREFIXES is EMPTY"
  fi
  expect_nonempty "GROUP_RETENTION_ADAPTER_URL" "$(get_env GROUP_RETENTION_ADAPTER_URL)"
else
  fail "cannot exec into $API"
fi

section "4. api errors in last 15 min"
if errs="$(docker logs --since 15m "$API" 2>&1 | grep -E 'configuration:|panic|FATAL' | tail -5)" && [[ -n "$errs" ]]; then
  fail "found startup/config errors:"; info "$errs"
else
  pass "no config errors"
fi

section "5. retention bridge reachability"
if docker exec "$API" nc -z -w 3 openim-api 19093 >/dev/null 2>&1; then
  pass "api -> openim-api:19093 reachable"
else
  warn "bridge unreachable (nc missing or bridge down)"
fi

section "6. overlay file (must stay non-empty for OSS_PUBLIC_BASE_URL)"
if [[ -f "$OVERLAY" ]]; then
  pass "overlay exists: $OVERLAY"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$OVERLAY" <<'PY'
import json, sys
try:
    env = json.load(open(sys.argv[1]))['services']['api']['environment']
except Exception as exc:
    print("       cannot parse overlay:", exc); sys.exit(0)
for key in ('OSS_PUBLIC_BASE_URL', 'OSS_MEDIA_SIGNING_KEY', 'GROUP_RETENTION_ADAPTER_KEY', 'MEDIA_SOURCE_URL_PREFIXES'):
    val = env.get(key, '')
    if isinstance(val, str) and val:
        shown = val if key == 'OSS_PUBLIC_BASE_URL' else val[:12] + '...'
        print(f"       {key} = {shown}")
    else:
        print(f"       [FAIL] {key} empty in overlay -> .env cannot win")
PY
  fi
else
  fail "overlay not found: $OVERLAY"
fi

section "7. openim object storage config"
if docker exec "$OPENIM" true >/dev/null 2>&1; then
  cfg="$(docker exec "$OPENIM" grep -E '^\s{4}(bucketURL|publicRead|bucket|endpoint):' /openim-server/config/openim-rpc-third.yml 2>/dev/null)"
  info "$cfg"
  bucket_url="$(printf '%s\n' "$cfg" | sed -n 's/.*bucketURL:[[:space:]]*"\?\([^"]*\)"\?.*/\1/p' | head -1)"
  public_read="$(printf '%s\n' "$cfg" | sed -n 's/.*publicRead:[[:space:]]*//p' | head -1)"
  info "bucketURL=$bucket_url publicRead=$public_read"
  # 只有「CDN 域名」不能当 bucketURL（CDN 不转发 PUT -> 上传挂）；
  # 网关域名 oss-chat-gw.whs188.xin 是允许的：它按方法分流，写请求透传 OSS、读请求 302 到 CDN。
  # 注：网关是历史备选方案，一期最终走的是「CDN 私有回源」（见 docs/聊天桶CDN-方案B上线手册.md）。
  # 这里保留网关判读分支，是因为线上 ECS 可能仍部署着网关，巡检不应把它误报成故障。
  if [[ "$bucket_url" == *"${CHAT_CDN_HOST:-oss-chat.whs188.xin}"* ]]; then
    fail "bucketURL points at the CDN domain -> chat upload breaks, roll back"
  elif [[ "$bucket_url" == *"${CHAT_GW_HOST:-oss-chat-gw.whs188.xin}"* ]]; then
    pass "bucketURL uses the gateway domain (writes bypass to OSS, reads 302 to CDN)"
  elif [[ -n "$bucket_url" ]]; then
    pass "bucketURL keeps the OSS custom domain (chat uploads use it for signing)"
  else
    warn "cannot read bucketURL"
  fi
  expect_eq "publicRead" "$public_read" "false"
else
  fail "cannot exec into $OPENIM"
fi

if docker logs --since 15m "$OPENIM" 2>&1 | grep -E 'panic|FATAL' | tail -3 | grep -q .; then
  fail "openim has panic/FATAL in last 15m"
else
  pass "no panic/FATAL in openim logs"
fi

section "8. business CDN probe (needs arg 1)"
if [[ -z "$BUSINESS_URL" ]]; then
  warn "no business URL given, skipped"
  info "用法: bash deploy/verify-cdn.sh https://oss-business.whs188.xin/im-app-production/business/avatars/xxx.jpg"
else
  hdr="$(curl -s -D - -o /dev/null -m 15 "$BUSINESS_URL" 2>/dev/null | tr -d '\r')"
  code="$(printf '%s\n' "$hdr" | sed -n 's/^HTTP\/[^ ]* \([0-9][0-9][0-9]\).*/\1/p' | tail -1)"
  cache="$(printf '%s\n' "$hdr" | sed -n 's/^[Xx]-[Cc]ache: //p' | tail -1)"
  via="$(printf '%s\n' "$hdr" | sed -n 's/^[Vv]ia: //p' | tail -1)"
  len="$(printf '%s\n' "$hdr" | sed -n 's/^[Cc]ontent-[Ll]ength: //p' | tail -1)"
  info "HTTP=$code  X-Cache=${cache:--}  Via=${via:--}  bytes=${len:--}"
  expect_eq "business CDN status" "$code" "200"
  if [[ "$cache" == HIT* ]]; then pass "edge cache hit"; else warn "not a HIT yet (first request or CDN cache cold)"; fi
  if printf '%s' "$BUSINESS_URL" | grep -qE '[?&](Signature|Expires|OSSAccessKeyId)='; then
    fail "URL carries an OSS signature -> CDN returns 400 InvalidArgument"
  else
    pass "URL is unsigned (required for CDN with private-bucket origin)"
  fi
fi

section "9. chat direct-OSS probe (needs arg 2)"
if [[ -z "$CHAT_URL" ]]; then
  warn "no chat URL given, skipped"
else
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$CHAT_URL" 2>/dev/null)"
  info "HTTP=$code"
  expect_eq "chat object status" "$code" "200"
fi

printf '\n'
if [[ $FAILS -eq 0 ]]; then
  printf '\033[32mAll checks passed.\033[0m\n'
else
  printf '\033[31m%d check(s) failed.\033[0m\n' "$FAILS"
fi
exit $((FAILS > 0))
