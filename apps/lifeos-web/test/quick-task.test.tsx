// T091: QuickTaskForm unit-testit (web-paketti, happy-dom + muististore).
// Kriteeri: 1–3 vuorovaikutusta, näkyy heti Todayssa (tässä: createTask-
// service kutsutaan oikeilla arvoilla + onCreated saa rivin).
// - Tyhjä nimi → kenttävirhe, ei service-kutsua;
// - nimi + oletus (Tänään) → createTask dueAt tänään klo 18 paikallista;
// - Huomenna-segmentti → dueAt seuraava päivä; Ei päivää → null.
// - T105: prioriteetti oletus normaali; valinta kulkee createTaskiin.
// - T106: tagit parsitaan pilkulla, dedupe case-insensitiivisesti; puuttuvat
//   tagit luodaan tagirepositorioon ja id:t linkkiyvät tehtävään.
// quickDueAt on puhdas apuri — aikavyöhykerajat suoraan (UTC+3 ja UTC−4).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InMemoryStore, type Clock } from "@lifeos/data";
import { DataProvider, useData } from "../src/dataContext.tsx";
import { QuickTaskForm, parseTagNames, quickDueAt } from "../src/quickadd/QuickTaskForm.tsx";
import type { Project, Tag, Task } from "@lifeos/domain";
import { createFixtureStores } from "./fixtures.tsx";

/** Kääre: antaa QuickTaskFormille aidot tasks-, tags- ja projects-repot. */
function QuickTaskFormWithTasks({
  store,
  tagStore,
  projectStore,
  clock,
  onCreated,
}: {
  readonly store: InMemoryStore<Task>;
  readonly tagStore: InMemoryStore<Tag>;
  readonly projectStore: InMemoryStore<Project>;
  readonly clock: Clock;
  readonly onCreated: (task: Task) => void;
}): React.JSX.Element {
  // Uniikki id per kutsu (saman millisekunnin luonnit eivät saa kolliota).
  let idCounter = 0;
  return (
    <DataProvider
      clock={clock}
      taskStore={store}
      tagStore={tagStore}
      projectStore={projectStore}
      ids={{
        next: () => `test-${String(Date.now())}-${String((idCounter += 1)).padStart(3, "0")}`,
      }}
    >
      <BoundForm clock={clock} onCreated={onCreated} />
    </DataProvider>
  );
}

function BoundForm({
  clock,
  onCreated,
}: {
  readonly clock: Clock;
  readonly onCreated: (task: Task) => void;
}): React.JSX.Element {
  const { tasks, tags, projects } = useData();
  return (
    <QuickTaskForm
      deps={{ clock, tasks }}
      localDate="2026-09-18"
      timezoneOffsetMinutes={180}
      tags={tags}
      projects={projects}
      onCreated={onCreated}
    />
  );
}

function renderForm(
  onCreated: (task: Task) => void,
  seedTags: readonly Tag[] = [],
  seedProjects: readonly Project[] = [],
): {
  store: InMemoryStore<Task>;
  tagStore: InMemoryStore<Tag>;
  projectStore: InMemoryStore<Project>;
  unmount: () => void;
} {
  const { taskStore, clock } = createFixtureStores();
  const tagStore = new InMemoryStore<Tag>("tag", seedTags);
  const projectStore = new InMemoryStore<Project>("project", seedProjects);
  const { unmount } = render(
    <QuickTaskFormWithTasks
      store={taskStore}
      tagStore={tagStore}
      projectStore={projectStore}
      clock={clock}
      onCreated={onCreated}
    />,
  );
  return { store: taskStore, tagStore, projectStore, unmount };
}

