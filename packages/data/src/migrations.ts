// T031: versionoidut migraatiot (§32 + §49).
// DDL asuu tässä datana (puhdas ketjuapu, ei IO:ta) ja worker ajaa sen —
// raaka SQL ei kuulu muualle data-koodiin (eristysskanni vartioi).
// - Jokaisella migraatiolla: yksilöllinen versio (M001 -> 1), kuvaus,
//   idempotentit lauseet (CREATE TABLE IF NOT EXISTS + sarakelisäykset
//   PRAGMA table_info -tarkistuksella). Ei koskaan tuhoavia lauseita ilman
//   erillistä korkean riskin migraatiota + backup-kehotetta (§38).
// - Runner on puhdas ketjuapu (ei IO:ta): worker ajaa lauseet yksi kerrallaan
//   transaktiossa; client validoi ketjun eheyden ennen ajoa (§49 kohta 4:
//   failure ei jätä puolikasta tilaa).
// - Skeemaversio talletetaan PRAGMA user_versioniin (SQLite-natiivi,
//   ei sovellustaulua joka itse tarvitsisi migraation). T031-kohde: v1.
// - Foreign keyt päällä (PRAGMA foreign_keys=ON) ja indeksit §32 mukaan.
//   Kello on injektoitava default-arvoissa: ei applikaatioaikaa skeemassa.

export interface MigrationStep {
  readonly version: number;
  readonly id: string;
  readonly description: string;
  /** Idempotentit DDL-lauseet ajojärjestyksessä. */
  readonly statements: readonly string[];
}

/** M001: perusta. Meta + skeemahistoria + sync-perusta (outbox/cursor). */
const M001_STATEMENTS = [
  "PRAGMA foreign_keys=ON;",
  `CREATE TABLE IF NOT EXISTS _lifeos_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;`,
  `CREATE TABLE IF NOT EXISTS _lifeos_migrations (
    version INTEGER PRIMARY KEY,
    id TEXT NOT NULL,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
  ) STRICT;`,
  // Sync outbox -perusta (§34): operaatiojono paikallisille muutoksille.
  // Payload salataan B15:ssä; tässä vain kuori + eheysviitteet (T026 SyncOperation).
  `CREATE TABLE IF NOT EXISTS _lifeos_sync_outbox (
    operation_id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    entity_version INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    encrypted_payload_ref TEXT NOT NULL,
    integrity_ref TEXT NOT NULL
  ) STRICT;`,
  "CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity ON _lifeos_sync_outbox(entity_type, entity_id);",
  "CREATE INDEX IF NOT EXISTS idx_sync_outbox_occurred ON _lifeos_sync_outbox(occurred_at);",
] as const;

