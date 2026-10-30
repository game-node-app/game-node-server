#!/usr/bin/env bash
# Run once inside the empty managed production MySQL container; see the infrastructure report, section 6.3.
# Not idempotent on purpose: CREATE fails on a provisioned instance instead of touching existing users.
(
    set -eo pipefail
    : "${MYSQL_USER:?}" "${MYSQL_ROOT_PASSWORD:?}" "${SUPERTOKENS_DB_USER:?}" "${SUPERTOKENS_DB_PASS:?}" "${CMS_DB_PASSWORD:?}"

    if ! declare -F docker_process_sql >/dev/null; then
        docker_process_sql() { MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot; }
    fi

    for user in "$MYSQL_USER" "$SUPERTOKENS_DB_USER"; do
        if [[ ! "$user" =~ ^[A-Za-z0-9_]{1,32}$ || "$user" == root || "$user" == blog_cms ]]; then
            echo 'Database users must be valid non-root names distinct from blog_cms' >&2
            exit 1
        fi
    done
    if [[ "$MYSQL_USER" == "$SUPERTOKENS_DB_USER" ]]; then
        echo 'GameNode and SuperTokens must use distinct database users' >&2
        exit 1
    fi

    docker_process_sql <<SQL
SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES';
CREATE DATABASE supertokens;
CREATE DATABASE blog_cms;
CREATE USER '$SUPERTOKENS_DB_USER'@'%' IDENTIFIED BY '${SUPERTOKENS_DB_PASS//\'/\'\'}';
GRANT ALL ON supertokens.* TO '$SUPERTOKENS_DB_USER'@'%';
CREATE USER 'blog_cms'@'%' IDENTIFIED BY '${CMS_DB_PASSWORD//\'/\'\'}';
GRANT ALL ON \`blog\_cms\`.* TO 'blog_cms'@'%';
SQL
)