describe("quickDueAt", () => {
  it("tänään → sama paikallispäivä klo 18 UTC-hetkenä", () => {
    // 2026-09-18T09:00:00Z = 12:00 Helsingissä → due 18:00 paikallista = 15:00Z.
    expect(quickDueAt("today", "2026-09-18T09:00:00.000Z", 180)).toBe("2026-09-18T15:00:00.000Z");
  });

  it("huomenna → seuraava paikallispäivä; none → null", () => {
    expect(quickDueAt("tomorrow", "2026-09-18T09:00:00.000Z", 180)).toBe(
      "2026-09-19T15:00:00.000Z",
    );
    expect(quickDueAt("none", "2026-09-18T09:00:00.000Z", 180)).toBeNull();
  });

  it("länsivyöhyke: 01:00Z on edellinen paikallispäivä (UTC−4)", () => {
    expect(quickDueAt("today", "2026-09-18T01:00:00.000Z", -240)).toBe("2026-09-17T22:00:00.000Z");
  });
});

describe("parseTagNames (T106)", () => {
  it("trimmaa, pudottaa tyhjät ja dedupeaa case-insensitiivisesti", () => {
    expect(parseTagNames("  työ , Työ,  ASIA,asia , ")).toEqual(["työ", "ASIA"]);
    expect(parseTagNames("")).toEqual([]);
    expect(parseTagNames(",,,")).toEqual([]);
  });

  it("enintään 8 tagia ja 40 merkkiä per tagi", () => {
    const long = "x".repeat(41);
    expect(parseTagNames(`${long}, ok`)).toEqual(["ok"]);
    const many = Array.from({ length: 12 }, (_, index) => `t${String(index)}`).join(",");
    expect(parseTagNames(many)).toHaveLength(8);
  });
});

