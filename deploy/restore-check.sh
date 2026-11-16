#!/usr/bin/env bash
# Container command variables must expand inside the container, not on the host.
# shellcheck disable=SC2016
set -euo pipefail
# shellcheck source=deploy/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
archive=${1:?Usage: bash deploy/restore-check.sh path-to-backup.dump}
[[ -f "$archive" && -f "$archive.sha256" ]] || { echo 'Backup/checksum is missing.' >&2; exit 1; }
(cd -- "$(dirname -- "$archive")" && sha256sum -c "${archive##*/}.sha256")
scratch="partysync_restore_$(date -u +%s)_$$_test"
[[ "$scratch" =~ ^partysync_restore_[0-9]+_[0-9]+_test$ ]] || exit 1
created=false
cleanup() {
  if [[ "$created" == true ]]; then
    "${compose[@]}" exec -T postgres sh -ec 'test "$1" != "$POSTGRES_DB"; export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --if-exists "$1"' sh "$scratch"
  fi
}
trap cleanup EXIT
"${compose[@]}" exec -T postgres sh -ec 'test "$1" != "$POSTGRES_DB"; export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec createdb -h 127.0.0.1 -U "$POSTGRES_USER" -O "$APP_DB_USER" "$1"' sh "$scratch"
created=true
"${compose[@]}" exec -T postgres sh -ec 'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" --role="$APP_DB_USER" --dbname="$1" --no-owner --no-acl --single-transaction --exit-on-error' sh "$scratch" < "$archive"
"${compose[@]}" exec -T postgres sh -ec 'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec psql -X -h 127.0.0.1 -U "$POSTGRES_USER" -d "$1" -At -v ON_ERROR_STOP=1 -c "select count(*) from flyway_schema_history where success; select count(*) from groups; select count(*) from group_member;"' sh "$scratch"
echo 'Restore succeeded in an isolated disposable test database; production data was not overwritten.'
