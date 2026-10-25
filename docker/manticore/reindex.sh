#!/bin/bash
set -euo pipefail

export TZ=UTC

if [ "$(id -u)" = "0" ] && [ "${MANTICORE_SKIP_GOSU:-0}" != "1" ] && command -v gosu >/dev/null 2>&1 && id -u manticore >/dev/null 2>&1; then
    exec gosu manticore /bin/bash "$0" "$@"
fi

DEFAULT_LOCK_DIR="/var/run/manticore"
if [ ! -d "$DEFAULT_LOCK_DIR" ] || [ ! -w "$DEFAULT_LOCK_DIR" ]; then
    DEFAULT_LOCK_DIR="/tmp"
fi
LOCK_FILE="${MANTICORE_INDEX_LOCK_FILE:-${DEFAULT_LOCK_DIR}/manticore-indexer.lock}"
CONFIG_FILE="${MANTICORE_CONFIG_FILE:-/etc/manticoresearch/manticore.conf}"

if [ "$#" -eq 0 ]; then
    set -- games users
fi

for table in "$@"; do
    case "$table" in
        games|users)
            ;;
        *)
            echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") [manticore-reindex] ERROR: unsupported index table '$table' (allowed: games, users)" >&2
            exit 1
            ;;
    esac
done

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") [manticore-reindex] ERROR: another index rebuild is already in progress (lock: $LOCK_FILE)" >&2
    exit 1
fi

if [[ "${MANTICORE_REINDEX_HOLD_SECONDS:-0}" =~ ^[0-9]+$ ]] && [ "${MANTICORE_REINDEX_HOLD_SECONDS:-0}" -gt 0 ]; then
    sleep "${MANTICORE_REINDEX_HOLD_SECONDS}"
fi

rotate_flags=()
if [ -f /var/run/manticore/searchd.pid ] && kill -0 "$(cat /var/run/manticore/searchd.pid 2>/dev/null || echo 0)" 2>/dev/null; then
    rotate_flags=(--rotate)
elif [ "${MANTICORE_FORCE_ROTATE:-0}" = "1" ]; then
    rotate_flags=(--rotate)
fi

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") [manticore-reindex] Starting index build for: $* ${rotate_flags[*]:-}"

set +e
output=$(cd /var/lib/manticore && indexer --config "$CONFIG_FILE" "${rotate_flags[@]}" "$@" 2>&1)
status=$?
set -e

while IFS= read -r line; do
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") [manticore-reindex] $line"
done <<< "$output"

if [ "$status" -ne 0 ] || echo "$output" | grep -Eq "FATAL:|ERROR:"; then
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") [manticore-reindex] ERROR: index build failed for: $*" >&2
    exit 1
fi

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") [manticore-reindex] Completed index build for: $*"