export const MIGRATIONS: readonly MigrationStep[] = [
  {
    version: 1,
    id: "M001",
    description: "Perusta: meta + migraatiohistoria + sync-outbox-perusta",
    statements: M001_STATEMENTS,
  },
  // M002 (T060): UserPreferences (§33). Yksi rivi (get-or-create singleton);
  // versionoitava entity-versiolla (BaseEntity.version) — skeemaversio on
  // erikseen PRAGMA user_versionissa (§49: local schema -versiointi).
  // CHECK-rajoitukset peilaavat domain-sääntöä (theme-unioni, hour 0–23)
  // jotta rikki data ei pääse kantaan edes toisesta kirjoittajasta.
  // enabled_sections JSON-taulukkona (§33 readonly string[]; json_valid).
  {
    version: 2,
    id: "M002",
    description: "UserPreferences: versioitava asetusrivi (get-or-create singleton)",
    statements: [
      `CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY,
        theme TEXT NOT NULL CHECK (theme IN ('light', 'dark', 'system')),
        day_start_hour INTEGER NOT NULL CHECK (day_start_hour >= 0 AND day_start_hour <= 23),
        gamification_visible INTEGER NOT NULL CHECK (gamification_visible IN (0, 1)),
        enabled_sections TEXT NOT NULL CHECK (json_valid(enabled_sections)),
        notification_defaults_enabled INTEGER NOT NULL CHECK (notification_defaults_enabled IN (0, 1)),
        app_lock_enabled INTEGER NOT NULL CHECK (app_lock_enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1)
      ) STRICT;`,
    ],
  },
  // M003 (T061): browser_installations (§39). Yksi rivi per profiili
  // (get-or-create; kysely ORDER BY created_at LIMIT 1). installation_id on
  // pysyvä satunnainen UUID (ei fingerprintingia) + VAIN turvallinen
  // metadata: nimi, viimeksi nähdyt app-versiot, sync-aika, revokaatio.
  // last_sync_at / revoked_at ovat NULL-olisia (tyhjä merkkijono protokollassa
  // -> SQL NULL bindissä). CHECK: version >= 1.
  {
    version: 3,
    id: "M003",
    description: "BrowserInstallation: pysyvä asennusrivi profiilille",
    statements: [
      `CREATE TABLE IF NOT EXISTS browser_installations (
        id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL UNIQUE,
        installation_name TEXT NOT NULL,
        last_seen_app_version TEXT NOT NULL,
        last_sync_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1)
      ) STRICT;`,
    ],
  },
  // M004 (T063): tehtäväydin — Task/ChecklistItem/Project/Tag + relaatiot.
  // - tasks.project_id -> projects(id) (validoituu FK:lla; NULL = ei projektia).
  // - Task.tagIds -> task_tags-risteystaulu (M:N, CASCADE molempiin suuntiin;
  //   puhdas liitostaulu ilman metadata-sarakkeita — ei BaseEntity).
  // - task_checklist_items.task_id -> tasks(id) ON DELETE CASCADE.
  // - Eheysehdot peilaavat domain-sääntöjä: status/priority unionit,
  //   otsikon pituus 1–200, liput 0/1, sort_order >= 0.
  // - Soft-deletable taulut (projects/tags/tasks/checklist): deleted_at-sarake
  //   entityMetadataColumns({softDelete:true}) -vakiosta (T062).
  {
    version: 4,
    id: "M004",
    description: "Tehtäväydin: projects/tags/tasks/checklist + FK-relaatiot ja eheysehdot",
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
        color_key TEXT,
        archived_at TEXT,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) >= 1 AND length(name) <= 60),
        color_key TEXT,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        notes TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'done')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        due_at TEXT,
        project_id TEXT REFERENCES projects(id),
        completed_at TEXT,
        reopened_at TEXT,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS task_checklist_items (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        done INTEGER NOT NULL CHECK (done IN (0, 1)),
        sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);",
      "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);",
      "CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);",
      "CREATE INDEX IF NOT EXISTS idx_checklist_task ON task_checklist_items(task_id, sort_order);",
      "CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);",
    ],
  },
  // M005 (T064): calendar_blocks — timebox joka tukee tehtävä- ja
  // rutiinilinkitystä (§33).
  // - kind-unioni CHECK:issä; aikaväli UTC ISO -merkkijonoina, ends >= starts
  //   (leksikaalinen vertailu = kronologinen, vrt. domain/rules isBefore).
  // - Linkityseheys: linked_task_id vain kind='task' -blokille ja
  //   linked_routine_id vain kind='routine' -blokille; molempia ei koskaan
  //   samalla. FK: linked_task_id -> tasks(id) (tehtävä poistetaan
  //   pehmeästi — kova poisto estetään FK:lla, historia säilyy).
  //   linked_routine_id: FK lisätään T066:ssa kun routines-taulu on olemassa
  //   (SQLite ei salli FK:n lisäämistä jälkikäteen ilman taulun uudelleen-
  //   rakennusta; dokumentoitu T066-tehtäväksi).
  // - Soft-delete: entityMetadataColumns({softDelete:true}) (T062-vakio).
  {
    version: 5,
    id: "M005",
    description: "CalendarBlock: timebox tehtävä-/rutiinilinkityksellä",
    statements: [
      `CREATE TABLE IF NOT EXISTS calendar_blocks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('task', 'routine', 'focus', 'event')),
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL CHECK (ends_at >= starts_at),
        linked_task_id TEXT REFERENCES tasks(id),
        linked_routine_id TEXT,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")},
        CHECK (
          (linked_task_id IS NULL OR kind = 'task') AND
          (linked_routine_id IS NULL OR kind = 'routine') AND
          NOT (linked_task_id IS NOT NULL AND linked_routine_id IS NOT NULL)
        )
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_calendar_starts ON calendar_blocks(starts_at);",
      "CREATE INDEX IF NOT EXISTS idx_calendar_kind ON calendar_blocks(kind);",
      "CREATE INDEX IF NOT EXISTS idx_calendar_task ON calendar_blocks(linked_task_id);",
    ],
  },
  // M006 (T065): tavoiteydin — Goal/HabitRule/GoalDay.
  // - "säännöt ja päivätilat erotetaan historiasta": HabitRule on oma
  //   entiteettinsä (goal_id nullable — sääntö voi olla vapaakin), GoalDay
  //   on goal+paikallispäivä-kohtainen TILARIVI (ei soft-deletable —
  //   tilahistoria ei poistu, entityMetadataColumns({softDelete:false})).
  // - Eheysehdot: cadence-unioni, target_per_period >= 1 (0 = turha sääntö),
  //   local_date 10 merkkiä "YYYY-MM-DD" + UNIQUE (goal_id, local_date)
  //   (yksi tila per tavoite per päivä).
  // - goal_days.goal_id -> goals(id) ON DELETE CASCADE (tilarivit ovat
  //   arvottomia ilman isäntää); habit_rules.goal_id -> goals(id) ON DELETE
  //   SET NULL (sääntö jää eloon vapaana, ei orpo-FK-lukkoa kovassa
  //   siivouksessa; pehmeä poisto on normaali tie eikä kosketa kumpaakaan).
  {
    version: 6,
    id: "M006",
    description: "Tavoiteydin: goals/habit_rules/goal_days + päivätila-UNIQUE",
    statements: [
      `CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        description TEXT,
        archived_at TEXT,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS habit_rules (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'custom')),
        target_per_period INTEGER NOT NULL CHECK (target_per_period >= 1),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS goal_days (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        local_date TEXT NOT NULL CHECK (length(local_date) = 10),
        completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")},
        UNIQUE (goal_id, local_date)
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_habit_rules_goal ON habit_rules(goal_id);",
      "CREATE INDEX IF NOT EXISTS idx_goal_days_goal ON goal_days(goal_id, local_date);",
    ],
  },
  // M007 (T066): rutiiniydin — Routine/RoutineStep + T064:n luvattu
  // calendar_blocks.linked_routine_id FK.
  // - routines/routine_steps soft-deletable entiteettejä (T062-vakio).
  // - routine_steps.routine_id -> routines(id) ON DELETE CASCADE (askeleet
  //   lapsia; sort_order ilman UNIQUEia — uudelleenjärjestely ei saa tarvita
  //   väliaikaisia duplikaatteja).
  // - calendar_blocks rakennetaan uudelleen (SQLite ei tue FK:n
  //   jälkiliitosta): sama skeema kuin M005 + linked_routine_id ->
  //   routines(id) ON DELETE SET NULL. M005-aikakaudella rutiineja EI voinut
  //   olla olemassa (taulut syntyvät tässä), joten kaikki linked_routine_id-
  //   arvot ovat FK:ttömän kauden arvoja — nollataan ennen rakennusta, muuten
  //   uusi FK estäisi migraation. Data muuten kopioidaan 1:1.
  {
    version: 7,
    id: "M007",
    description: "Rutiiniydin: routines/routine_steps + calendar_blocks.routine-FK",
    statements: [
      `CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        archived_at TEXT,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS routine_steps (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE calendar_blocks_new (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('task', 'routine', 'focus', 'event')),
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL CHECK (ends_at >= starts_at),
        linked_task_id TEXT REFERENCES tasks(id),
        linked_routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")},
        CHECK (
          (linked_task_id IS NULL OR kind = 'task') AND
          (linked_routine_id IS NULL OR kind = 'routine') AND
          NOT (linked_task_id IS NOT NULL AND linked_routine_id IS NOT NULL)
        )
      ) STRICT;`,
      // M005-kauden rutiinilinkit ovat FK:ttömän kauden arvoja (rutiineja
      // ei voinut olla olemassa) — nollataan ennen rakennusta.
      "UPDATE calendar_blocks SET linked_routine_id = NULL;",
      `INSERT INTO calendar_blocks_new (
         id, kind, title, starts_at, ends_at, linked_task_id, linked_routine_id,
         created_at, updated_at, version, deleted_at
       ) SELECT
         id, kind, title, starts_at, ends_at, linked_task_id, linked_routine_id,
         created_at, updated_at, version, deleted_at
       FROM calendar_blocks;`,
      "DROP TABLE calendar_blocks;",
      "ALTER TABLE calendar_blocks_new RENAME TO calendar_blocks;",
      "CREATE INDEX IF NOT EXISTS idx_calendar_starts ON calendar_blocks(starts_at);",
      "CREATE INDEX IF NOT EXISTS idx_calendar_kind ON calendar_blocks(kind);",
      "CREATE INDEX IF NOT EXISTS idx_calendar_task ON calendar_blocks(linked_task_id);",
      "CREATE INDEX IF NOT EXISTS idx_calendar_routine ON calendar_blocks(linked_routine_id);",
      "CREATE INDEX IF NOT EXISTS idx_routine_steps_routine ON routine_steps(routine_id, sort_order);",
    ],
  },
  // M008 (T067): fokus + parking lot — pysyviä HISTORIAENTITEETTEJÄ
  // (BaseEntity ilman soft-deleteä: istuntoja ei poisteta, ne arkistoituvat).
  // - focus_sessions: task_id -> tasks(id) (RESTRICT — kova poisto tehtävästä
  //   estetään, pehmeä poisto on tie; historia säilyy), routine_id ->
  //   routines(id) ON DELETE SET NULL (sama malli kuin calendar_blocks),
  //   phase-unioni CHECK, ended >= started kun molemmat asetettu (NULL läpäisee
  //   CHECKin — istunto voi olla alkamatta), duration >= 0.
  // - distractions (parking lot): focus_session_id -> focus_sessions(id)
  //   ON DELETE CASCADE (huomiot arvottomia ilman istuntoa), noted_at NOT NULL.
  {
    version: 8,
    id: "M008",
    description: "Fokus: focus_sessions/distractions (historiaentiteetit)",
    statements: [
      `CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id),
        routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL,
        phase TEXT NOT NULL CHECK (phase IN ('planned', 'running', 'paused', 'completed', 'cancelled')),
        started_at TEXT,
        ended_at TEXT CHECK (ended_at >= started_at),
        duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS distractions (
        id TEXT PRIMARY KEY,
        focus_session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
        noted_at TEXT NOT NULL,
        note TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_focus_task ON focus_sessions(task_id);",
      "CREATE INDEX IF NOT EXISTS idx_focus_started ON focus_sessions(started_at);",
      "CREATE INDEX IF NOT EXISTS idx_distractions_session ON distractions(focus_session_id);",
    ],
  },
  // M009 (T068): mittaukset — append-only (§36: yhdistyvät ilman
  // kenttäkonflikteja, ei soft-deleteä eikä versiopäivityksiä tuotannossa).
  // - MeasurementType on domainissa suljettu unioni (§33) — EI erillistä
  //   taulua; custom-mittaukset tulevat type='custom' + oma unit.
  // - Tukee yksikköä (unit), timestampia (measured_at) ja kontekstia
  //   (secondary_value esim. verenpaineen diastoliselle + note).
  // - Ei merkkirajoitusta valuelle (lämpötila voi olla negatiivinen).
  // - Append-only on palvelukerroksen sopimus (ei triggeriä — T076).
  {
    version: 9,
    id: "M009",
    description: "Measurements: append-only mittarivit type/unit/measured_at",
    statements: [
      `CREATE TABLE IF NOT EXISTS measurements (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('weight', 'blood-pressure', 'blood-sugar', 'temperature', 'body-measure', 'custom')),
        value REAL NOT NULL,
        secondary_value REAL,
        unit TEXT NOT NULL CHECK (length(trim(unit)) >= 1 AND length(unit) <= 20),
        measured_at TEXT NOT NULL,
        note TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_measurements_type_at ON measurements(type, measured_at);",
      "CREATE INDEX IF NOT EXISTS idx_measurements_at ON measurements(measured_at);",
    ],
  },
  // M010 (T069): ravinto + neste — normalisoitu malli (§33).
  // - foods: makrot per 100 g CHECK >= 0 (kalorit/proteiinit eivät voi olla
  //   negatiivisia); NutritionEntry pitää makrot omalla rivillään (domainissa
  //   ei food_id-viitettä — ei denormalisointia kannan puolesta).
  // - Recipe.foodIds -> recipe_foods-junction (M:N, CASCADE molempiin).
  // - hydration_entries: BaseEntity ilman soft-deleteä (tilarivi).
  // - nutrition_entries: soft-deletable (§36 merge-kentät).
  {
    version: 10,
    id: "M010",
    description: "Ravinto + neste: foods/nutrition_entries/recipes/recipe_foods/hydration",
    statements: [
      `CREATE TABLE IF NOT EXISTS foods (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
        calories_per_100g REAL CHECK (calories_per_100g IS NULL OR calories_per_100g >= 0),
        protein_per_100g REAL CHECK (protein_per_100g IS NULL OR protein_per_100g >= 0),
        carbs_per_100g REAL CHECK (carbs_per_100g IS NULL OR carbs_per_100g >= 0),
        fat_per_100g REAL CHECK (fat_per_100g IS NULL OR fat_per_100g >= 0),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS nutrition_entries (
        id TEXT PRIMARY KEY,
        eaten_at TEXT NOT NULL,
        label TEXT NOT NULL CHECK (length(trim(label)) >= 1 AND length(label) <= 200),
        calories REAL CHECK (calories IS NULL OR calories >= 0),
        protein_g REAL CHECK (protein_g IS NULL OR protein_g >= 0),
        carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
        fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS recipe_foods (
        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
        PRIMARY KEY (recipe_id, food_id)
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS hydration_entries (
        id TEXT PRIMARY KEY,
        drunk_at TEXT NOT NULL,
        milliliters INTEGER NOT NULL CHECK (milliliters >= 0),
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_nutrition_eaten ON nutrition_entries(eaten_at);",
      "CREATE INDEX IF NOT EXISTS idx_hydration_drunk ON hydration_entries(drunk_at);",
      "CREATE INDEX IF NOT EXISTS idx_recipe_foods_food ON recipe_foods(food_id);",
    ],
  },
  // M011 (T070): lisäravinteet — SUUNNITELMA ja TOTEUTUNUT KIRJAUS erillään.
  // - supplements = suunnitelma (nimi + annosmerkintä) — soft-deletable;
  // - supplement_logs = toteutuneet ottokerrat (taken_at) — tilarivejä ilman
  //   soft-deleteä, CASCADE isäntään (logi arvoton ilman suunnitelmaa).
  {
    version: 11,
    id: "M011",
    description: "Lisäravinteet: supplements (suunnitelma) + supplement_logs (kirjaus)",
    statements: [
      `CREATE TABLE IF NOT EXISTS supplements (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
        dose_label TEXT,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS supplement_logs (
        id TEXT PRIMARY KEY,
        supplement_id TEXT NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
        taken_at TEXT NOT NULL,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_supplement_logs_supplement ON supplement_logs(supplement_id, taken_at);",
    ],
  },
  // M012 (T071): hyvinvointimerkinnät — erilliset taulut, YHTEINEN
  // metadata-malli (T062-vakio; kunkin domain-tyypin mukainen soft-delete).
  // - sleep_entries/activity_entries/journal_entries soft-deletable;
  //   mood_checkins tilarivejä ilman deleted_at:ta.
  // - Eheysehdot: sleep_end >= sleep_start (UTC ISO leksikaalinen), duration/
  //   distance >= 0, mood 1–5 (domain-kommentti §33), body ei tyhjä.
  //   quality/energy: domain ei määritä aluetta — ei keksittyä CHECKiä,
  //   vain >= 0 -saniteetti puuttuu tarkoituksella (ei rajoiteta domainin
  //   ulkopuolelta).
  {
    version: 12,
    id: "M012",
    description: "Hyvinvointi: sleep/activity/mood/journal yhteisellä metadatalla",
    statements: [
      `CREATE TABLE IF NOT EXISTS sleep_entries (
        id TEXT PRIMARY KEY,
        sleep_start TEXT NOT NULL,
        sleep_end TEXT NOT NULL CHECK (sleep_end >= sleep_start),
        quality INTEGER,
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS activity_entries (
        id TEXT PRIMARY KEY,
        activity_at TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (length(trim(kind)) >= 1 AND length(kind) <= 60),
        duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        distance_meters REAL CHECK (distance_meters IS NULL OR distance_meters >= 0),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS mood_checkins (
        id TEXT PRIMARY KEY,
        checked_at TEXT NOT NULL,
        mood INTEGER NOT NULL CHECK (mood >= 1 AND mood <= 5),
        energy INTEGER,
        note TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        written_at TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL CHECK (length(trim(body)) >= 1),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_sleep_start ON sleep_entries(sleep_start);",
      "CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_entries(activity_at);",
      "CREATE INDEX IF NOT EXISTS idx_mood_checked ON mood_checkins(checked_at);",
      "CREATE INDEX IF NOT EXISTS idx_journal_written ON journal_entries(written_at);",
    ],
  },
  // M013 (T072): muistutukset + toimitustila — erotettu domainissa.
  // - reminders = käyttäjän ajastus (kind-unioni, sanitized route ilman PII:tä
  //   §33, kategoria §24-säädettävä, enabled-lippu) — soft-deletable.
  // - notification_states = laitteen paikallinen toimitustila — tilarivejä
  //   ilman soft-deleteä; reminder_id -> reminders(id) ON DELETE SET NULL
  //   (toimitushistoria säilyy; reminder_id nullable — myös muut kuin
  //   muistutusilmoitukset), delivery-unioni CHECK.
  {
    version: 13,
    id: "M013",
    description: "Muistutukset: reminders + notification_states (ajastus/toimitus erillään)",
    statements: [
      `CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('time', 'recurring', 'deadline', 'conditional')),
        route TEXT NOT NULL CHECK (length(trim(route)) >= 1 AND length(route) <= 200),
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        fire_at TEXT,
        snoozed_until TEXT,
        category_key TEXT NOT NULL CHECK (length(trim(category_key)) >= 1 AND length(category_key) <= 60),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS notification_states (
        id TEXT PRIMARY KEY,
        reminder_id TEXT REFERENCES reminders(id) ON DELETE SET NULL,
        category_key TEXT NOT NULL CHECK (length(trim(category_key)) >= 1 AND length(category_key) <= 60),
        delivery TEXT NOT NULL CHECK (delivery IN ('pending', 'shown', 'dismissed', 'missed')),
        last_evaluated_at TEXT NOT NULL,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_reminders_category ON reminders(category_key);",
      "CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders(fire_at);",
      "CREATE INDEX IF NOT EXISTS idx_notification_states_reminder ON notification_states(reminder_id);",
    ],
  },
  // M014 (T073): gamification — XP append-only -virtaa (§40: bulk-import ei
  // tuota XP:tä; raja B09:ssä), tasot derivoidaan (LevelState = snapshot),
  // sisältö (quests/achievements/collectibles) ja palkinnot.
  // - Kaikki BaseEntity ilman soft-deleteä: tapahtumat ja derivaatat ovat
  //   historiatietoa, sisältötaulut hallittua dataa (ei käyttäjän poistettavaa).
  // - xp_transactions.source_entity_id: polymorfinen viite (ei FK — kohde vaihtelee
  //   lähteen mukaan), amount: ei merkkirajoitusta domainissa (manual-korjaukset).
  // - user_rewards: ainakin yksi viite (achievement/collectible) CHECK,
  //   CASCADE kummastakin (palkinto kuuluu palkinnon antajaan).
  {
    version: 14,
    id: "M014",
    description: "Gamification: xp/level/quests/achievements/collectibles/rewards",
    statements: [
      `CREATE TABLE IF NOT EXISTS xp_transactions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('task', 'routine', 'focus', 'habit', 'health', 'quest', 'manual')),
        source_entity_id TEXT,
        amount INTEGER NOT NULL,
        earned_at TEXT NOT NULL,
        reason TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS level_states (
        id TEXT PRIMARY KEY,
        total_xp INTEGER NOT NULL CHECK (total_xp >= 0),
        level INTEGER NOT NULL CHECK (level >= 1),
        computed_at TEXT NOT NULL,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS quests (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        description TEXT,
        active_from TEXT,
        active_until TEXT CHECK (active_until IS NULL OR active_from IS NULL OR active_until >= active_from),
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS quest_progress (
        id TEXT PRIMARY KEY,
        quest_id TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
        progress INTEGER NOT NULL CHECK (progress >= 0),
        goal INTEGER NOT NULL CHECK (goal >= 1),
        completed_at TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS achievements (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE CHECK (length(trim(key)) >= 1 AND length(key) <= 100),
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        description TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS collectibles (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE CHECK (length(trim(key)) >= 1 AND length(key) <= 100),
        title TEXT NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
        unlocks_theme_key TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS user_rewards (
        id TEXT PRIMARY KEY,
        achievement_id TEXT REFERENCES achievements(id) ON DELETE CASCADE,
        collectible_id TEXT REFERENCES collectibles(id) ON DELETE CASCADE,
        earned_at TEXT NOT NULL,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")},
        CHECK (achievement_id IS NOT NULL OR collectible_id IS NOT NULL)
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_xp_earned ON xp_transactions(earned_at);",
      "CREATE INDEX IF NOT EXISTS idx_xp_source ON xp_transactions(source);",
      "CREATE INDEX IF NOT EXISTS idx_quest_progress_quest ON quest_progress(quest_id);",
      "CREATE INDEX IF NOT EXISTS idx_rewards_achievement ON user_rewards(achievement_id);",
      "CREATE INDEX IF NOT EXISTS idx_rewards_collectible ON user_rewards(collectible_id);",
    ],
  },
  // M015 (T074): sync-entiteetit ilman Drive-riippuvuutta (§34–§36).
  // - _lifeos_sync_outbox (M001-perusta, ilman kirjoittajia) rakennetaan
  //   uudelleen: sync_operations T062-metadatalla (id = legacy operation_id,
  //   operation_id UNIQUE), data kopioidaan 1:1. installation_id EI FK:ta —
  //   operaatiot voivat tulla muista asennuksista (paikallinen taulu ei tunne
  //   niitä). Ei PII:tä payload-viitteessä (salattu opaque, B15).
  // - sync_cursors: yksi per asennus (installation_id UNIQUE).
  // - conflict_records: molemmat versioreferenssit säilytetään (§36),
  //   status open|resolved, resolution viittaa ratkaisuoperaatioon.
  {
    version: 15,
    id: "M015",
    description: "Sync: sync_operations (outbox uudelleen) + sync_cursors + conflict_records",
    statements: [
      `CREATE TABLE IF NOT EXISTS sync_operations (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) >= 1 AND length(operation_id) <= 128),
        installation_id TEXT NOT NULL CHECK (length(installation_id) >= 1),
        entity_type TEXT NOT NULL CHECK (length(entity_type) >= 1 AND length(entity_type) <= 60),
        entity_id TEXT NOT NULL CHECK (length(entity_id) >= 1),
        operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'resolve')),
        entity_version INTEGER NOT NULL CHECK (entity_version >= 1),
        occurred_at TEXT NOT NULL,
        encrypted_payload_ref TEXT NOT NULL,
        integrity_ref TEXT NOT NULL,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `INSERT INTO sync_operations (
         id, operation_id, installation_id, entity_type, entity_id, operation,
         entity_version, occurred_at, encrypted_payload_ref, integrity_ref,
         created_at, updated_at, version
       ) SELECT
         operation_id, operation_id, installation_id, entity_type, entity_id, operation,
         entity_version, occurred_at, encrypted_payload_ref, integrity_ref,
         occurred_at, occurred_at, 1
       FROM _lifeos_sync_outbox;`,
      "DROP TABLE _lifeos_sync_outbox;",
      `CREATE TABLE IF NOT EXISTS sync_cursors (
        id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL UNIQUE CHECK (length(installation_id) >= 1),
        last_seen_operation_id TEXT,
        updated_through TEXT NOT NULL,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `CREATE TABLE IF NOT EXISTS conflict_records (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL CHECK (length(entity_type) >= 1 AND length(entity_type) <= 60),
        entity_id TEXT NOT NULL CHECK (length(entity_id) >= 1),
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
        local_version_ref TEXT NOT NULL,
        remote_version_ref TEXT NOT NULL,
        resolved_at TEXT,
        resolution_operation_id TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")},
        CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_sync_operations_installation ON sync_operations(installation_id, occurred_at);",
      "CREATE INDEX IF NOT EXISTS idx_sync_operations_entity ON sync_operations(entity_type, entity_id);",
      "CREATE INDEX IF NOT EXISTS idx_sync_cursors_installation ON sync_cursors(installation_id);",
      "CREATE INDEX IF NOT EXISTS idx_conflicts_entity ON conflict_records(entity_type, entity_id);",
      "CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflict_records(status);",
    ],
  },
  // M016 (T075): BackupManifest — backupin kuvaus eksplisiittisenä (§38).
  // - backup_version: backupiformaatin versio; schema_version: skeemaversio
  //   jolloin backup otettiin (molemmat >= 1 CHECK);
  // - crypto_version: kryptoversio merkkijonona (ei avaimia/tokeneita
  //   manifestiin — §38);
  // - contents: sisältöluettelo JSON-objektina (entiteettityyppi -> lukumäärä),
  //   json_valid CHECK — ei itse dataa;
  // - Manifestit ovat muuttumattomia tietueita: ei soft-deleteä (T062-vakio,
  //   softDelete:false).
  {
    version: 16,
    id: "M016",
    description: "BackupManifest: versio + sisältömanifesti eksplisiittisinä",
    statements: [
      `CREATE TABLE IF NOT EXISTS backup_manifests (
        id TEXT PRIMARY KEY,
        backup_version INTEGER NOT NULL CHECK (backup_version >= 1),
        schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
        crypto_version TEXT NOT NULL CHECK (length(trim(crypto_version)) >= 1 AND length(crypto_version) <= 30),
        contents TEXT NOT NULL CHECK (json_valid(contents)),
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_backup_manifests_created ON backup_manifests(created_at);",
    ],
  },
  // M017 (T130): geneerinen entity-doc -taulu appin EntityStoreille.
  // - Yksi rivi per entiteetti: koko entity JSON-docina (repos hallitsevat
  //   version/updatedAt-invariantit; doc-store säilöö entityn sellaisenaan);
  // - created_at duplikoitu sarakkeeksi järjestysvaatimuksiin (listaus
  //   creation-järjestyksessä kuten InMemoryStore);
  // - entity_type: repositorion entityType-merkki (esim. "task").
  {
    version: 17,
    id: "M017",
    description: "EntityDocs: geneerinen JSON-doc -tallenne appin storeille",
    statements: [
      `CREATE TABLE IF NOT EXISTS entity_docs (
        entity_type TEXT NOT NULL CHECK (length(entity_type) >= 1 AND length(entity_type) <= 60),
        id TEXT NOT NULL CHECK (length(id) >= 1),
        doc TEXT NOT NULL CHECK (json_valid(doc)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, id)
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_entity_docs_type_created ON entity_docs(entity_type, created_at, id);",
    ],
  },
  // M018 (T151): valinnainen rutiinivaihe. Vanha data säilyy pakollisena;
  // entity-doc-repoissa puuttuva optional-kenttä normalisoituu service-rajan
  // kautta falseksi.
  {
    version: 18,
    id: "M018",
    description: "Rutiinivaiheen optional-lippu",
    statements: [
      "ALTER TABLE routine_steps ADD COLUMN optional INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0, 1));",
    ],
  },
  // M019 (T204): käyttäjän painotavoite säilyy asetuksena omassa yksikössään.
  {
    version: 19,
    id: "M019",
    description: "UserPreferences: painotavoite asetuksena",
    statements: [
      "ALTER TABLE user_preferences ADD COLUMN weight_target TEXT CHECK (weight_target IS NULL OR json_valid(weight_target));",
    ],
  },
  // M020 (T205): käyttäjän ilmoittama pituus BMI-laskentaa varten.
  {
    version: 20,
    id: "M020",
    description: "UserPreferences: käyttäjän pituus cm-yksikössä",
    statements: [
      "ALTER TABLE user_preferences ADD COLUMN height_cm TEXT CHECK (height_cm IS NULL OR (CAST(height_cm AS REAL) >= 50 AND CAST(height_cm AS REAL) <= 250));",
    ],
  },
  // M021 (T212): lisää SpO₂ mittaustyyppien suljettuun unioniin.
  // measurements-taulun CHECK päivitetään tietoja säilyttävällä rebuildillä;
  // kaikki aiemmat rivit kopioidaan transaktion sisällä ennen vanhan taulun
  // poistamista. Mittauksilla ei ole viiteavaimia muista tauluista.
  {
    version: 21,
    id: "M021",
    description: "Measurements: SpO₂-mittaustyyppi",
    statements: [
      "DROP INDEX IF EXISTS idx_measurements_type_at;",
      "DROP INDEX IF EXISTS idx_measurements_at;",
      `CREATE TABLE IF NOT EXISTS measurements_m021 (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('weight', 'blood-pressure', 'blood-sugar', 'temperature', 'spo2', 'body-measure', 'custom')),
        value REAL NOT NULL,
        secondary_value REAL,
        unit TEXT NOT NULL CHECK (length(trim(unit)) >= 1 AND length(unit) <= 20),
        measured_at TEXT NOT NULL,
        note TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `INSERT INTO measurements_m021 (
         id, type, value, secondary_value, unit, measured_at, note,
         created_at, updated_at, version
       ) SELECT
         id, type, value, secondary_value, unit, measured_at, note,
         created_at, updated_at, version
       FROM measurements;`,
      "DROP TABLE measurements;",
      "ALTER TABLE measurements_m021 RENAME TO measurements;",
      "CREATE INDEX IF NOT EXISTS idx_measurements_type_at ON measurements(type, measured_at);",
      "CREATE INDEX IF NOT EXISTS idx_measurements_at ON measurements(measured_at);",
    ],
  },
  // M022 (T223): mukautettavat aterialuokat UserPreferences-asetuksissa.
  // Vanhoille profiileille lisätään §11:n oletusluokat; käyttäjän piilottamat
  // luokat säilyvät listassa historiallisten ravintomerkintöjen nimiä varten.
  {
    version: 22,
    id: "M022",
    description: "UserPreferences: aterialuokat oletuksineen ja mukautuksineen",
    statements: [
      `ALTER TABLE user_preferences ADD COLUMN meal_slots TEXT NOT NULL DEFAULT '[{"id":"breakfast","label":"Aamiainen","sortOrder":0,"archived":false},{"id":"lunch","label":"Lounas","sortOrder":1,"archived":false},{"id":"dinner","label":"Päivällinen","sortOrder":2,"archived":false},{"id":"snack","label":"Välipala","sortOrder":3,"archived":false}]' CHECK (json_valid(meal_slots) AND json_type(meal_slots) = 'array');`,
    ],
  },
  // M023 (T226): vapaaehtoiset ravintotavoitteet UserPreferences-asetuksissa.
  // Vanhoille profiileille jokainen tavoite jätetään tyhjäksi.
  {
    version: 23,
    id: "M023",
    description: "UserPreferences: päivittäiset ravintotavoitteet",
    statements: [
      `ALTER TABLE user_preferences ADD COLUMN macro_targets TEXT NOT NULL DEFAULT '{"caloriesKcal":null,"proteinG":null,"carbsG":null,"fatG":null,"fiberG":null}' CHECK (json_valid(macro_targets) AND json_type(macro_targets) = 'object');`,
    ],
  },
  // M024 (T230): valinnainen päivittäinen juomatavoite millilitroina.
  // Vanhoille profiileille tavoitetta ei aseteta automaattisesti.
  {
    version: 24,
    id: "M024",
    description: "UserPreferences: päivittäinen nestetavoite",
    statements: [
      "ALTER TABLE user_preferences ADD COLUMN hydration_target_ml INTEGER CHECK (hydration_target_ml IS NULL OR (hydration_target_ml >= 1 AND hydration_target_ml <= 20000));",
    ],
  },
  // M025 (T232): paikallinen nestetavoitteen tarkistusaika. Muistutus on
  // foreground-ehdon arviointi; se ei lupaa suljetun selaimen ilmoitusta.
  {
    version: 25,
    id: "M025",
    description: "UserPreferences: nestetavoitteen tarkistusaika",
    statements: [
      "ALTER TABLE user_preferences ADD COLUMN hydration_reminder_time TEXT CHECK (hydration_reminder_time IS NULL OR hydration_reminder_time GLOB '[01][0-9]:[0-5][0-9]' OR hydration_reminder_time GLOB '2[0-3]:[0-5][0-9]');",
    ],
  },
  // M026: entity-dokumentin formaattiversio erotetaan domain-versionumerosta.
  // Vanhat dokumentit alkavat versiosta 0 ja päivittyvät entity-kohtaisesti
  // lukurajassa, kun kyseiselle tyypille lisätään migraatio.
  {
    version: 26,
    id: "M026",
    description: "EntityDocs: dokumenttiformaatin versio",
    statements: [
      "ALTER TABLE entity_docs ADD COLUMN doc_version INTEGER NOT NULL DEFAULT 0 CHECK (doc_version >= 0);",
    ],
  },
  // M027: Goalin paikalliset voimassaolopäivät siirretään JSON-dokkarista
  // omiksi sarakkeikseen, jotta relaatiostore säilyttää koko domain-mallin.
  {
    version: 27,
    id: "M027",
    description: "Goals: voimassaolon alku- ja loppupäivä",
    statements: [
      "ALTER TABLE goals ADD COLUMN active_from TEXT CHECK (active_from IS NULL OR (length(active_from) = 10 AND active_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));",
      "ALTER TABLE goals ADD COLUMN active_until TEXT CHECK (active_until IS NULL OR (length(active_until) = 10 AND active_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));",
    ],
  },
  // M028: Measurement-domainin valinnaiset mittarinimi- ja verenpainetiedot
  // siirtyvät relaatiotauluun JSON-dokumenttien sijaan.
  {
    version: 28,
    id: "M028",
    description: "Measurements: mittarin nimi, pulssi ja konteksti",
    statements: [
      "ALTER TABLE measurements ADD COLUMN metric_name TEXT CHECK (metric_name IS NULL OR (length(trim(metric_name)) BETWEEN 1 AND 60));",
      "ALTER TABLE measurements ADD COLUMN pulse_bpm INTEGER CHECK (pulse_bpm IS NULL OR (pulse_bpm >= 1 AND pulse_bpm <= 300));",
      "ALTER TABLE measurements ADD COLUMN context TEXT CHECK (context IS NULL OR context IN ('morning', 'evening', 'resting', 'after-activity', 'other'));",
    ],
  },
  // M029: Foodin täydet nykyiset ravintotiedot myös relaatiotallennuksessa.
  {
    version: 29,
    id: "M029",
    description: "Foods: kuitu ja oletusannoksen koko",
    statements: [
      "ALTER TABLE foods ADD COLUMN fiber_per_100g REAL CHECK (fiber_per_100g IS NULL OR fiber_per_100g >= 0);",
      "ALTER TABLE foods ADD COLUMN serving_size_g REAL CHECK (serving_size_g IS NULL OR serving_size_g > 0);",
    ],
  },
  // M030: NutritionEntry tallentaa ruoka-, annos-, aterialuokka- ja kuitutiedot
  // relaatiotauluun; food_id viittaa ensin migroituun Food-riviin.
  {
    version: 30,
    id: "M030",
    description: "NutritionEntries: ruoka, määrä, aterialuokka ja kuitu",
    statements: [
      "ALTER TABLE nutrition_entries ADD COLUMN food_id TEXT REFERENCES foods(id) ON DELETE SET NULL;",
      "ALTER TABLE nutrition_entries ADD COLUMN amount_g REAL CHECK (amount_g IS NULL OR amount_g > 0);",
      "ALTER TABLE nutrition_entries ADD COLUMN meal_slot_id TEXT CHECK (meal_slot_id IS NULL OR (length(trim(meal_slot_id)) BETWEEN 1 AND 60));",
      "ALTER TABLE nutrition_entries ADD COLUMN fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0);",
      "CREATE INDEX IF NOT EXISTS idx_nutrition_food ON nutrition_entries(food_id);",
    ],
  },
  // M031: reseptien annosmäärä ja ainesosien grammamäärät relaatiomalliin.
  {
    version: 31,
    id: "M031",
    description: "Recipes: annosmäärä ja määrällinen recipe-foods-junction",
    statements: [
      "ALTER TABLE recipes ADD COLUMN servings REAL CHECK (servings IS NULL OR servings > 0);",
      `CREATE TABLE recipe_foods_next (
        id INTEGER PRIMARY KEY,
        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
        amount_g REAL CHECK (amount_g IS NULL OR amount_g > 0),
        position INTEGER NOT NULL CHECK (position >= 0),
        UNIQUE (recipe_id, position)
      ) STRICT;`,
      `INSERT INTO recipe_foods_next (recipe_id, food_id, amount_g, position)
       SELECT recipe_id, food_id, NULL,
              ROW_NUMBER() OVER (PARTITION BY recipe_id ORDER BY food_id) - 1
       FROM recipe_foods;`,
      "DROP TABLE recipe_foods;",
      "ALTER TABLE recipe_foods_next RENAME TO recipe_foods;",
      "CREATE INDEX IF NOT EXISTS idx_recipe_foods_food ON recipe_foods(food_id);",
      "CREATE INDEX IF NOT EXISTS idx_recipe_foods_recipe_position ON recipe_foods(recipe_id, position);",
    ],
  },
  // M032: sovelluksen käyttämät lisäravinnesuunnitelman kentät supplements-riville.
  {
    version: 32,
    id: "M032",
    description: "Supplements: annos, aikataulu ja saldon tarkistuspiste",
    statements: [
      "ALTER TABLE supplements ADD COLUMN amount REAL CHECK (amount IS NULL OR amount > 0);",
      "ALTER TABLE supplements ADD COLUMN unit TEXT CHECK (unit IS NULL OR (length(trim(unit)) BETWEEN 1 AND 40));",
      "ALTER TABLE supplements ADD COLUMN schedule_json TEXT;",
      "ALTER TABLE supplements ADD COLUMN stock_amount REAL CHECK (stock_amount IS NULL OR stock_amount >= 0);",
      "ALTER TABLE supplements ADD COLUMN stock_unit TEXT CHECK (stock_unit IS NULL OR (length(trim(stock_unit)) BETWEEN 1 AND 40));",
      "ALTER TABLE supplements ADD COLUMN stock_counted_at TEXT;",
    ],
  },
  // M033: lokin tila ja annossnapshot. Pending/skipped-rivillä ei ole taken_at-aikaa.
  {
    version: 33,
    id: "M033",
    description: "SupplementLogs: status, suunniteltu aika ja annossnapshot",
    statements: [
      `CREATE TABLE supplement_logs_next (
        id TEXT PRIMARY KEY,
        supplement_id TEXT NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('taken', 'skipped', 'pending')),
        scheduled_at TEXT,
        dose_amount REAL CHECK (dose_amount IS NULL OR dose_amount > 0),
        dose_unit TEXT CHECK (dose_unit IS NULL OR (length(trim(dose_unit)) BETWEEN 1 AND 40)),
        taken_at TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")},
        CHECK ((status = 'taken' AND taken_at IS NOT NULL) OR (status IN ('skipped', 'pending') AND taken_at IS NULL))
      ) STRICT;`,
      `INSERT INTO supplement_logs_next (
         id, supplement_id, status, scheduled_at, dose_amount, dose_unit, taken_at,
         created_at, updated_at, version
       ) SELECT id, supplement_id, 'taken', NULL, NULL, NULL, taken_at,
                created_at, updated_at, version
         FROM supplement_logs;`,
      "DROP TABLE supplement_logs;",
      "ALTER TABLE supplement_logs_next RENAME TO supplement_logs;",
      "CREATE INDEX IF NOT EXISTS idx_supplement_logs_supplement ON supplement_logs(supplement_id, taken_at);",
      "CREATE INDEX IF NOT EXISTS idx_supplement_logs_scheduled ON supplement_logs(supplement_id, scheduled_at);",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_supplement_logs_scheduled_unique ON supplement_logs(supplement_id, scheduled_at) WHERE scheduled_at IS NOT NULL;",
    ],
  },
  // M034 (T079): BreathingSessionin nykyiset domain-kentät pysyvään tauluun.
  {
    version: 34,
    id: "M034",
    description: "BreathingSessions: istuntohistoria ja hengitysmallin avain",
    statements: [
      `CREATE TABLE IF NOT EXISTS breathing_sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT CHECK (ended_at IS NULL OR ended_at >= started_at),
        pattern_key TEXT NOT NULL CHECK (length(trim(pattern_key)) >= 1),
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_breathing_sessions_started ON breathing_sessions(started_at);",
    ],
  },
  // M035 (T073): Questin ehto tallennetaan questin kanssa.
  // Aiemmat rivit säilyvät null-ehtoina, sillä niiden sääntöä ei voi päätellä
  // luotettavasti pelkästä progress.goal-arvosta.
  {
    version: 35,
    id: "M035",
    description: "Quests: persisted condition kind, goal and minimum amount",
    statements: [
      `ALTER TABLE quests ADD COLUMN condition_kind TEXT
       CHECK (condition_kind IS NULL OR condition_kind IN ('event-count', 'active-day-count'));`,
      `ALTER TABLE quests ADD COLUMN condition_goal INTEGER
       CHECK (condition_goal IS NULL OR condition_goal >= 1);`,
      `ALTER TABLE quests ADD COLUMN minimum_amount REAL
       CHECK (minimum_amount IS NULL OR minimum_amount > 0);`,
      `CREATE TRIGGER IF NOT EXISTS trg_quests_condition_insert
       BEFORE INSERT ON quests
       WHEN (NEW.condition_kind IS NULL AND
             (NEW.condition_goal IS NOT NULL OR NEW.minimum_amount IS NOT NULL))
         OR (NEW.condition_kind IS NOT NULL AND
             (NEW.condition_goal IS NULL OR NEW.condition_goal < 1))
       BEGIN SELECT RAISE(ABORT, 'quest-condition-invalid'); END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_quests_condition_update
       BEFORE UPDATE OF condition_kind, condition_goal, minimum_amount ON quests
       WHEN (NEW.condition_kind IS NULL AND
             (NEW.condition_goal IS NOT NULL OR NEW.minimum_amount IS NOT NULL))
         OR (NEW.condition_kind IS NOT NULL AND
             (NEW.condition_goal IS NULL OR NEW.condition_goal < 1))
       BEGIN SELECT RAISE(ABORT, 'quest-condition-invalid'); END;`,
    ],
  },
  // M036 (T073): käyttäjän Reward Vault -palkintojen relaatiotallennus.
  // Lunastushistoria säilyy tässä vaiheessa entity-doc -storeissa. Triggerit
  // turvaavat rewardId-viitteen ja estävät lunastetun palkinnon poistamisen.
  {
    version: 36,
    id: "M036",
    description: "Reward Vault: persistent user-defined XP-threshold rewards",
    statements: [
      `CREATE TABLE IF NOT EXISTS vault_rewards (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
        note TEXT CHECK (note IS NULL OR length(note) <= 500),
        xp_threshold INTEGER NOT NULL CHECK (xp_threshold >= 1),
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_vault_rewards_threshold ON vault_rewards(xp_threshold, created_at);",
      `CREATE TRIGGER IF NOT EXISTS trg_vault_claim_entity_doc_insert
       BEFORE INSERT ON entity_docs
       WHEN NEW.entity_type = 'vault-claim'
         AND (COALESCE(json_type(NEW.doc, '$.rewardId'), '') <> 'text'
              OR NOT EXISTS (
                SELECT 1 FROM vault_rewards WHERE id = json_extract(NEW.doc, '$.rewardId')
              ))
       BEGIN SELECT RAISE(ABORT, 'vault-claim-reward-missing'); END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_vault_claim_entity_doc_update
       BEFORE UPDATE OF entity_type, doc ON entity_docs
       WHEN NEW.entity_type = 'vault-claim'
         AND (COALESCE(json_type(NEW.doc, '$.rewardId'), '') <> 'text'
              OR NOT EXISTS (
                SELECT 1 FROM vault_rewards WHERE id = json_extract(NEW.doc, '$.rewardId')
              ))
       BEGIN SELECT RAISE(ABORT, 'vault-claim-reward-missing'); END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_vault_reward_restrict_claim_delete
       BEFORE DELETE ON vault_rewards
       WHEN EXISTS (
         SELECT 1 FROM entity_docs
         WHERE entity_type = 'vault-claim'
           AND json_extract(doc, '$.rewardId') = OLD.id
       )
       BEGIN SELECT RAISE(ABORT, 'vault-reward-claimed'); END;`,
    ],
  },
  // M037 (T073): VaultRewardClaim on pysyvä append-only-kirjaus.
  // Historialliset entity-docit siirretään storea avattaessa M036-palkintojen
  // jälkeen; FK suojaa palkintoviitteen myös rinnakkaisissa kirjoituksissa.
  {
    version: 37,
    id: "M037",
    description: "Reward Vault: append-only relational claim history",
    statements: [
      `CREATE TABLE IF NOT EXISTS vault_reward_claims (
        id TEXT PRIMARY KEY,
        reward_id TEXT NOT NULL REFERENCES vault_rewards(id) ON DELETE RESTRICT,
        claimed_at TEXT NOT NULL,
        xp_deducted INTEGER NOT NULL CHECK (xp_deducted >= 0),
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_vault_reward_claims_reward ON vault_reward_claims(reward_id, claimed_at, created_at);",
      `CREATE TRIGGER IF NOT EXISTS trg_vault_reward_claim_no_update
       BEFORE UPDATE ON vault_reward_claims
       BEGIN SELECT RAISE(ABORT, 'vault-reward-claim-append-only'); END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_vault_reward_claim_no_delete
       BEFORE DELETE ON vault_reward_claims
       BEGIN SELECT RAISE(ABORT, 'vault-reward-claim-append-only'); END;`,
    ],
  },
  // M038 (T073): XPTransactionin M014-taulu on tuotannon append-only-ledger.
  {
    version: 38,
    id: "M038",
    description: "Gamification: enforce append-only XP transaction ledger",
    statements: [
      `CREATE TRIGGER IF NOT EXISTS trg_xp_transaction_no_update
       BEFORE UPDATE ON xp_transactions
       BEGIN SELECT RAISE(ABORT, 'xp-transaction-append-only'); END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_xp_transaction_no_delete
       BEFORE DELETE ON xp_transactions
       BEGIN SELECT RAISE(ABORT, 'xp-transaction-append-only'); END;`,
    ],
  },
  // M039: käyttäjälle ansaitut saavutukset ja keräilyesineet ovat historiaa.
  // Parentin M014-CASCADE ei saa poistaa tai muuttaa niitä epäsuorasti.
  {
    version: 39,
    id: "M039",
    description: "Gamification: enforce append-only user reward history",
    statements: [
      `CREATE TRIGGER IF NOT EXISTS trg_user_reward_no_update
       BEFORE UPDATE ON user_rewards
       BEGIN SELECT RAISE(ABORT, 'user-reward-append-only'); END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_user_reward_no_delete
       BEFORE DELETE ON user_rewards
       BEGIN SELECT RAISE(ABORT, 'user-reward-append-only'); END;`,
    ],
  },
  // M040: Taskin nykyiset lisäkentät ja tunnisteiden järjestys säilyvät
  // relaatiotallennuksessa. Vanhojen tehtävien data siirretään storea avatessa.
  {
    version: 40,
    id: "M040",
    description: "Tasks: persist recurrence, estimates, elapsed seconds and ordered tags",
    statements: [
      `ALTER TABLE tasks ADD COLUMN recurrence_json TEXT;`,
      `ALTER TABLE tasks ADD COLUMN estimate_minutes REAL
       CHECK (estimate_minutes IS NULL OR estimate_minutes > 0);`,
      `ALTER TABLE tasks ADD COLUMN actual_seconds REAL NOT NULL DEFAULT 0
       CHECK (actual_seconds >= 0);`,
      `ALTER TABLE task_tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0
       CHECK (sort_order >= 0);`,
      "CREATE INDEX IF NOT EXISTS idx_task_tags_order ON task_tags(task_id, sort_order, tag_id);",
    ],
  },
  // M041: persist FocusSession's post-M008 domain fields. Keep the schema
  // aligned with the current timer/history model and preserve the optional
  // CalendarBlock reference used by sessions launched from the calendar.
  {
    version: 41,
    id: "M041",
    description: "FocusSessions: timebox-linkki ja aktiivisen ajan metadata",
    statements: [
      "ALTER TABLE focus_sessions ADD COLUMN calendar_block_id TEXT REFERENCES calendar_blocks(id) ON DELETE SET NULL;",
      "ALTER TABLE focus_sessions ADD COLUMN active_elapsed_seconds REAL CHECK (active_elapsed_seconds IS NULL OR active_elapsed_seconds >= 0);",
      "ALTER TABLE focus_sessions ADD COLUMN active_segment_started_at TEXT;",
      "ALTER TABLE focus_sessions ADD COLUMN accumulated_pause_seconds INTEGER CHECK (accumulated_pause_seconds IS NULL OR accumulated_pause_seconds >= 0);",
      "ALTER TABLE focus_sessions ADD COLUMN interruption_count INTEGER CHECK (interruption_count IS NULL OR interruption_count >= 0);",
      "CREATE INDEX IF NOT EXISTS idx_focus_calendar_block ON focus_sessions(calendar_block_id);",
    ],
  },
  // M042: RoutineSchedule käyttää samaa relaatiopolkua kuin rutiini ja sen
  // askeleet. Viikonpäivät säilyvät JSON-taulukkona, jonka muoto ja
  // rytmikohtainen pituus tarkistetaan skeemassa; tarkemmat päiväarvot
  // validoidaan store-rajalla domain-säännöillä.
  {
    version: 42,
    id: "M042",
    description: "RoutineSchedules: aikataulut relationaaliseksi Routine-viitteellä",
    statements: [
      `CREATE TABLE IF NOT EXISTS routine_schedules (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly')),
        weekdays_json TEXT NOT NULL CHECK (
          json_valid(weekdays_json) AND json_type(weekdays_json) = 'array' AND
          ((cadence = 'daily' AND json_array_length(weekdays_json) = 0) OR
           (cadence = 'weekly' AND json_array_length(weekdays_json) BETWEEN 1 AND 7))
        ),
        local_time TEXT CHECK (
          local_time IS NULL OR (
            length(local_time) = 5 AND substr(local_time, 3, 1) = ':' AND
            (substr(local_time, 1, 2) GLOB '[01][0-9]' OR
             substr(local_time, 1, 2) IN ('20', '21', '22', '23')) AND
            substr(local_time, 4, 2) GLOB '[0-5][0-9]'
          )
        ),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        ${entityMetadataColumns({ softDelete: true }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_routine_schedules_routine ON routine_schedules(routine_id, created_at, id);",
      "CREATE INDEX IF NOT EXISTS idx_routine_schedules_enabled ON routine_schedules(enabled, cadence);",
    ],
  },
  // M043: RoutineRun muuttuu suorituksen aikana (running -> completed/skipped),
  // joten historian tila päivittyy saman rivin sisällä. Ei-perutun ajon
  // päiväkohtainen yksikäsitteisyys nostetaan myös SQL-tasolle.
  {
    version: 43,
    id: "M043",
    description: "RoutineRuns: suoritushistoria relaatiotauluun",
    statements: [
      `CREATE TABLE IF NOT EXISTS routine_runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE RESTRICT,
        local_date TEXT NOT NULL CHECK (
          length(local_date) = 10 AND local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        ),
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'skipped', 'cancelled')),
        day_mode TEXT CHECK (day_mode IS NULL OR day_mode IN ('full', 'minimum')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        skip_reason TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_routine_runs_routine_history ON routine_runs(routine_id, local_date DESC, started_at DESC);",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_runs_active_day ON routine_runs(routine_id, local_date) WHERE status <> 'cancelled';",
    ],
  },
  // M044: askelkirjaus yhdistää olemassa olevan RoutineRunin ja RoutineStepin.
  // FK:t säilyttävät historian, UNIQUE estää saman askeleen tuplakirjauksen,
  // ja triggerit varmistavat, että molemmat parentit kuuluvat samaan rutiiniin.
  {
    version: 44,
    id: "M044",
    description: "RoutineStepRuns: askelkohtainen suoritushistoria relaatioon",
    statements: [
      `CREATE TABLE IF NOT EXISTS routine_step_runs (
        id TEXT PRIMARY KEY,
        routine_run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE RESTRICT,
        routine_step_id TEXT NOT NULL REFERENCES routine_steps(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped')),
        completed_at TEXT,
        skip_reason TEXT,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")},
        CHECK (
          (status = 'pending' AND completed_at IS NULL AND skip_reason IS NULL) OR
          (status = 'completed' AND completed_at IS NOT NULL AND skip_reason IS NULL) OR
          (status = 'skipped' AND completed_at IS NOT NULL AND
            skip_reason IS NOT NULL AND length(trim(skip_reason)) > 0)
        ),
        UNIQUE (routine_run_id, routine_step_id)
      ) STRICT;`,
      "CREATE INDEX IF NOT EXISTS idx_routine_step_runs_run ON routine_step_runs(routine_run_id, created_at, id);",
      "CREATE INDEX IF NOT EXISTS idx_routine_step_runs_step ON routine_step_runs(routine_step_id, created_at, id);",
      `CREATE TRIGGER IF NOT EXISTS trg_routine_step_runs_same_routine_insert
       BEFORE INSERT ON routine_step_runs
       WHEN (SELECT routine_id FROM routine_runs WHERE id = NEW.routine_run_id)
            IS NOT
            (SELECT routine_id FROM routine_steps WHERE id = NEW.routine_step_id)
       BEGIN
         SELECT RAISE(ABORT, 'routine-step-run-parent-mismatch');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_routine_step_runs_same_routine_update
       BEFORE UPDATE OF routine_run_id, routine_step_id ON routine_step_runs
       WHEN (SELECT routine_id FROM routine_runs WHERE id = NEW.routine_run_id)
            IS NOT
            (SELECT routine_id FROM routine_steps WHERE id = NEW.routine_step_id)
       BEGIN
         SELECT RAISE(ABORT, 'routine-step-run-parent-mismatch');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_routine_runs_keep_step_run_routine
       BEFORE UPDATE OF routine_id ON routine_runs
       WHEN EXISTS (
         SELECT 1
         FROM routine_step_runs AS step_run
         JOIN routine_steps AS step ON step.id = step_run.routine_step_id
         WHERE step_run.routine_run_id = OLD.id AND step.routine_id IS NOT NEW.routine_id
       )
       BEGIN
         SELECT RAISE(ABORT, 'routine-step-run-parent-mismatch');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_routine_steps_keep_step_run_routine
       BEFORE UPDATE OF routine_id ON routine_steps
       WHEN EXISTS (
         SELECT 1
         FROM routine_step_runs AS step_run
         JOIN routine_runs AS run ON run.id = step_run.routine_run_id
         WHERE step_run.routine_step_id = OLD.id AND run.routine_id IS NOT NEW.routine_id
       )
       BEGIN
         SELECT RAISE(ABORT, 'routine-step-run-parent-mismatch');
       END;`,
    ],
  },
  // M045: unen päiväuni/yöuni-luokka; vanhat kirjaukset säilyvät yöunina.
  {
    version: 45,
    id: "M045",
    description: "SleepEntry: tallenna päiväunimerkintä",
    statements: [
      "ALTER TABLE sleep_entries ADD COLUMN is_nap INTEGER NOT NULL DEFAULT 0 CHECK (is_nap IN (0, 1));",
    ],
  },
  // M046 (T243): aktiviteetin valinnainen muistiinpano; vanhat rivit pysyvät null-arvoisina.
  {
    version: 46,
    id: "M046",
    description: "ActivityEntry: tallenna aktiviteetin muistiinpano",
    statements: [
      "ALTER TABLE activity_entries ADD COLUMN note TEXT CHECK (note IS NULL OR length(note) <= 500);",
    ],
  },
  // M047 (T247): check-inin neljä vapaaehtoista 1–5-asteikkoa; vanhat rivit pysyvät null-arvoisina.
  {
    version: 47,
    id: "M047",
    description: "MoodCheckin: stressi, energia, motivaatio ja keskittyminen",
    statements: [
      "ALTER TABLE mood_checkins ADD COLUMN stress INTEGER CHECK (stress IS NULL OR stress BETWEEN 1 AND 5);",
      "ALTER TABLE mood_checkins ADD COLUMN motivation INTEGER CHECK (motivation IS NULL OR motivation BETWEEN 1 AND 5);",
      "ALTER TABLE mood_checkins ADD COLUMN focus INTEGER CHECK (focus IS NULL OR focus BETWEEN 1 AND 5);",
      "CREATE TRIGGER IF NOT EXISTS trg_mood_checkins_energy_scale_insert BEFORE INSERT ON mood_checkins WHEN NEW.energy IS NOT NULL AND NEW.energy NOT BETWEEN 1 AND 5 BEGIN SELECT RAISE(ABORT, 'mood-checkin-energy-scale'); END;",
      "CREATE TRIGGER IF NOT EXISTS trg_mood_checkins_energy_scale_update BEFORE UPDATE OF energy ON mood_checkins WHEN NEW.energy IS NOT NULL AND NEW.energy NOT BETWEEN 1 AND 5 BEGIN SELECT RAISE(ABORT, 'mood-checkin-energy-scale'); END;",
    ],
  },
  // M048 (T250): päiväkirjan ohjatut reflektiot; taulun rebuild sallii reflection-only-merkinnän.
  {
    version: 48,
    id: "M048",
    description: "JournalEntry: vapaa teksti ja onnistumis-/haaste-/huomiskentät",
    statements: [
      `CREATE TABLE journal_entries_t250 (
        id TEXT PRIMARY KEY,
        written_at TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        reflection_success TEXT CHECK (reflection_success IS NULL OR length(reflection_success) <= 2000),
        reflection_difficult TEXT CHECK (reflection_difficult IS NULL OR length(reflection_difficult) <= 2000),
        reflection_tomorrow TEXT CHECK (reflection_tomorrow IS NULL OR length(reflection_tomorrow) <= 2000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        deleted_at TEXT,
        CHECK (
          length(trim(body)) >= 1 OR
          (reflection_success IS NOT NULL AND length(trim(reflection_success)) >= 1) OR
          (reflection_difficult IS NOT NULL AND length(trim(reflection_difficult)) >= 1) OR
          (reflection_tomorrow IS NOT NULL AND length(trim(reflection_tomorrow)) >= 1)
        )
      ) STRICT;`,
      `INSERT INTO journal_entries_t250 (
        id, written_at, title, body, reflection_success, reflection_difficult,
        reflection_tomorrow, created_at, updated_at, version, deleted_at
      )
      SELECT id, written_at, title, body, NULL, NULL, NULL, created_at, updated_at, version, deleted_at
      FROM journal_entries;`,
      "DROP TABLE journal_entries;",
      "ALTER TABLE journal_entries_t250 RENAME TO journal_entries;",
      "CREATE INDEX IF NOT EXISTS idx_journal_written ON journal_entries(written_at);",
    ],
  },
  // M049 (T281): sarjoitettu, validoitava muistutussääntö ajastinta varten.
  // Vanhoilla riveillä null säilyttää tiedot mutta estää puuttuvan säännön arvailun.
  {
    version: 49,
    id: "M049",
    description: "Reminder: säilytä time/recurrence/deadline/conditional-sääntö",
    statements: [
      "ALTER TABLE reminders ADD COLUMN rule_json TEXT CHECK (rule_json IS NULL OR length(rule_json) <= 2048);",
    ],
  },
  // M050 (T282): muistutuskategoriat ovat käyttäjän paikallinen asetus.
  {
    version: 50,
    id: "M050",
    description: "UserPreferences: notification categories",
    statements: [
      `ALTER TABLE user_preferences ADD COLUMN notification_categories TEXT NOT NULL
       DEFAULT '{"task":true,"routine":true,"focus":true,"health":true,"supplement":true,"system":true}'
       CHECK (json_valid(notification_categories) AND json_type(notification_categories) = 'object');`,
    ],
  },
  // M051 (T291): käyttäjän tekemä snooze kirjataan erillisenä toimitustilana.
  {
    version: 51,
    id: "M051",
    description: "NotificationState: snoozed delivery state",
    statements: [
      "ALTER TABLE notification_states RENAME TO notification_states_before_snoozed;",
      `CREATE TABLE notification_states (
        id TEXT PRIMARY KEY,
        reminder_id TEXT REFERENCES reminders(id) ON DELETE SET NULL,
        category_key TEXT NOT NULL CHECK (length(trim(category_key)) >= 1 AND length(category_key) <= 60),
        delivery TEXT NOT NULL CHECK (delivery IN ('pending', 'shown', 'dismissed', 'missed', 'snoozed')),
        last_evaluated_at TEXT NOT NULL,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")}
      ) STRICT;`,
      `INSERT INTO notification_states (
        id, reminder_id, category_key, delivery, last_evaluated_at,
        created_at, updated_at, version
      ) SELECT id, reminder_id, category_key, delivery, last_evaluated_at,
               created_at, updated_at, version
        FROM notification_states_before_snoozed;`,
      "DROP TABLE notification_states_before_snoozed;",
      "CREATE INDEX IF NOT EXISTS idx_notification_states_reminder ON notification_states(reminder_id);",
    ],
  },
  // M052 (T315): provider-specific opaque remote checkpoint. Keep legacy
  // cursors as a null provider checkpoint so the first sync safely rescans.
  {
    version: 52,
    id: "M052",
    description: "SyncCursor: persist provider-specific checkpoint",
    statements: [
      "ALTER TABLE sync_cursors RENAME TO sync_cursors_before_provider_cursor;",
      `CREATE TABLE sync_cursors (
        id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL CHECK (length(installation_id) >= 1),
        provider_id TEXT NOT NULL CHECK (length(provider_id) >= 1 AND length(provider_id) <= 128),
        provider_cursor TEXT CHECK (provider_cursor IS NULL OR length(provider_cursor) <= 1400000),
        last_seen_operation_id TEXT,
        updated_through TEXT NOT NULL,
        ${entityMetadataColumns({ softDelete: false }).join(",\n        ")},
        UNIQUE (installation_id, provider_id)
      ) STRICT;`,
      `INSERT INTO sync_cursors (
        id, installation_id, provider_id, provider_cursor, last_seen_operation_id,
        updated_through, created_at, updated_at, version
      ) SELECT id, installation_id, 'legacy', NULL, last_seen_operation_id,
               updated_through, created_at, updated_at, version
        FROM sync_cursors_before_provider_cursor;`,
      "DROP TABLE sync_cursors_before_provider_cursor;",
      "CREATE INDEX IF NOT EXISTS idx_sync_cursors_installation ON sync_cursors(installation_id);",
    ],
  },
  // M053 (T328): distinguish this profile's installation from encrypted
  // metadata received for other browser installations.
  {
    version: 53,
    id: "M053",
    description: "BrowserInstallation: local versus received metadata",
    statements: [
      `ALTER TABLE browser_installations
       ADD COLUMN is_local INTEGER NOT NULL DEFAULT 1 CHECK (is_local IN (0, 1));`,
      "CREATE INDEX IF NOT EXISTS idx_browser_installations_local ON browser_installations(is_local, created_at, id);",
    ],
  },
  // M054 (T339): hold encrypted health/private-field payloads separately from
  // the searchable relational columns. A row is keyed by its source table/id;
  // the worker owns encryption and exposes plaintext only to authenticated
  // local-data sessions.
  {
    version: 54,
    id: "M054",
    description: "Encrypted local private-record payloads",
    statements: [
      `CREATE TABLE IF NOT EXISTS local_private_records (
        record_type TEXT NOT NULL CHECK (length(record_type) >= 1 AND length(record_type) <= 60),
        record_id TEXT NOT NULL CHECK (length(record_id) >= 1 AND length(record_id) <= 256),
        payload TEXT NOT NULL CHECK (length(payload) >= 1),
        PRIMARY KEY (record_type, record_id)
      ) STRICT;`,
    ],
  },
] as const;

