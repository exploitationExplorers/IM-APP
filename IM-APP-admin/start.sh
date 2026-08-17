#!/usr/bin/env bash
# ============================================================
# im-app-admin 启动脚本 (Ubuntu)
#
# 用法:
#   ./start.sh          启动（默认）
#   ./start.sh start    启动
#   ./start.sh stop     停止
#   ./start.sh restart  重启
#   ./start.sh status   查看状态
#   ./start.sh build    重新编译最新源码
#
# 行为:
#   - 自动读取同目录 .env（HTTP_ADDR / DATABASE_URL / ADMIN_JWT_SECRET）
#   - 二进制不存在时自动 go build ./cmd/admin
#   - 未配置 ADMIN_JWT_SECRET 时自动生成强密钥写入 .env
#   - 后台运行 + pid 文件 + admin.log 日志 + health 健康检查
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

BIN="$DIR/im-app-admin"
LOG="$DIR/admin.log"
PID_FILE="$DIR/admin.pid"
ENV_FILE="$DIR/.env"

# 从 .env 读取 HTTP_ADDR 得到端口（默认 8090）
get_port() {
  local addr
  addr=$(grep -E '^HTTP_ADDR=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -n "$addr" ]; then
    echo "${addr##*:}"
    return
  fi
  echo "8090"
}

# 读取 .env 中的值（key= 后的内容，去掉引号）
get_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "[ERROR] 缺少 $ENV_FILE，请先 cp .env.example .env 并配置 DATABASE_URL" >&2
    exit 1
  fi
}

ensure_bin() {
  if [ ! -f "$BIN" ]; then
    echo "[INFO] 未找到二进制 $BIN，开始编译..."
    if ! command -v go >/dev/null 2>&1; then
      echo "[ERROR] 未安装 Go，无法编译。请安装 Go 或上传编译好的二进制" >&2
      exit 1
    fi
    go build -o "$BIN" ./cmd/admin || { echo "[ERROR] 编译失败，请检查 go.mod / 源码" >&2; exit 1; }
  fi
}

ensure_jwt() {
  # 新版代码要求：生产模式（GIN_MODE=release/test）下 ADMIN_JWT_SECRET 必须 >=32 字符，否则拒绝启动
  local secret
  secret=$(get_env ADMIN_JWT_SECRET)
  if [ -z "$secret" ]; then
    echo "[INFO] 未配置 ADMIN_JWT_SECRET，自动生成强密钥写入 .env ..."
    if command -v openssl >/dev/null 2>&1; then
      local gen
      gen=$(openssl rand -base64 32 | tr -d '\n')
      printf '\n# 自动生成的管理端 JWT 密钥 (start.sh)\nADMIN_JWT_SECRET=%s\n' "$gen" >> "$ENV_FILE"
      echo "[OK] 已生成 ADMIN_JWT_SECRET"
    else
      echo "[WARN] 无 openssl，请手动在 .env 配置 ADMIN_JWT_SECRET（>=32 字符随机串）" >&2
    fi
  elif [ "${#secret}" -lt 32 ]; then
    local mode
    mode=$(get_env GIN_MODE)
    if [ "$mode" = "release" ] || [ "$mode" = "test" ]; then
      echo "[ERROR] GIN_MODE=$mode 但 ADMIN_JWT_SECRET 过短(<32)，新版会拒绝启动。请在 .env 配置强密钥" >&2
      exit 1
    else
      echo "[WARN] ADMIN_JWT_SECRET 过短(<32)，仅限开发(GIN_MODE=debug)使用" >&2
    fi
  fi
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  ensure_env
  ensure_bin
  ensure_jwt
  if is_running; then
    echo "[INFO] 已在运行 (pid $(cat "$PID_FILE"))"
    return 0
  fi
  local port
  port=$(get_port)
  echo "[INFO] 启动 im-app-admin，监听 :$port (日志: $LOG)"
  nohup "$BIN" >> "$LOG" 2>&1 &
  echo $! > "$PID_FILE"

  # 健康检查：最多等 20 秒
  local ok=0
  for _ in $(seq 1 20); do
    sleep 1
    if curl -sf "http://localhost:$port/api/admin/v1/health" >/dev/null 2>&1; then
      ok=1
      break
    fi
    # 进程提前退出则失败
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      break
    fi
  done

  if [ "$ok" = "1" ]; then
    echo "[OK] 启动成功，端口 $port，健康检查通过"
  else
    echo "[WARN] 健康检查未通过，请查看日志: tail -100 $LOG" >&2
    exit 1
  fi
}

stop() {
  if is_running; then
    local pid
    pid=$(cat "$PID_FILE")
    echo "[INFO] 停止 pid $pid ..."
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "[OK] 已停止"
  else
    echo "[INFO] 未在运行"
  fi
}

restart() {
  stop
  sleep 1
  start
}

status() {
  if is_running; then
    echo "运行中 (pid $(cat "$PID_FILE"))，端口 $(get_port)"
  else
    echo "未运行"
  fi
}

build() {
  ensure_env
  if ! command -v go >/dev/null 2>&1; then
    echo "[ERROR] 未安装 Go" >&2
    exit 1
  fi
  echo "[INFO] 编译最新源码..."
  go build -o "$BIN" ./cmd/admin || { echo "[ERROR] 编译失败" >&2; exit 1; }
  echo "[OK] 编译完成: $BIN"
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  restart) restart ;;
  status) status ;;
  build)  build ;;
  *) echo "用法: $0 {start|stop|restart|status|build}"; exit 1 ;;
esac
