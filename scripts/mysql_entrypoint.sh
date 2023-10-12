#!/bin/bash

set -e

mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS supertokens;"

exec "$@"