# whatsapp-memory

Keeps a local WhatsApp Web sync alive (Baileys) and pushes each completed day's
chats into [Memory](https://petals.chat) as structured transcripts — one
`meeting_transcript` per `(chat, day)`, with per-person speaker attribution.

## Components

- **gateway** (`bun run whatsapp`) — Baileys sidecar. Pairs via QR, stores
  messages + contacts in `~/.screenpipe-distiller/whatsapp/messages.sqlite`,
  exposes `GET /status` `/qr` `/chats` `/messages` on `127.0.0.1:3036`. Reuses
  the existing session dir, so migrating from screenpipe-distiller needs **no
  re-pair**.
- **pusher** (`bun run push`) — reads completed days, builds transcripts, POSTs
  them to Petals `/api/memory/ingest/transcript`, and records a watermark in
  `push-state.sqlite`. `bun run push --backfill 60` for a deeper one-shot.

## Setup

```bash
bun install
cp .env.example .env   # fill PETALS_API_KEY and SELF_ALIASES
./scripts/install-gateway.sh   # keep-alive Baileys sidecar
./scripts/install-pusher.sh    # daily push at 04:00
```

Pairing (only if no existing session): start the gateway, then
`curl -fsS http://127.0.0.1:3036/qr | qrencode -t ANSIUTF8` and scan from
WhatsApp → Linked Devices.

## Config

See `.env.example`. Key vars: `PETALS_API_KEY`, `SELF_ALIASES` (comma-separated;
first is your emitted label), `WHATSAPP_GROUP_FILTER` (`contacts`|`all`),
`TIMEZONE`, `BACKFILL_DAYS`.
