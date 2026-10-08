// T215: yhteiset liukuvat aikavälit terveysmittausten historiassa.
import { t, tOptions } from "../../language.tsx";
import { SegmentedControl } from "@lifeos/ui";
import type { Measurement } from "@lifeos/domain";

export const HEALTH_RANGE_OPTIONS = [
  { value: "7d", label: "7 pv" },
  { value: "30d", label: "30 pv" },
  { value: "90d", label: "90 pv" },
  { value: "1y", label: "1 v" },
  { value: "all", label: "Kaikki" },
] as const;

export type HealthRange = (typeof HEALTH_RANGE_OPTIONS)[number]["value"];

const RANGE_MILLISECONDS: Readonly<Record<Exclude<HealthRange, "all">, number>> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
};

export function filterMeasurementsByRange(
  measurements: readonly Measurement[],
  range: HealthRange,
  nowMilliseconds = Date.now(),
): Measurement[] {
  if (range === "all") {
    return [...measurements];
  }
  const cutoff = nowMilliseconds - RANGE_MILLISECONDS[range];
  return measurements.filter((measurement) => {
    const measuredAt = Date.parse(measurement.measuredAt);
    return Number.isFinite(measuredAt) && measuredAt >= cutoff && measuredAt <= nowMilliseconds;
  });
}

export function HealthRangeControl({
  range,
  onRangeChange,
}: {
  readonly range: HealthRange;
  readonly onRangeChange: (range: HealthRange) => void;
}): React.JSX.Element {
  return (
    <SegmentedControl
      label={t("Aikaväli")}
      options={tOptions(HEALTH_RANGE_OPTIONS)}
      value={range}
      onOptionChange={(value) => {
        if (HEALTH_RANGE_OPTIONS.some((option) => option.value === value)) {
          onRangeChange(value as HealthRange);
        }
      }}
    />
  );
}
