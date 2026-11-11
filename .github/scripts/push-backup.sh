#!/usr/bin/env bash
# Push an already committed backup without overwriting another writer's work.
set -euo pipefail

branch=${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}
if ! git check-ref-format --branch "$branch" >/dev/null; then
  echo "Invalid target branch" >&2
  exit 1
fi

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  : "${GH_TOKEN:?GH_TOKEN is required to push the backup}"
  gh auth setup-git --hostname github.com
fi

for attempt in 1 2 3; do
  git fetch origin "refs/heads/${branch}:refs/remotes/origin/${branch}"
  if ! git rebase "refs/remotes/origin/${branch}"; then
    git rebase --abort || true
    echo "Backup changes conflict with the remote branch" >&2
    exit 1
  fi

  if git push origin "HEAD:refs/heads/${branch}"; then
    exit 0
  fi

  if (( attempt < 3 )); then
    sleep "$attempt"
  fi
done

echo "Could not push backup after three attempts" >&2
exit 1
