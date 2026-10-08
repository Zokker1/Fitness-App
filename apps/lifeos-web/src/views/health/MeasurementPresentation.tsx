import type { Measurement } from "@lifeos/domain";
import { getIntlLocale } from "../../language.tsx";
import type { ReactNode } from "react";
import { Icon } from "@lifeos/ui";
import { t } from "../../language.tsx";

export function MeasurementHeading({
  title,
  icon,
}: {
  readonly title: string;
  readonly icon: "body" | "thermometer" | "droplet" | "grid";
}): React.JSX.Element {
  return (
    <span data-ui="measurement-card-heading">
      <Icon name={icon} />
      <span>{t(title)}</span>
    </span>
  );
}

export function MeasurementEmptyPreview({
  hint,
  unit,
}: {
  readonly title?: ReactNode;
  readonly hint?: ReactNode;
  readonly unit: string;
}): React.JSX.Element {
  return (
    <div data-ui="measurement-empty-preview">
      <p data-ui="measurement-description">{hint}</p>
      <div data-ui="measurement-preview-row">
        <div data-ui="measurement-preview-chart">
          <svg viewBox="0 0 320 60" aria-hidden="true">
            <line x1="16" y1="30" x2="304" y2="30" />
          </svg>
        </div>
        <div data-ui="measurement-preview-value">
          <strong>-- {unit}</strong>
          <span>{t("Ei mittauksia vielä")}</span>
        </div>
      </div>
    </div>
  );
}

export function MeasurementDataPreview({
  measurements,
}: {
  readonly measurements: readonly Measurement[];
}): React.JSX.Element {
  const ordered = [...measurements].sort(
    (a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt),
  );
  const latest = ordered[ordered.length - 1];
  if (latest === undefined) return <></>;
  const values = ordered
    .filter((entry) => entry.unit === latest.unit)
    .slice(-30)
    .map((entry) => entry.value);
  const minimum = Math.min(...values);
  const span = Math.max(1, Math.max(...values) - minimum);
  const points = values
    .map(
      (value, index) =>
        `${String(values.length === 1 ? 160 : 16 + (index / (values.length - 1)) * 288)},${String(44 - ((value - minimum) / span) * 28)}`,
    )
    .join(" ");
  return (
    <div data-ui="measurement-preview-row">
      <div data-ui="measurement-preview-chart">
        <svg viewBox="0 0 320 60" role="img" aria-label={t("Mittauskehitys")}>
          {values.length > 1 ? <polyline points={points} /> : <circle cx="160" cy="44" r="3" />}
        </svg>
      </div>
      <div data-ui="measurement-preview-value">
        <strong>
          {new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 1 }).format(
            latest.value,
          )}{" "}
          {latest.unit}
        </strong>
        <span>{t("Viimeisin kirjaus")}</span>
      </div>
    </div>
  );
}
