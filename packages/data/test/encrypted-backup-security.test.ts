import { afterEach, describe, expect, it } from "vitest";
import type { PortableDataCollections, PortableDataSettings } from "../src/index.ts";
import {
  createDataKeySession,
  createEncryptedBackup,
  ENCRYPTED_BACKUP_FORMAT,
  MAX_ENCRYPTED_BACKUP_FILE_BYTES,
  openEncryptedBackup,
  parseEncryptedBackup,
  PORTABLE_DATA_COLLECTION_KEYS,
  serializeEncryptedBackup,
  type EncryptedBackup,
  type PortableDataSnapshotInput,
} from "../src/index.ts";

const sessions: { lock: () => void }[] = [];
const EXPORTED_AT = "2026-10-03T12:00:00.000Z";
const SECRET_MARKER = "private-journal-note-7d23";

function emptyCollections(): PortableDataCollections {
  return Object.fromEntries(
    PORTABLE_DATA_COLLECTION_KEYS.map((key) => [key, []]),
  ) as unknown as PortableDataCollections;
}

const settings: PortableDataSettings = {
  theme: "system",
  dayStartHour: 8,
  gamificationVisible: true,
  enabledSections: null,
  notificationDefaultsEnabled: null,
  appLockEnabled: null,
  weightTarget: null,
  heightCm: null,
  mealSlots: [],
  macroTargets: {
    caloriesKcal: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fiberG: null,
  },
  hydrationTargetMl: null,
  hydrationReminderTime: null,
  favoriteFoodIds: [],
};

function createSession(fill: number) {
  const session = createDataKeySession(new Uint8Array(32).fill(fill));
  if (session === null) throw new Error("Could not create test key session.");
  sessions.push(session);
  return session;
}

function snapshot(): PortableDataSnapshotInput {
  const collections = emptyCollections();
  return {
    exportedAt: EXPORTED_AT,
    settings,
    collections: {
      ...collections,
      journalEntries: [
        {
          id: "journal-1",
          note: SECRET_MARKER,
        } as unknown as PortableDataCollections["journalEntries"][number],
      ],
    },
  };
}

async function encryptedFixture(): Promise<EncryptedBackup> {
  const encrypted = await createEncryptedBackup(snapshot(), createSession(3));
  expect(encrypted.ok).toBe(true);
  if (!encrypted.ok) throw new Error("Could not encrypt backup test fixture.");
  return encrypted.value;
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.lock();
});

describe("encrypted backup security boundary", () => {
  it("keeps snapshot contents out of the envelope and opens them only with the data key", async () => {
    const backup = await encryptedFixture();
    const serialized = serializeEncryptedBackup(backup);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    expect(serialized.value).toContain(ENCRYPTED_BACKUP_FORMAT);
    expect(serialized.value).not.toContain(SECRET_MARKER);
    const parsed = parseEncryptedBackup(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const opened = await openEncryptedBackup(parsed.value, createSession(3));
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(JSON.stringify(opened.value.payload)).toContain(SECRET_MARKER);
    }
    await expect(openEncryptedBackup(backup, createSession(4))).resolves.toMatchObject({
      ok: false,
      error: { code: "authentication-failed" },
    });
  });

  it("authenticates clear manifest metadata and encrypted bytes", async () => {
    const backup = await encryptedFixture();
    const otherTimestamp = {
      ...backup,
      manifest: { ...backup.manifest, updatedAt: "2026-10-03T12:01:00.000Z" },
    };
    const changedFirstByte = backup.encryptedDataHex[0] === "0" ? "1" : "0";
    const changedCiphertext = {
      ...backup,
      encryptedDataHex: `${changedFirstByte}${backup.encryptedDataHex.slice(1)}`,
    };

    await expect(openEncryptedBackup(otherTimestamp, createSession(3))).resolves.toMatchObject({
      ok: false,
      error: { code: "authentication-failed" },
    });
    await expect(openEncryptedBackup(changedCiphertext, createSession(3))).resolves.toMatchObject({
      ok: false,
      error: { code: "authentication-failed" },
    });
  });

  it("rejects malformed, unsupported, and oversized untrusted envelopes before decrypting", () => {
    expect(parseEncryptedBackup("not json")).toMatchObject({ ok: false });
    expect(parseEncryptedBackup(JSON.stringify({ format: ENCRYPTED_BACKUP_FORMAT }))).toMatchObject(
      {
        ok: false,
        error: { code: "invalid-format" },
      },
    );
    expect(parseEncryptedBackup(" ".repeat(MAX_ENCRYPTED_BACKUP_FILE_BYTES + 1))).toMatchObject({
      ok: false,
      error: { code: "invalid-format", diagnosticCode: "encrypted-backup.parse.too-large" },
    });
  });
});
