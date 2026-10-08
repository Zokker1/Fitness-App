import { describe, expect, it } from "vitest";
import {
  backupRotationBuckets,
  dueBackupRotationPeriods,
  retainBackupRotationRecords,
} from "../src/backup-rotation.ts";
import type { BackupRotationRecord } from "../src/backup-rotation.ts";

function record(id: string, at: Date): BackupRotationRecord {
  return {
    id,
    createdAt: at.toISOString(),
    ...backupRotationBuckets(at),
  };
}

describe("encrypted backup rotation retention", () => {
  it("uses ISO week year across the UTC year boundary", () => {
    expect(backupRotationBuckets(new Date("2021-01-01T12:00:00.000Z"))).toEqual({
      daily: "2021-01-01",
      weekly: "2020-W53",
      monthly: "2021-01",
    });
  });

  it("only marks periods as due when no retained backup covers that bucket", () => {
    const at = new Date("2026-12-31T12:00:00.000Z");
    const existing = record("existing", at);

    expect(dueBackupRotationPeriods([existing], at)).toEqual({
      daily: null,
      weekly: null,
      monthly: null,
    });
    expect(dueBackupRotationPeriods([{ ...existing, weekly: null }], at)).toEqual({
      daily: null,
      weekly: "2026-W53",
      monthly: null,
    });
  });

  it("retains the newest 12 monthly snapshots and prunes older buckets", () => {
    const records = Array.from({ length: 15 }, (_, month) => {
      const at = new Date(Date.UTC(2025, month, 15, 12));
      return record(`month-${String(month).padStart(2, "0")}`, at);
    });

    expect(retainBackupRotationRecords(records)).toEqual(records.slice(3));
  });
});
