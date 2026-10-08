// T248: käyttäjän oirearviot käyttävät append-only Measurement-tallennusta.
// Erillistä oiretaulua ei tarvita; vakioyksikkö erottaa asteikon muista mittareista.
import type { Measurement, UtcTimestamp } from "@lifeos/domain";
import { invalidInput, type DataResult } from "./errors.ts";
import { createMeasurementService } from "./measurement-service.ts";
import type { EntityRepository } from "./repositories.ts";
import type { Clock } from "./clock.ts";

export const CUSTOM_SYMPTOM_SCALE_MINIMUM = 1;
export const CUSTOM_SYMPTOM_SCALE_MAXIMUM = 5;
export const CUSTOM_SYMPTOM_SCALE_UNIT = "oireasteikko 1–5";

export interface CustomSymptomMetricServiceDeps {
  readonly clock: Clock;
  readonly measurements: EntityRepository<Measurement>;
}

export interface CreateCustomSymptomMetricInput {
  readonly metricName: string;
  readonly value: number;
  readonly measuredAt?: UtcTimestamp | undefined;
}

/** Kirjaa oman oireasteikon arvon turvallisesti, ilman tulkintaa tai diagnoosia. */
export function createCustomSymptomMetricService(
  deps: CustomSymptomMetricServiceDeps,
  input: CreateCustomSymptomMetricInput,
): Promise<DataResult<Measurement>> {
  if (
    !Number.isSafeInteger(input.value) ||
    input.value < CUSTOM_SYMPTOM_SCALE_MINIMUM ||
    input.value > CUSTOM_SYMPTOM_SCALE_MAXIMUM
  ) {
    return Promise.resolve({
      ok: false,
      error: invalidInput(
        "data.symptom-metric.scale",
        `Oirearvon tulee olla kokonaisluku väliltä ${String(CUSTOM_SYMPTOM_SCALE_MINIMUM)}–${String(CUSTOM_SYMPTOM_SCALE_MAXIMUM)}.`,
      ),
    });
  }
  return createMeasurementService(deps, {
    type: "custom",
    metricName: input.metricName,
    value: input.value,
    secondaryValue: null,
    unit: CUSTOM_SYMPTOM_SCALE_UNIT,
    ...(input.measuredAt === undefined ? {} : { measuredAt: input.measuredAt }),
    note: null,
  });
}
