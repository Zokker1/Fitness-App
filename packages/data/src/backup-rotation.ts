// T322: deterministic retention policy for encrypted backups created while the app is active.

export const BACKUP_ROTATION_RETENTION = {
  daily: 7,
  weekly: 4,
  monthly: 12,
} as const;

export interface BackupRotationPeriods {
  readonly daily: string | null;
  readonly weekly: string | null;
  readonly monthly: string | null;
}

export interface BackupRotationRecord extends BackupRotationPeriods {
  readonly id: string;
  readonly createdAt: string;
}

export interface BackupRotationBuckets {
  readonly daily: string;
  readonly weekly: string;
  readonly monthly: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Uses UTC and ISO weeks so different local time zones rotate the same backup set consistently. */
export function backupRotationBuckets(at: Date): BackupRotationBuckets {
  if (!Number.isFinite(at.getTime())) throw new RangeError("Backup rotation time is invalid.");
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + 1;
  const day = at.getUTCDate();
  const weekday = at.getUTCDay() || 7;
  const monday = new Date(Date.UTC(year, month - 1, day - weekday + 1));
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const weekOneMonday = new Date(Date.UTC(isoYear, 0, 4));
  weekOneMonday.setUTCDate(weekOneMonday.getUTCDate() - ((weekOneMonday.getUTCDay() || 7) - 1));
  const week =
    Math.floor((monday.getTime() - weekOneMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

  return {
    daily: `${String(year)}-${pad(month)}-${pad(day)}`,
    weekly: `${String(isoYear)}-W${pad(week)}`,
    monthly: `${String(year)}-${pad(month)}`,
  };
}

/** Return only retention tiers that do not yet have a backup in the current bucket. */
export function dueBackupRotationPeriods(
  records: readonly BackupRotationRecord[],
  at: Date,
): BackupRotationPeriods {
  const current = backupRotationBuckets(at);
  return {
    daily: records.some((record) => record.daily === current.daily) ? null : current.daily,
    weekly: records.some((record) => record.weekly === current.weekly) ? null : current.weekly,
    monthly: records.some((record) => record.monthly === current.monthly) ? null : current.monthly,
  };
}

/** Keep one copy for each of the newest 7 daily, 4 weekly, and 12 monthly buckets. */
export function retainBackupRotationRecords<T extends BackupRotationRecord>(
  records: readonly T[],
): readonly T[] {
  const newestFirst = [...records].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
  const keptIds = new Set<string>();

  for (const tier of ["daily", "weekly", "monthly"] as const) {
    const keptBuckets = new Set<string>();
    let keptCount = 0;
    for (const record of newestFirst) {
      const bucket = record[tier];
      if (bucket === null || keptBuckets.has(bucket)) continue;
      if (keptCount === BACKUP_ROTATION_RETENTION[tier]) break;
      keptBuckets.add(bucket);
      keptIds.add(record.id);
      keptCount += 1;
    }
  }

  return records.filter((record) => keptIds.has(record.id));
}
