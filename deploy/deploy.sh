#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
tag=${1:?Usage: bash deploy/deploy.sh verified-main-commit-sha}
[[ "$tag" =~ ^[a-f0-9]{40}$ ]] || { echo 'Use a full verified commit SHA.' >&2; exit 1; }
export IMAGE_TAG=$tag
mkdir -p -- "$state_dir"
exec 9>"$state_dir/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
"${compose[@]}" config --quiet
site=$("${compose[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["reverse-proxy"]["environment"]["SITE_ADDRESS"])')
[[ "$site" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+[a-zA-Z0-9]$ && "$site" == *.* && "$site" != *replace* && "$site" != *.invalid ]] || { echo 'A real bare hostname with approved DNS is required.' >&2; exit 1; }
"${compose[@]}" pull backend reverse-proxy
while IFS= read -r image; do
  [[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$tag" ]] || { echo 'Image revision label mismatch.' >&2; exit 1; }
done < <("${compose[@]}" config --format json | python3 -c 'import json,sys; s=json.load(sys.stdin)["services"]; print(s["backend"]["image"]); print(s["reverse-proxy"]["image"])')
# Never recreate a running DB as part of an application release. DB upgrades are separate.
"${compose[@]}" up -d --no-recreate --wait --wait-timeout 120 postgres
tables=$(app_query "select count(*) from pg_tables where schemaname='public'")
if [[ "$tables" != 0 ]]; then
  bash "$repo_root/deploy/backup.sh"
fi
if [[ -f "$state_dir/current" ]]; then cp -- "$state_dir/current" "$state_dir/previous"; fi
# Allow backend startup grace, failed probes and the proxy's subsequent health check.
if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 420 backend reverse-proxy; then
  echo 'Deployment health check failed. No DB rollback or automatic image downgrade was performed.' >&2
  "${compose[@]}" ps
  # Emit targeted diagnostics rather than container configuration, which contains secrets.
  backend_id=$("${compose[@]}" ps -q backend)
  if [[ -n "$backend_id" ]]; then
    docker inspect --format '{{json .State.Health}}' "$backend_id" || true
  fi
  "${compose[@]}" logs --no-color --tail 100 backend || true
  exit 1
fi
curl --fail --silent --show-error --max-time 30 "https://$site/healthz" > /dev/null
next_state=$(mktemp "$state_dir/.current.XXXXXX")
printf '%s\n' "$tag" > "$next_state"
mv -- "$next_state" "$state_dir/current"
printf 'Healthy release: %s\n' "$tag"
