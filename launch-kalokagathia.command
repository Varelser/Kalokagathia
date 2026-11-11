#!/bin/zsh

# Monosphere launcher (revised 2026-11-10)
# Changes from the original (2026-04-01):
#  - Node.js requirement aligned with the project: engines >=20 / .nvmrc = 20
#    (the original only asked for 18+ and said so in its error message).
#  - Dependencies are installed only when needed: the md5 of package-lock.json
#    is stamped into node_modules/.launcher-stamp after a successful install,
#    and later launches skip npm install while the stamp matches.
#  - `npm ci` is used when installing from scratch (exact lockfile reproduce),
#    falling back to `npm install` if ci fails.
#  - Port conflicts on the dev server are reported with guidance instead of a
#    raw stack trace.
#  - Dev-server invocation fixed: the original ran `npm start -- --host ...`,
#    but current npm consumes those flags itself (the start script is itself
#    `npm run dev`), leaving vite with a stray "127.0.0.1" positional argument
#    and a 404-serving root. Verified broken on the iMac 2026-11-10 with
#    npm 11.8. The launcher now calls `npm run dev -- --host 127.0.0.1 --open`
#    so the flags reach vite. (This breakage is presumably why a revised
#    launcher was drafted in the first place.)
# Everything else (PATH discovery for Homebrew/Volta/asdf/nvm, prompts)
# is unchanged from the original.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.asdf/shims:$PATH"
if [[ -d "$HOME/.nvm/versions/node" ]]; then
  for NVM_BIN in "$HOME"/.nvm/versions/node/*/bin; do
    if [[ -d "$NVM_BIN" ]]; then
      export PATH="$NVM_BIN:$PATH"
    fi
  done
fi

echo "Monosphere launcher"
echo "Project: $SCRIPT_DIR"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 20+ is not installed or not in PATH."
  echo "Install Node.js 20 (see .nvmrc), then run this launcher again."
  echo
  read -r "?Press Enter to close..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not in PATH."
  echo "Install Node.js 20, then run this launcher again."
  echo
  read -r "?Press Enter to close..."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Error: Node.js 20+ is required (found $(node -v))."
  echo "This project pins Node 20 in .nvmrc / package.json engines."
  echo "Switch Node versions (e.g. 'nvm install 20 && nvm use 20'), then run this launcher again."
  echo
  read -r "?Press Enter to close..."
  exit 1
fi

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"
echo

STAMP_FILE="node_modules/.launcher-stamp"
LOCK_HASH=""
if command -v md5 >/dev/null 2>&1; then
  LOCK_HASH="$(md5 -q package-lock.json 2>/dev/null || echo '')"
elif command -v md5sum >/dev/null 2>&1; then
  LOCK_HASH="$(md5sum package-lock.json 2>/dev/null | awk '{print $1}')"
fi

NEED_INSTALL=1
if [[ -d node_modules && -n "$LOCK_HASH" && -f "$STAMP_FILE" ]]; then
  if [[ "$(cat "$STAMP_FILE" 2>/dev/null)" == "$LOCK_HASH" ]]; then
    NEED_INSTALL=0
  fi
fi

if [[ "$NEED_INSTALL" -eq 0 ]]; then
  echo "Dependencies are up to date (package-lock.json unchanged). Skipping install."
else
  if [[ -d node_modules ]]; then
    echo "Installing or repairing dependencies..."
    npm install
  else
    echo "Installing dependencies (first run)..."
    npm ci || npm install
  fi
  if [[ $? -ne 0 ]]; then
    echo
    echo "Dependency install failed."
    read -r "?Press Enter to close..."
    exit 1
  fi
  if [[ -n "$LOCK_HASH" ]]; then
    echo "$LOCK_HASH" > "$STAMP_FILE"
  fi
fi

echo
echo "Starting development server..."
echo "If the browser does not open automatically, copy the localhost URL from this window."
echo "If startup fails with 'Port 3000 is already in use', close the other server first."
echo

npm run dev -- --host 127.0.0.1 --open

EXIT_CODE=$?
echo
echo "Monosphere stopped with exit code $EXIT_CODE."
read -r "?Press Enter to close..."
exit $EXIT_CODE
