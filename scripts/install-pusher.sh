#!/usr/bin/env bash
# Installs the daily WhatsApp → Memory pusher on macOS.
# Reads config from $REPO/.env (Bun auto-loads it from WorkingDirectory).
set -euo pipefail

LABEL="com.whatsapp-memory.pusher"
AGENTS="$HOME/Library/LaunchAgents"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUN="$(command -v bun || true)"

if [ -z "$BUN" ]; then
  echo "error: 'bun' not found on PATH." >&2
  exit 1
fi

mkdir -p "$AGENTS"

cat > "$AGENTS/$LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$BUN</string><string>run</string><string>push</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$REPO/push.out.log</string>
  <key>StandardErrorPath</key><string>$REPO/push.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "$AGENTS/$LABEL.plist" 2>/dev/null || true
launchctl load "$AGENTS/$LABEL.plist"
echo "loaded $LABEL (daily at 04:00)"
