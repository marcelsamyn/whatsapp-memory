import { describe, expect, test } from "bun:test";
import { previousDayKey, recentCompletedDayKeys, dayWindowUtc, yesterdayKey } from "./date-utils";

describe("yesterdayKey", () => {
  test("is correct across the autumn fall-back boundary (Europe/Brussels)", () => {
    // 2026-10-25 ~01:30 local is still Oct 25; yesterday must be Oct 24.
    expect(yesterdayKey(new Date("2026-10-24T23:30:00Z"), "Europe/Brussels")).toBe("2026-10-24");
  });
});

describe("previousDayKey", () => {
  test("steps back one calendar day across month/year boundaries", () => {
    expect(previousDayKey("2026-06-02")).toBe("2026-06-01");
    expect(previousDayKey("2026-06-01")).toBe("2026-05-31");
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");
  });
});

describe("recentCompletedDayKeys", () => {
  test("returns N completed local days, newest first, excluding today", () => {
    // 18:00Z on the 16th is still the 16th in Brussels (UTC+2) → today=16th, excluded.
    const now = new Date("2026-06-16T18:00:00Z");
    expect(recentCompletedDayKeys(now, "Europe/Brussels", 3)).toEqual([
      "2026-06-15",
      "2026-06-14",
      "2026-06-13",
    ]);
  });
});

describe("dayWindowUtc", () => {
  test("brackets a Brussels day in UTC (DST: UTC+2 in June)", () => {
    expect(dayWindowUtc("2026-06-15", "Europe/Brussels")).toEqual({
      startIso: "2026-06-14T22:00:00.000Z",
      endIso: "2026-06-15T22:00:00.000Z",
    });
  });
});
