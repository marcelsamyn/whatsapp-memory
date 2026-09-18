import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export type ArchivedMessage = {
  id: string;
  jid: string;
  fromMe: boolean;
  sender: string;
  text: string | null;
  mediaType: string | null;
  timestamp: number;
  pushName: string | null;
};

export type ArchivedChat = {
  jid: string;
  messageCount: number;
  lastMessageTimestamp: number;
};

const messageRowSchema = z
  .object({
    id: z.string(),
    jid: z.string(),
    fromMe: z.number(),
    sender: z.string(),
    text: z.string().nullable(),
    mediaType: z.string().nullable(),
    timestamp: z.number(),
    pushName: z.string().nullable(),
  })
  .transform((row): ArchivedMessage => ({ ...row, fromMe: row.fromMe === 1 }));
const chatRowSchema = z.object({ jid: z.string(), messageCount: z.number(), lastMessageTimestamp: z.number() });
const nameRowSchema = z.object({ jid: z.string(), name: z.string() });
const jidRowSchema = z.object({ jid: z.string() });
const statusRowSchema = z.object({
  chatCount: z.number(),
  messageCount: z.number(),
  lastMessageTimestamp: z.number().nullable(),
});

export type ArchiveStatus = z.infer<typeof statusRowSchema>;

const MESSAGE_COLUMNS = `
  id,
  jid,
  from_me AS fromMe,
  sender,
  text,
  media_type AS mediaType,
  timestamp,
  push_name AS pushName
`;

export class WhatsAppArchive {
  readonly #database: DatabaseSync;

  constructor(path: string, options: { readonly?: boolean } = {}) {
    if (options.readonly) {
      // Read-only connections cannot run DDL; the sidecar owns the schema.
      this.#database = new DatabaseSync(path, { readOnly: true });
      return;
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        jid TEXT NOT NULL,
        from_me INTEGER NOT NULL,
        sender TEXT NOT NULL,
        text TEXT,
        media_type TEXT,
        timestamp INTEGER NOT NULL,
        push_name TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_jid_timestamp
        ON messages (jid, timestamp);
      CREATE TABLE IF NOT EXISTS chats (
        jid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_group INTEGER NOT NULL DEFAULT 0,
        saved INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  storeMessages(messages: readonly ArchivedMessage[]): void {
    const insert = this.#database.prepare(`
      INSERT OR IGNORE INTO messages (
        id, jid, from_me, sender, text, media_type, timestamp, push_name
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    this.#database.exec("BEGIN");
    try {
      messages.forEach((message) =>
        insert.run(
          message.id,
          message.jid,
          message.fromMe ? 1 : 0,
          message.sender,
          message.text,
          message.mediaType,
          message.timestamp,
          message.pushName,
        ),
      );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listMessages(jid: string, limit: number): ArchivedMessage[] {
    const rows = this.#database
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE jid = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(jid, limit);

    return z.array(messageRowSchema).parse(rows).reverse();
  }

  upsertChatName(jid: string, name: string, isGroup: boolean, saved = false): void {
    // `saved` (address-book contact) is sticky once set; a real saved name is kept
    // over a later non-saved display name (e.g. a self-set pushName).
    this.#database
      .prepare(`
        INSERT INTO chats (jid, name, is_group, saved) VALUES (?, ?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          name = CASE
            WHEN excluded.saved = 1 THEN excluded.name
            WHEN chats.saved = 1 THEN chats.name
            ELSE excluded.name
          END,
          is_group = excluded.is_group,
          saved = MAX(chats.saved, excluded.saved)
      `)
      .run(jid, name, isGroup ? 1 : 0, saved ? 1 : 0);
  }

  chatNames(): Map<string, string> {
    try {
      const rows = z.array(nameRowSchema).parse(this.#database.prepare(`SELECT jid, name FROM chats`).all());
      return new Map(rows.map((row) => [row.jid, row.name]));
    } catch {
      // Archive written before name enrichment has no `chats` table — treat as no names.
      return new Map();
    }
  }

  /** JIDs of address-book ("saved") contacts — used to filter unknown group senders. */
  savedContacts(): Set<string> {
    try {
      const rows = z.array(jidRowSchema).parse(this.#database.prepare(`SELECT jid FROM chats WHERE saved = 1`).all());
      return new Set(rows.map((row) => row.jid));
    } catch {
      return new Set();
    }
  }

  listMessagesInWindow(startUnix: number, endUnix: number): ArchivedMessage[] {
    const rows = this.#database
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE timestamp >= ? AND timestamp < ? ORDER BY jid, timestamp ASC`,
      )
      .all(startUnix, endUnix);

    return z.array(messageRowSchema).parse(rows);
  }

  listChats(): ArchivedChat[] {
    const rows = this.#database
      .prepare(`
        SELECT
          jid,
          COUNT(*) AS messageCount,
          MAX(timestamp) AS lastMessageTimestamp
        FROM messages
        GROUP BY jid
        ORDER BY lastMessageTimestamp DESC
      `)
      .all();
    return z.array(chatRowSchema).parse(rows);
  }

  status(): ArchiveStatus {
    const row = this.#database
      .prepare(`
        SELECT
          COUNT(DISTINCT jid) AS chatCount,
          COUNT(*) AS messageCount,
          MAX(timestamp) AS lastMessageTimestamp
        FROM messages
      `)
      .get();
    return statusRowSchema.parse(row);
  }

  close(): void {
    this.#database.close();
  }
}
