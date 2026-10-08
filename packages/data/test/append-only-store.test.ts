import { describe, expect, it } from "vitest";
import { createAppendOnlyEntityStore, InMemoryStore } from "../src/index.ts";

interface LedgerRow {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly amount: number;
}

describe("createAppendOnlyEntityStore", () => {
  it("allows inserts and rejects edits and deletes", async () => {
    const store = createAppendOnlyEntityStore(new InMemoryStore<LedgerRow>("ledger"));
    const row: LedgerRow = {
      id: "claim-1",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
      version: 1,
      amount: 100,
    };

    const conflicting = { ...row, amount: 0, version: 2 };
    const results = await Promise.all([store.save(row), store.save(conflicting)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toMatchObject([
      { ok: false, error: { code: "already-exists" } },
    ]);
    expect(await store.getById(row.id)).toEqual({ ok: true, value: row });
    expect(await store.remove(row.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.ledger.append-only" },
    });
    expect(await store.getById(row.id)).toEqual({ ok: true, value: row });
  });
});
