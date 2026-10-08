// T108: TaskChecklist unit-testit (web-paketti, happy-dom + muististore).
// Kriteeri: alitehtävät järjestettävissä + completion-logiikka toimii
// komponentissa (checkbox → done, ylös-siirto → sortOrder-vaihto, lisäys →
// uusi rivi seuraavalla sortOrderilla).
import { useCallback, useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InMemoryStore } from "@lifeos/data";
import type { TaskChecklistItem } from "@lifeos/domain";
import { DataProvider, useData } from "../src/dataContext.tsx";
import { TaskChecklist } from "../src/views/today/TaskChecklist.tsx";

const TASK_ID = "t1";

/** Lataa alitehtävät storesta ja välittää TaskChecklille (onChanged → reload). */
function Harness(): React.JSX.Element {
  const { taskChecklistItems } = useData();
  const [items, setItems] = useState<readonly TaskChecklistItem[]>([]);
  const reload = useCallback(async () => {
    const listed = await taskChecklistItems.list();
    if (listed.ok) {
      setItems(listed.value.filter((row) => row.deletedAt === null));
    }
  }, [taskChecklistItems]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <TaskChecklist taskId={TASK_ID} items={items} onChanged={() => void reload()} />;
}

function HarnessWithStore({ seed }: { seed: readonly TaskChecklistItem[] }): React.JSX.Element {
  const store = new InMemoryStore<TaskChecklistItem>("task-checklist-item", seed);
  return (
    <DataProvider taskChecklistStore={store}>
      <Harness />
    </DataProvider>
  );
}

function renderChecklist(seed: readonly TaskChecklistItem[]): { unmount: () => void } {
  const { unmount } = render(<HarnessWithStore seed={seed} />);
  return { unmount };
}

function checklistItem(
  id: string,
  sortOrder: number,
  overrides: Partial<TaskChecklistItem> = {},
): TaskChecklistItem {
  return {
    id,
    createdAt: `2026-09-10T08:00:0${String(sortOrder).padStart(2, "0")}.000Z`,
    updatedAt: "2026-09-10T08:00:00.000Z",
    version: 1,
    taskId: TASK_ID,
    title: id,
    done: false,
    sortOrder,
    deletedAt: null,
    ...overrides,
  };
}

describe("TaskChecklist (T108)", () => {
  it("lisäys: uusi alitehtävä renderöityy listaan", async () => {
    const { unmount } = renderChecklist([checklistItem("a", 0)]);
    try {
      await waitFor(() => {
        expect(screen.getByTestId(`checklist-toggle-${TASK_ID}`)).toHaveTextContent("0/1");
      });
      fireEvent.click(screen.getByTestId(`checklist-toggle-${TASK_ID}`));
      fireEvent.change(screen.getByLabelText("Uusi alitehtävä"), {
        target: { value: "Imuroi" },
      });
      fireEvent.click(screen.getByTestId(`checklist-add-${TASK_ID}`));
      await waitFor(
        () => {
          expect(screen.getByText("Imuroi")).toBeInTheDocument();
        },
        { timeout: 3_000 },
      );
      expect(screen.getByTestId(`checklist-toggle-${TASK_ID}`)).toHaveTextContent("0/2");
    } finally {
      unmount();
    }
  });

  it("completion: checkbox kääntää done-arvon (progress päivittyy)", async () => {
    const { unmount } = renderChecklist([checklistItem("a", 0)]);
    try {
      await waitFor(() => {
        expect(screen.getByTestId(`checklist-toggle-${TASK_ID}`)).toHaveTextContent("0/1");
      });
      fireEvent.click(screen.getByTestId(`checklist-toggle-${TASK_ID}`));
      fireEvent.click(await screen.findByTestId("checklist-check-a"));
      await waitFor(() => {
        expect(screen.getByTestId(`checklist-toggle-${TASK_ID}`)).toHaveTextContent("1/1");
      });
    } finally {
      unmount();
    }
  });

  it("järjestys: ylössiirto vaihtaa naapurien paikat listassa", async () => {
    const { unmount } = renderChecklist([checklistItem("a", 0), checklistItem("b", 1)]);
    try {
      await waitFor(() => {
        expect(screen.getByTestId(`checklist-toggle-${TASK_ID}`)).toHaveTextContent("0/2");
      });
      fireEvent.click(screen.getByTestId(`checklist-toggle-${TASK_ID}`));
      const list = screen.getByTestId(`checklist-${TASK_ID}`);
      // Alkujärjestys: a, b (sortOrder).
      const rows = list.querySelectorAll("li");
      expect(rows[0]?.textContent).toContain("a");
      expect(rows[1]?.textContent).toContain("b");
      fireEvent.click(await screen.findByTestId("checklist-up-b"));
      await waitFor(() => {
        expect(screen.getByTestId("checklist-up-b")).toBeDisabled();
      });
      const rowsAfter = screen.getByTestId(`checklist-${TASK_ID}`).querySelectorAll("li");
      expect(rowsAfter[0]?.textContent).toContain("b");
      expect(rowsAfter[1]?.textContent).toContain("a");
    } finally {
      unmount();
    }
  });

  it("T113: raahaus pointer-eventein + näppäimistön alas-painike sen jälkeen", async () => {
    const { unmount } = renderChecklist([checklistItem("a", 0), checklistItem("b", 1)]);
    try {
      await waitFor(() => {
        expect(screen.getByTestId(`checklist-toggle-${TASK_ID}`)).toHaveTextContent("0/2");
      });
      fireEvent.click(screen.getByTestId(`checklist-toggle-${TASK_ID}`));
      const handle = await screen.findByTestId("checklist-drag-a");
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 10 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 90 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 90 });
      // Raahauksen jälkeen: b ensin (sortOrder 0), a toiseksi (1).
      await waitFor(() => {
        expect(screen.getByTestId("checklist-up-b")).toBeDisabled();
      });
      // Näppäimistöreitti: b alas → a palaa kärkeen.
      fireEvent.click(screen.getByTestId("checklist-down-b"));
      await waitFor(() => {
        expect(screen.getByTestId("checklist-down-b")).not.toBeDisabled();
      });
    } finally {
      unmount();
    }
  });
});
