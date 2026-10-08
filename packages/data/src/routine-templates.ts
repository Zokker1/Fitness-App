// T152: rutiinien opt-in-mallikirjasto. Mallit ovat puhdasta katalogidataa:
// lukeminen ei kirjoita mitään, ja sisältö syntyy vasta käyttäjän pyynnöstä.

export type RoutineTemplateKey = "morning" | "evening";

export interface RoutineTemplateStep {
  readonly title: string;
  readonly optional: boolean;
}

export interface RoutineTemplate {
  readonly key: RoutineTemplateKey;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly RoutineTemplateStep[];
}

const ROUTINE_TEMPLATES: readonly RoutineTemplate[] = [
  {
    key: "morning",
    title: "Aamun rauhallinen alku",
    description: "Kolme pientä askelta, joilla päivä saa selkeän suunnan.",
    steps: [
      { title: "Juo lasi vettä", optional: false },
      { title: "Valitse päivän tärkein tehtävä", optional: false },
      { title: "Venyttele hetki", optional: true },
    ],
  },
  {
    key: "evening",
    title: "Illan rauhoittuminen",
    description: "Kevyt päätös päivälle ilman täydellisen suorituksen painetta.",
    steps: [
      { title: "Kirjaa yksi asia, joka onnistui", optional: false },
      { title: "Valmistele huomisen ensimmäinen askel", optional: false },
      { title: "Rauhoita näyttöilta", optional: true },
    ],
  },
];

export function listRoutineTemplates(): readonly RoutineTemplate[] {
  return ROUTINE_TEMPLATES;
}

export function getRoutineTemplate(key: string): RoutineTemplate | null {
  return ROUTINE_TEMPLATES.find((template) => template.key === key) ?? null;
}
