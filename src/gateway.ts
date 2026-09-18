import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type AuthenticationState,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import pino from "pino";
import { z } from "zod";
import { WhatsAppArchive, type ArchivedMessage } from "./archive.ts";
import { toArchivedMessage } from "./message.ts";
import { contactNameUpdates, groupNameUpdates, pushNameUpdates, type ChatNameUpdate } from "./names.ts";

process.umask(0o077);

const dataDirectory =
  process.env.WHATSAPP_DATA_DIR ??
  join(process.env.HOME ?? ".", ".screenpipe-distiller", "whatsapp");
const port = Number(process.env.WHATSAPP_HTTP_PORT ?? "3036");
const sessionDirectory = join(dataDirectory, "session");
// WhatsApp answers rapid reconnects with 503 stream errors; pause before retrying.
const RECONNECT_DELAY_MS = 5_000;
// A Baileys socket can stay "open" while no longer delivering messages (Baileys #2491),
// and only a fresh process recovers it. launchd's KeepAlive restarts us after exit.
const DEAF_AFTER_MS = 3 * 60 * 60 * 1000;
mkdirSync(dataDirectory, { recursive: true });

const archive = new WhatsAppArchive(join(dataDirectory, "messages.sqlite"));
let connected = false;
let name: string | null = null;
let phone: string | null = null;
let qr: string | null = null;
let historyChunks = 0;
let historyMessages = 0;
let lastHistorySyncAt: string | null = null;
let lastMessageAt = Date.now();
const disconnectErrorSchema = z.object({
  output: z.object({ statusCode: z.number() }),
});

const storeMessages = (messages: readonly WAMessage[]): ArchivedMessage[] => {
  const archived = messages.flatMap((message) => {
    const result = toArchivedMessage(message);
    return result ? [result] : [];
  });
  archive.storeMessages(archived);
  lastMessageAt = Date.now();
  return archived;
};

const applyNames = (updates: readonly ChatNameUpdate[]): void => {
  updates.forEach((update) =>
    archive.upsertChatName(update.jid, update.name, update.isGroup, update.saved),
  );
};

// App-state patch collections that carry contact records. Contacts live here;
// a full snapshot of them re-emits every address-book name.
const CONTACT_PATCH_COLLECTIONS = [
  "critical_block",
  "critical_unblock_low",
  "regular_high",
  "regular_low",
  "regular",
] as const;
let contactsBackfilled = false;

/**
 * WhatsApp only re-emits every address-book name — each carrying BOTH its @lid
 * and phone-number identity — when app-state is synced as a fresh snapshot (from
 * version 0). The initial pairing sync can miss names (e.g. when interrupted),
 * leaving LID-migrated contacts as masked numbers under their phone jid. Once per
 * process, clear the cached app-state versions and force a full resync so the
 * `contacts.upsert` handler receives complete, dual-keyable names.
 */
const backfillContacts = async (
  socket: ReturnType<typeof makeWASocket>,
  keys: AuthenticationState["keys"],
): Promise<void> => {
  if (contactsBackfilled) return;
  await keys.set({
    "app-state-sync-version": Object.fromEntries(CONTACT_PATCH_COLLECTIONS.map((name) => [name, null])),
  });
  await socket.resyncAppState(CONTACT_PATCH_COLLECTIONS, true);
  contactsBackfilled = true;
  console.log(JSON.stringify({ type: "contacts-backfill", collections: CONTACT_PATCH_COLLECTIONS.length }));
};

const backfillGroupNames = async (socket: ReturnType<typeof makeWASocket>): Promise<void> => {
  const known = archive.chatNames();
  const groupJids = archive
    .listChats()
    .map((chat) => chat.jid)
    .filter((jid) => jid.endsWith("@g.us"));
  for (const jid of groupJids) {
    try {
      const meta = await socket.groupMetadata(jid);
      const subject = meta.subject?.trim();
      if (subject && !known.has(jid)) archive.upsertChatName(jid, subject, true);
      // Participants are Contacts carrying lid/phoneNumber/saved name — harvest them so
      // group senders (often @lid) resolve and address-book members are flagged saved.
      applyNames(contactNameUpdates(meta.participants));
    } catch {
      // Group may be inaccessible (left/removed); skip and continue.
    }
  }
};

const limitSchema = z.coerce.number().int().positive().default(100);

