#!/bin/bash
set -euo pipefail

export TZ=UTC

TEMPLATE_PATH="${MANTICORE_TEMPLATE_PATH:-/etc/manticoresearch/manticore.conf.template}"
OUTPUT_PATH="${MANTICORE_CONFIG_PATH:-/etc/manticoresearch/manticore.conf}"
REINDEX_SCRIPT="${MANTICORE_REINDEX_SCRIPT:-/etc/manticoresearch/reindex.sh}"
CRONTAB_FILE="${MANTICORE_CRONTAB_FILE:-/etc/cron.d/manticore}"

validate_required_identifier() {
    local name="$1"
    local val="${2:-}"
    if [ -z "$val" ]; then
        echo "ERROR: Missing required environment variable $name" >&2
        exit 1
    fi
    if [[ "$val" == *$'\n'* || "$val" == *$'\r'* ]]; then
        echo "ERROR: $name must not contain newline characters" >&2
        exit 1
    fi
    if [[ ! "$val" =~ ^[A-Za-z0-9._-]+$ ]]; then
        echo "ERROR: $name contains unsafe characters" >&2
        exit 1
    fi
}

validate_password() {
    local val="${1:-}"
    if [ -z "$val" ]; then
        echo "ERROR: Missing required environment variable DB_PASS" >&2
        exit 1
    fi
    if [[ "$val" == *$'\n'* || "$val" == *$'\r'* ]]; then
        echo "ERROR: DB_PASS must not contain newline characters" >&2
        exit 1
    fi
    if [[ "$val" =~ ^[[:space:]] || "$val" =~ [[:space:]]$ ]]; then
        echo "ERROR: DB_PASS must not have leading or trailing whitespace" >&2
        exit 1
    fi
    if printf '%s' "$val" | LC_ALL=C grep -q '[[:cntrl:]]'; then
        echo "ERROR: DB_PASS must not contain control characters" >&2
        exit 1
    fi
}

escape_manticore_value() {
    local val="$1"
    val="${val//\\/\\\\}"
    val="${val//#/\\#}"
    printf '%s' "$val"
}

DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-}"
DB_PASS="${DB_PASS:-}"
DB_DATABASE="${DB_DATABASE:-}"

validate_required_identifier "DB_HOST" "$DB_HOST"
validate_required_identifier "DB_USER" "$DB_USER"
validate_required_identifier "DB_DATABASE" "$DB_DATABASE"
validate_password "$DB_PASS"

if [[ ! "$DB_PORT" =~ ^[0-9]+$ ]] || [ "$DB_PORT" -lt 1 ] || [ "$DB_PORT" -gt 65535 ]; then
    echo "ERROR: DB_PORT must be a valid TCP port (1-65535)" >&2
    exit 1
fi

if [ ! -f "$TEMPLATE_PATH" ]; then
    echo "ERROR: Manticore config template not found at $TEMPLATE_PATH" >&2
    exit 1
fi

export ESCAPED_HOST="$(escape_manticore_value "$DB_HOST")"
export ESCAPED_PORT="$(escape_manticore_value "$DB_PORT")"
export ESCAPED_USER="$(escape_manticore_value "$DB_USER")"
export ESCAPED_PASS="$(escape_manticore_value "$DB_PASS")"
export ESCAPED_DB="$(escape_manticore_value "$DB_DATABASE")"

mkdir -p "$(dirname "$OUTPUT_PATH")"
awk '
function replace_literal(str, token, replacement,    pos, out) {
    out = ""
    while ((pos = index(str, token)) > 0) {
        out = out substr(str, 1, pos - 1) replacement
        str = substr(str, pos + length(token))
    }
    return out str
}
{
    line = $0
    line = replace_literal(line, "{{DB_HOST}}", ENVIRON["ESCAPED_HOST"])
    line = replace_literal(line, "{{DB_PORT}}", ENVIRON["ESCAPED_PORT"])
    line = replace_literal(line, "{{DB_USER}}", ENVIRON["ESCAPED_USER"])
    line = replace_literal(line, "{{DB_PASS}}", ENVIRON["ESCAPED_PASS"])
    line = replace_literal(line, "{{DB_DATABASE}}", ENVIRON["ESCAPED_DB"])
    print line
}' "$TEMPLATE_PATH" > "$OUTPUT_PATH"

unset ESCAPED_HOST ESCAPED_PORT ESCAPED_USER ESCAPED_PASS ESCAPED_DB

chmod 640 "$OUTPUT_PATH" || true

if [ "${MANTICORE_RENDER_ONLY:-0}" = "1" ]; then
    exit 0
fi

if [ "$(id -u)" = "0" ]; then
    chown manticore:manticore "$OUTPUT_PATH" || true
    mkdir -p /var/lib/manticore /var/log/manticore /var/run/manticore
    find /var/lib/manticore /var/log/manticore /var/run/manticore /etc/manticoresearch /dev/stdout \! -user manticore -exec chown manticore:manticore '{}' + 2>/dev/null || true
fi

if [[ -n "${CREATE_PLAIN_TABLES:-}" && "${CREATE_PLAIN_TABLES}" != "0" ]]; then
    INITIAL_TABLES=()
    CRON_LINES=()

    IFS=';' read -ra ITM <<<"${CREATE_PLAIN_TABLES}"
    for item in "${ITM[@]}"; do
        IFS=':' read -ra LINE <<<"$item"
        table_name="${LINE[0]:-}"
        schedule="${LINE[1]:-}"
        if [ -z "$table_name" ]; then
            continue
        fi
        if [ -z "$schedule" ]; then
            INITIAL_TABLES+=("$table_name")
            continue
        fi
        if [[ ! "$schedule" =~ ^([0-9,\-\/\*]+\ ){4}([0-9,\-\/\*]+)$ ]]; then
            echo "ERROR: Invalid crontab schedule '$schedule' for table '$table_name'" >&2
            exit 1
        fi
        CRON_LINES+=("${schedule} /bin/bash ${REINDEX_SCRIPT} ${table_name} >> /proc/1/fd/1 2>&1")
    done

    if [ "${#CRON_LINES[@]}" -gt 0 ]; then
        {
            echo "SHELL=/bin/bash"
            echo "TZ=UTC"
            echo "PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin"
            for cron_line in "${CRON_LINES[@]}"; do
                echo "$cron_line"
            done
        } > "$CRONTAB_FILE"
        chmod 0644 "$CRONTAB_FILE" || true
        if [ "$(id -u)" = "0" ]; then
            crontab -u manticore "$CRONTAB_FILE"
            pgrep -x cron >/dev/null 2>&1 || cron
        else
            crontab "$CRONTAB_FILE"
            pgrep -x cron >/dev/null 2>&1 || cron -f &
        fi
    fi

    if [ "${#INITIAL_TABLES[@]}" -gt 0 ]; then
        if [ "$(id -u)" = "0" ]; then
            gosu manticore /bin/bash "$REINDEX_SCRIPT" "${INITIAL_TABLES[@]}"
        else
            /bin/bash "$REINDEX_SCRIPT" "${INITIAL_TABLES[@]}"
        fi
    fi
fi

if [ "$#" -eq 0 ]; then
    set -- searchd --nodetach
fi

if [ "$(id -u)" = "0" ] && { [ "$1" = "searchd" ] || [ "$1" = "indexer" ]; }; then
    exec gosu manticore "$@"
fi

exec "$@"
