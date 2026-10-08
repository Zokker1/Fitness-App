import { describe, expect, it } from "vitest";
import {
  decryptLocalContent,
  encryptLocalContent,
  isLocalContentCiphertext,
} from "../src/local-content-crypto.ts";

const context = { recordType: "journal-entry", recordId: "entry-1", field: "body" } as const;

describe("local content encryption", () => {
  it("round trips UTF-8 text into an opaque, versioned envelope", () => {
    const key = new Uint8Array(32).fill(7);
    const encrypted = encryptLocalContent("Päivän yksityinen merkintä 🫧", key, context);

    expect(isLocalContentCiphertext(encrypted)).toBe(true);
    expect(encrypted).not.toContain("yksityinen");
    expect(decryptLocalContent(encrypted, key, context)).toBe("Päivän yksityinen merkintä 🫧");
  });

  it("rejects ciphertext copied to another field and tampered envelopes", () => {
    const key = new Uint8Array(32).fill(9);
    const encrypted = encryptLocalContent("secret", key, context);

    expect(() => decryptLocalContent(encrypted, key, { ...context, field: "title" })).toThrow();
    const middle = Math.floor(encrypted.length / 2);
    const replacement = encrypted[middle] === "A" ? "B" : "A";
    expect(() =>
      decryptLocalContent(
        `${encrypted.slice(0, middle)}${replacement}${encrypted.slice(middle + 1)}`,
        key,
        context,
      ),
    ).toThrow();
  });

  it("rejects the wrong key and malformed envelopes", () => {
    const encrypted = encryptLocalContent("secret", new Uint8Array(32).fill(1), context);

    expect(() => decryptLocalContent(encrypted, new Uint8Array(32).fill(2), context)).toThrow();
    expect(() => decryptLocalContent("lifeos-private-v1:!", new Uint8Array(32), context)).toThrow();
  });
});
