/**
 * CLI entry: push completed-day WhatsApp transcripts into Memory.
 * Usage: `bun run push` or `bun run push --backfill 60` (one-shot deeper window).
 */
import { loadConfig } from "./config.ts";
import { execFileSync } from "node:child_process";
import { isArchiveStale, runPush } from "./pusher.ts";

const args = process.argv.slice(2);
const backfillIdx = args.indexOf("--backfill");
const overrides: Record<string, string | undefined> = { ...process.env };
if (backfillIdx >= 0) {
  const raw = args[backfillIdx + 1];
  if (raw === undefined) {
    console.error("usage: push --backfill <positive integer>");
    process.exit(1);
  }
  // Let Zod coerce + validate (positive int); a bad value throws a clear config error.
  overrides.BACKFILL_DAYS = raw;
}

const config = loadConfig(overrides);
const summary = await runPush(config);
console.log(JSON.stringify({ type: "push-summary", ...summary }));

if (isArchiveStale(summary.lastMessageTimestamp, new Date())) {
  const message = "No new WhatsApp messages archived in 24h. Check the gateway: curl http://127.0.0.1:3036/status";
  console.error(JSON.stringify({ type: "archive-stale", lastMessageTimestamp: summary.lastMessageTimestamp }));
  // launchd runs this unattended, so a desktop notification is the only signal a person sees.
  execFileSync("osascript", ["-e", `display notification ${JSON.stringify(message)} with title "whatsapp-memory"`]);
  process.exit(1);
}
