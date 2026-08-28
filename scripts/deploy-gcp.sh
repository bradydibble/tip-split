#!/usr/bin/env bash
set -Eeuo pipefail

readonly ACCOUNT='bradydibble@gmail.com'
readonly PROJECT='homelab-personal-502823'
readonly ZONE='us-central1-a'
readonly INSTANCE='tipsplit-vm'
readonly IMAGE_REPOSITORY="us-central1-docker.pkg.dev/${PROJECT}/apps/tip-split"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

for command in git gcloud curl; do
  command -v "$command" >/dev/null || {
    echo "Required command not found: ${command}" >&2
    exit 1
  }
done

echo 'Fetching production source from origin/main...'
git fetch origin main
commit="$(git rev-parse FETCH_HEAD)"
short_commit="$(git rev-parse --short=12 "$commit")"
image_tag="git-${short_commit}"

work_dir="$(mktemp -d -t tipsplit-gcp-deploy.XXXXXX)"
source_dir="${work_dir}/source"
cleanup() {
  if [[ -d "$source_dir" ]]; then
    git worktree remove --force "$source_dir" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

git worktree add --detach "$source_dir" "$commit" >/dev/null

echo "Building ${commit} in Cloud Build..."
gcloud builds submit "$source_dir" \
  --quiet \
  --account="$ACCOUNT" \
  --project="$PROJECT" \
  --config="${repo_root}/deploy/cloudbuild.gcp.yaml" \
  --substitutions="_IMAGE_TAG=${image_tag}"

digest="$(gcloud artifacts docker images describe "${IMAGE_REPOSITORY}:${image_tag}" \
  --account="$ACCOUNT" \
  --project="$PROJECT" \
  --format='value(image_summary.digest)')"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Could not resolve the image digest for ${image_tag}." >&2
  exit 1
}

remote_script="/tmp/tipsplit-gcp-deploy-${short_commit}.sh"
echo "Deploying ${digest} to ${INSTANCE}..."
gcloud compute scp "${repo_root}/deploy/gcp-vm-deploy.sh" "${INSTANCE}:${remote_script}" \
  --quiet \
  --account="$ACCOUNT" \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --tunnel-through-iap

gcloud compute ssh "$INSTANCE" \
  --quiet \
  --account="$ACCOUNT" \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --tunnel-through-iap \
  --command="sudo bash ${remote_script} ${digest} ${commit}; rc=\$?; sudo rm -f ${remote_script}; exit \$rc"

curl -fsS https://tipsplit.bradydibble.com/ >/dev/null
echo "TipSplit production is healthy at commit ${commit} (${digest})."