describe("QuickTaskForm T106 tagit", () => {
  it("uudet tagit luodaan ja linkkiyvät tehtävään; duplikaatti yhdistetään", async () => {
    const onCreated = vi.fn();
    const { tagStore, unmount } = renderForm(onCreated);
    try {
      fireEvent.change(screen.getByPlaceholderText("Esim. Osta maitoa"), {
        target: { value: "Tagitehtävä" },
      });
      fireEvent.change(screen.getByLabelText("Tagit (valinnainen)"), {
        target: { value: "työ, asia, TYÖ" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna tehtävä" }));
      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledTimes(1);
      });
      const created = onCreated.mock.calls[0]?.[0] as Task;
      // "työ" ja "TYÖ" yhdistyvät → 2 unikkia tagia.
      expect(created.tagIds).toHaveLength(2);
      const listed = await tagStore.list();
      expect(listed.ok && listed.value.map((tag) => tag.name).sort()).toEqual(["asia", "työ"]);
    } finally {
      unmount();
    }
  });

  it("olemassa oleva tagi (case-insensitive) uudelleenkäytetään, ei luoda uutta", async () => {
    const onCreated = vi.fn();
    const seedTag: Tag = {
      id: "tag-existing",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
      version: 1,
      name: "Työ",
      colorKey: null,
      deletedAt: null,
    };
    const { tagStore, unmount } = renderForm(onCreated, [seedTag]);
    try {
      fireEvent.change(screen.getByPlaceholderText("Esim. Osta maitoa"), {
        target: { value: "Tagiton työtehtävä" },
      });
      fireEvent.change(screen.getByLabelText("Tagit (valinnainen)"), {
        target: { value: "työ" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna tehtävä" }));
      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledTimes(1);
      });
      const created = onCreated.mock.calls[0]?.[0] as Task;
      expect(created.tagIds).toEqual(["tag-existing"]);
      const listed = await tagStore.list();
      expect(listed.ok && listed.value).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it("T110: toistovalinta muodostaa säännön eräpäivästä (daily)", async () => {
    const onCreated = vi.fn();
    const { unmount } = renderForm(onCreated);
    try {
      fireEvent.change(screen.getByPlaceholderText("Esim. Osta maitoa"), {
        target: { value: "Toistuva tehtävä" },
      });
      fireEvent.change(screen.getByLabelText("Toisto"), {
        target: { value: "daily" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna tehtävä" }));
      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledTimes(1);
      });
      const created = onCreated.mock.calls[0]?.[0] as Task;
      expect(created.recurrence).toEqual({ kind: "daily", everyDays: 1 });
      // Reset: toisto palaa oletukseen.
      expect(screen.getByLabelText("Toisto")).toHaveValue("none");
    } finally {
      unmount();
    }
  });

  it("T111: arvio kulkeutuu createTaskiin (estimateMinutes)", async () => {
    const onCreated = vi.fn();
    const { unmount } = renderForm(onCreated);
    try {
      fireEvent.change(screen.getByPlaceholderText("Esim. Osta maitoa"), {
        target: { value: "Arvioitu tehtävä" },
      });
      fireEvent.change(screen.getByLabelText("Arvio (valinnainen)"), {
        target: { value: "45" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna tehtävä" }));
      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledTimes(1);
      });
      const created = onCreated.mock.calls[0]?.[0] as Task;
      expect(created.estimateMinutes).toBe(45);
    } finally {
      unmount();
    }
  });

  it("T107: projektivalinta kulkee createTaskiin (projectId)", async () => {
    const onCreated = vi.fn();
    const seedProject: Project = {
      id: "project-1",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
      version: 1,
      name: "Remontti",
      colorKey: null,
      archivedAt: null,
      deletedAt: null,
    };
    const { unmount } = renderForm(onCreated, [], [seedProject]);
    try {
      fireEvent.change(screen.getByPlaceholderText("Esim. Osta maitoa"), {
        target: { value: "Projektitehtävä" },
      });
      // Projektivalitsin renderöityy kun listaus on latautunut (async).
      fireEvent.change(await screen.findByLabelText("Projekti (valinnainen)"), {
        target: { value: "project-1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna tehtävä" }));
      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledTimes(1);
      });
      const created = onCreated.mock.calls[0]?.[0] as Task;
      expect(created.projectId).toBe("project-1");
    } finally {
      unmount();
    }
  });
});

describe("QuickTaskForm", () => {
  it("tyhjä nimi → kenttävirhe, ei service-kutsua", async () => {
    const onCreated = vi.fn();
    const { unmount } = renderForm(onCreated);
    try {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      fireEvent.submit(screen.getByTestId("quick-task-form"));
      await waitFor(() => {
        // FieldShell renderöi virheen role=alert-elementtiin (ikoni + span
        // erillään — tekstihakuun sopimaton, siksi roolihaku).
        expect(screen.getByRole("alert")).toHaveTextContent("Anna tehtävälle nimi.");
      });
      expect(onCreated).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("nimi + Tallenna → createTask + onCreated (oletus Tänään)", async () => {
    const onCreated = vi.fn();
    const { store, unmount } = renderForm(onCreated);
    try {
      fireEvent.change(screen.getByPlaceholderText("Esim. Osta maitoa"), {
        target: { value: "Osta maitoa" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna tehtävä" }));
      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledTimes(1);
      });
      const created = onCreated.mock.calls[0]?.[0] as Task;
      expect(created.title).toBe("Osta maitoa");
      expect(created.status).toBe("open");
      expect(created.dueAt).not.toBeNull();
      const listed = await store.list();
      expect(listed.ok && listed.value.length).toBe(1);
    } finally {
      unmount();
    }
  });

  it("T105: prioriteetti oletus normaali; valittu prioriteetti kulkee createTaskiin", async () => {
    const onCreated = vi.fn();
    const { unmount } = renderForm(onCreated);
    try {
      // Oletus: Normaali valmiiksi valittuna (Keep it Simple, ei pakota
      // prioriteettivalintaa).
      expect(screen.getByRole("radio", { name: "Normaali" })).toBeChecked();
      fireEvent.change(screen.getByPlaceholderText("Esim. Osta maitoa"), {
        target: { value: "Korkea kiire" },
      });
      fireEvent.click(screen.getByRole("radio", { name: "Korkea" }));
      fireEvent.click(screen.getByRole("button", { name: "Tallenna tehtävä" }));
      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledTimes(1);
      });
      const created = onCreated.mock.calls[0]?.[0] as Task;
      expect(created.priority).toBe("high");
      // Tallennuksen jälkeen lomake palaa oletuksiin (prioriteetti normaali).
      expect(screen.getByRole("radio", { name: "Normaali" })).toBeChecked();
    } finally {
      unmount();
    }
  });
});
