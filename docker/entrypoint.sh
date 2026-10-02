#!/bin/sh
# Pulls the repository on every container start, then serves site/ via nginx.
# Restarting the container (manually, or via restart: unless-stopped on NAS
# boot) is the update gesture: restart equals "deploy latest main".
set -eu

REPO_URL="${REPO_URL:?REPO_URL must point to the Git repository}"
BRANCH="${BRANCH:-main}"
REPO_DIR="/var/www/repo"
RETRIES="${PULL_RETRIES:-5}"

git config --global --replace-all safe.directory "$REPO_DIR"

pull() {
  if [ ! -d "$REPO_DIR/.git" ]; then
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$REPO_DIR"
  else
    git -C "$REPO_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
  fi
}

# NAS boot order can race network availability, so retry before giving up.
attempt=1
until pull; do
  if [ "$attempt" -ge "$RETRIES" ]; then
    if [ -d "$REPO_DIR/.git" ]; then
      # Update failed but a previous checkout exists: keep serving it.
      echo "entrypoint: pull failed after $RETRIES attempts, serving the existing checkout" >&2
      break
    fi
    echo "entrypoint: clone failed after $RETRIES attempts and no checkout exists" >&2
    exit 1
  fi
  echo "entrypoint: pull failed (attempt $attempt/$RETRIES), retrying in 3s" >&2
  attempt=$((attempt + 1))
  sleep 3
done

# Surface the deployed commit at /VERSION for quick checks.
git -C "$REPO_DIR" rev-parse --short HEAD > "$REPO_DIR/site/VERSION"

# Point the default nginx site at the freshly pulled web root.
sed -i "s|/usr/share/nginx/html|$REPO_DIR/site|" /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"
