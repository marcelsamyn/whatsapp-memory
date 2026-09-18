import { describe, expect, test } from "bun:test";
import { toArchivedMessage } from "./message.ts";

describe("toArchivedMessage", () => {
  test("maps a text message into the archive shape", () => {
    expect(
      toArchivedMessage({
        key: {
          id: "message-1",
          remoteJid: "person@s.whatsapp.net",
          fromMe: false,
        },
        messageTimestamp: 1_700_000_000,
        pushName: "Person",
        message: { conversation: "hello" },
      }),
    ).toEqual({
      id: "message-1",
      jid: "person@s.whatsapp.net",
      fromMe: false,
      sender: "person@s.whatsapp.net",
      text: "hello",
      mediaType: null,
      timestamp: 1_700_000_000,
      pushName: "Person",
    });
  });

  test("ignores protocol messages without an archiveable payload", () => {
    expect(
      toArchivedMessage({
        key: { id: "protocol", remoteJid: "person@s.whatsapp.net" },
        message: { protocolMessage: {} },
      }),
    ).toBeNull();
  });

  test("uses the group participant as the sender", () => {
    expect(
      toArchivedMessage({
        key: {
          id: "g1",
          remoteJid: "trip@g.us",
          fromMe: false,
          participant: "alice@s.whatsapp.net",
        },
        messageTimestamp: 1_700_000_000,
        message: { conversation: "boarding now" },
      }),
    ).toMatchObject({
      jid: "trip@g.us",
      sender: "alice@s.whatsapp.net",
      text: "boarding now",
    });
  });

  test("unwraps disappearing-message payloads", () => {
    expect(
      toArchivedMessage({
        key: { id: "e1", remoteJid: "person@s.whatsapp.net", fromMe: true },
        messageTimestamp: 1_700_000_000,
        message: { ephemeralMessage: { message: { extendedTextMessage: { text: "see you at 8" } } } },
      }),
    ).toMatchObject({ id: "e1", sender: "me", text: "see you at 8" });
  });
});
