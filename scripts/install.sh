#!/bin/sh
# Thin macOS/Linux entry; installation and checks live in the shared JS command.
set -eu
installer_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node_command=${VIBETRACE_NODE:-node}
if ! command -v "$node_command" >/dev/null 2>&1; then
  echo 'VibeTrace requires Node.js 20+ before this installer can run.' >&2
  echo 'macOS with Homebrew: brew install node python' >&2
  echo 'Other installations: https://nodejs.org/en/download' >&2
  echo 'Open a new terminal after installing, then run this command again.' >&2
  exit 1
fi
exec "$node_command" "$installer_dir/vibetrace.mjs" setup "$@"
