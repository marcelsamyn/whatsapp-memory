/**
 * CLI entry: push completed-day WhatsApp transcripts into Memory.
 * Usage: `bun run push` or `bun run push --backfill 60` (one-shot deeper window).
 */
import { loadConfig } from "./config";
import { runPush } from "./pusher";

const args = process.argv.slice(2);
const backfillIdx = args.indexOf("--backfill");
const base = loadConfig();
const config =
  backfillIdx >= 0 && Number.isFinite(Number(args[backfillIdx + 1]))
    ? { ...base, BACKFILL_DAYS: Number(args[backfillIdx + 1]) }
    : base;

const summary = await runPush(config);
console.log(JSON.stringify({ type: "push-summary", ...summary }));
