#!/bin/bash
# Enhanced MySQL backup script (multi-instance, env-driven)
# Works great with Dockerized MySQL in a shared network (e.g. game_node_app)

set -euo pipefail
IFS=$'\n\t'

# === CONFIGURATION ===

# Current date for unique backup filenames
DATE=$(date +%F-%H%M%S)

# Backup directory on host
BACKUP_DIR="${BACKUP_DIR:-/var/local/backups/sql}"
mkdir -p "$BACKUP_DIR"

# Docker network shared by both DB containers
NETWORK="${NETWORK:-game_node_app}"

# Docker MySQL image used for dumping
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.3}"

# Rclone config (optional)
RCLONE_CONFIG_NAME="${RCLONE_CONFIG_NAME:-cloudflare}"
RCLONE_BUCKET_NAME="${RCLONE_BUCKET_NAME:-gamenode-sql-backup}"

# === DATABASES TO BACKUP ===
# These must be passed via environment variables in crontab, e.g.:
# DB1_NAME=gamenode DB1_USER=root DB1_PASS=pass DB1_HOST=db
# DB2_NAME=supertokens DB2_USER=root DB2_PASS=pass DB2_HOST=supertokens_db
# and so on.

declare -A DBS=(
  ["$DB1_NAME"]="$DB1_USER:$DB1_PASS@$DB1_HOST"
)

# Add second database if defined
if [[ -n "${DB2_NAME:-}" && -n "${DB2_USER:-}" && -n "${DB2_PASS:-}" && -n "${DB2_HOST:-}" ]]; then
  DBS["$DB2_NAME"]="$DB2_USER:$DB2_PASS@$DB2_HOST"
fi

# === BACKUP LOOP ===

for DB_NAME in "${!DBS[@]}"; do
  echo "🔹 Backing up database: $DB_NAME"

  CREDENTIALS="${DBS[$DB_NAME]}"
  DB_USER="${CREDENTIALS%%:*}"
  REST="${CREDENTIALS#*:}"
  DB_PASS="${REST%%@*}"
  DB_HOST="${REST#*@}"

  BACKUP_FILENAME="$BACKUP_DIR/${DB_NAME}-${DATE}.sql"
  COMPRESSED_BACKUP_FILENAME="${BACKUP_FILENAME}.zst"

  # Maximum number of retries
  MAX_RETRIES=3
  RETRY_DELAY=5  # seconds between attempts

  # Dump DB using Dockerized MySQL client with retries
  SUCCESS=false
  for ((i=1; i<=MAX_RETRIES; i++)); do
      echo "🔹 Attempt $i: Backing up database $DB_NAME..."
      if docker run --rm --network "$NETWORK" "$MYSQL_IMAGE" \
          mysqldump --compact --single-transaction --quick --lock-tables=false \
          -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" > "$BACKUP_FILENAME"; then
          SUCCESS=true
          break
      else
          echo "⚠️ Backup attempt $i failed."
          if [[ $i -lt $MAX_RETRIES ]]; then
              echo "⏳ Retrying in $RETRY_DELAY seconds..."
              sleep $RETRY_DELAY
          fi
      fi
  done

  if [[ "$SUCCESS" != true ]]; then
      echo "❌ Failed to backup database $DB_NAME after $MAX_RETRIES attempts. Exiting."
      exit 1
  fi

  # Compress with 2 threads
  zstd -9 -T2 "$BACKUP_FILENAME" -o "$COMPRESSED_BACKUP_FILENAME"

  # Remove uncompressed dump
  rm -f "$BACKUP_FILENAME"

  echo "✅ Backup complete: $COMPRESSED_BACKUP_FILENAME"

  # Upload to R2 via rclone if enabled
  if [[ "${UPLOAD_TO_RCLONE:-false}" == "true" ]]; then
    echo "☁️ Uploading $COMPRESSED_BACKUP_FILENAME to R2..."
    rclone copy "$COMPRESSED_BACKUP_FILENAME" "${RCLONE_CONFIG_NAME}:${RCLONE_BUCKET_NAME}" \
      --quiet --s3-no-check-bucket
  fi

  # Optionally remove local copy after upload
  if [[ "${CLEANUP_LOCAL:-false}" == "true" ]]; then
    echo "🧹 Removing local backup $COMPRESSED_BACKUP_FILENAME"
    rm -f "$COMPRESSED_BACKUP_FILENAME"
  fi
done

# === Cleanup old backups (older than 14 days) ===
# From local files
echo "🗑️ Removing local backups older than 14 days in $BACKUP_DIR..."
find "$BACKUP_DIR" -type f -name "*.zst" -mtime +14 -exec rm -f {} \;
# From RCLONE
echo "🗑️ Removing bucket backups older than 14 days in ${RCLONE_CONFIG_NAME}:${RCLONE_BUCKET_NAME}..."
rclone delete --min-age 14d "${RCLONE_CONFIG_NAME}:${RCLONE_BUCKET_NAME}"

echo "🎉 All backups completed successfully."