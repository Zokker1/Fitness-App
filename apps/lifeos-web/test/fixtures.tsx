// T033: UI-testifixture. DataProvider deterministisillä storeilla +
// apukomponentti joka todistaa service-rajan toimivan renderöidyssä
// komponentissa ilman domain-logiikkaa komponentissa.
import { useEffect, useState } from "react";
import type { HydrationEntry, Task } from "@lifeos/domain";
import {
  InMemoryStore,
  completeTaskService,
  createTask,
  fixedClock,
  sequentialIdGenerator,
} from "@lifeos/data";
import { DataProvider, useData } from "../src/dataContext.tsx";

export const FIXTURE_AT = "2026-09-15T12:00:00.000Z";

export function createFixtureStores(): {
  readonly taskStore: InMemoryStore<Task>;
  readonly hydrationStore: InMemoryStore<HydrationEntry>;
  readonly clock: ReturnType<typeof fixedClock>;
  readonly ids: ReturnType<typeof sequentialIdGenerator>;
} {
  return {
    taskStore: new InMemoryStore<Task>("task"),
    hydrationStore: new InMemoryStore<HydrationEntry>("hydration"),
    clock: fixedClock(FIXTURE_AT),
    ids: sequentialIdGenerator("fx"),
  };
}

/** Pieni todistuskomponentti: luo tehtävän mountissa, näyttää tilan. */
export function FixtureTaskProbe({ title }: { readonly title: string }): React.JSX.Element {
  const { tasks } = useData();
  const [label, setLabel] = useState("ladataan…");
  useEffect(() => {
    // Unmount peruuttaa vain odottavan setLabelin (ref: boolean, ei tila).
    // Lintin no-unnecessary-condition ei seuraa ref-mutaatiota — puretaan
    // ehto apufunktioon jotta virhepolku pysyy mutta vertailu ei ole
    // staattisesti pääteltävissä.
    const guard = { cancelled: false };
    const shouldStop = (): boolean => guard.cancelled;
    const run = async (): Promise<void> => {
      const created = await createTask({ clock: fixedClock(FIXTURE_AT), tasks }, { title });
      if (shouldStop()) {
        return;
      }
      if (!created.ok) {
        setLabel("virhe:luonti");
        return;
      }
      const done = await completeTaskService(
        { clock: fixedClock(FIXTURE_AT), tasks },
        created.value.id,
      );
      if (shouldStop()) {
        return;
      }
      if (!done.ok) {
        setLabel("virhe:valmistus");
        return;
      }
      setLabel(`valmis:${done.value.title}:${done.value.status}:v${String(done.value.version)}`);
    };
    void run().catch(() => {
      if (!shouldStop()) {
        setLabel("virhe:odottamaton");
      }
    });
    return () => {
      guard.cancelled = true;
    };
  }, [tasks, title]);
  return <p data-testid="fixture-task">{label}</p>;
}

export function FixtureProvider({
  children,
}: {
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const { taskStore, clock, ids } = createFixtureStores();
  return (
    <DataProvider clock={clock} ids={ids} taskStore={taskStore}>
      {children}
    </DataProvider>
  );
}
