/**
 * Reads completed-day WhatsApp messages from the archive and pushes each
 * (chat, day) as a transcript to Memory, skipping ones already recorded.
 */
import { existsSync } from "node:fs";
import { WhatsAppArchive } from "./archive";
import { PushState } from "./push-state";
import { buildDayTranscripts, type TranscriptPayload } from "./transcripts";
import { ingestTranscript } from "./petals";
import { dayWindowUtc, recentCompletedDayKeys } from "./date-utils";
import type { Config } from "./config";

export interface PushSummary {
  pushed: number;
  skipped: number;
  failed: number;
}

export interface PushDeps {
  now?: Date;
  ingest?: (payload: TranscriptPayload) => Promise<{ jobId: string }>;
}

export async function runPush(config: Config, deps: PushDeps = {}): Promise<PushSummary> {
  const now = deps.now ?? new Date();
  const ingest =
    deps.ingest ??
    ((payload: TranscriptPayload) =>
      ingestTranscript(payload, { baseUrl: config.PETALS_BASE_URL, apiKey: config.PETALS_API_KEY }));

  const summary: PushSummary = { pushed: 0, skipped: 0, failed: 0 };
  if (!existsSync(config.WHATSAPP_ARCHIVE_PATH)) {
    console.warn(`[push] archive not found at ${config.WHATSAPP_ARCHIVE_PATH}; nothing to push`);
    return summary;
  }

  const archive = new WhatsAppArchive(config.WHATSAPP_ARCHIVE_PATH, { readonly: true });
  try {
    const state = new PushState(config.PUSH_STATE_PATH);
    try {
      const names = archive.chatNames();
      const savedSenders = config.WHATSAPP_GROUP_FILTER === "all" ? null : archive.savedContacts();
      for (const dayKey of recentCompletedDayKeys(now, config.TIMEZONE, config.BACKFILL_DAYS)) {
        const { startIso, endIso } = dayWindowUtc(dayKey, config.TIMEZONE);
        const messages = archive.listMessagesInWindow(
          Math.floor(Date.parse(startIso) / 1000),
          Math.floor(Date.parse(endIso) / 1000),
        );
        const transcripts = buildDayTranscripts({
          messages,
          names,
          savedSenders,
          dayKey,
          selfAliases: config.SELF_ALIASES,
        });
        for (const t of transcripts) {
          if (state.has(t.jid, t.dayKey)) {
            summary.skipped += 1;
            continue;
          }
          try {
            await ingest(t.payload);
            state.record(t.jid, t.dayKey, Math.floor(now.getTime() / 1000));
            summary.pushed += 1;
          } catch (error) {
            summary.failed += 1;
            console.error(
              JSON.stringify({ type: "push-failed", transcriptId: t.payload.transcriptId, error: String(error) }),
            );
          }
        }
      }
      return summary;
    } finally {
      state.close();
    }
  } finally {
    archive.close();
  }
}
