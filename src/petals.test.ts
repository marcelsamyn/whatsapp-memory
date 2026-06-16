import { describe, expect, test } from "bun:test";
import { ingestTranscript, IngestError } from "./petals";
import type { TranscriptPayload } from "./transcripts";

const payload: TranscriptPayload = {
  transcriptId: "whatsapp-p@s.whatsapp.net-2026-06-15",
  scope: "personal",
  occurredAt: "2026-06-15T08:00:00.000Z",
  content: { kind: "segmented", utterances: [{ speakerLabel: "Pat", content: "yo", timestamp: "2026-06-15T08:00:00.000Z" }] },
  userSelfAliasesOverride: ["Marcel"],
};
const config = { baseUrl: "https://petals.test", apiKey: "petals-k" };
const noSleep = async () => {};

describe("ingestTranscript", () => {
  test("posts to the transcript endpoint with x-api-key and returns jobId", async () => {
    let seen: { url: string; headers: Record<string, string>; body: unknown } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = {
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      };
      return new Response(JSON.stringify({ message: "queued", jobId: "job_1", sourceId: "src_1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await ingestTranscript(payload, config, { fetchImpl, sleep: noSleep });
    expect(res.jobId).toBe("job_1");
    expect(seen!.url).toBe("https://petals.test/api/memory/ingest/transcript");
    expect(seen!.headers["x-api-key"]).toBe("petals-k");
    expect(seen!.body).toEqual(payload); // no userId sent
  });

  test("throws on 4xx without retrying", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("bad", { status: 400 });
    }) as unknown as typeof fetch;
    await expect(ingestTranscript(payload, config, { fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(IngestError);
    expect(calls).toBe(1);
  });

  test("retries 5xx then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls < 2
        ? new Response("oops", { status: 503 })
        : new Response(JSON.stringify({ message: "queued", jobId: "job_2" }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await ingestTranscript(payload, config, { fetchImpl, sleep: noSleep });
    expect(res.jobId).toBe("job_2");
    expect(calls).toBe(2);
  });

  test("throws after exhausting all retries on persistent 5xx", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("err", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(ingestTranscript(payload, config, { fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(IngestError);
    expect(calls).toBe(4);
  });

  test("retries a 429 rate-limit then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls < 2
        ? new Response("rate limited", { status: 429 })
        : new Response(JSON.stringify({ message: "queued", jobId: "job_429" }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await ingestTranscript(payload, config, { fetchImpl, sleep: noSleep });
    expect(res.jobId).toBe("job_429");
    expect(calls).toBe(2);
  });
});
