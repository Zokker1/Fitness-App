// T094: QuickMoodForm unit-testit (web-paketti, happy-dom + muististore).
// Kriteeri: mieliala 1–5 + valinnainen energia + valinnainen muistiinpano,
// EI TULKINTAA (ei arvioita onnistumisesta).
// - Oletus (3, ei energiaa, ei notea) → 1 rivi (mood 3, energy null);
// - energia + note → rivillä mukana; pitkä note → virhe, ei kirjoitusta.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MoodCheckin } from "@lifeos/domain";
import { InMemoryStore, createEntityRepository } from "@lifeos/data";
import { createFixtureStores } from "./fixtures.tsx";
import { QuickMoodForm } from "../src/quickadd/QuickMoodForm.tsx";

function renderForm(onSaved: (row: MoodCheckin) => void) {
  const { clock } = createFixtureStores();
  const store = new InMemoryStore<MoodCheckin>("mood-checkin");
  let counter = 0;
  const moodCheckins = createEntityRepository(store, {
    clock,
    ids: { next: () => `md-${String(++counter)}` },
  });
  const view = render(<QuickMoodForm moodCheckins={moodCheckins} onSaved={onSaved} />);
  return { store, ...view };
}

describe("QuickMoodForm", () => {
  it("oletus tallentaa mood 3 ilman energiaa ja notea", async () => {
    const onSaved = vi.fn();
    const { store, unmount } = renderForm(onSaved);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Tallenna mieliala" }));
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(1);
      });
      const row = onSaved.mock.calls[0]?.[0] as MoodCheckin;
      expect(row).toMatchObject({ mood: 3, energy: null, note: null });
      const listed = await store.list();
      expect(listed.ok && listed.value.length).toBe(1);
    } finally {
      unmount();
    }
  });

  it("energia + muistiinpano tallentuvat riville (ei tulkintaa)", async () => {
    const onSaved = vi.fn();
    const { unmount } = renderForm(onSaved);
    try {
      // Kaksi "5"-radiota (mieliala + energia) — rajataan Mieliala-ryhmään.
      const moodGroup = screen.getByRole("group", { name: "Mieliala" });
      fireEvent.click(within(moodGroup).getByRole("radio", { name: "5" }));
      fireEvent.change(screen.getByLabelText("Muistiinpano (valinnainen)"), {
        target: { value: "Rauhallinen aamu" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna mieliala" }));
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(1);
      });
      const row = onSaved.mock.calls[0]?.[0] as MoodCheckin;
      expect(row).toMatchObject({ mood: 5, note: "Rauhallinen aamu" });
    } finally {
      unmount();
    }
  });

  it("liian pitkä note → virhe, ei kirjoitusta", async () => {
    const onSaved = vi.fn();
    const { unmount } = renderForm(onSaved);
    try {
      fireEvent.change(screen.getByLabelText("Muistiinpano (valinnainen)"), {
        target: { value: "x".repeat(501) },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna mieliala" }));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("500 merkkiä");
      });
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});