export const CURRENT_SCHEMA_VERSION = 54;

export type MigrationChainIssue =
  | { readonly kind: "empty-chain" }
  | { readonly kind: "starts-not-at-one"; readonly firstVersion: number }
  | { readonly kind: "duplicate-version"; readonly version: number }
  | { readonly kind: "gap"; readonly expected: number; readonly found: number }
  | { readonly kind: "duplicate-id"; readonly id: string }
  | { readonly kind: "empty-statements"; readonly id: string };

/** Validoi ketjun eheyden ennen ajoa: 1..N aukoton, ei duplikaatteja. */
export function validateMigrationChain(
  chain: readonly MigrationStep[],
): { readonly ok: true } | { readonly ok: false; readonly issue: MigrationChainIssue } {
  if (chain.length === 0) {
    return { ok: false, issue: { kind: "empty-chain" } };
  }
  const first = chain[0];
  if (first === undefined || first.version !== 1) {
    return { ok: false, issue: { kind: "starts-not-at-one", firstVersion: first?.version ?? -1 } };
  }
  const seenVersions = new Set<number>();
  const seenIds = new Set<string>();
  let expected = 1;
  for (const step of chain) {
    if (seenVersions.has(step.version)) {
      return { ok: false, issue: { kind: "duplicate-version", version: step.version } };
    }
    seenVersions.add(step.version);
    if (seenIds.has(step.id)) {
      return { ok: false, issue: { kind: "duplicate-id", id: step.id } };
    }
    seenIds.add(step.id);
    if (step.version !== expected) {
      return { ok: false, issue: { kind: "gap", expected, found: step.version } };
    }
    if (step.statements.length === 0) {
      return { ok: false, issue: { kind: "empty-statements", id: step.id } };
    }
    expected += 1;
  }
  return { ok: true };
}

