#!/bin/sh
# Installs swarmforge.py as `launch-herdr-agents` on your PATH.
#
#   curl -fsSL https://www.uparix.com/swarmforge/install.sh | sh

set -eu

REPO_RAW_URL="https://raw.githubusercontent.com/uparix/uparix.github.io/main/swarmforge/swarmforge.py"
INSTALL_DIR="${HERDR_INSTALL_DIR:-$HOME/.local/bin}"
INSTALL_PATH="$INSTALL_DIR/swarmforge"

command -v python3 >/dev/null 2>&1 || {
    echo "Error: python3 is required but was not found on PATH." >&2
    exit 1
}

mkdir -p "$INSTALL_DIR"

if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$REPO_RAW_URL" -o "$INSTALL_PATH"
elif command -v wget >/dev/null 2>&1; then
    wget -q "$REPO_RAW_URL" -O "$INSTALL_PATH"
else
    echo "Error: curl or wget is required but neither was found on PATH." >&2
    exit 1
fi

chmod +x "$INSTALL_PATH"

echo "Installed swarmforge to $INSTALL_PATH"

case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
        echo "Note: $INSTALL_DIR is not on your PATH."
        echo "Add this to your shell profile:"
        echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
        ;;
esac

if ! command -v herdr >/dev/null 2>&1; then
    echo "Note: herdr is not installed. Download it from https://herdr.dev"
fi
