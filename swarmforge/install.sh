#!/bin/sh
# Installs swarmforge.py as `launch-herdr-agents` on your PATH.
#
#   curl -fsSL https://www.uparix.com/swarmforge/install.sh | sh

set -eu

REPO_RAW_URL="https://raw.githubusercontent.com/uparix/uparix.github.io/main/swarmforge/swarmforge.py"
AGENTS_API_URL="https://api.github.com/repos/uparix/uparix.github.io/contents/swarmforge/.claude/agents"
AGENTS_RAW_BASE="https://raw.githubusercontent.com/uparix/uparix.github.io/main/swarmforge/.claude/agents"
SETTINGS_RAW_URL="https://raw.githubusercontent.com/uparix/uparix.github.io/main/swarmforge/.claude/settings.json"
INSTALL_DIR="${HERDR_INSTALL_DIR:-$PWD}"
INSTALL_PATH="$INSTALL_DIR/swarmforge.py"
AGENTS_DIR="$PWD/.claude/agents"
SETTINGS_PATH="$PWD/.claude/settings.json"

command -v python3 >/dev/null 2>&1 || {
    echo "Error: python3 is required but was not found on PATH." >&2
    exit 1
}

command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || {
    echo "Error: curl or wget is required but neither was found on PATH." >&2
    exit 1
}

fetch() {
    # fetch <url> <dest>
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$1" -o "$2"
    else
        wget -q "$1" -O "$2"
    fi
}

mkdir -p "$INSTALL_DIR"
fetch "$REPO_RAW_URL" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"

echo "Installed swarmforge.py to $INSTALL_PATH"

if [ ! -d "$AGENTS_DIR" ]; then
    mkdir -p "$AGENTS_DIR"
    AGENTS_JSON="$(mktemp)"
    fetch "$AGENTS_API_URL" "$AGENTS_JSON"
    python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    entries = json.load(f)
for entry in entries:
    if entry["name"].endswith(".md"):
        print(entry["name"])
' "$AGENTS_JSON" | while IFS= read -r name; do
        fetch "$AGENTS_RAW_BASE/$name" "$AGENTS_DIR/$name"
        echo "Installed $name to $AGENTS_DIR/$name"
    done
    rm -f "$AGENTS_JSON"
fi

if [ ! -f "$SETTINGS_PATH" ]; then
    mkdir -p "$(dirname "$SETTINGS_PATH")"
    fetch "$SETTINGS_RAW_URL" "$SETTINGS_PATH"
    echo "Installed settings.json to $SETTINGS_PATH"
fi

if ! command -v herdr >/dev/null 2>&1; then
    echo "Note: herdr is not installed. Download it from https://herdr.dev"
fi
