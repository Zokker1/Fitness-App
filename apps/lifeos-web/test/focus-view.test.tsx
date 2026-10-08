import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "./renderWithLanguage.tsx";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { FocusSession, Task } from "@lifeos/domain";
import { InMemoryStore } from "@lifeos/data";
import { DataProvider } from "../src/dataContext.tsx";
import { FocusView } from "../src/views/focus/FocusView.tsx";

function renderFocus(
  focusStore?: InMemoryStore<FocusSession>,
  taskStore?: InMemoryStore<Task>,
): void {
  render(
    <DataProvider
      {...(focusStore === undefined ? {} : { focusStore })}
      {...(taskStore === undefined ? {} : { taskStore })}
    >
      <MemoryRouter>
        <FocusView />
      </MemoryRouter>
    </DataProvider>,
  );
}

describe("FocusView", () => {
  afterEach(() => {
    cleanup();
  });

  it("aloittaa uuden fokusjakson ja näyttää fullscreen-ajastimen", async () => {
    const user = userEvent.setup();
    renderFocus();

    await screen.findByTestId("focus-view-empty");
    await user.click(screen.getByRole("button", { name: "Aloita fokus" }));

    const fullscreen = await screen.findByTestId("focus-fullscreen");
    expect(fullscreen).toHaveTextContent("Itsenäinen fokus");
    expect(fullscreen).toHaveTextContent("Pidä tauko");
    expect(fullscreen).toHaveTextContent("Valmis");
    expect(screen.getByRole("timer")).toHaveTextContent(/^\d{2}:\d{2}$/);
    expect(screen.getByRole("progressbar", { name: "Fokusjakson eteneminen" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    const sound = screen.getByRole("checkbox", { name: "Äänimerkki vaiheen vaihtuessa" });
    const vibration = screen.getByRole("checkbox", {
      name: "Värinä, jos selain tukee sitä",
    });
    expect(sound).not.toBeChecked();
    expect(vibration).not.toBeChecked();
    await user.click(vibration);
    expect(vibration).toBeChecked();
  });

  it("näyttää linkitetyn tehtävän ja vaihtaa käynnissä olevan session tauolle", async () => {
    const now = new Date().toISOString();
    const session: FocusSession = {
      id: "focus-session-1",
      taskId: "task-1",
      routineId: null,
      phase: "running",
      startedAt: now,
      endedAt: null,
      durationSeconds: 1_500,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const task: Task = {
      id: "task-1",
      title: "Kirjoita päivän tärkein asia",
      notes: null,
      status: "open",
      priority: "high",
      dueAt: null,
      projectId: null,
      tagIds: [],
      completedAt: null,
      reopenedAt: null,
      deletedAt: null,
      recurrence: null,
      estimateMinutes: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const user = userEvent.setup();
    renderFocus(
      new InMemoryStore<FocusSession>("focus-session", [session]),
      new InMemoryStore<Task>("task", [task]),
    );

    const fullscreen = await screen.findByTestId("focus-fullscreen");
    await waitFor(() => {
      expect(fullscreen).toHaveTextContent("Kirjoita päivän tärkein asia");
    });
    await user.click(screen.getByRole("button", { name: "Pidä tauko" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Jatka" })).toBeVisible();
    });
    expect(screen.getByRole("timer")).toHaveTextContent(/^\d{2}:\d{2}$/);
  });
});
