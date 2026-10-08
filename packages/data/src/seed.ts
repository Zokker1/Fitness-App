// T078: realistinen synthetic seed — deterministinen testidata joka kattaa
// vuoden historian (§33 testidata; EI oikeaa henkilötietoa: kaikki tekstit
// ovat geneerisiä esimerkkejä, id:t synthetyksiä, ei PII:tä/terveysarvoja
// oikeista henkilöistä).
// - Puhas funktio createSyntheticSeed(options): palauttaa domain-muotoiset
//   rivit KAIKILLE kestotauluille (Ei DB-kirjoituksia tässä — kutsuja
//   päättää kanavan: suora SQL testeissä, palvelukerros myöhemmin).
// - Determinismi: mulberry32-PRNG siemenellä; sama siemen + now => identtinen
//   data (todistettu testissä).
// - Kattavuus: tasks/pomodoro/mittaukset/hyvinvointi leviävät `days`-ikkunaan
//   (oletus 365 pv); goal_days päivittäishistoriana; XP derivoidaan
//   suorituksista (§40: bulk-import ei tuota XP:tä — seed simuloi normaalia
//   käyttöä, ei bulkia).
import type {
  Achievement,
  ActivityEntry,
  BrowserInstallation,
  CalendarBlock,
  Collectible,
  Distraction,
  FocusSession,
  Food,
  Goal,
  GoalDay,
  HabitRule,
  HydrationEntry,
  JournalEntry,
  Measurement,
  MoodCheckin,
  NutritionEntry,
  Project,
  Quest,
  QuestProgress,
  Reminder,
  SleepEntry,
  Supplement,
  SupplementLog,
  Task,
  TaskChecklistItem,
  UserPreferences,
  UserReward,
  XPTransaction,
  LevelState,
  Tag,
} from "@lifeos/domain";
import { DEFAULT_PREFERENCE_VALUES } from "@lifeos/domain";
import { levelForTotalXp } from "./level-curve.ts";
import { DEFAULT_XP_RULES } from "./xp-rules.ts";

export interface SyntheticSeedOptions {
  /** PRNG-siemen (sama => identtinen data). */
  readonly seed: number;
  /** "Nyt" — ikkunan loppu (UTC ISO). */
  readonly now: string;
  /** Historia-ikkunan pituus päivinä (oletus 365). */
  readonly days?: number;
}

export interface SyntheticSeedData {
  readonly preferences: UserPreferences;
  readonly installation: BrowserInstallation;
  readonly projects: readonly Project[];
  readonly tags: readonly Tag[];
  readonly tasks: readonly Task[];
  readonly checklistItems: readonly TaskChecklistItem[];
  readonly taskTags: readonly { readonly taskId: string; readonly tagId: string }[];
  readonly calendarBlocks: readonly CalendarBlock[];
  readonly goals: readonly Goal[];
  readonly habitRules: readonly HabitRule[];
  readonly goalDays: readonly GoalDay[];
  readonly focusSessions: readonly FocusSession[];
  readonly distractions: readonly Distraction[];
  readonly measurements: readonly Measurement[];
  readonly nutritionEntries: readonly NutritionEntry[];
  readonly hydrationEntries: readonly HydrationEntry[];
  readonly supplements: readonly Supplement[];
  readonly supplementLogs: readonly SupplementLog[];
  readonly sleepEntries: readonly SleepEntry[];
  readonly activityEntries: readonly ActivityEntry[];
  readonly moodCheckins: readonly MoodCheckin[];
  readonly journalEntries: readonly JournalEntry[];
  readonly reminders: readonly Reminder[];
  readonly xpTransactions: readonly XPTransaction[];
  readonly levelStates: readonly LevelState[];
  readonly quests: readonly Quest[];
  readonly questProgress: readonly QuestProgress[];
  readonly achievements: readonly Achievement[];
  readonly collectibles: readonly Collectible[];
  readonly userRewards: readonly UserReward[];
}

/** mulberry32: pieni deterministinen PRNG (riittää testidataan). */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MS_PER_DAY = 86_400_000;

