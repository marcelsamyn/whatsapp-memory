/**
 * Loads + validates all runtime configuration from the environment.
 * Boundary parse: call once, then trust the typed Config everywhere.
 */
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";

/** Expand a leading `~/` to the user's home dir; concrete requirement of the default paths. */
function expandTilde(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

const configSchema = z.object({
  PETALS_BASE_URL: z.string().url().default("https://petals.chat"),
  PETALS_API_KEY: z.string().min(1),
  WHATSAPP_ARCHIVE_PATH: z
    .string()
    .default("~/.screenpipe-distiller/whatsapp/messages.sqlite")
    .transform(expandTilde),
  PUSH_STATE_PATH: z
    .string()
    .default("~/.screenpipe-distiller/whatsapp/push-state.sqlite")
    .transform(expandTilde),
  // Group-message relevance: "contacts" keeps only saved address-book contacts +
  // you; "all" keeps every group message. 1:1 chats are never filtered.
  WHATSAPP_GROUP_FILTER: z.enum(["contacts", "all"]).default("contacts"),
  TIMEZONE: z
    .string()
    .min(1)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "TIMEZONE must be a valid IANA timezone")
    .default("Europe/Brussels"),
  BACKFILL_DAYS: z.coerce.number().int().positive().default(30),
  // Comma-separated; [0] is emitted as the speaker label for your own messages,
  // the full list is sent as userSelfAliasesOverride.
  SELF_ALIASES: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((a) => a.trim()).filter(Boolean))
    .refine((a) => a.length > 0, "SELF_ALIASES must list at least one alias"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return configSchema.parse(env);
}
