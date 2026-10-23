#!/bin/sh
set -eu

# Runs only inside a newly initialized test PostgreSQL volume.
test "$POSTGRES_DB" = 'imapp_oss_test'
test "$POSTGRES_USER" = 'oss_test_admin'
: "${TEST_PG_APP_PASSWORD:?test application password is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$TEST_PG_APP_PASSWORD" <<'SQL'
CREATE ROLE im_oss_test LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE imapp_oss_test OWNER TO im_oss_test;
REVOKE ALL ON DATABASE imapp_oss_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE imapp_oss_test TO im_oss_test;
SQL