export function createSyntheticSeed(options: SyntheticSeedOptions): SyntheticSeedData {
  const days = options.days ?? 365;
  const nowMs = Date.parse(options.now);
  const random = createRandom(options.seed);

  const dayOffsetIso = (daysAgo: number, hour = 8, minute = 0): string =>
    new Date(nowMs - daysAgo * MS_PER_DAY + (hour - 8) * 3_600_000 + minute * 60_000).toISOString();
  const between = (min: number, max: number): number =>
    min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  // --- Preferences + installation -------------------------------------------
  const preferences: UserPreferences = {
    ...DEFAULT_PREFERENCE_VALUES,
    notificationDefaults: { ...DEFAULT_PREFERENCE_VALUES.notificationDefaults },
    notificationCategories: { ...DEFAULT_PREFERENCE_VALUES.notificationCategories },
    enabledSections: [...DEFAULT_PREFERENCE_VALUES.enabledSections],
    mealSlots: DEFAULT_PREFERENCE_VALUES.mealSlots.map((slot) => ({ ...slot })),
    macroTargets: { ...DEFAULT_PREFERENCE_VALUES.macroTargets },
    id: "seed-pref-1",
    createdAt: dayOffsetIso(days),
    updatedAt: dayOffsetIso(7),
    version: 4,
  };
  const installation: BrowserInstallation = {
    id: "seed-install-1",
    installationId: "seed-installation-0001",
    installationName: "Testiselain",
    lastSeenAppVersion: "0.0.0-seed",
    lastSyncAt: dayOffsetIso(1, 9),
    revokedAt: null,
    createdAt: dayOffsetIso(days),
    updatedAt: dayOffsetIso(1, 9),
    version: 6,
  };

  // --- Tehtäväydin ------------------------------------------------------------
  const projects: Project[] = [
    {
      id: "seed-project-1",
      name: "Koti",
      colorKey: "green",
      archivedAt: null,
      createdAt: dayOffsetIso(days),
      updatedAt: dayOffsetIso(30),
      version: 2,
      deletedAt: null,
    },
    {
      id: "seed-project-2",
      name: "Työ",
      colorKey: "blue",
      archivedAt: null,
      createdAt: dayOffsetIso(days - 10),
      updatedAt: dayOffsetIso(20),
      version: 1,
      deletedAt: null,
    },
  ];
  const tags: Tag[] = [
    {
      id: "seed-tag-1",
      name: "hankinta",
      colorKey: null,
      createdAt: dayOffsetIso(days),
      updatedAt: dayOffsetIso(days),
      version: 1,
      deletedAt: null,
    },
    {
      id: "seed-tag-2",
      name: "5min",
      colorKey: null,
      createdAt: dayOffsetIso(days),
      updatedAt: dayOffsetIso(days),
      version: 1,
      deletedAt: null,
    },
    {
      id: "seed-tag-3",
      name: "syvälle",
      colorKey: null,
      createdAt: dayOffsetIso(days),
      updatedAt: dayOffsetIso(days),
      version: 1,
      deletedAt: null,
    },
    {
      id: "seed-tag-4",
      name: "pikanen",
      colorKey: null,
      createdAt: dayOffsetIso(days),
      updatedAt: dayOffsetIso(days),
      version: 1,
      deletedAt: null,
    },
  ];
  const taskTitles = [
    "Käy ruokakaupassa",
    "Maksa lasku",
    "Varaa hammaslääkäri",
    "Siivoa komero",
    "Päivitä budjetti",
    "Soita taloyhtiöön",
    "Tilaa suodatin",
    "Kirjaa kuitti",
    "Suunnittele viikko",
    "Tyhjennä postilaatikko",
    "Vie pullot palautukseen",
    "Osta joululahja",
    "Päivitä salasana",
    "Soppi ikkunasta",
    "Varaa autopaikka",
  ];
  const tasks: Task[] = [];
  const checklistItems: TaskChecklistItem[] = [];
  const taskTags: { taskId: string; tagId: string }[] = [];
  let checklistCounter = 0;
  for (let index = 0; index < 36; index += 1) {
    const id = `seed-task-${String(index + 1).padStart(2, "0")}`;
    const completed = index < 24;
    const daysAgo = completed ? days - Math.floor((index / 24) * (days - 14)) : index - 24;
    const createdAt = dayOffsetIso(Math.max(daysAgo + 2, 1), 9);
    const completedAt = completed ? dayOffsetIso(Math.max(daysAgo, 0), between(10, 18)) : null;
    const baseTitle = taskTitles[index % taskTitles.length] ?? "Tehtävä";
    const round = Math.floor(index / taskTitles.length) + 1;
    const task: Task = {
      id,
      createdAt,
      updatedAt: completedAt ?? createdAt,
      version: completed ? 3 : 1,
      title: `${baseTitle} ${String(round)}`,
      notes: null,
      status: completed ? "done" : "open",
      priority: pick(["low", "normal", "high"]),
      dueAt: completed ? null : dayOffsetIso(-between(1, 14), 18),
      projectId: pick([null, "seed-project-1", "seed-project-2"]),
      tagIds: [],
      deletedAt: null,
      completedAt,
      reopenedAt: null,
    };
    tasks.push(task);
    if (index % 6 === 0) {
      checklistItems.push(
        {
          id: `seed-check-${String(++checklistCounter).padStart(2, "0")}`,
          createdAt: createdAt,
          updatedAt: completedAt ?? createdAt,
          version: 1,
          taskId: id,
          title: "Alivaihe A",
          done: completed,
          sortOrder: 0,
          deletedAt: null,
        },
        {
          id: `seed-check-${String(++checklistCounter).padStart(2, "0")}`,
          createdAt: createdAt,
          updatedAt: completedAt ?? createdAt,
          version: 1,
          taskId: id,
          title: "Alivaihe B",
          done: false,
          sortOrder: 1,
          deletedAt: null,
        },
      );
    }
    taskTags.push({ taskId: id, tagId: pick(tags).id });
  }

  // --- Kalenteri ---------------------------------------------------------------
  const calendarBlocks: CalendarBlock[] = tasks.slice(0, 8).map((task, index) => ({
    id: `seed-block-${String(index + 1).padStart(2, "0")}`,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    version: 1,
    kind: "task",
    title: task.title,
    startsAt: dayOffsetIso(between(0, 30), 9 + (index % 8)),
    endsAt: dayOffsetIso(between(0, 30), 10 + (index % 8)),
    linkedTaskId: task.id,
    linkedRoutineId: null,
    deletedAt: null,
  }));

  // --- Tavoitteet -----------------------------------------------------------
  const goals: Goal[] = [
    {
      id: "seed-goal-1",
      createdAt: dayOffsetIso(days),
      updatedAt: dayOffsetIso(1),
      version: 2,
      title: "Liiku päivittäin",
      description: null,
      archivedAt: null,
      deletedAt: null,
    },
    {
      id: "seed-goal-2",
      createdAt: dayOffsetIso(days - 5),
      updatedAt: dayOffsetIso(2),
      version: 1,
      title: "Lue iltaisin",
      description: "20 sivua",
      archivedAt: null,
      deletedAt: null,
    },
  ];
  const habitRules: HabitRule[] = [
    {
      id: "seed-rule-1",
      createdAt: dayOffsetIso(days),
      updatedAt: dayOffsetIso(1),
      version: 2,
      goalId: "seed-goal-1",
      title: "30 min kävely",
      cadence: "daily",
      targetPerPeriod: 7,
      deletedAt: null,
    },
    {
      id: "seed-rule-2",
      createdAt: dayOffsetIso(days - 5),
      updatedAt: dayOffsetIso(2),
      version: 1,
      goalId: "seed-goal-2",
      title: "Lukuhetki",
      cadence: "daily",
      targetPerPeriod: 6,
      deletedAt: null,
    },
    {
      id: "seed-rule-3",
      createdAt: dayOffsetIso(60),
      updatedAt: dayOffsetIso(60),
      version: 1,
      goalId: null,
      title: "Veni itsenäisesti",
      cadence: "custom",
      targetPerPeriod: 3,
      deletedAt: null,
    },
  ];
  const goalDays: GoalDay[] = [];
  for (let daysAgo = days; daysAgo >= 0; daysAgo -= 1) {
    const localDate = new Date(nowMs - daysAgo * MS_PER_DAY).toISOString().slice(0, 10);
    goalDays.push(
      {
        id: `seed-gd-g1-${localDate}`,
        createdAt: dayOffsetIso(daysAgo),
        updatedAt: dayOffsetIso(daysAgo),
        version: 1,
        goalId: "seed-goal-1",
        localDate,
        completed: random() > 0.25,
      },
      {
        id: `seed-gd-g2-${localDate}`,
        createdAt: dayOffsetIso(daysAgo),
        updatedAt: dayOffsetIso(daysAgo),
        version: 1,
        goalId: "seed-goal-2",
        localDate,
        completed: random() > 0.45,
      },
    );
  }

  // --- Fokus + parking lot -----------------------------------------------------
  const focusSessions: FocusSession[] = [];
  const distractions: Distraction[] = [];
  for (let index = 0; index < 60; index += 1) {
    const id = `seed-focus-${String(index + 1).padStart(2, "0")}`;
    const daysAgo = days - Math.floor((index / 60) * (days - 3));
    const startedAt = dayOffsetIso(daysAgo, 9 + (index % 6));
    const endedAt = dayOffsetIso(daysAgo, 9 + (index % 6), 25);
    focusSessions.push({
      id,
      createdAt: startedAt,
      updatedAt: endedAt,
      version: 1,
      taskId: index % 3 === 0 ? (tasks[index]?.id ?? null) : null,
      routineId: null,
      phase: "completed",
      startedAt,
      endedAt,
      durationSeconds: 1500,
    });
    if (index % 4 === 0) {
      distractions.push({
        id: `seed-distract-${String(distractions.length + 1).padStart(2, "0")}`,
        createdAt: endedAt,
        updatedAt: endedAt,
        version: 1,
        focusSessionId: id,
        notedAt: endedAt,
        note: pick(["Puhelin", "Kaveri tuli juttelemaan", "Sähköposti", null]),
      });
    }
  }

  // --- Mittaukset (painotrendi + verenpaine) ------------------------------------
  const measurements: Measurement[] = [];
  for (let index = 0; index < 52; index += 1) {
    const daysAgo = days - Math.floor((index / 52) * days);
    measurements.push({
      id: `seed-meas-w${String(index + 1).padStart(2, "0")}`,
      createdAt: dayOffsetIso(daysAgo),
      updatedAt: dayOffsetIso(daysAgo),
      version: 1,
      type: "weight",
      value: 78 - (index / 52) * 4 + random(),
      secondaryValue: null,
      unit: "kg",
      measuredAt: dayOffsetIso(daysAgo, 7),
      note: null,
    });
  }
  for (let index = 0; index < 8; index += 1) {
    const daysAgo = between(1, 30);
    measurements.push({
      id: `seed-meas-bp${String(index + 1).padStart(2, "0")}`,
      createdAt: dayOffsetIso(daysAgo),
      updatedAt: dayOffsetIso(daysAgo),
      version: 1,
      type: "blood-pressure",
      value: 118 + between(-5, 8),
      secondaryValue: 76 + between(-4, 6),
      unit: "mmHg",
      measuredAt: dayOffsetIso(daysAgo, 8),
      note: null,
    });
  }

  // --- Ravinto + neste (viimeiset 30 pv) ------------------------------------------
  const nutritionEntries: NutritionEntry[] = [];
  const hydrationEntries: HydrationEntry[] = [];
  const foods: Food[] = [
    {
      id: "seed-food-1",
      createdAt: AT(days),
      updatedAt: AT(days),
      version: 1,
      name: "Kaura",
      caloriesPer100G: 372,
      proteinPer100G: 13.5,
      carbsPer100G: 58,
      fatPer100G: 7,
      deletedAt: null,
    },
    {
      id: "seed-food-2",
      createdAt: AT(days),
      updatedAt: AT(days),
      version: 1,
      name: "Kana",
      caloriesPer100G: 165,
      proteinPer100G: 31,
      carbsPer100G: 0,
      fatPer100G: 3.6,
      deletedAt: null,
    },
    {
      id: "seed-food-3",
      createdAt: AT(days),
      updatedAt: AT(days),
      version: 1,
      name: "Riisi",
      caloriesPer100G: 130,
      proteinPer100G: 2.7,
      carbsPer100G: 28,
      fatPer100G: 0.3,
      deletedAt: null,
    },
  ];
  const meals = ["Aamiainen", "Lounas", "Päivällinen"];
  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    for (const [mealIndex, label] of meals.entries()) {
      nutritionEntries.push({
        id: `seed-nutr-${String((29 - daysAgo) * 3 + mealIndex + 1).padStart(3, "0")}`,
        createdAt: dayOffsetIso(daysAgo, 7 + mealIndex * 5),
        updatedAt: dayOffsetIso(daysAgo, 7 + mealIndex * 5),
        version: 1,
        eatenAt: dayOffsetIso(daysAgo, 7 + mealIndex * 5),
        label: `${label} — ${pick(foods).name}`,
        calories: between(350, 750),
        proteinG: between(15, 40),
        carbsG: between(30, 90),
        fatG: between(8, 28),
        deletedAt: null,
      });
    }
    for (let glass = 0; glass < 5; glass += 1) {
      hydrationEntries.push({
        id: `seed-hyd-${String((29 - daysAgo) * 5 + glass + 1).padStart(3, "0")}`,
        createdAt: dayOffsetIso(daysAgo, 8 + glass * 2),
        updatedAt: dayOffsetIso(daysAgo, 8 + glass * 2),
        version: 1,
        drunkAt: dayOffsetIso(daysAgo, 8 + glass * 2),
        milliliters: 200 + between(0, 100),
      });
    }
  }

  // --- Lisäravinteet ---------------------------------------------------------
  const supplements: Supplement[] = [
    {
      id: "seed-supp-1",
      createdAt: dayOffsetIso(120),
      updatedAt: dayOffsetIso(1),
      version: 1,
      name: "D-vitamiini",
      doseLabel: "50 µg",
      deletedAt: null,
    },
    {
      id: "seed-supp-2",
      createdAt: dayOffsetIso(90),
      updatedAt: dayOffsetIso(1),
      version: 1,
      name: "Magnesium",
      doseLabel: null,
      deletedAt: null,
    },
  ];
  const supplementLogs: SupplementLog[] = [];
  for (let index = 0; index < 60; index += 1) {
    const daysAgo = 60 - index;
    supplementLogs.push({
      id: `seed-slog-${String(index + 1).padStart(2, "0")}`,
      createdAt: dayOffsetIso(daysAgo, 9),
      updatedAt: dayOffsetIso(daysAgo, 9),
      version: 1,
      supplementId: index % 2 === 0 ? "seed-supp-1" : "seed-supp-2",
      status: "taken",
      takenAt: dayOffsetIso(daysAgo, 9),
    });
  }

  // --- Hyvinvointi (viimeiset 90 pv) ---------------------------------------------
  const sleepEntries: SleepEntry[] = [];
  const activityEntries: ActivityEntry[] = [];
  const moodCheckins: MoodCheckin[] = [];
  const journalEntries: JournalEntry[] = [];
  const activityKinds = ["kävely", "juoksu", "pyöräily", "voimailu"];
  const journalTitles = ["Viikkokatsaus", "Huomioita", "Onnistuminen", null];
  for (let index = 0; index < 90; index += 1) {
    const daysAgo = 89 - index;
    sleepEntries.push({
      id: `seed-sleep-${String(index + 1).padStart(2, "0")}`,
      createdAt: dayOffsetIso(daysAgo, 23),
      updatedAt: dayOffsetIso(Math.max(daysAgo - 1, 0), 7),
      version: 1,
      sleepStart: dayOffsetIso(daysAgo, 23),
      sleepEnd: dayOffsetIso(Math.max(daysAgo - 1, 0), 7),
      quality: between(2, 5),
      deletedAt: null,
    });
    moodCheckins.push({
      id: `seed-mood-${String(index + 1).padStart(2, "0")}`,
      createdAt: dayOffsetIso(daysAgo, 20),
      updatedAt: dayOffsetIso(daysAgo, 20),
      version: 1,
      checkedAt: dayOffsetIso(daysAgo, 20),
      mood: between(2, 5),
      stress: between(1, 5),
      energy: between(1, 5),
      motivation: between(1, 5),
      focus: between(1, 5),
      note: null,
    });
    if (index % 2 === 0) {
      activityEntries.push({
        id: `seed-act-${String(activityEntries.length + 1).padStart(2, "0")}`,
        createdAt: dayOffsetIso(daysAgo, 17),
        updatedAt: dayOffsetIso(daysAgo, 17),
        version: 1,
        activityAt: dayOffsetIso(daysAgo, 17),
        kind: pick(activityKinds),
        durationSeconds: between(1200, 4200),
        distanceMeters: random() > 0.5 ? between(2000, 9000) : null,
        deletedAt: null,
      });
    }
    if (index % 8 === 0) {
      journalEntries.push({
        id: `seed-journal-${String(journalEntries.length + 1).padStart(2, "0")}`,
        createdAt: dayOffsetIso(daysAgo, 21),
        updatedAt: dayOffsetIso(daysAgo, 21),
        version: 1,
        writtenAt: dayOffsetIso(daysAgo, 21),
        title: pick(journalTitles),
        body: "Synteettinen päiväkirjamerkintä ilman oikeaa henkilötietoa. Päivä sujui rauhallisesti.",
        reflectionSuccess: null,
        reflectionDifficult: null,
        reflectionTomorrow: null,
        deletedAt: null,
      });
    }
  }

  // --- Muistutukset ---------------------------------------------------------
  const reminders: Reminder[] = [
    {
      id: "seed-rem-1",
      createdAt: dayOffsetIso(30),
      updatedAt: dayOffsetIso(1),
      version: 2,
      kind: "recurring",
      route: "/tasks",
      title: "Iltakirjaus",
      rule: null,
      fireAt: null,
      snoozedUntil: null,
      categoryKey: "health",
      enabled: true,
      deletedAt: null,
    },
    {
      id: "seed-rem-2",
      createdAt: dayOffsetIso(14),
      updatedAt: dayOffsetIso(14),
      version: 1,
      kind: "time",
      route: "/health",
      title: "Mittausaika",
      rule: null,
      fireAt: dayOffsetIso(-2, 8),
      snoozedUntil: null,
      categoryKey: "health",
      enabled: true,
      deletedAt: null,
    },
  ];

  // --- Gamification: XP derivoidaan suorituksista -----------------------------
  const xpTransactions: XPTransaction[] = [];
  let xpCounter = 0;
  for (const task of tasks) {
    if (task.status === "done" && task.completedAt !== null) {
      xpTransactions.push({
        id: `seed-xp-${String(++xpCounter).padStart(3, "0")}`,
        createdAt: task.completedAt,
        updatedAt: task.completedAt,
        version: 1,
        source: "task",
        sourceEntityId: task.id,
        amount: DEFAULT_XP_RULES.taskCompletion,
        earnedAt: task.completedAt,
        reason: null,
      });
    }
  }
  for (const session of focusSessions) {
    xpTransactions.push({
      id: `seed-xp-${String(++xpCounter).padStart(3, "0")}`,
      createdAt: session.endedAt ?? session.createdAt,
      updatedAt: session.endedAt ?? session.createdAt,
      version: 1,
      source: "focus",
      sourceEntityId: session.id,
      amount: DEFAULT_XP_RULES.focusCompletion,
      earnedAt: session.endedAt ?? session.createdAt,
      reason: null,
    });
  }
  for (const log of supplementLogs) {
    if (log.takenAt === null || log.status === "skipped" || log.status === "pending") continue;
    const takenAt = log.takenAt;
    xpTransactions.push({
      id: `seed-xp-${String(++xpCounter).padStart(3, "0")}`,
      createdAt: takenAt,
      updatedAt: takenAt,
      version: 1,
      source: "health",
      sourceEntityId: log.supplementId,
      amount: DEFAULT_XP_RULES.supplementLog,
      earnedAt: takenAt,
      reason: null,
    });
  }
  const totalXp = xpTransactions.reduce((sum, tx) => sum + tx.amount, 0);
  // T182: snapshotin level derivoitu samalla käyrällä kuin sovellus laskee
  // (transaktiovirta on totuus, LevelState on välimuisti).
  const levelStates: LevelState[] = [
    {
      id: "seed-level-1",
      createdAt: dayOffsetIso(180),
      updatedAt: dayOffsetIso(180),
      version: 1,
      totalXp: Math.floor(totalXp / 2),
      level: levelForTotalXp(Math.floor(totalXp / 2)),
      computedAt: dayOffsetIso(180),
    },
    {
      id: "seed-level-2",
      createdAt: options.now,
      updatedAt: options.now,
      version: 2,
      totalXp,
      level: levelForTotalXp(totalXp),
      computedAt: options.now,
    },
  ];
  const quests: Quest[] = [
    {
      id: "seed-quest-1",
      createdAt: dayOffsetIso(30),
      updatedAt: dayOffsetIso(30),
      version: 1,
      title: "Vikon haaste: 5 tehtävää",
      description: null,
      activeFrom: dayOffsetIso(30),
      activeUntil: null,
      condition: { kind: "event-count", goal: 5 },
    },
  ];
  const questProgress: QuestProgress[] = [
    {
      id: "seed-qprog-1",
      createdAt: dayOffsetIso(7),
      updatedAt: options.now,
      version: 2,
      questId: "seed-quest-1",
      progress: 3,
      goal: 5,
      completedAt: null,
    },
  ];
  const achievements: Achievement[] = [
    {
      id: "seed-ach-1",
      createdAt: dayOffsetIso(200),
      updatedAt: dayOffsetIso(200),
      version: 1,
      key: "first-task",
      title: "Ensimmäinen tehtävä",
      description: "Kirjasit ensimmäisen tehtävän valmiiksi.",
    },
    {
      id: "seed-ach-2",
      createdAt: dayOffsetIso(150),
      updatedAt: dayOffsetIso(150),
      version: 1,
      key: "week-streak",
      title: "Viikon putki",
      description: "Seitsemän päivää putkeen.",
    },
    {
      id: "seed-ach-3",
      createdAt: dayOffsetIso(100),
      updatedAt: dayOffsetIso(100),
      version: 1,
      key: "focus-hour",
      title: "Fokustunti",
      description: "60 min yhtenäistä fokusta.",
    },
  ];
  const collectibles: Collectible[] = [
    {
      id: "seed-coll-1",
      createdAt: dayOffsetIso(200),
      updatedAt: dayOffsetIso(200),
      version: 1,
      key: "medal-bronze",
      title: "Pronssimitali",
      unlocksThemeKey: null,
    },
    {
      id: "seed-coll-2",
      createdAt: dayOffsetIso(100),
      updatedAt: dayOffsetIso(100),
      version: 1,
      key: "medal-silver",
      title: "Hopeamitali",
      unlocksThemeKey: "aurora",
    },
  ];
  const userRewards: UserReward[] = [
    {
      id: "seed-reward-1",
      createdAt: dayOffsetIso(150),
      updatedAt: dayOffsetIso(150),
      version: 1,
      achievementId: "seed-ach-1",
      collectibleId: "seed-coll-1",
      earnedAt: dayOffsetIso(150),
    },
    {
      id: "seed-reward-2",
      createdAt: dayOffsetIso(100),
      updatedAt: dayOffsetIso(100),
      version: 1,
      achievementId: "seed-ach-2",
      collectibleId: null,
      earnedAt: dayOffsetIso(100),
    },
  ];

  return {
    preferences,
    installation,
    projects,
    tags,
    tasks,
    checklistItems,
    taskTags,
    calendarBlocks,
    goals,
    habitRules,
    goalDays,
    focusSessions,
    distractions,
    measurements,
    nutritionEntries,
    hydrationEntries,
    supplements,
    supplementLogs,
    sleepEntries,
    activityEntries,
    moodCheckins,
    journalEntries,
    reminders,
    xpTransactions,
    levelStates,
    quests,
    questProgress,
    achievements,
    collectibles,
    userRewards,
  };

  function AT(daysAgo: number): string {
    return dayOffsetIso(Math.max(daysAgo, 0));
  }
}
