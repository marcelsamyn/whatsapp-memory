import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WhatsAppArchive, type ArchivedMessage } from "./archive.ts";
import { isArchiveStale, runPush } from "./pusher.ts";
import type { Config } from "./config.ts";
import type { TranscriptPayload } from "./transcripts.ts";
import { RateLimitedError } from "./petals.ts";

const paths: string[] = [];
const tempPath = (tag: string): string => {
  const path = join(tmpdir(), `wa-${tag}-${crypto.randomUUID()}.sqlite`);
  paths.push(path);
  return path;
};
afterEach(() => {
  paths.forEach((p) => {
    rmSync(p, { force: true });
    rmSync(`${p}-shm`, { force: true });
    rmSync(`${p}-wal`, { force: true });
  });
  paths.length = 0;
});

// 2026-06-15 ~10:00 Brussels (UTC+2) → 08:00:00Z, inside the completed day.
const TS_15 = Math.floor(Date.parse("2026-06-15T08:00:00Z") / 1000);
const NOW = new Date("2026-06-16T18:00:00Z");

const makeConfig = (archivePath: string, statePath: string): Config =>
  ({
    PETALS_BASE_URL: "https://petals.test",
    PETALS_API_KEY: "petals-k",
    WHATSAPP_ARCHIVE_PATH: archivePath,
    PUSH_STATE_PATH: statePath,
    WHATSAPP_GROUP_FILTER: "contacts",
    TIMEZONE: "Europe/Brussels",
    BACKFILL_DAYS: 5,
    SELF_ALIASES: ["Marcel"],
  }) satisfies Config;

const seedArchive = (messages: ArchivedMessage[], names: [string, string, boolean, boolean?][] = []): string => {
  const path = tempPath("archive");
  const archive = new WhatsAppArchive(path);
  archive.storeMessages(messages);
  names.forEach(([jid, name, isGroup, saved]) => archive.upsertChatName(jid, name, isGroup, saved ?? false));
  archive.close();
  return path;
};

describe("runPush", () => {
  test("pushes each completed-day chat once and records the watermark", async () => {
    const archivePath = seedArchive(
      [
        { id: "1", jid: "p@s.whatsapp.net", fromMe: false, sender: "p@s.whatsapp.net", text: "yo", mediaType: null, timestamp: TS_15, pushName: null },
      ],
      [["p@s.whatsapp.net", "Pat", false, true]],
    );
    const statePath = tempPath("state");
    const config = makeConfig(archivePath, statePath);
    const sent: TranscriptPayload[] = [];
    const ingest = async (payload: TranscriptPayload) => {
      sent.push(payload);
      return { jobId: "job_x" };
    };

    const first = await runPush(config, { now: NOW, ingest });
    expect(first).toEqual({ pushed: 1, skipped: 0, failed: 0, lastMessageTimestamp: TS_15 });
    expect(sent[0]?.transcriptId).toBe("whatsapp-p@s.whatsapp.net-2026-06-15");
    expect(sent[0]?.content.utterances[0]).toEqual({ speakerLabel: "Pat", content: "yo", timestamp: "2026-06-15T08:00:00.000Z" });

    // Second run: already recorded → skipped, no new ingest.
    sent.length = 0;
    const second = await runPush(config, { now: NOW, ingest });
    expect(second).toEqual({ pushed: 0, skipped: 1, failed: 0, lastMessageTimestamp: TS_15 });
    expect(sent.length).toBe(0);
  });

  test("counts a failed ingest and does not record it (retried next run)", async () => {
    const archivePath = seedArchive([
      { id: "1", jid: "p@s.whatsapp.net", fromMe: false, sender: "p@s.whatsapp.net", text: "yo", mediaType: null, timestamp: TS_15, pushName: null },
    ]);
    const statePath = tempPath("state");
    const config = makeConfig(archivePath, statePath);

    const failing = async () => {
      throw new Error("boom");
    };
    const failRun = await runPush(config, { now: NOW, ingest: failing });
    expect(failRun).toMatchObject({ pushed: 0, skipped: 0, failed: 1 });

    // Not recorded, so a later good run pushes it.
    const okRun = await runPush(config, { now: NOW, ingest: async () => ({ jobId: "job_ok" }) });
    expect(okRun).toMatchObject({ pushed: 1, skipped: 0, failed: 0 });
  });

  test("stops the run at the first rate-limit rejection", async () => {
    const archivePath = seedArchive([
      { id: "1", jid: "a@s.whatsapp.net", fromMe: false, sender: "a@s.whatsapp.net", text: "one", mediaType: null, timestamp: TS_15, pushName: null },
      { id: "2", jid: "b@s.whatsapp.net", fromMe: false, sender: "b@s.whatsapp.net", text: "two", mediaType: null, timestamp: TS_15, pushName: null },
    ]);
    const config = makeConfig(archivePath, tempPath("state"));
    let calls = 0;
    const rateLimited = async (): Promise<{ jobId: string }> => {
      calls += 1;
      throw new RateLimitedError("rate limited");
    };

    const summary = await runPush(config, { now: NOW, ingest: rateLimited });
    expect(summary).toMatchObject({ pushed: 0, failed: 1 });
    expect(calls).toBe(1);
  });

  test("returns a zero summary when the archive file is missing", async () => {
    const config = makeConfig(join(tmpdir(), "does-not-exist.sqlite"), tempPath("state"));
    const summary = await runPush(config, { now: NOW, ingest: async () => ({ jobId: "x" }) });
    expect(summary).toEqual({ pushed: 0, skipped: 0, failed: 0, lastMessageTimestamp: null });
  });
});

describe("isArchiveStale", () => {
  test("is stale when the archive has no messages", () => {
    expect(isArchiveStale(null, NOW)).toBe(true);
  });

  test("is fresh within a day of the newest message and stale after", () => {
    const nowSeconds = NOW.getTime() / 1000;
    expect(isArchiveStale(nowSeconds - 23 * 3600, NOW)).toBe(false);
    expect(isArchiveStale(nowSeconds - 25 * 3600, NOW)).toBe(true);
  });
});
