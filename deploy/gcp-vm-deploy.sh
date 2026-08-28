#!/usr/bin/env bash
set -Eeuo pipefail

readonly IMAGE_REPOSITORY='us-central1-docker.pkg.dev/homelab-personal-502823/apps/tip-split'
readonly CONTAINER_NAME='tipsplit'
readonly DATA_DIR='/data/tipsplit'
readonly HEALTH_URL='http://127.0.0.1:8080/'

usage() {
  echo "Usage: $0 <sha256:digest> <git-commit>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
readonly EXPECTED_DIGEST="$1"
readonly GIT_COMMIT="$2"
[[ "$EXPECTED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || usage
[[ "$GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]] || usage
readonly NEW_IMAGE="${IMAGE_REPOSITORY}@${EXPECTED_DIGEST}"

env_file="$(mktemp /run/tipsplit-env.XXXXXX)"
chmod 600 "$env_file"
cleanup() {
  rm -f "$env_file"
}
trap cleanup EXIT

root_usage="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
if (( root_usage >= 85 )); then
  echo "Refusing deployment: root filesystem is ${root_usage}% full." >&2
  exit 1
fi

podman container exists "$CONTAINER_NAME" || {
  echo "Refusing deployment: current ${CONTAINER_NAME} container was not found." >&2
  exit 1
}
curl -fsS "$HEALTH_URL" >/dev/null || {
  echo 'Refusing deployment: current production container is not healthy.' >&2
  exit 1
}

readonly PREVIOUS_IMAGE="$(podman inspect --format '{{.ImageName}}' "$CONTAINER_NAME")"

# Preserve only runtime-supplied application settings. Image defaults come from
# the new image and must not be copied forward from the previous Node image.
podman inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER_NAME" \
  | sed -E '/^(PATH|container|NODE_ENV|DATABASE_PATH|NODE_VERSION|YARN_VERSION|HOME|HOSTNAME)=/d' \
  >"$env_file"

token="$(curl -fsS \
  -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token \
  | jq -r '.access_token')"
printf '%s' "$token" \
  | podman login -u oauth2accesstoken --password-stdin us-central1-docker.pkg.dev \
    >/dev/null
unset token

podman pull "$NEW_IMAGE" >/dev/null

root_usage="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
if (( root_usage >= 85 )); then
  echo "Refusing deployment after image pull: root filesystem is ${root_usage}% full." >&2
  exit 1
fi

readonly BACKUP_DIR="${DATA_DIR}/backups"
readonly BACKUP_NAME="tipsplit.db.predeploy-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
podman exec "$CONTAINER_NAME" node -e '
  const Database = require("better-sqlite3");
  const db = new Database("/app/data/tipsplit.db");
  db.backup(process.argv[1])
    .then(() => db.close())
    .catch((error) => { console.error(error); process.exit(1); });
' "/app/data/backups/$BACKUP_NAME"
test -s "${BACKUP_DIR}/${BACKUP_NAME}"

start_container() {
  local image="$1"
  shift
  podman run -d \
    --name "$CONTAINER_NAME" \
    --restart=always \
    -p 127.0.0.1:8080:3000 \
    -v "${DATA_DIR}:/app/data:Z" \
    --env-file "$env_file" \
    "$@" \
    "$image" >/dev/null
}

wait_healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS "$HEALTH_URL" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

rollback() {
  echo "Deployment failed; rolling back to ${PREVIOUS_IMAGE}." >&2
  podman rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  start_container "$PREVIOUS_IMAGE"
  wait_healthy || {
    echo 'Rollback container also failed its health check.' >&2
    exit 2
  }
  exit 1
}

podman rm -f "$CONTAINER_NAME" >/dev/null
start_container "$NEW_IMAGE" --label "io.tipsplit.git-sha=${GIT_COMMIT}"
wait_healthy || rollback

running_digest="$(podman inspect --format '{{.ImageDigest}}' "$CONTAINER_NAME")"
[[ "$running_digest" == "$EXPECTED_DIGEST" ]] || rollback

curl -kfsS \
  --resolve tipsplit.bradydibble.com:443:127.0.0.1 \
  https://tipsplit.bradydibble.com/ >/dev/null || rollback

podman exec "$CONTAINER_NAME" node -e '
  const Database = require("better-sqlite3");
  const db = new Database("/app/data/tipsplit.db");
  if (db.pragma("integrity_check", { simple: true }) !== "ok") process.exit(1);
  db.close();
' || rollback

echo "deployed_commit=${GIT_COMMIT}"
echo "deployed_digest=${EXPECTED_DIGEST}"
echo "database_backup=${BACKUP_DIR}/${BACKUP_NAME}"
