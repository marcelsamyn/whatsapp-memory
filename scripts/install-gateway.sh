#!/usr/bin/env bash
# Installs the persistent WhatsApp gateway (Baileys sidecar) on macOS.
# Reuses the existing ~/.screenpipe-distiller/whatsapp session, so no re-pair.
set -euo pipefail

LABEL="com.whatsapp-memory.gateway"
AGENTS="$HOME/Library/LaunchAgents"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$HOME/.screenpipe-distiller/whatsapp"
# Baileys supports Node only; under Bun its WebSocket lifecycle events are missing.
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "error: 'node' (>= 23.6, for native TypeScript) not found on PATH." >&2
  exit 1
fi

mkdir -p "$AGENTS" "$DATA_DIR"
chmod 700 "$HOME/.screenpipe-distiller" "$DATA_DIR"

cat > "$AGENTS/$LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>src/gateway.ts</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>WHATSAPP_HTTP_PORT</key><string>3036</string>
    <key>WHATSAPP_DATA_DIR</key><string>$DATA_DIR</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$REPO/whatsapp.out.log</string>
  <key>StandardErrorPath</key><string>$REPO/whatsapp.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "$AGENTS/$LABEL.plist" 2>/dev/null || true
launchctl load "$AGENTS/$LABEL.plist"
echo "loaded $LABEL"
echo "status: curl -fsS http://127.0.0.1:3036/status"
