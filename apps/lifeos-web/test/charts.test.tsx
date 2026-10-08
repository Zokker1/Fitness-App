// T053: chart-framen unit-testit (happy-dom).
// - Otsikko (h2) + yksikkö + range-vaihto (radioryhmä kutsuu callbackin).
// - Tekstivastine: details+taulukko (caption, otsikot, rivit = pisteet).
// - Tyhjä data: EmptyState-teksti + vihje; renderer-slotti piilossa.
// - Lataus: Skeleton ("Ladataan…"), ei taulukkoa.
// - StatChip: arvo (tabular, label) + sanallinen trendi.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChartFrame, StatChip } from "@lifeos/ui";

const RANGES = [
  { value: "7d", label: "7 pv" },
  { value: "30d", label: "30 pv" },
];

const POINTS = [
  { x: "10.9.", y: 20 },
  { x: "11.9.", y: 35 },
];

describe("ChartFrame", () => {
  it("otsikko + yksikkö + range-vaihto", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    render(
      <ChartFrame
        title="Viikon fokus"
        unit="min"
        ranges={RANGES}
        range="7d"
        onRangeChange={onRangeChange}
        points={POINTS}
        emptyText="Ei mittauksia vielä"
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Viikon fokus" })).toBeInTheDocument();
    expect(screen.getByText("Yksikkö: min")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "30 pv" }));
    expect(onRangeChange).toHaveBeenCalledWith("30d");
  });

  it("tekstivastine taulukkona (caption + rivit)", () => {
    document.body.innerHTML = "";
    render(
      <ChartFrame
        title="Viikon fokus"
        unit="min"
        ranges={RANGES}
        range="7d"
        onRangeChange={() => {}}
        points={POINTS}
        summary="Nouseva."
        emptyText="Ei mittauksia vielä"
      />,
    );
    expect(screen.getByText("Tekstivastine taulukkona")).toBeInTheDocument();
    expect(screen.getByText("Viikon fokus (min)")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /10\.9\.\s*20/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /11\.9\.\s*35/ })).toBeInTheDocument();
  });

  it("tyhjä data on suunniteltu tila (ei taulukkoa/slottia)", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <ChartFrame
        title="Tyhjä graafi"
        unit="kg"
        ranges={RANGES}
        range="7d"
        onRangeChange={() => {}}
        points={[]}
        emptyText="Ei mittauksia vielä"
        summary="Kirjaa ensimmäinen mittaus."
      >
        <div>renderer</div>
      </ChartFrame>,
    );
    expect(screen.getByText("Ei mittauksia vielä")).toBeInTheDocument();
    expect(screen.getByText("Kirjaa ensimmäinen mittaus.")).toBeInTheDocument();
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector('[data-ui="chart-canvas"]')).toBeNull();
  });

  it("lataus näyttää skeletonin (ei taulukkoa)", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <ChartFrame
        title="Lataava graafi"
        unit="min"
        ranges={RANGES}
        range="7d"
        onRangeChange={() => {}}
        loading
        emptyText="Ei mittauksia vielä"
      />,
    );
    expect(screen.getByText("Ladataan…")).toBeInTheDocument();
    expect(container.querySelector("table")).toBeNull();
  });
});

describe("StatChip", () => {
  it("arvo + label + sanallinen trendi", () => {
    document.body.innerHTML = "";
    render(
      <StatChip
        value="125 min"
        valueLabel="125 fokusminuuttia"
        label="Viikon fokus"
        trendText="12 minuuttia enemmän kuin viime viikolla"
      />,
    );
    expect(screen.getByRole("img", { name: "125 fokusminuuttia" })).toHaveTextContent("125 min");
    expect(screen.getByText("Viikon fokus")).toBeInTheDocument();
    expect(screen.getByText(/enemmän kuin viime viikolla/)).toBeInTheDocument();
  });
});
