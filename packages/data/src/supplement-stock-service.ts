// T235: saldo on käyttäjän viimeksi laskema määrä; arvio vähentää sen jälkeen otetut annokset.

import type { Supplement, SupplementLog } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { DataResult } from "./errors.ts";
import { invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";
import { getSupplementLogStatus } from "./supplement-log-service.ts";

export const SUPPLEMENT_STOCK_AMOUNT_MAXIMUM = 1_000_000;

export interface SupplementStockServiceDeps {
  readonly clock: Clock;
  readonly supplements: EntityRepository<Supplement>;
}

export interface SupplementStockEstimate {
  readonly status: "not-set" | "available" | "unavailable";
  readonly startingAmount: number | null;
  readonly consumedAmount: number | null;
  readonly remainingAmount: number | null;
  readonly unit: string | null;
  readonly takenLogCount: number;
  readonly reason: "missing-baseline" | "missing-dose" | "unit-mismatch" | null;
}

function invalidStock<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.supplement-stock.validation.${field}`, message),
  };
}

/** Asettaa käyttäjän juuri tarkistaman saldon. Saldo käyttää lisäravinteen annosyksikköä. */
export async function setSupplementStockService(
  deps: SupplementStockServiceDeps,
  supplementId: string,
  amount: number,
): Promise<DataResult<Supplement>> {
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > SUPPLEMENT_STOCK_AMOUNT_MAXIMUM
  ) {
    return invalidStock(
      "amount",
      `Saldon tulee olla välillä 0–${String(SUPPLEMENT_STOCK_AMOUNT_MAXIMUM)}.`,
    );
  }
  const supplement = await deps.supplements.getById(supplementId);
  if (!supplement.ok) return supplement;
  if (supplement.value.deletedAt !== null) {
    return invalidStock("supplement-deleted", "Poistetun lisäravinteen saldoa ei voi muuttaa.");
  }
  if (
    typeof supplement.value.amount !== "number" ||
    !Number.isFinite(supplement.value.amount) ||
    supplement.value.amount <= 0 ||
    typeof supplement.value.unit !== "string" ||
    supplement.value.unit.trim().length === 0
  ) {
    return invalidStock(
      "dose-required",
      "Lisää ensin lisäravinteen annos ja yksikkö, jotta saldon kulutusta voi arvioida.",
    );
  }
  return deps.supplements.update(supplementId, {
    stockAmount: amount,
    stockUnit: supplement.value.unit,
    stockCountedAt: deps.clock.nowIso(),
  });
}

/** Poistaa saldoarvion käytöstä ilman että lokihistoria muuttuu. */
export async function clearSupplementStockService(
  deps: SupplementStockServiceDeps,
  supplementId: string,
): Promise<DataResult<Supplement>> {
  const supplement = await deps.supplements.getById(supplementId);
  if (!supplement.ok) return supplement;
  return deps.supplements.update(supplementId, {
    stockAmount: null,
    stockUnit: null,
    stockCountedAt: null,
  });
}

/** Laskee jäljellä olevan määrän vain saldohetken jälkeen otetuista saman yksikön annoksista. */
export function estimateSupplementStock(
  supplement: Supplement,
  logs: readonly SupplementLog[],
  now: string,
): SupplementStockEstimate {
  const stockAmount = supplement.stockAmount;
  const stockUnit = supplement.stockUnit;
  const stockCountedAt = supplement.stockCountedAt;
  if (
    (stockAmount === undefined || stockAmount === null) &&
    (stockUnit === undefined || stockUnit === null) &&
    (stockCountedAt === undefined || stockCountedAt === null)
  ) {
    return {
      status: "not-set",
      startingAmount: null,
      consumedAmount: null,
      remainingAmount: null,
      unit: supplement.unit ?? null,
      takenLogCount: 0,
      reason: null,
    };
  }
  if (
    typeof stockAmount !== "number" ||
    !Number.isFinite(stockAmount) ||
    stockAmount < 0 ||
    typeof stockUnit !== "string" ||
    stockUnit.trim().length === 0 ||
    typeof stockCountedAt !== "string" ||
    !Number.isFinite(Date.parse(stockCountedAt))
  ) {
    return {
      status: "unavailable",
      startingAmount: null,
      consumedAmount: null,
      remainingAmount: null,
      unit: typeof stockUnit === "string" ? stockUnit : null,
      takenLogCount: 0,
      reason: "missing-baseline",
    };
  }

  const takenSinceCount = logs.filter(
    (log) =>
      log.supplementId === supplement.id &&
      getSupplementLogStatus(log) === "taken" &&
      log.takenAt !== null &&
      Date.parse(log.takenAt) >= Date.parse(stockCountedAt) &&
      Date.parse(log.takenAt) <= Date.parse(now),
  );
  let consumedAmount = 0;
  for (const log of takenSinceCount) {
    if (
      typeof log.doseAmount !== "number" ||
      !Number.isFinite(log.doseAmount) ||
      log.doseAmount <= 0
    ) {
      return {
        status: "unavailable",
        startingAmount: stockAmount,
        consumedAmount: null,
        remainingAmount: null,
        unit: stockUnit,
        takenLogCount: takenSinceCount.length,
        reason: "missing-dose",
      };
    }
    if (log.doseUnit !== stockUnit) {
      return {
        status: "unavailable",
        startingAmount: stockAmount,
        consumedAmount: null,
        remainingAmount: null,
        unit: stockUnit,
        takenLogCount: takenSinceCount.length,
        reason: "unit-mismatch",
      };
    }
    consumedAmount += log.doseAmount;
  }
  return {
    status: "available",
    startingAmount: stockAmount,
    consumedAmount,
    remainingAmount: stockAmount - consumedAmount,
    unit: stockUnit,
    takenLogCount: takenSinceCount.length,
    reason: null,
  };
}
