/**
 * CLI entry: push completed-day WhatsApp transcripts into Memory.
 * Usage: `bun run push` or `bun run push --backfill 60` (one-shot deeper window).
 */
import { loadConfig } from "./config";
import { runPush } from "./pusher";

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
