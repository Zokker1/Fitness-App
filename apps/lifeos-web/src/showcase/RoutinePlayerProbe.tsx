// T150: rutiinipelaajan visuaalinen E2E-näyteikkuna. Fixtures elävät vain
// sisäisessä muistirepossa, jotta tuotannon pysyvä tietokanta ei muutu.
import { useMemo } from "react";
import type { Routine, RoutineStep } from "@lifeos/domain";
import { InMemoryStore, sequentialIdGenerator } from "@lifeos/data";
import { DataProvider } from "../dataContext.tsx";
import { RoutinePlayer } from "../views/goals/RoutinePlayer.tsx";

const AT = "2026-09-21T07:00:00.000Z";
const ROUTINE_ID = "routine-player-probe";

const PREVIEW_ROUTINE: Routine = {
  id: ROUTINE_ID,
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  title: "Kevyt aamun aloitus",
  archivedAt: null,
  deletedAt: null,
};

const PREVIEW_STEPS: readonly RoutineStep[] = [
  {
    id: "routine-player-probe-step-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId: ROUTINE_ID,
    title: "Juo lasi vettä",
    sortOrder: 0,
    deletedAt: null,
  },
  {
    id: "routine-player-probe-step-2",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId: ROUTINE_ID,
    title: "Avaa päivän tärkein tehtävä",
    sortOrder: 1,
    optional: true,
    deletedAt: null,
  },
  {
    id: "routine-player-probe-step-3",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId: ROUTINE_ID,
    title: "Hengitä rauhassa kolme kertaa",
    sortOrder: 2,
    deletedAt: null,
  },
];

export function RoutinePlayerProbe(): React.JSX.Element {
  const routineStore = useMemo(
    () => new InMemoryStore<Routine>("routine-player-probe", [PREVIEW_ROUTINE]),
    [],
  );
  const routineStepStore = useMemo(
    () => new InMemoryStore<RoutineStep>("routine-player-probe-step", PREVIEW_STEPS),
    [],
  );
  const ids = useMemo(() => sequentialIdGenerator("routine-player-probe"), []);

  return (
    <DataProvider ids={ids} routineStore={routineStore} routineStepStore={routineStepStore}>
      <RoutinePlayer routineId={ROUTINE_ID} onBack={() => undefined} />
    </DataProvider>
  );
}
