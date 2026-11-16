#!/bin/sh
set -eu
# Runs only for a new, empty PostgreSQL volume. Existing data is never reinitialized.
case "$APP_DB_USER" in
  ''|*[!a-z0-9_]*|[0-9_]*|pg_*|postgres|public) echo 'Use a dedicated lower-case application role name.' >&2; exit 1 ;;
esac
test "$APP_DB_USER" != "$POSTGRES_USER" && test "${#APP_DB_USER}" -le 63
APP_PASSWORD=$(cat /run/secrets/DB_PASSWORD)
test -n "$APP_PASSWORD"
export APP_PASSWORD
# Even a bootstrap SQL error must not log the password-bearing statement.
PGOPTIONS='-c log_min_error_statement=panic -c log_statement=none' \
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=app_user="$APP_DB_USER" --set=app_db="$POSTGRES_DB" <<'SQL'
\getenv app_password APP_PASSWORD
CREATE ROLE :"app_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
ALTER DATABASE :"app_db" OWNER TO :"app_user";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
SQL
unset APP_PASSWORD
