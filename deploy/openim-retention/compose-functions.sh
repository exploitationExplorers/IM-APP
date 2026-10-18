# Source this file in Bash. It defines functions only; it never starts a service.
# Keep the PREVIOUS OSS override between the original Compose and this release.
RETENTION_BUNDLE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

_retention_business() {
  local phase="$1"
  shift
  local -a files=(-f "$RETENTION_BUNDLE/api.install.compose.json")
  case "$phase" in
    install) ;;
    canary) files+=(-f "$RETENTION_BUNDLE/api.canary.compose.json") ;;
    enable) files+=(-f "$RETENTION_BUNDLE/api.enable.compose.json") ;;
    *) echo 'Unknown retention phase' >&2; return 1 ;;
  esac
  docker --host=unix:///var/run/docker.sock compose \
    --project-directory /www/wwwroot/deploy \
    --env-file /www/wwwroot/deploy/.env \
    --env-file "$RETENTION_BUNDLE/private/retention.env" \
    --project-name im-app \
    -f /www/wwwroot/deploy/docker-compose.yml \
    -f /root/im-app-oss-production/oss-production-bundle/private/api.compose.json \
    "${files[@]}" "$@"
}

retention_api_install() { _retention_business install "$@"; }
retention_api_canary() { _retention_business canary "$@"; }
retention_api_enable() { _retention_business enable "$@"; }

retention_openim() {
  docker --host=unix:///var/run/docker.sock compose \
    --project-directory /www/wwwroot/deploy/openim \
    --env-file /www/wwwroot/deploy/.env \
    --env-file "$RETENTION_BUNDLE/private/retention.env" \
    --project-name openim \
    -f /www/wwwroot/deploy/openim/docker-compose.yml \
    -f /root/im-app-oss-production/oss-production-bundle/private/openim.compose.json \
    -f "$RETENTION_BUNDLE/openim.bridge.compose.json" "$@"
}
