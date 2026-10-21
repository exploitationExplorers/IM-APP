#!/usr/bin/env bash
# One-command rebuild and redeploy for the im-app api.
#
# The production loop is now only two steps:
#   1. upload or edit the sources under /www/wwwroot/IM-APP-server
#   2. bash deploy/redeploy.sh
# No git on the server is required.
#
# It never pushes to a registry: the image is built on this host, tagged with the
# name the running container already uses, and the old tag is kept as
# <name>:rollback-<timestamp> so you can go back with --rollback.
#
# Usage (source is uploaded manually, no git required):
#   bash deploy/redeploy.sh                 deploy api
#   bash deploy/redeploy.sh --force         rebuild even if nothing looks newer
#   bash deploy/redeploy.sh --offline       build with --network=none (BuildKit cache only)
#   bash deploy/redeploy.sh --rollback      go back to the previous image tag
#   bash deploy/redeploy.sh --help
#
# Environment overrides:
#   REDEPLOY_OVERLAY   api compose overlay (default /root/im-app-oss-production/oss-production-bundle/private/api.compose.json)
#   REDEPLOY_CONTAINER container name (default im-app-api)
#   REDEPLOY_SOURCE      directory holding IM-APP-server sources (default ../IM-APP-server)
#   REDEPLOY_COMPOSE_DIR directory holding docker-compose.yml (default the script's own dir)

set -euo pipefail

SELF="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SELF/.." && pwd)"
OVERLAY="${REDEPLOY_OVERLAY:-/root/im-app-oss-production/oss-production-bundle/private/api.compose.json}"
CONTAINER="${REDEPLOY_CONTAINER:-im-app-api}"
HEALTH_URL="${REDEPLOY_HEALTH:-http://127.0.0.1:8080/health}"
COMPOSE_DIR="${REDEPLOY_COMPOSE_DIR:-$SELF}"
SOURCE_DIR="${REDEPLOY_SOURCE:-$ROOT/IM-APP-server}"
STAMP="$(date +%Y%m%d-%H%M%S)"

ACTION="deploy"
FORCE=0
OFFLINE=0
for arg in "$@"; do
  case "$arg" in
    --help|-h) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
    --force) FORCE=1 ;;
    --offline) OFFLINE=1 ;;
    --rollback) ACTION="rollback" ;;
    all) ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

die() { printf '\033[31m[ABORT]\033[0m %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok() { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$*"; }

[[ "$(id -u)" == 0 ]] || die "run as root"

step "0. preflight"
command -v docker >/dev/null || die "docker not found"
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found"
[[ -f "$OVERLAY" ]] || die "overlay missing: $OVERLAY"
[[ -f "$SOURCE_DIR/Dockerfile" ]] || die "api Dockerfile missing: $SOURCE_DIR/Dockerfile (set REDEPLOY_SOURCE)"
ok "docker + compose + overlay present"

# Fail fast before anything else: the container would otherwise restart-loop.
python3 - "$OVERLAY" <<'PY' || die "overlay is missing required OSS/retention values"
import json, sys
env = json.load(open(sys.argv[1])).get('services', {}).get('api', {}).get('environment', {})
required = ['OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_PUBLIC_BASE_URL',
            'OSS_MEDIA_SIGNING_KEY', 'GROUP_RETENTION_ADAPTER_URL', 'GROUP_RETENTION_ADAPTER_KEY']
missing = [k for k in required if not str(env.get(k, '')).strip()]
if missing:
    print("missing in overlay:", ', '.join(missing), file=sys.stderr)
    print("hint: overlay wins over .env, fill these here not in .env", file=sys.stderr)
    sys.exit(1)
print("       overlay required keys present")
PY

CURRENT="$(docker inspect "$CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || true)"
[[ -n "$CURRENT" ]] || die "cannot read current image from container $CONTAINER"
case "$CURRENT" in
  *@sha256:*|*:*) ;;
  *) CURRENT="$CURRENT:latest" ;;
esac
IMG_NAME="${CURRENT%%:*}"
IMG_TAG="${CURRENT##*:}"
[[ -n "$IMG_NAME" && -n "$IMG_TAG" ]] || die "cannot derive image name/tag from '$CURRENT'"
ok "current image = $CURRENT"

if [[ "$ACTION" == "rollback" ]]; then
  step "rollback"
  PREV="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^${IMG_NAME}:rollback-" | sort | tail -1 || true)"
  [[ -n "$PREV" ]] || die "no rollback tag found for $IMG_NAME"
  docker tag "$PREV" "$CURRENT"
  (cd "$COMPOSE_DIR" && docker compose --project-directory "$COMPOSE_DIR" --env-file "$COMPOSE_DIR/.env" \
    --project-name im-app -f "$COMPOSE_DIR/docker-compose.yml" -f "$OVERLAY" \
    up -d --no-deps --no-build --pull never --force-recreate api)
  sleep 8
  docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}'
  curl -s -o /dev/null -w "health=%{http_code}\n" "$HEALTH_URL"
  ok "rolled back to $PREV"
  exit 0
