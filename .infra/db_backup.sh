#!/bin/bash
# This is a sample backup script for your MySQL database.
# There's probably a hundred better ways to do it, but this + a simple cronjob does the job most of the time.

# Current date in YYYY-MM-DD-HHMMSS format for unique backup filenames
DATE=$(date +%F-%H%M%S)

# Backup directory on the host
BACKUP_DIR="~/backups/sql"

# Database credentials and details
DB_HOST="localhost" #hostname of the mysql container
DB_USER="root"
DB_PASSWORD="root"
DB_NAME="gamenode"
NETWORK="your_network" #name of the network where mysql container is running. You can check the list of the docker neworks using doocker network ls

# Docker image version of MySQL
MYSQL_IMAGE="mysql:8.3"

# Backup filename
BACKUP_FILENAME="$BACKUP_DIR/$DB_NAME-$DATE.sql"

# Run mysqldump within a new Docker container
docker run --rm --network $NETWORK $MYSQL_IMAGE mysqldump -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME > $BACKUP_FILENAME

# Compress the backup file
gzip $BACKUP_FILENAME

# Removes backup file after compression
rm $BACKUP_FILENAME

# Removes files older than X (30) days in backup folder
find $BACKUP_DIR -type f -mtime +30 | xargs rm