/** Palauttaa ajettavat migraatiot nykyversiosta eteenpäin (tyhjä = ajan tasalla). */
export function pendingMigrations(
  chain: readonly MigrationStep[],
  currentVersion: number,
): readonly MigrationStep[] {
  return chain.filter((step) => step.version > currentVersion);
}

// ---------------------------------------------------------------------------
// T062: yhteinen metadata-skeema. Jokaisen ENTITEETTITAULUN (ei meta/outbox)
// metadatasarakkeet ovat täsmälleen tämä muoto (domain/base EntityMetadata):
//   id            TEXT PRIMARY KEY          (globaali ULID-tyyppinen id)
//   created_at    TEXT NOT NULL             (UTC ISO-8601)
//   updated_at    TEXT NOT NULL             (UTC ISO-8601)
//   version       INTEGER NOT NULL >= 1     (looginen versio synkkaa varten)
//   deleted_at    TEXT                      (NULL = aktiivinen; vain
//                                            soft-delete-tauluissa)
// Ajetut M002/M003 sisältävät sarakkeet inline (migraatiohistoriaa EI koskaan
// muokata); tämä apuri on pakollinen M004+:n tauluille ja testi lukitsee
// yhtenäisyyden (entity-metadata.test.ts).
// ---------------------------------------------------------------------------

export interface EntityMetadataOptions {
  /** TRUE jos entiteetti on soft-deletable (deletedAt mukaan, esim. Task). */
  readonly softDelete: boolean;
}

export function entityMetadataColumns(options: EntityMetadataOptions): readonly string[] {
  return [
    "created_at TEXT NOT NULL",
    "updated_at TEXT NOT NULL",
    "version INTEGER NOT NULL CHECK (version >= 1)",
    ...(options.softDelete ? ["deleted_at TEXT"] : []),
  ];
}

/** Sarakenimet ilman tyyppimäärittelyjä (PRAGMA table_info -vertailuun). */
export function entityMetadataColumnNames(options: EntityMetadataOptions): readonly string[] {
  return entityMetadataColumns(options).map((column) => column.split(" ")[0] ?? "");
}
