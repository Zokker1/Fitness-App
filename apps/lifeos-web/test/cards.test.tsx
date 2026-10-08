// T049: korttiperheiden unit-testit (happy-dom).
// - ActionCard: solidaarinen rakenne + sankariarvo saavutettavalla nimellä.
// - MetricCard: tabular-arvo + natiivi progress (clamp 0–100) + sanallinen
//   muutos + sävy; ilman progressia ei progress-elementtiä.
// - LogCard: rivit (otsikko/meta/arvo) + tyhjä suunniteltu tila.
// - QuietCard: reunaton sisältö + valinnainen otsikko.
// - StatusCard: role=status + ikoni + sävy.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionCard, LogCard, MetricCard, QuietCard, StatusCard } from "@lifeos/ui";

describe("ActionCard", () => {
  it("otsikko + sankariarvo + toiminto", () => {
    document.body.innerHTML = "";
    render(
      <ActionCard heading="Mitä seuraavaksi" value="Osta maitoa" valueLabel="yksi avoin tehtävä">
        <button type="button">Avaa</button>
      </ActionCard>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Mitä seuraavaksi" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "yksi avoin tehtävä" })).toHaveTextContent(
      "Osta maitoa",
    );
    expect(screen.getByRole("button", { name: "Avaa" })).toBeInTheDocument();
  });
});

describe("MetricCard", () => {
  it("arvo + progress + sanallinen muutos", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <MetricCard
        heading="Viikon fokus"
        valueLabel="125 fokusminuuttia"
        value="125 min"
        progress={62}
        changeText="12 minuuttia enemmän kuin viime viikolla"
        tone="success"
      />,
    );
    expect(screen.getByRole("img", { name: "125 fokusminuuttia" })).toHaveTextContent("125 min");
    const progress = container.querySelector("progress");
    expect(progress?.getAttribute("value")).toBe("62");
    expect(screen.getByText(/enemmän kuin viime viikolla/)).toBeInTheDocument();
  });

  it("clampaa progressin 0–100 eikä renderöi ilman arvoa", () => {
    document.body.innerHTML = "";
    const { container, rerender } = render(
      <MetricCard heading="M" valueLabel="l" value="1" progress={140} />,
    );
    expect(container.querySelector("progress")?.getAttribute("value")).toBe("100");
    rerender(<MetricCard heading="M" valueLabel="l" value="1" />);
    expect(container.querySelector("progress")).toBeNull();
  });
});

describe("LogCard", () => {
  it("rivit + tyhjä tila suunniteltuna", () => {
    document.body.innerHTML = "";
    const { rerender } = render(
      <LogCard
        heading="Virta"
        emptyText="Ei merkintöjä vielä"
        rows={[{ title: "Lenkki", meta: "kello 7.30", value: "30 min" }]}
      />,
    );
    expect(screen.getByText("Lenkki")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    rerender(<LogCard heading="Virta" emptyText="Ei merkintöjä vielä" rows={[]} />);
    expect(screen.getByText("Ei merkintöjä vielä")).toBeInTheDocument();
  });
});

describe("QuietCard", () => {
  it("sisältö ilman reunaa/varjoa (tyyli CSS:ssä) + valinnainen otsikko", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <QuietCard heading="Huomio">
        <p>Hiljainen täydennys.</p>
      </QuietCard>,
    );
    expect(container.querySelector('[data-ui="card-quiet"]')).not.toBeNull();
    expect(screen.getByText("Hiljainen täydennys.")).toBeInTheDocument();
  });
});

describe("StatusCard", () => {
  it("role=status + sävy + ikoni", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <StatusCard heading="Synkronoitu" tone="success">
        <p>Kaikki tallessa.</p>
      </StatusCard>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelector('[data-tone="success"]')).not.toBeNull();
    expect(container.querySelector('[data-ui="icon"][aria-hidden="true"]')).not.toBeNull();
  });
});
