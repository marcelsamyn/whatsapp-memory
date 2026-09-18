import { describe, expect, test } from "bun:test";
import { buildDayTranscripts } from "./transcripts.ts";
import type { ArchivedMessage } from "./archive.ts";

const msg = (
  over: Partial<ArchivedMessage> & Pick<ArchivedMessage, "id" | "jid" | "timestamp">,
): ArchivedMessage => ({
  fromMe: false,
  sender: over.jid,
  text: "hi",
  mediaType: null,
  pushName: null,
  ...over,
});

const build = (messages: ArchivedMessage[], opts: { names?: [string, string][]; saved?: string[] | null } = {}) =>
  buildDayTranscripts({
    messages,
    names: new Map(opts.names ?? []),
    savedSenders: opts.saved === undefined ? new Set() : opts.saved === null ? null : new Set(opts.saved),
    dayKey: "2026-06-15",
    selfAliases: ["Marcel", "+32123"],
  });

describe("buildDayTranscripts", () => {
  test("builds a 1:1 transcript with resolved labels, ordered utterances, occurredAt = first", () => {
    const [t] = build(
      [
        msg({ id: "2", jid: "p@s.whatsapp.net", timestamp: 110, fromMe: true, sender: "me", text: "hey" }),
        msg({ id: "1", jid: "p@s.whatsapp.net", timestamp: 100, sender: "p@s.whatsapp.net", text: "yo" }),
      ],
      { names: [["p@s.whatsapp.net", "Pat"]] },
    );
    expect(t?.jid).toBe("p@s.whatsapp.net");
    expect(t?.dayKey).toBe("2026-06-15");
    expect(t?.payload.transcriptId).toBe("whatsapp-p@s.whatsapp.net-2026-06-15");
    expect(t?.payload.scope).toBe("personal");
    expect(t?.payload.occurredAt).toBe(new Date(100_000).toISOString());
    expect(t?.payload.userSelfAliasesOverride).toEqual(["Marcel", "+32123"]);
    expect(t?.payload.content).toEqual({
      kind: "segmented",
      utterances: [
        { speakerLabel: "Pat", content: "yo", timestamp: new Date(100_000).toISOString() },
        { speakerLabel: "Marcel", content: "hey", timestamp: new Date(110_000).toISOString() },
      ],
    });
  });

  test("uses the group subject's participant names and drops media-only messages", () => {
    const [t] = build(
      [
        msg({ id: "1", jid: "trip@g.us", timestamp: 100, sender: "a@s.whatsapp.net", text: "boarding" }),
        msg({ id: "2", jid: "trip@g.us", timestamp: 110, sender: "a@s.whatsapp.net", text: null, mediaType: "image" }),
      ],
      { names: [["a@s.whatsapp.net", "Alice"]], saved: ["a@s.whatsapp.net"] },
    );
    expect(t?.payload.content.utterances).toEqual([
      { speakerLabel: "Alice", content: "boarding", timestamp: new Date(100_000).toISOString() },
    ]);
  });

  test("keeps a caption (stored as text) on a media message", () => {
    const [t] = build([msg({ id: "1", jid: "p@s.whatsapp.net", timestamp: 100, text: "look at this", mediaType: "image" })]);
    expect(t?.payload.content.utterances[0]?.content).toBe("look at this");
  });

  test("in groups, keeps saved contacts + me and drops unknown senders", () => {
    const [t] = build(
      [
        msg({ id: "1", jid: "trip@g.us", timestamp: 100, sender: "saved@s.whatsapp.net", text: "from a friend" }),
        msg({ id: "2", jid: "trip@g.us", timestamp: 110, sender: "9999@lid", text: "from a stranger" }),
        msg({ id: "3", jid: "trip@g.us", timestamp: 120, fromMe: true, sender: "me", text: "my reply" }),
      ],
      { names: [["saved@s.whatsapp.net", "Friend"]], saved: ["saved@s.whatsapp.net"] },
    );
    expect(t?.payload.content.utterances.map((u) => u.speakerLabel)).toEqual(["Friend", "Marcel"]);
    expect(t?.payload.content.utterances.map((u) => u.content)).toEqual(["from a friend", "my reply"]);
  });

  test("drops a group entirely when only unknown senders participate", () => {
    expect(
      build(
        [
          msg({ id: "1", jid: "noise@g.us", timestamp: 100, sender: "1111@lid", text: "spam" }),
          msg({ id: "2", jid: "noise@g.us", timestamp: 110, sender: "2222@lid", text: "more spam" }),
        ],
        { saved: [] },
      ),
    ).toEqual([]);
  });

  test("groupFilter 'all' (savedSenders=null) keeps unknown group senders", () => {
    const [t] = build(
      [msg({ id: "1", jid: "noise@g.us", timestamp: 100, sender: "1111@lid", text: "stranger" })],
      { saved: null },
    );
    expect(t?.payload.content.utterances[0]?.content).toBe("stranger");
  });

  test("never filters 1:1 chats and falls back to +number for unknown senders", () => {
    const [t] = build([
      msg({ id: "1", jid: "31699999999@s.whatsapp.net", timestamp: 100, sender: "31699999999@s.whatsapp.net", text: "hi" }),
    ]);
    expect(t?.payload.content.utterances[0]?.speakerLabel).toBe("+31699999999");
  });

  test("skips a chat whose only message is media-only", () => {
    expect(build([msg({ id: "1", jid: "p@s.whatsapp.net", timestamp: 100, text: null, mediaType: "image" })])).toEqual([]);
  });
});