fi

step "1. source freshness (did you forget to upload?)"
# newest mtime across things that actually end up in the binary
SRC_EPOCH="$(find "$SOURCE_DIR" -type f \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' \
  -o -name 'Dockerfile' \) -printf '%T@\n' 2>/dev/null | sort -n | tail -1)"
SRC_EPOCH="${SRC_EPOCH%.*}"
[[ -n "$SRC_EPOCH" ]] || die "no go sources found under $SOURCE_DIR (wrong REDEPLOY_SOURCE?)"
ok "newest source file: $(date -d "@$SRC_EPOCH" '+%Y-%m-%d %H:%M:%S')"

IMG_CREATED="$(docker image inspect "$CURRENT" --format '{{.Created}}' 2>/dev/null || true)"
if [[ -n "$IMG_CREATED" ]]; then
  IMG_EPOCH="$(date -d "${IMG_CREATED%%.*}Z" '+%s' 2>/dev/null || echo 0)"
  ok "current image built: $(date -d "@$IMG_EPOCH" '+%Y-%m-%d %H:%M:%S')"
  if (( SRC_EPOCH <= IMG_EPOCH )) && (( FORCE == 0 )); then
    printf '\033[33m[WARN]\033[0m 源码不比当前镜像新 —— 你多半**忘了上传**，重建出来的还是同一份代码。\n'
    printf '       确认就是要重建，加 --force；否则先传代码再来。\n'
    exit 3
  fi
  (( FORCE == 1 )) && ok "--force given, rebuilding anyway"
fi

step "2. keep a rollback tag"
if docker image inspect "$CURRENT" >/dev/null 2>&1; then
  docker tag "$CURRENT" "$IMG_NAME:rollback-$STAMP" && ok "rollback tag = $IMG_NAME:rollback-$STAMP"
else
  warn "current image not present locally; nothing to roll back to"
fi

step "3. build on this host"
BUILD_TAG="$IMG_NAME:$STAMP"
NET_ARGS=()
[[ "$OFFLINE" == 1 ]] && NET_ARGS=(--network none)
if docker build "${NET_ARGS[@]+"${NET_ARGS[@]}"}" \
      -f "$SOURCE_DIR/Dockerfile" -t "$BUILD_TAG" "$SOURCE_DIR"; then
  ok "built $BUILD_TAG"
else
  cat <<MSG
Build failed. Almost always one of these:
  1) base images missing -> pull them once (see the footer of this script)
  2) go mod download / apk add need network but none is reachable
  2) go mod download / apk add need network but none is reachable
  3) Dockerfile or go.mod changed, so the BuildKit cache no longer covers it
MSG
  die "docker build failed"
fi

step "4. switch the pinned tag to the new image"
docker tag "$BUILD_TAG" "$CURRENT"
ok "$CURRENT now points at $BUILD_TAG"

step "5. recreate"
cd "$COMPOSE_DIR"
docker compose --project-directory "$COMPOSE_DIR" --env-file "$COMPOSE_DIR/.env" \
  --project-name im-app -f "$COMPOSE_DIR/docker-compose.yml" -f "$OVERLAY" \
  up -d --no-deps --no-build --pull never --force-recreate api

step "6. verify"
for _ in $(seq 1 20); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
  [[ "$status" == healthy ]] && break
  sleep 3
done
docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}  {{.Image}}'
code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || echo 000)"
[[ "$code" == 200 ]] || die "health check returned $code; docker logs $CONTAINER"
ok "health = $code"
if docker logs --since 3m "$CONTAINER" 2>&1 | grep -qE 'configuration:|panic'; then
  warn "config errors in the last 3 minutes - here they are:"
  docker logs --since 3m "$CONTAINER" 2>&1 | grep -E 'configuration:|panic' | tail -5
else
  ok "no config errors"
fi

cat <<MSG

Done. Next:
  bash deploy/verify-cdn.sh <any https://oss-business.<domain>/... object url>

--------------------------------------------------------------------------
base images (only needed the first time, or after bumping go/alpine):
--------------------------------------------------------------------------
  docker pull golang:1.25-alpine
  docker pull alpine:3.20
  # keep an offline copy so a future registry outage cannot block a deploy:
  docker save golang:1.25-alpine alpine:3.20 -o /root/im-app-base-images.tar
  # restore later with:  docker load -i /root/im-app-base-images.tar
After the first successful build the apk/go layers live in the BuildKit cache,
so ordinary rebuilds need no network. Use --offline to prove it.
MSG
