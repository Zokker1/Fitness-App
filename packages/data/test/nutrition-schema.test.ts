// T069: ravinto- ja nesteytinten integriteettitesti (oikea wasm, sama
// M001-M045-ketju kuin worker ajaa). Todistaa normalisoinnin:
// - foods makroilla per 100 g (CHECK >= 0), nutrition_entries omilla makroillaan;
// - Recipe.ingredients/servings -> määrällinen recipe_foods-junction;
// - hydration_entries tilariveinä ilman deleted_at:ta, milliliters >= 0;
// - eheysehdot: negatiiviset makrot hylätään, tyhjä label/nimi hylätään.
import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import { MIGRATIONS } from "../src/index.ts";

type Row = Record<string, unknown>;

type Db = {
  exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
  close: () => void;
};

async function openMigrated(targetVersion = 31): Promise<Db> {
  const sqlite3 = await initModule();
  const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as Db;
  db.exec("PRAGMA foreign_keys=ON;");
  for (const step of MIGRATIONS) {
    if (step.version > targetVersion) continue;
    for (const statement of step.statements) {
      db.exec(statement);
    }
  }
  return db;
}

const AT = "2026-01-01T00:00:00.000Z";

function insertFood(
  db: Db,
  id: string,
  name = "Kaura",
  overrides: Record<string, unknown> = {},
): void {
  const row: Record<string, unknown> = {
    id,
    name,
    calories_per_100g: 372,
    protein_per_100g: 13.5,
    carbs_per_100g: 58,
    fat_per_100g: 7,
    created_at: AT,
    updated_at: AT,
    version: 1,
    deleted_at: null,
    ...overrides,
  };
  db.exec(
    `INSERT INTO foods (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
       fat_per_100g, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.name,
        row.calories_per_100g,
        row.protein_per_100g,
        row.carbs_per_100g,
        row.fat_per_100g,
        row.created_at,
        row.updated_at,
        row.version,
        row.deleted_at,
      ],
    },
  );
}

function insertRecipe(db: Db, id: string, name = "Puuro"): void {
  db.exec(
    `INSERT INTO recipes (id, name, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, 1, NULL);`,
    { bind: [id, name, AT, AT] },
  );
}

describe("nutrition schema (T069)", () => {
  it("normalisoitu malli: foods + recipe-junction + kirjaukset omilla makroillaan", async () => {
    const db = await openMigrated();
    try {
      insertFood(db, "f-1");
      insertFood(db, "f-2", "Maito");
      insertRecipe(db, "rc-1");
      db.exec(
        "INSERT INTO recipe_foods (recipe_id, food_id, amount_g, position) VALUES ('rc-1', 'f-1', 40, 0);",
      );
      db.exec(
        "INSERT INTO recipe_foods (recipe_id, food_id, amount_g, position) VALUES ('rc-1', 'f-2', 250, 1);",
      );
      const recipeFoods: Row[] = [];
      db.exec(
        `SELECT f.name, rf.amount_g FROM recipe_foods rf JOIN foods f ON f.id = rf.food_id
         WHERE rf.recipe_id = 'rc-1' ORDER BY f.name;`,
        { rowMode: "object", resultRows: recipeFoods },
      );
      expect(recipeFoods).toEqual([
        { name: "Kaura", amount_g: 40 },
        { name: "Maito", amount_g: 250 },
      ]);

      db.exec(
        `INSERT INTO nutrition_entries (id, eaten_at, label, calories, protein_g, carbs_g, fat_g,
           created_at, updated_at, version, deleted_at)
         VALUES ('n-1', '2026-01-02T07:45:00.000Z', 'Aamiainen', 420, 18, 55, 9, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO hydration_entries (id, drunk_at, milliliters, created_at, updated_at, version)
         VALUES ('h-1', '2026-01-02T07:46:00.000Z', 250, ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      const hydration: Row[] = [];
      db.exec("SELECT milliliters FROM hydration_entries;", {
        rowMode: "object",
        resultRows: hydration,
      });
      expect(hydration[0]?.milliliters).toBe(250);
    } finally {
      db.close();
    }
  });

  it("eheysehdot: negatiiviset makrot hylätään, junction kaskadoituu", async () => {
    const db = await openMigrated();
    try {
      insertFood(db, "f-1");
      expect(() => {
        insertFood(db, "f-bad", "Huono", { calories_per_100g: -1 });
      }).toThrow();
      expect(() => {
        insertFood(db, "f-empty", "  ");
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO nutrition_entries (id, eaten_at, label, calories, protein_g, carbs_g, fat_g,
             created_at, updated_at, version, deleted_at)
           VALUES ('n-bad', ?, 'Aamiainen', -5, NULL, NULL, NULL, ?, ?, 1, NULL);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO hydration_entries (id, drunk_at, milliliters, created_at, updated_at, version)
           VALUES ('h-bad', ?, -100, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      // hydration_entries EI sisällä deleted_at:ta (tilarivi).
      const hydrationCols: Row[] = [];
      db.exec("PRAGMA table_info(hydration_entries);", {
        rowMode: "object",
        resultRows: hydrationCols,
      });
      expect(hydrationCols.map((row) => String(row.name))).not.toContain("deleted_at");

      // Junction CASCADE: reseptin poisto poistaa liitokset, foods säilyvät.
      insertRecipe(db, "rc-1");
      db.exec(
        "INSERT INTO recipe_foods (recipe_id, food_id, amount_g, position) VALUES ('rc-1', 'f-1', 50, 0);",
      );
      db.exec("DELETE FROM recipes WHERE id = 'rc-1';");
      const junction: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM recipe_foods;", {
        rowMode: "object",
        resultRows: junction,
      });
      expect(Number(junction[0]?.n)).toBe(0);
      const foods: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM foods;", { rowMode: "object", resultRows: foods });
      expect(Number(foods[0]?.n)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("NutritionEntry viittaa Foodiin ja säilyttää snapshotin Food-rivin fyysisen poiston jälkeen", async () => {
    const db = await openMigrated();
    try {
      insertFood(db, "f-1");
      db.exec(
        `INSERT INTO nutrition_entries (
           id, eaten_at, food_id, amount_g, meal_slot_id, label, calories, protein_g,
           carbs_g, fat_g, fiber_g, created_at, updated_at, version, deleted_at
         ) VALUES ('n-1', ?, 'f-1', 150, 'breakfast', 'Kaurapuuro', 105, 3.75,
                   18, 2.25, 2.7, ?, ?, 1, NULL);`,
        { bind: ["2026-01-02T07:45:00.000Z", AT, AT] },
      );
      expect(() => {
        db.exec(
          `INSERT INTO nutrition_entries (id, eaten_at, food_id, amount_g, meal_slot_id,
             label, calories, protein_g, carbs_g, fat_g, fiber_g, created_at, updated_at,
             version, deleted_at)
           VALUES ('n-orphan', ?, 'missing-food', 100, 'breakfast', 'Orpo', 50, NULL, NULL,
                   NULL, NULL, ?, ?, 1, NULL);`,
          { bind: ["2026-01-02T07:45:00.000Z", AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO nutrition_entries (id, eaten_at, food_id, amount_g, meal_slot_id,
             label, calories, protein_g, carbs_g, fat_g, fiber_g, created_at, updated_at,
             version, deleted_at)
           VALUES ('n-bad-amount', ?, 'f-1', 0, 'breakfast', 'Virheellinen määrä', 0, NULL,
                   NULL, NULL, NULL, ?, ?, 1, NULL);`,
          { bind: ["2026-01-02T07:45:00.000Z", AT, AT] },
        );
      }).toThrow();

      db.exec("DELETE FROM foods WHERE id = 'f-1';");
      const entry: Row[] = [];
      db.exec(
        "SELECT food_id, amount_g, calories, fiber_g FROM nutrition_entries WHERE id = 'n-1';",
        {
          rowMode: "object",
          resultRows: entry,
        },
      );
      expect(entry[0]).toEqual({
        food_id: null,
        amount_g: 150,
        calories: 105,
        fiber_g: 2.7,
      });
    } finally {
      db.close();
    }
  });

  it("M031 säilyttää aiemmat recipe-food-linkit annosmäärän jäädessä tuntemattomaksi", async () => {
    const db = await openMigrated(10);
    try {
      insertFood(db, "f-legacy");
      insertRecipe(db, "rc-legacy");
      db.exec("INSERT INTO recipe_foods (recipe_id, food_id) VALUES ('rc-legacy', 'f-legacy');");
      for (const step of MIGRATIONS.filter((migration) => migration.version > 10)) {
        for (const statement of step.statements) {
          db.exec(statement);
        }
      }
      const ingredients: Row[] = [];
      db.exec(
        "SELECT food_id, amount_g, position FROM recipe_foods WHERE recipe_id = 'rc-legacy';",
        { rowMode: "object", resultRows: ingredients },
      );
      expect(ingredients).toEqual([{ food_id: "f-legacy", amount_g: null, position: 0 }]);
    } finally {
      db.close();
    }
  });
});
