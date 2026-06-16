/**
 * Tracks which (chat, day) transcripts have already been pushed to Memory.
 * A don't-redo-work watermark — backend ingest is idempotent by transcriptId.
 */
import { Database } from "bun:sqlite";

export class PushState {
  readonly #database: Database;

  constructor(path: string) {
    this.#database = new Database(path, { create: true });
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pushed_days (
        jid TEXT NOT NULL,
        day TEXT NOT NULL,
        pushed_at INTEGER NOT NULL,
        PRIMARY KEY (jid, day)
      );
    `);
  }

  has(jid: string, day: string): boolean {
    return (
      this.#database
        .query<{ one: number }, [string, string]>(
          `SELECT 1 AS one FROM pushed_days WHERE jid = ? AND day = ?`,
        )
        .get(jid, day) !== null
    );
  }

  record(jid: string, day: string, pushedAt: number): void {
    this.#database
      .query(`INSERT OR REPLACE INTO pushed_days (jid, day, pushed_at) VALUES (?, ?, ?)`)
      .run(jid, day, pushedAt);
  }

  close(): void {
    this.#database.close();
  }
}
