// T033: domain-sääntöjen unit-testit (T026-säännöt lukittuna).
import { describe, expect, it } from "vitest";
import type { FocusSession, Task } from "../src/index.ts";
import {
  assertEntityId,
  assertInstallationActive,
  completeTask,
  deleteTask,
  filterUnseenOperations,
  isBefore,
  isDuplicateOperation,
  reopenTask,
  restoreTask,
  revokeInstallation,
  toLocalDateKey,
  touchInstallation,
  transitionFocus,
  validateUserPreferencesValues,
} from "../src/index.ts";

const AT = "2026-09-15T12:00:00.000Z";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-0001",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Testi",
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId: null,
    tagIds: [],
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
    ...overrides,
  };
}

function focus(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "f-0001",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    taskId: null,
    routineId: null,
    phase: "planned",
    startedAt: null,
    endedAt: null,
    durationSeconds: null,
    ...overrides,
  };
}

describe("task lifecycle", () => {
  it("complete merkitsee valmiiksi", () => {
    const result = completeTask(task(), AT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("done");
      expect(result.value.completedAt).toBe(AT);
    }
  });

  it("tupla-complete hylätään", () => {
    expect(completeTask(task({ status: "done" }), AT).ok).toBe(false);
  });

  it("reopen palauttaa avoimeksi", () => {
    const result = reopenTask(task({ status: "done" }), AT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("open");
      expect(result.value.reopenedAt).toBe(AT);
    }
  });

  it("avoimen reopen hylätään", () => {
    expect(reopenTask(task(), AT).ok).toBe(false);
  });

  it("T100: delete merkitsee tombstonen, restore palauttaa", () => {
    const deleted = deleteTask(task(), AT);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.value.deletedAt).toBe(AT);
    }
    // Idempotentti: toinen delete hylätään.
    expect(deleteTask(task({ deletedAt: AT }), AT).ok).toBe(false);
    // Restore: tombstone poistuu.
    const restored = restoreTask(task({ deletedAt: AT }));
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.value.deletedAt).toBeNull();
    }
    // Restore avoimeen hylätään.
    expect(restoreTask(task()).ok).toBe(false);
  });
});

describe("focus lifecycle", () => {
  it("planned -> running -> completed", () => {
    const running = transitionFocus(focus(), "running");
    expect(running.ok).toBe(true);
    if (running.ok) {
      expect(transitionFocus(running.value, "completed").ok).toBe(true);
    }
  });

  it("planned -> completed hylätään (ei hyppyä)", () => {
    expect(transitionFocus(focus(), "completed").ok).toBe(false);
  });

  it("completed on pääte", () => {
    expect(transitionFocus(focus({ phase: "completed" }), "running").ok).toBe(false);
  });
});

describe("sync dedupe + aika", () => {
  it("operationId suodattaa duplikaatit", () => {
    const base = {
      id: "op-base",
      createdAt: AT,
      updatedAt: AT,
      version: 1,
      installationId: "inst-1",
      entityType: "task",
      entityId: "t-1",
      operation: "create",
      entityVersion: 1,
      occurredAt: AT,
      encryptedPayloadRef: "ref",
      integrityRef: "hash",
    } as const;
    const ops = [
      { ...base, id: "op-1", operationId: "op-1" },
      { ...base, id: "op-2", operationId: "op-2" },
    ];
    expect(filterUnseenOperations(ops, new Set(["op-1"]))).toHaveLength(1);
    expect(isDuplicateOperation("op-1", new Set(["op-1"]))).toBe(true);
    expect(isDuplicateOperation("op-3", new Set(["op-1"]))).toBe(false);
  });

  it("ISO-vertailu on kronologinen", () => {
    expect(isBefore("2026-09-14T00:00:00.000Z", AT)).toBe(true);
    expect(isBefore(AT, AT)).toBe(false);
  });

  it("local-date-avain offsetilla", () => {
    expect(toLocalDateKey("2026-09-15T00:30:00.000Z", -120)).toBe("2026-09-14");
    expect(toLocalDateKey("2026-09-15T00:30:00.000Z", 0)).toBe("2026-09-15");
  });

  it("tyhjä id hylätään", () => {
    expect(assertEntityId("   ").ok).toBe(false);
    expect(assertEntityId("t-0001").ok).toBe(true);
  });

  it("T060: asetusarvot validoivat teema + päivän raja", () => {
    expect(validateUserPreferencesValues({ theme: "system", dayStartHour: 8 }).ok).toBe(true);
    expect(validateUserPreferencesValues({ theme: "light", dayStartHour: 0 }).ok).toBe(true);
    expect(validateUserPreferencesValues({ theme: "dark", dayStartHour: 23 }).ok).toBe(true);
    expect(validateUserPreferencesValues({ theme: "blue", dayStartHour: 8 }).ok).toBe(false);
    expect(validateUserPreferencesValues({ theme: "system", dayStartHour: -1 }).ok).toBe(false);
    expect(validateUserPreferencesValues({ theme: "system", dayStartHour: 24 }).ok).toBe(false);
    expect(validateUserPreferencesValues({ theme: "system", dayStartHour: 7.5 }).ok).toBe(false);
  });

  it("T061: asennuksen elinkaari — touch/revoke/revoked-tila", () => {
    const AT2 = "2026-09-16T08:00:00.000Z";
    const installation = {
      revokedAt: null as string | null,
    };
    // Aktiivinen: touch päivittää version merkinnän.
    const touched = touchInstallation(installation, AT2, "0.1.0");
    expect(touched.ok).toBe(true);
    if (touched.ok) {
      expect(touched.value.lastSeenAppVersion).toBe("0.1.0");
    }
    // Revokaatio asettaa aikaleiman.
    const revoked = revokeInstallation(installation, AT2);
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      expect(revoked.value.revokedAt).toBe(AT2);
      // Revokoitu: touch hylätään, toinen revokaatio hylätään.
      expect(touchInstallation({ revokedAt: AT2 }, AT, "0.1.1").ok).toBe(false);
      expect(revokeInstallation({ revokedAt: AT2 }, AT).ok).toBe(false);
      expect(assertInstallationActive({ revokedAt: AT2 }).ok).toBe(false);
    }
  });
});
