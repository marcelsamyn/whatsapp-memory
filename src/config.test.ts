import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

const base = { PETALS_API_KEY: "petals-x", SELF_ALIASES: "Marcel, +32123" };

describe("loadConfig", () => {
  test("parses SELF_ALIASES into a trimmed list and applies defaults", () => {
    const cfg = loadConfig(base);
    expect(cfg.SELF_ALIASES).toEqual(["Marcel", "+32123"]);
    expect(cfg.PETALS_BASE_URL).toBe("https://petals.chat");
    expect(cfg.WHATSAPP_GROUP_FILTER).toBe("contacts");
    expect(cfg.BACKFILL_DAYS).toBe(30);
    expect(cfg.TIMEZONE).toBe("Europe/Brussels");
    expect(cfg.WHATSAPP_ARCHIVE_PATH.startsWith("~")).toBe(false);
    expect(cfg.WHATSAPP_ARCHIVE_PATH.endsWith("/.screenpipe-distiller/whatsapp/messages.sqlite")).toBe(true);
    expect(cfg.PUSH_STATE_PATH.endsWith("/.screenpipe-distiller/whatsapp/push-state.sqlite")).toBe(true);
  });

  test("requires PETALS_API_KEY", () => {
    expect(() => loadConfig({ SELF_ALIASES: "Marcel" })).toThrow();
  });

  test("requires SELF_ALIASES", () => {
    expect(() => loadConfig({ PETALS_API_KEY: "petals-x" })).toThrow();
  });

  test("coerces BACKFILL_DAYS and honors overrides", () => {
    const cfg = loadConfig({ PETALS_API_KEY: "k", SELF_ALIASES: "Me", BACKFILL_DAYS: "7", WHATSAPP_GROUP_FILTER: "all", TIMEZONE: "UTC" });
    expect(cfg.BACKFILL_DAYS).toBe(7);
    expect(cfg.WHATSAPP_GROUP_FILTER).toBe("all");
    expect(cfg.TIMEZONE).toBe("UTC");
  });
});
