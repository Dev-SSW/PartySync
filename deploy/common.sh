#!/usr/bin/env bash
# Container command variables must expand inside the container, not on the host.
# shellcheck disable=SC2016
set -euo pipefail
umask 077
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
env_file=${PARTYSYNC_ENV_FILE:-$repo_root/deploy/.env.prod}
[[ -f "$env_file" ]] || { echo 'Production environment file is missing.' >&2; exit 1; }
compose=(docker compose --project-directory "$repo_root" --env-file "$env_file" -f "$repo_root/compose.prod.yaml")
backup_dir=${BACKUP_DIR:-$repo_root/deploy/backups}
state_dir=${STATE_DIR:-$repo_root/deploy/state}

# PostgreSQL credentials remain inside the explicitly authorized DB container.
app_query() {
  "${compose[@]}" exec -T postgres sh -ec 'export PGPASSWORD="$(cat /run/secrets/DB_PASSWORD)"; exec psql -X -h 127.0.0.1 -U "$APP_DB_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "$1"' sh "$1"
}
