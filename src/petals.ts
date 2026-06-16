/**
 * Pushes a WhatsApp transcript into Memory via the Petals proxy. Petals injects
 * the userId from the API key, so the client sends none. Retries network/5xx
 * with exponential backoff; 4xx is a hard failure.
 */
import { z } from "zod";
import type { TranscriptPayload } from "./transcripts";

export class IngestError extends Error {}

const responseSchema = z.object({ message: z.string(), jobId: z.string() }).passthrough();

export interface IngestConfig {
  baseUrl: string;
  apiKey: string;
}

interface IngestDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function ingestTranscript(
  payload: TranscriptPayload,
  config: IngestConfig,
  deps: IngestDeps = {},
): Promise<{ jobId: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const url = `${config.baseUrl}/api/memory/ingest/transcript`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": config.apiKey },
    body: JSON.stringify(payload),
  };

  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res: Response | null = null;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      lastErr = e;
    }
    if (res) {
      if (res.ok) {
        try {
          return { jobId: responseSchema.parse(await res.json()).jobId };
        } catch (e) {
          throw new IngestError(`transcript ingest: unexpected response body: ${e}`);
        }
      }
      const text = await res.text();
      if (res.status >= 400 && res.status < 500) {
        throw new IngestError(`transcript ingest rejected ${res.status}: ${text}`);
      }
      lastErr = new IngestError(`transcript ingest failed ${res.status}: ${text}`);
    }
    if (attempt < maxAttempts) await sleep(250 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new IngestError("transcript ingest failed after retries");
}
