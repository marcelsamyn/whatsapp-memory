import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushState } from "./push-state.ts";

const paths: string[] = [];
const tempPath = (): string => {
  const path = join(tmpdir(), `wa-push-${crypto.randomUUID()}.sqlite`);
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

describe("PushState", () => {
  test("has() is false until record(), then true", () => {
    const state = new PushState(tempPath());
    expect(state.has("p@s.whatsapp.net", "2026-06-15")).toBe(false);
    state.record("p@s.whatsapp.net", "2026-06-15", 1_700_000_000);
    expect(state.has("p@s.whatsapp.net", "2026-06-15")).toBe(true);
    expect(state.has("p@s.whatsapp.net", "2026-06-14")).toBe(false);
    state.close();
  });

  test("persists across reopen", () => {
    const path = tempPath();
    const first = new PushState(path);
    first.record("g@g.us", "2026-06-15", 1_700_000_000);
    first.close();
    const second = new PushState(path);
    expect(second.has("g@g.us", "2026-06-15")).toBe(true);
    second.close();
  });
});
