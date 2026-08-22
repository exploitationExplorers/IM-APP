#!/usr/bin/env bash
set -euo pipefail

require_testdata_tools() {
  command -v curl >/dev/null || { echo '缺少 curl' >&2; return 1; }
  command -v jq >/dev/null || { echo '缺少 jq' >&2; return 1; }
}

api_call() {
  local method="$1" url="$2" body="${3:-}" token="${4:-}"
  local args=(-sS -X "$method" -H 'Content-Type: application/json') response
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body" ]] && args+=(--data "$body")
  response="$(curl "${args[@]}" "$url")" || return 1
  if ! jq -e '.code == 0' >/dev/null <<<"$response"; then
    jq -r '"API failed: " + (.message // .msg // "unknown error")' <<<"$response" >&2
    return 1
  fi
  jq -c '.data' <<<"$response"
}

get_or_create_test_user() {
  local base_url="$1" phone="$2" password="$3" device="testdata-$phone"
  local sms auth im code
  if sms="$(api_call POST "$base_url/api/v1/auth/sms/send" "$(jq -nc --arg p "$phone" --arg d "$device" '{countryCode:"+86",phone:$p,scene:"register",deviceId:$d}')")" \
    && code="$(jq -r '.devCode // empty' <<<"$sms")" \
    && [[ -n "$code" ]] \
    && auth="$(api_call POST "$base_url/api/v1/auth/register" "$(jq -nc --arg p "$phone" --arg c "$code" --arg pw "$password" --arg d "$device" '{countryCode:"+86",phone:$p,code:$c,password:$pw,deviceId:$d}')")"; then
    :
  else
    auth="$(api_call POST "$base_url/api/v1/auth/login" "$(jq -nc --arg p "$phone" --arg pw "$password" --arg d "$device" '{countryCode:"+86",phone:$p,password:$pw,deviceId:$d}')")"
  fi
  local access_token
  access_token="$(jq -r '.accessToken' <<<"$auth")"
  im="$(api_call POST "$base_url/api/v1/im/token" '{"platformId":5}' "$access_token")"
  jq -e '.userId and .token' >/dev/null <<<"$im" || { echo "用户 $phone 未完成 OpenIM 注册/取 token" >&2; return 1; }
  jq -nc --arg phone "$phone" --arg password "$password" \
    --arg userId "$(jq -r '.user.id' <<<"$auth")" --arg publicId "$(jq -r '.user.publicId' <<<"$auth")" \
    --arg accessToken "$access_token" --arg imUserId "$(jq -r '.userId' <<<"$im")" \
    '{phone:$phone,password:$password,userId:$userId,publicId:$publicId,accessToken:$accessToken,imUserId:$imUserId,openIMTokenVerified:true}'
}
