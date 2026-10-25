#!/usr/bin/env bash
# Production entry point. Never run a full-stack up/down or restart data services.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-help}"
[[ "$EUID" == 0 && "${HOSTNAME,,}" == izbp15qkzomsmdhdmtx27dz ]] || { echo 'Run on the known backend as root only' >&2; exit 1; }
if [[ "$ACTION" == inspect ]]; then
  HELPER="$HERE/openim-retention/prepare-production.py"
  [[ -f "$HELPER" ]] || HELPER="$HERE/prepare-production.py"
  exec python3 "$HELPER" inspect
fi
if [[ $# -lt 2 ]]; then
  echo 'Usage: bash production.sh {prepare|build|up-openim|up-api|verify|canary|enable|disable} /root/im-app-retention/RELEASE [argument]'
  echo 'Read PRODUCTION.md first. enable also requires --accept-full-group-retention.'
  exit 1
fi
RELEASE="$(realpath -e -- "$2")"
[[ "$RELEASE" == /root/im-app-retention/* ]] || { echo 'Release must be under /root/im-app-retention/' >&2; exit 1; }
if [[ "$ACTION" == prepare ]]; then
  exec python3 "$RELEASE/prepare-production.py" prepare "${@:3}"
fi
if [[ "$ACTION" == verify ]]; then
  exec python3 "$RELEASE/prepare-production.py" verify
fi
[[ -f "$RELEASE/private/images.env" && -f "$RELEASE/private/retention.env" ]] || { echo 'Run prepare first' >&2; exit 1; }
# This generated file contains only image IDs/tags, NOT the bridge or RAM keys.
source "$RELEASE/private/images.env"
source "$RELEASE/compose-functions.sh"
case "$ACTION" in
  build)
    for image in "$BASE_API_IMAGE" "$BASE_OPENIM_IMAGE"; do
      [[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Invalid pinned base image' >&2; exit 1; }
    done
    for image in "$RETENTION_API_IMAGE" "$RETENTION_OPENIM_IMAGE"; do
      [[ "$image" =~ ^im-app-retention-(api|openim):[0-9a-f-]+$ ]] || { echo 'Invalid release image tag' >&2; exit 1; }
    done
    d() { docker --host=unix:///var/run/docker.sock "$@"; }
    API_BASE="im-app-retention-base-api:${RETENTION_API_IMAGE##*:}"
    OPENIM_BASE="im-app-retention-base-openim:${RETENTION_OPENIM_IMAGE##*:}"
    d image tag "$BASE_API_IMAGE" "$API_BASE"
    d image tag "$BASE_OPENIM_IMAGE" "$OPENIM_BASE"
    d build --pull=false --network=none --build-arg "BASE_IMAGE=$API_BASE" \
      -f "$RELEASE/api.Dockerfile" -t "$RETENTION_API_IMAGE" "$RELEASE"
    d build --pull=false --network=none --build-arg "BASE_IMAGE=$OPENIM_BASE" \
      -f "$RELEASE/openim.Dockerfile" -t "$RETENTION_OPENIM_IMAGE" "$RELEASE"
    echo 'RETENTION_IMAGES_BUILT: services_not_restarted'
    ;;
  up-openim)
    retention_openim config --quiet
    retention_openim up -d --no-deps --no-build --pull never openim-api
    ;;
  up-api)
    retention_api_install config --quiet
    retention_api_install up -d --no-deps --no-build --pull never api
    echo 'RETENTION_API_WORKER_ON: all_groups; media_reference_guard_on; GC_activation_after_verify'
    ;;
  disable)
    python3 "$RELEASE/cleanup-production.py" disable-gc
    retention_api_disable config --quiet
    retention_api_disable up -d --no-deps --no-build --pull never api
    echo 'RETENTION_TASKS_OFF: reference_guards_and_published_boundaries_retained'
    ;;
  canary)
    python3 "$RELEASE/prepare-production.py" verify
    retention_api_canary config --quiet
    retention_api_canary up -d --no-deps --no-build --pull never api
    ;;
  enable)
    [[ "${3:-}" == --accept-full-group-retention ]] || { echo 'Complete ACCEPTANCE.md, then explicitly pass --accept-full-group-retention' >&2; exit 1; }
    python3 "$RELEASE/prepare-production.py" verify
    retention_api_enable config --quiet
    retention_api_enable up -d --no-deps --no-build --pull never api
    ;;
  *) echo 'Unknown action; nothing deployed' >&2; exit 1 ;;
esac
