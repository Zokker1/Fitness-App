// T093: QuickMeasureForm unit-testit (web-paketti, happy-dom + muististore).
// Kriteeri: paino + valinnainen verenpaine, yksiköt mukana, EI TULKINTAA.
// - Tyhjä paino → kenttävirhe, ei kirjoituksia;
// - paino → 1 weight-rivi (kg) + onSaved; BP tyhjänä → ei toista riviä;
// - BP täytettynä → 2 riviä (weight + blood-pressure, systolinen/diastolinen);
// - puolikas BP (vain toinen) → virhe; pilkkudesimaali toimii.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Measurement } from "@lifeos/domain";
import { InMemoryStore, createEntityRepository } from "@lifeos/data";
import { createFixtureStores } from "./fixtures.tsx";
import { QuickMeasureForm } from "../src/quickadd/QuickMeasureForm.tsx";

function renderForm(onSaved: (rows: readonly Measurement[]) => void) {
  const { clock } = createFixtureStores();
  const store = new InMemoryStore<Measurement>("measurement");
  let counter = 0;
  const measurements = createEntityRepository(store, {
    clock,
    ids: { next: () => `m-${String(++counter)}` },
  });
  const view = render(<QuickMeasureForm measurements={measurements} onSaved={onSaved} />);
  return { store, ...view };
}

describe("QuickMeasureForm", () => {
  it("tyhjä paino → kenttävirhe, ei kirjoituksia", async () => {
    const onSaved = vi.fn();
    const { unmount } = renderForm(onSaved);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Tallenna mittaus" }));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("20–400 kg");
      });
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("paino pilkulla → weight-rivi kg-yksiköllä, ei BP-riviä", async () => {
    const onSaved = vi.fn();
    const { store, unmount } = renderForm(onSaved);
    try {
      fireEvent.change(screen.getByLabelText("Paino (kg)"), { target: { value: "75,5" } });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna mittaus" }));
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(1);
      });
      const rows = onSaved.mock.calls[0]?.[0] as readonly Measurement[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "weight", value: 75.5, unit: "kg" });
      const listed = await store.list();
      expect(listed.ok && listed.value.length).toBe(1);
    } finally {
      unmount();
    }
  });

  it("BP täytettynä → weight + blood-pressure (systolinen/diastolinen)", async () => {
    const onSaved = vi.fn();
    const { store, unmount } = renderForm(onSaved);
    try {
      fireEvent.change(screen.getByLabelText("Paino (kg)"), { target: { value: "80" } });
      fireEvent.change(screen.getByLabelText("Yläpaine (valinnainen)"), {
        target: { value: "120" },
      });
      fireEvent.change(screen.getByLabelText("Alapaine (valinnainen)"), {
        target: { value: "80" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna mittaus" }));
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(1);
      });
      const rows = onSaved.mock.calls[0]?.[0] as readonly Measurement[];
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        type: "blood-pressure",
        value: 120,
        secondaryValue: 80,
        unit: "mmHg",
      });
      const listed = await store.list();
      expect(listed.ok && listed.value.length).toBe(2);
    } finally {
      unmount();
    }
  });

  it("puolikas BP (vain yläpaine) → virhe, ei kirjoituksia", async () => {
    const onSaved = vi.fn();
    const { unmount } = renderForm(onSaved);
    try {
      fireEvent.change(screen.getByLabelText("Paino (kg)"), { target: { value: "80" } });
      fireEvent.change(screen.getByLabelText("Yläpaine (valinnainen)"), {
        target: { value: "120" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tallenna mittaus" }));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("40–300 mmHg");
      });
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});
