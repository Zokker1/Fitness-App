// T205: informatiivinen BMI-laskenta ilman painoluokkia tai diagnoosipäätelmiä.
import type { WeightUnit } from "./identity.ts";

export interface BmiWeight {
  readonly value: number;
  readonly unit: WeightUnit;
}

/** Laskee BMI:n viimeisimmästä painosta ja cm-pituudesta; puuttuva tieto palauttaa nullin. */
export function calculateBmi(weight: BmiWeight | null, heightCm: number | null): number | null {
  if (
    weight === null ||
    heightCm === null ||
    !Number.isFinite(weight.value) ||
    weight.value <= 0 ||
    !Number.isFinite(heightCm) ||
    heightCm <= 0
  ) {
    return null;
  }
  const value =
    weight.unit === "kg"
      ? weight.value / (heightCm / 100) ** 2
      : (weight.value * 703) / (heightCm / 2.54) ** 2;
  return Number.isFinite(value) ? value : null;
}
