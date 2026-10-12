#!/usr/bin/env bash
# 每周兜底：截断过大的 Docker json-file 日志，防止磁盘再次写满。
# 主防护仍是 compose / daemon.json 的 max-size；本脚本只处理漏网的大文件。
set -euo pipefail

THRESHOLD_BYTES=$((100 * 1024 * 1024)) # 超过 100MB 才截断
LOG_GLOB="/var/lib/docker/containers/*/*-json.log"
TRIMMED=0

shopt -s nullglob
for f in $LOG_GLOB; do
  size=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$size" -gt "$THRESHOLD_BYTES" ]; then
    truncate -s 0 "$f"
    TRIMMED=$((TRIMMED + 1))
    echo "$(date -Is) trimmed $f (was ${size} bytes)"
  fi
done

echo "$(date -Is) done, trimmed=$TRIMMED"
df -h / | tail -1
