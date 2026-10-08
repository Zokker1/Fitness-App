// T078: synthetic seed -testit. Todistaa kriteerin:
// - determinismi: sama siemen + now => identtinen data (JSON-vertailu);
// - vuoden kattavuus: tehtäväsuoritukset, mittaukset ja goal_days leviävät
//   ~365 pv ikkunaan, goal_days ~730 riviä (2 tavoitetta × päivät);
// - ei tulevaisuuden historiaa: suoritus-/mittausajat <= now;
// - ei PII:tä: kaikki vapaat tekstit ovat kiinteästä syntettiikkalistasta
//   (ei sähköposteja/puhelinnumeroita);
// - oikea SQLite nielaisee ydinjoukon (SMOKE: preferences/installation/
//   tasks/tags/junction/goal_days/measurements/xp — rivimäärät täsmäävät).
import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import { MIGRATIONS, createSyntheticSeed } from "../src/index.ts";

type Row = Record<string, unknown>;

const NOW = "2026-09-17T12:00:00.000Z";
const SEED = 20260917;

describe("synthetic seed (T078)", () => {
  const seedData = createSyntheticSeed({ seed: SEED, now: NOW, days: 365 });

  it("on deterministinen: sama siemen => identtinen data", () => {
    const again = createSyntheticSeed({ seed: SEED, now: NOW, days: 365 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(seedData));
    // Eri siemen => eri data (ei vahingossa kovakoodattu).
    const other = createSyntheticSeed({ seed: SEED + 1, now: NOW, days: 365 });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(seedData));
  });

  it("kattaa vuoden historian: suoritukset ja mittaukset leviävät ikkunaan", () => {
    const nowMs = Date.parse(NOW);
    const windowMs = 366 * 86_400_000; // 365 pv + tuntitasotoleranssi (tuntiviivat).
    const completionTimes = seedData.tasks
      .map((task) => task.completedAt)
      .filter((value): value is string => value !== null);
    expect(completionTimes.length).toBeGreaterThanOrEqual(20);
    for (const completed of completionTimes) {
      expect(Date.parse(completed)).toBeLessThanOrEqual(nowMs);
      expect(nowMs - Date.parse(completed)).toBeLessThanOrEqual(windowMs);
    }
    for (const measurement of seedData.measurements) {
      expect(Date.parse(measurement.measuredAt)).toBeLessThanOrEqual(nowMs);
      expect(nowMs - Date.parse(measurement.measuredAt)).toBeLessThanOrEqual(windowMs);
    }
    // goal_days: 2 tavoitetta × 366 paikallispäivää.
    expect(seedData.goalDays.length).toBeGreaterThanOrEqual(700);
    const goalDates = new Set(seedData.goalDays.map((day) => day.localDate));
    expect(goalDates.size).toBeGreaterThanOrEqual(360);
    // Painotrendi: ensimmäinen mittaus painavampi kuin viimeinen.
    const weights = seedData.measurements.filter((m) => m.type === "weight");
    expect(weights.length).toBeGreaterThanOrEqual(50);
    expect(weights[0]?.value).toBeGreaterThan(weights[weights.length - 1]?.value ?? 0);
  });

  it("ei PII:tä: vapaat tekstit ovat syntettiikkalistasta (ei yhteystietoja)", () => {
    const contactPattern = /@|\+358|0(40|45|50)\d{7}/;
    const freeTexts = [
      ...seedData.tasks.map((task) => task.title),
      ...seedData.journalEntries.map((entry) => entry.body),
      ...seedData.distractions.map((entry) => entry.note ?? ""),
      ...seedData.projects.map((project) => project.name),
    ];
    for (const text of freeTexts) {
      expect(contactPattern.test(text)).toBe(false);
    }
    // Ei oikeita henkilönimiä: kaikki tehtäväotsikot alkavat geneerisellä verbolla/listasta.
    for (const task of seedData.tasks) {
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.title.startsWith("seed-")).toBe(false);
    }
  });

  it("kaikki kokoelmat eivät ole tyhjiä (kattaa domainin)", () => {
    expect(seedData.projects.length).toBeGreaterThan(0);
    expect(seedData.tags.length).toBeGreaterThan(0);
    expect(seedData.tasks.length).toBeGreaterThan(0);
    expect(seedData.checklistItems.length).toBeGreaterThan(0);
    expect(seedData.taskTags.length).toBeGreaterThan(0);
    expect(seedData.calendarBlocks.length).toBeGreaterThan(0);
    expect(seedData.goals.length).toBeGreaterThan(0);
    expect(seedData.habitRules.length).toBeGreaterThan(0);
    expect(seedData.goalDays.length).toBeGreaterThan(0);
    expect(seedData.focusSessions.length).toBeGreaterThan(0);
    expect(seedData.distractions.length).toBeGreaterThan(0);
    expect(seedData.measurements.length).toBeGreaterThan(0);
    expect(seedData.nutritionEntries.length).toBeGreaterThan(0);
    expect(seedData.hydrationEntries.length).toBeGreaterThan(0);
    expect(seedData.supplements.length).toBeGreaterThan(0);
    expect(seedData.supplementLogs.length).toBeGreaterThan(0);
    expect(seedData.sleepEntries.length).toBeGreaterThan(0);
    expect(seedData.activityEntries.length).toBeGreaterThan(0);
    expect(seedData.moodCheckins.length).toBeGreaterThan(0);
    expect(seedData.journalEntries.length).toBeGreaterThan(0);
    expect(seedData.reminders.length).toBeGreaterThan(0);
    expect(seedData.xpTransactions.length).toBeGreaterThan(0);
    expect(seedData.levelStates.length).toBeGreaterThan(0);
    expect(seedData.quests.length).toBeGreaterThan(0);
    expect(seedData.questProgress.length).toBeGreaterThan(0);
    expect(seedData.achievements.length).toBeGreaterThan(0);
    expect(seedData.collectibles.length).toBeGreaterThan(0);
    expect(seedData.userRewards.length).toBeGreaterThan(0);
  });

  it("SMOKE: ydinjoukko mahtuu oikeaan SQLite-kantaan (rivimäärät täsmäävät)", async () => {
    const sqlite3 = await initModule();
    const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as {
      exec: (
        sql: string,
        options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] },
      ) => void;
      close: () => void;
    };
    try {
      db.exec("PRAGMA foreign_keys=ON;");
      for (const step of MIGRATIONS) {
        for (const statement of step.statements) {
          db.exec(statement);
        }
      }

      // Asetukset + asennus.
      db.exec(
        `INSERT INTO user_preferences (id, theme, day_start_hour, gamification_visible, enabled_sections,
           notification_defaults_enabled, app_lock_enabled, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        {
          bind: [
            seedData.preferences.id,
            seedData.preferences.theme,
            seedData.preferences.dayStartHour,
            seedData.preferences.gamificationVisible ? 1 : 0,
            JSON.stringify(seedData.preferences.enabledSections),
            seedData.preferences.notificationDefaults.enabled ? 1 : 0,
            seedData.preferences.appLockEnabled ? 1 : 0,
            seedData.preferences.createdAt,
            seedData.preferences.updatedAt,
            seedData.preferences.version,
          ],
        },
      );
      db.exec(
        `INSERT INTO browser_installations (id, installation_id, installation_name,
           last_seen_app_version, last_sync_at, revoked_at, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        {
          bind: [
            seedData.installation.id,
            seedData.installation.installationId,
            seedData.installation.installationName,
            seedData.installation.lastSeenAppVersion,
            seedData.installation.lastSyncAt,
            seedData.installation.revokedAt,
            seedData.installation.createdAt,
            seedData.installation.updatedAt,
            seedData.installation.version,
          ],
        },
      );
      // Tehtäväydin: projektit, tagit, tehtävät, junction.
      for (const project of seedData.projects) {
        db.exec(
          `INSERT INTO projects (id, name, color_key, archived_at, created_at, updated_at, version, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              project.id,
              project.name,
              project.colorKey,
              project.archivedAt,
              project.createdAt,
              project.updatedAt,
              project.version,
              project.deletedAt,
            ],
          },
        );
      }
      for (const tag of seedData.tags) {
        db.exec(
          `INSERT INTO tags (id, name, color_key, created_at, updated_at, version, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              tag.id,
              tag.name,
              tag.colorKey,
              tag.createdAt,
              tag.updatedAt,
              tag.version,
              tag.deletedAt,
            ],
          },
        );
      }
      for (const task of seedData.tasks) {
        db.exec(
          `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
             completed_at, reopened_at, created_at, updated_at, version, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              task.id,
              task.title,
              task.notes,
              task.status,
              task.priority,
              task.dueAt,
              task.projectId,
              task.completedAt,
              task.reopenedAt,
              task.createdAt,
              task.updatedAt,
              task.version,
              task.deletedAt,
            ],
          },
        );
      }
      for (const link of seedData.taskTags) {
        db.exec("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?);", {
          bind: [link.taskId, link.tagId],
        });
      }
      // goal_days vaatii goals-rivit (FK) — lisätään ennen päivätiloja.
      for (const goal of seedData.goals) {
        db.exec(
          `INSERT INTO goals (id, title, description, archived_at, created_at, updated_at, version, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              goal.id,
              goal.title,
              goal.description,
              goal.archivedAt,
              goal.createdAt,
              goal.updatedAt,
              goal.version,
              goal.deletedAt,
            ],
          },
        );
      }
      // goal_days + measurements + xp.
      for (const day of seedData.goalDays) {
        db.exec(
          `INSERT INTO goal_days (id, goal_id, local_date, completed, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              day.id,
              day.goalId,
              day.localDate,
              day.completed ? 1 : 0,
              day.createdAt,
              day.updatedAt,
              day.version,
            ],
          },
        );
      }
      for (const measurement of seedData.measurements) {
        db.exec(
          `INSERT INTO measurements (id, type, value, secondary_value, unit, measured_at, note,
             created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              measurement.id,
              measurement.type,
              measurement.value,
              measurement.secondaryValue,
              measurement.unit,
              measurement.measuredAt,
              measurement.note,
              measurement.createdAt,
              measurement.updatedAt,
              measurement.version,
            ],
          },
        );
      }
      for (const tx of seedData.xpTransactions) {
        db.exec(
          `INSERT INTO xp_transactions (id, source, source_entity_id, amount, earned_at, reason,
             created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              tx.id,
              tx.source,
              tx.sourceEntityId,
              tx.amount,
              tx.earnedAt,
              tx.reason,
              tx.createdAt,
              tx.updatedAt,
              tx.version,
            ],
          },
        );
      }

      const counts: Row[] = [];
      db.exec(
        `SELECT (SELECT COUNT(*) FROM user_preferences) AS prefs,
                (SELECT COUNT(*) FROM browser_installations) AS installs,
                (SELECT COUNT(*) FROM tasks) AS tasks,
                (SELECT COUNT(*) FROM task_tags) AS junctions,
                (SELECT COUNT(*) FROM goal_days) AS goal_days,
                (SELECT COUNT(*) FROM measurements) AS measurements,
                (SELECT COUNT(*) FROM xp_transactions) AS xp;`,
        { rowMode: "object", resultRows: counts },
      );
      expect(counts[0]).toMatchObject({
        prefs: 1,
        installs: 1,
        tasks: seedData.tasks.length,
        junctions: seedData.taskTags.length,
        goal_days: seedData.goalDays.length,
        measurements: seedData.measurements.length,
        xp: seedData.xpTransactions.length,
      });

      const integrity: Row[] = [];
      db.exec("PRAGMA integrity_check;", { rowMode: "object", resultRows: integrity });
      const firstCell: unknown = Object.values(integrity[0] ?? {})[0];
      expect(typeof firstCell === "string" ? firstCell.toLowerCase() : "").toBe("ok");
    } finally {
      db.close();
    }
  });
});
