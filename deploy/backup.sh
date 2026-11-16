#!/usr/bin/env bash
# Container command variables must expand inside the container, not on the host.
# shellcheck disable=SC2016
set -euo pipefail
# shellcheck source=deploy/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
mkdir -p -- "$backup_dir"
chmod 700 -- "$backup_dir"
temporary=$(mktemp "$backup_dir/.pending.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
"${compose[@]}" exec -T postgres sh -ec 'export PGPASSWORD="$(cat /run/secrets/DB_PASSWORD)"; exec pg_dump -h 127.0.0.1 -U "$APP_DB_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$temporary"
test -s "$temporary"
"${compose[@]}" exec -T postgres pg_restore --list < "$temporary" > /dev/null
archive="$backup_dir/partysync-$(date -u +%Y%m%dT%H%M%SZ)-${temporary##*.}.dump"
mv -- "$temporary" "$archive"
chmod 600 -- "$archive"
(cd -- "$backup_dir" && sha256sum "${archive##*/}" > "${archive##*/}.sha256")
# Optional executable supplied by the operator, e.g. encrypted off-server upload.
if [[ -n ${BACKUP_EXPORT_HOOK:-} ]]; then
  [[ -x "$BACKUP_EXPORT_HOOK" ]] || { echo 'Backup export hook is not executable.' >&2; exit 1; }
  "$BACKUP_EXPORT_HOOK" "$archive" "$archive.sha256"
fi
days=${BACKUP_RETENTION_DAYS:-14}
[[ "$days" =~ ^[1-9][0-9]{0,3}$ ]] || { echo 'Invalid retention days.' >&2; exit 1; }
# Only dated backup artifacts in this private backup directory are eligible for retention.
find "$backup_dir" -maxdepth 1 -type f \( -name 'partysync-*.dump' -o -name 'partysync-*.dump.sha256' \) -mtime "+$days" -delete
printf 'Backup created: %s\n' "$archive"
