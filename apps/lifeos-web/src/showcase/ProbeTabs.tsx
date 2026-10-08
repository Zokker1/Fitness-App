// T056-tukimuutos: E2E-näyteikkunan osiovalinta (vain ?e2e=1). Katselu
// pyörii aiemmin yhtenä loputtomana syötteenä — nyt osiot ovat välilehdillä
// URL-parametrin (probe=<avain>) kautta: syvälinkitettävä, E2E:n avattava
// suoraan oikeaan osioon, näppäimistöllä tavalliset linkit (aria-current).
// Oletus on "näkymä" = varsinainen sovellusnäkymä ilman probepinoa.
import { Link } from "react-router";

export const PROBE_SECTIONS = [
  { key: "nakyma", label: "Näkymä" },
  { key: "tavoite", label: "Tavoite" },
  { key: "rutiini", label: "Rutiini" },
  { key: "tanaan", label: "Tänään" },
  { key: "saavutukset", label: "Saavutukset" },
  { key: "haku", label: "Haku" },
  { key: "typografia", label: "Typografia" },
  { key: "napit", label: "Napit" },
  { key: "lomakkeet", label: "Lomakkeet" },
  { key: "kortit", label: "Kortit" },
  { key: "overlayt", label: "Overlayt" },
  { key: "tilat", label: "Tilat" },
  { key: "edistyminen", label: "Edistyminen" },
  { key: "graafit", label: "Graafit" },
  { key: "liike", label: "Liike" },
  { key: "persistenssi", label: "Persistenssi" },
] as const;

const PROBE_GROUPS = [
  {
    key: "views",
    label: "Näkymät",
    sections: ["nakyma", "tavoite", "rutiini", "tanaan", "saavutukset", "haku"],
  },
  {
    key: "ui",
    label: "Käyttöliittymä",
    sections: ["typografia", "napit", "lomakkeet", "kortit", "overlayt", "tilat"],
  },
  {
    key: "system",
    label: "Järjestelmä",
    sections: ["edistyminen", "graafit", "liike", "persistenssi"],
  },
] as const;

export type ProbeSection = (typeof PROBE_SECTIONS)[number]["key"];

export function probeSectionFromParam(value: string | null): ProbeSection {
  const found = PROBE_SECTIONS.find((section) => section.key === value);
  return found === undefined ? "nakyma" : found.key;
}

function probeSearch(section: ProbeSection): string {
  return section === "nakyma" ? "?e2e=1" : `?e2e=1&probe=${encodeURIComponent(section)}`;
}

function ProbeTabArrow({
  direction,
  target,
}: {
  readonly direction: "previous" | "next";
  readonly target: ProbeSection | undefined;
}): React.JSX.Element {
  const isPrevious = direction === "previous";
  const directionLabel = isPrevious ? "Edellinen" : "Seuraava";
  const targetLabel =
    target === undefined
      ? `${directionLabel} osio ei ole käytettävissä`
      : `${directionLabel} osio: ${PROBE_SECTIONS.find((section) => section.key === target)?.label ?? ""}`;

  if (target === undefined) {
    return (
      <button
        type="button"
        data-ui="probe-tab-arrow"
        data-testid={`probe-tab-arrow-${direction}`}
        aria-label={targetLabel}
        disabled
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={isPrevious ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
        </svg>
      </button>
    );
  }

  return (
    <Link
      to={{ pathname: "/", search: probeSearch(target) }}
      data-ui="probe-tab-arrow"
      data-testid={`probe-tab-arrow-${direction}`}
      aria-label={targetLabel}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={isPrevious ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
      </svg>
    </Link>
  );
}

export function ProbeTabs({ active }: { readonly active: ProbeSection }): React.JSX.Element {
  const activeIndex = PROBE_SECTIONS.findIndex((section) => section.key === active);
  const previous = activeIndex > 0 ? PROBE_SECTIONS[activeIndex - 1]?.key : undefined;
  const next =
    activeIndex >= 0 && activeIndex < PROBE_SECTIONS.length - 1
      ? PROBE_SECTIONS[activeIndex + 1]?.key
      : undefined;

  return (
    <nav data-ui="probe-tabs" data-testid="probe-tabs" aria-label="Näyteosiot (E2E)">
      <div data-ui="probe-tabs-header">
        <div>
          <span data-ui="probe-tabs-eyebrow">Kehitysnäkymä</span>
          <strong data-ui="probe-tabs-title">Näyteikkuna</strong>
        </div>
        <span data-ui="probe-tabs-count">{PROBE_SECTIONS.length} osiota</span>
      </div>
      <div data-ui="probe-tabs-controls">
        <ProbeTabArrow direction="previous" target={previous} />
        <div data-ui="probe-tab-groups">
          {PROBE_GROUPS.map((group) => (
            <div key={group.key} data-ui="probe-tab-group" aria-label={group.label}>
              <span data-ui="probe-tab-group-label">{group.label}</span>
              <div data-ui="probe-tab-list">
                {group.sections.map((sectionKey) => {
                  const section = PROBE_SECTIONS.find((candidate) => candidate.key === sectionKey);
                  if (section === undefined) return null;
                  return (
                    <Link
                      key={section.key}
                      to={{ pathname: "/", search: probeSearch(section.key) }}
                      data-ui="probe-tab"
                      aria-current={active === section.key ? "true" : undefined}
                    >
                      {section.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <ProbeTabArrow direction="next" target={next} />
      </div>
    </nav>
  );
}
