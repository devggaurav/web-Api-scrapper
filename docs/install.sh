#!/bin/sh
# browser-flow-tracker installer — downloads the standalone binary (no Node needed)
# and installs it to a fixed path your AI app can always find.
#
#   curl -fsSL https://apiflowtracker.com/install.sh | sh
#
set -eu

REPO="devggaurav/web-Api-scrapper"
BIN="browser-flow-tracker"
DEST_DIR="/usr/local/bin"

say() { printf '%s\n' "$*"; }
err() { printf 'Error: %s\n' "$*" >&2; exit 1; }

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) OS=darwin ;;
  Linux)  OS=linux ;;
  *) err "Unsupported OS '$os'. On Windows, download the .exe from https://github.com/$REPO/releases/latest" ;;
esac
case "$arch" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  *) err "Unsupported architecture '$arch'." ;;
esac

command -v curl >/dev/null 2>&1 || err "curl is required but not found."

ASSET="$BIN-$OS-$ARCH"
URL="https://github.com/$REPO/releases/latest/download/$ASSET"

tmp=$(mktemp)
say "Downloading $ASSET ..."
curl -fSL "$URL" -o "$tmp" || err "Download failed: $URL"
chmod +x "$tmp"

# macOS: clear the quarantine flag so it runs without a Gatekeeper prompt.
if [ "$OS" = "darwin" ]; then xattr -d com.apple.quarantine "$tmp" 2>/dev/null || true; fi

DEST="$DEST_DIR/$BIN"
say "Installing to $DEST ..."
if [ -w "$DEST_DIR" ]; then
  mv "$tmp" "$DEST"
else
  say "(administrator password needed to write to $DEST_DIR)"
  sudo mv "$tmp" "$DEST"
fi

say ""
say "Installed. Add this to your Claude Code / Cursor MCP config:"
say ""
say '  {'
say '    "mcpServers": {'
say '      "browser-flow-tracker": {'
say "        \"command\": \"$DEST\""
say '      }'
say '    }'
say '  }'
say ""
say "Then restart your AI app and say:"
say "  \"let's record the session for this url https://example.com\""