const route = (url: URL): { status: number; body: unknown } => {
  if (url.pathname === "/status") {
    return {
      status: 200,
      body: { connected, name, phone, qrReady: qr !== null, historyChunks, historyMessages, lastHistorySyncAt, ...archive.status() },
    };
  }
  if (url.pathname === "/qr") return qr ? { status: 200, body: qr } : { status: 404, body: { error: "QR not ready" } };
  if (url.pathname === "/chats") return { status: 200, body: archive.listChats() };
  if (url.pathname === "/messages") {
    const jid = url.searchParams.get("jid");
    if (!jid) return { status: 400, body: { error: "provide jid" } };
    const limit = limitSchema.safeParse(url.searchParams.get("limit") ?? undefined);
    if (!limit.success) return { status: 400, body: { error: "limit must be a positive integer" } };
    return { status: 200, body: { jid, messages: archive.listMessages(jid, limit.data) } };
  }
  return { status: 404, body: { error: "not found" } };
};

// Node, unlike Bun.serve, treats a throw in a request listener as fatal; answer 500 instead.
const safeRoute = (url: URL): { status: number; body: unknown } => {
  try {
    return route(url);
  } catch (error) {
    console.error(JSON.stringify({ type: "http-error", path: url.pathname, error: String(error) }));
    return { status: 500, body: { error: "internal error" } };
  }
};

createServer((request, response) => {
  const { status, body } = safeRoute(new URL(request.url ?? "/", "http://127.0.0.1"));
  const isText = typeof body === "string";
  response.writeHead(status, { "content-type": isText ? "text/plain" : "application/json" });
  response.end(isText ? body : JSON.stringify(body));
}).listen(port, "127.0.0.1");

const start = async (): Promise<void> => {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDirectory);
  const { version } = await fetchLatestBaileysVersion();
  const socket = makeWASocket({
    version,
    auth: state,
    browser: Browsers.macOS("Chrome"),
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
    logger: pino({ level: "warn" }),
  });

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("messaging-history.set", ({ messages, contacts, chats, syncType, chunkOrder }) => {
    const archived = storeMessages(messages);
    applyNames(contactNameUpdates(contacts ?? []));
    applyNames(groupNameUpdates(chats ?? []));
    applyNames(pushNameUpdates(archived));
    historyChunks += 1;
    historyMessages += archived.length;
    lastHistorySyncAt = new Date().toISOString();
    console.log(JSON.stringify({ type: "history-sync", syncType, chunkOrder, stored: archived.length }));
  });
  socket.ev.on("messages.upsert", ({ messages }) => {
    applyNames(pushNameUpdates(storeMessages(messages)));
  });
  socket.ev.on("contacts.upsert", (contacts) => applyNames(contactNameUpdates(contacts)));
  socket.ev.on("contacts.update", (contacts) => applyNames(contactNameUpdates(contacts)));
  socket.ev.on("groups.upsert", (groups) => applyNames(groupNameUpdates(groups)));
  socket.ev.on("groups.update", (groups) => applyNames(groupNameUpdates(groups)));
  socket.ev.on("connection.update", ({ connection, lastDisconnect, qr: nextQr }) => {
    if (nextQr) qr = nextQr;
    if (connection === "open") {
      connected = true;
      lastMessageAt = Date.now();
      qr = null;
      name = socket.user?.name ?? null;
      phone = socket.user?.id.split(":")[0] ?? null;
      console.log(JSON.stringify({ type: "connected", name, phone }));
      void backfillContacts(socket, state.keys).catch((error) =>
        console.error("contacts backfill failed:", error),
      );
      void backfillGroupNames(socket);
    }
    if (connection !== "close") return;

    connected = false;
    const parsedError = disconnectErrorSchema.safeParse(lastDisconnect?.error);
    const statusCode = parsedError.success ? parsedError.data.output.statusCode : null;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    console.log(JSON.stringify({ type: "disconnected", statusCode, loggedOut }));
    // Logged-out credentials can never reconnect; drop them so the next start serves a fresh QR.
    if (loggedOut) rmSync(sessionDirectory, { recursive: true, force: true });
    setTimeout(() => void start(), RECONNECT_DELAY_MS);
  });
};

setInterval(() => {
  const silentMs = Date.now() - lastMessageAt;
  if (!connected || silentMs < DEAF_AFTER_MS) return;
  console.log(JSON.stringify({ type: "deaf-session-exit", silentMinutes: Math.round(silentMs / 60_000) }));
  process.exit(1);
}, 10 * 60 * 1000);

console.log(JSON.stringify({ type: "http", port, dataDirectory }));
await start();
