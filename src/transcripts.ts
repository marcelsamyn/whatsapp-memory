/**
 * Builds per-(chat, day) WhatsApp transcript payloads from archived messages.
 * Aliases: whatsapp transcript builder, segmented utterances, day transcripts.
 */
import type { ArchivedMessage } from "./archive.ts";

export interface TranscriptUtterance {
  speakerLabel: string;
  content: string;
  timestamp: string; // ISO
}

export interface TranscriptPayload {
  transcriptId: string;
  scope: "personal";
  occurredAt: string; // ISO
  content: { kind: "segmented"; utterances: TranscriptUtterance[] };
  userSelfAliasesOverride: string[];
}

/** One transcript plus the (jid, day) key used to watermark it. */
export interface DayTranscript {
  jid: string;
  dayKey: string;
  payload: TranscriptPayload;
}

export interface BuildParams {
  /** A single local day's messages (any order). */
  messages: readonly ArchivedMessage[];
  names: Map<string, string>;
  /** Saved-contact jids to keep in groups (+ me); null disables group filtering ("all"). */
  savedSenders: Set<string> | null;
  dayKey: string;
  /** Non-empty; [0] is the label emitted for the user's own messages. */
  selfAliases: string[];
}

function phoneFromJid(jid: string): string {
  const [user] = jid.split("@");
  return `+${user ?? jid}`;
}

export function buildDayTranscripts(params: BuildParams): DayTranscript[] {
  const self = params.selfAliases[0] ?? "Me";
  const byJid = new Map<string, ArchivedMessage[]>();
  for (const message of params.messages) {
    const list = byJid.get(message.jid) ?? [];
    list.push(message);
    byJid.set(message.jid, list);
  }

  const transcripts: DayTranscript[] = [];
  for (const [jid, msgs] of byJid) {
    const isGroup = jid.endsWith("@g.us");
    const ordered = [...msgs].sort((a, b) => a.timestamp - b.timestamp);
    const utterances = ordered.flatMap((m): TranscriptUtterance[] => {
      // In groups, drop messages from senders who aren't saved contacts (or me).
      if (isGroup && params.savedSenders && !m.fromMe && !params.savedSenders.has(m.sender)) return [];
      const content = m.text?.trim();
      if (!content) return []; // drop media-only / empty (captions are stored as text and survive)
      const speakerLabel = m.fromMe ? self : (params.names.get(m.sender) ?? phoneFromJid(m.sender));
      return [{ speakerLabel, content, timestamp: new Date(m.timestamp * 1000).toISOString() }];
    });
    if (utterances.length === 0) continue;
    transcripts.push({
      jid,
      dayKey: params.dayKey,
      payload: {
        transcriptId: `whatsapp-${jid}-${params.dayKey}`,
        scope: "personal",
        occurredAt: utterances[0]!.timestamp,
        content: { kind: "segmented", utterances },
        userSelfAliasesOverride: params.selfAliases,
      },
    });
  }
  return transcripts;
}
