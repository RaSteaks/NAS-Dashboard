#!/bin/sh
# Web Station's folder picker hides symlinks, so publish a normal directory.
set -eu
umask 022

if [ "${GITSYNC_ONE_TIME:-true}" != "true" ]; then
  echo "publish: GITSYNC_ONE_TIME must be true; start the container again to update" >&2
  exit 1
fi

# Never copy an old checkout after a failed sync.
/git-sync "$@"
repo="${GITSYNC_LINK:-/data/current}"
source="$repo/site"
destination=/data/site
if [ ! -f "$source/index.html" ]; then
  echo "publish: synced repository has no site/index.html" >&2
  exit 1
fi
if [ -L "$destination" ] || { [ -e "$destination" ] && [ ! -d "$destination" ]; }; then
  echo "publish: /data/site must be an ordinary directory or absent" >&2
  exit 1
fi

stage=$(mktemp -d /data/.site-new.XXXXXX)
backup=""
cleanup() {
  # Restore the previous site if interrupted between the two renames.
  if [ -n "$backup" ] && [ -d "$backup/site" ] && [ ! -e "$destination" ]; then
    mv "$backup/site" "$destination" || echo "publish: restore site from $backup/site" >&2
  fi
  [ ! -d "$stage" ] || rm -rf -- "$stage"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Stage every file first; mktemp creates mode 700, which must be readable by HTTP.
cp -R "$source/." "$stage/"
chmod 755 "$stage"
# The sidebar and narrow-screen footer read this stamp. Git-sync targets its checkout
# symlink at the synced commit; an unreadable link leaves an empty stamp
# that the page simply hides.
link=$(readlink "$repo" 2>/dev/null || true)
printf '{"commit":"%s"}\n' "${link##*/}" > "$stage/build.json"
if [ -d "$destination" ]; then
  backup=$(mktemp -d /data/.site-old.XXXXXX)
  mv "$destination" "$backup/site"
fi
mv "$stage" "$destination"
# Only the replaced website is removed; /data/config and legacy Git data are untouched.
if [ -n "$backup" ]; then
  rm -rf -- "$backup"
fi
# Report the published revision so NAS logs can confirm the version-file contents.
echo "publish: commit ${link##*/}"
echo "publish: complete; Web Station root is /data/site"
