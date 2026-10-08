// T245: askelmäärä on tavallinen manuaalinen Measurement; laiteintegraatiota ei tarvita.

import { normalizeMeasurementMetricName } from "@lifeos/domain";
import type { Measurement, UtcTimestamp } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";
import { createMeasurementService } from "./measurement-service.ts";

export const MANUAL_STEP_COUNT_METRIC_NAME = "Askelmäärä";
export const MANUAL_STEP_COUNT_UNIT = "askelta";

export interface ManualStepCountServiceDeps {
  readonly clock: Clock;
  readonly measurements: EntityRepository<Measurement>;
}

export interface CreateManualStepCountInput {
  readonly steps: number;
  readonly measuredAt?: UtcTimestamp | undefined;
  readonly note?: string | null | undefined;
}

export function isManualStepCountMetric(metricName: string, unit: string): boolean {
  return (
    normalizeMeasurementMetricName(metricName).toLocaleLowerCase("fi-FI") ===
      MANUAL_STEP_COUNT_METRIC_NAME.toLocaleLowerCase("fi-FI") &&
    unit.normalize("NFKC").trim().toLocaleLowerCase("fi-FI") === MANUAL_STEP_COUNT_UNIT
  );
}

export function isManualStepCountMeasurement(
  measurement: Pick<Measurement, "type" | "metricName" | "unit">,
): boolean {
  return (
    measurement.type === "custom" &&
    typeof measurement.metricName === "string" &&
    isManualStepCountMetric(measurement.metricName, measurement.unit)
  );
}

/** Tallentaa manuaalisen päiväarvon olemassa olevaan append-only-mittaustietoon. */
export async function createManualStepCountService(
  deps: ManualStepCountServiceDeps,
  input: CreateManualStepCountInput,
): Promise<DataResult<Measurement>> {
  if (!Number.isSafeInteger(input.steps) || input.steps < 0) {
    return {
      ok: false,
      error: invalidInput(
        "data.step-count.validation.steps",
        "Askelmäärän on oltava nolla tai sitä suurempi kokonaisluku.",
      ),
    };
  }
  return createMeasurementService(deps, {
    type: "custom",
    value: input.steps,
    secondaryValue: null,
    unit: MANUAL_STEP_COUNT_UNIT,
    metricName: MANUAL_STEP_COUNT_METRIC_NAME,
    note: input.note ?? null,
    ...(input.measuredAt === undefined ? {} : { measuredAt: input.measuredAt }),
  });
}
