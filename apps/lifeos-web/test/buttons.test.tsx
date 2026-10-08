// T046: Button-perheen unit-testit (happy-dom).
// - Variantit renderöityvät data-variantilla (primary/secondary/danger/ghost).
// - States: loading (disabled + aria-busy + "Ladataan…"), disabled, focus-
//   rengas (CSS, ei testata tässä — E2E todistaa näkyvyyden).
// - IconButton: aria-label pakollinen (nimi löytyy), ikoni renderöityy,
//   loading näyttää odotuksen.
// - Fab: oletuslabeli "Kirjaa" + ikoni + teksti (ei pelkkä +).
// - Haptics: isHapticsSupported + readVibrateFunction ilman selaintukea
//   (happy-dom: ei vibratea -> null, no-op, ei heittoa); hook palauttaa
//   funktion joka ei heitä ilman tukeakaan.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Button,
  Fab,
  IconButton,
  isHapticsSupported,
  readVibrateFunction,
  useHaptics,
} from "@lifeos/ui";

describe("Button-variantit", () => {
  it("neljä varianttia data-variantilla", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <>
        <Button variant="primary">Ensisijainen</Button>
        <Button variant="secondary">Toissijainen</Button>
        <Button variant="danger">Poista</Button>
        <Button variant="ghost">Peruuta</Button>
      </>,
    );
    expect(container.querySelector('button[data-variant="primary"]')).not.toBeNull();
    expect(container.querySelector('button[data-variant="secondary"]')).not.toBeNull();
    expect(container.querySelector('button[data-variant="danger"]')).not.toBeNull();
    expect(container.querySelector('button[data-variant="ghost"]')).not.toBeNull();
  });

  it("loading: disabled + aria-busy + odotusteksti (ei layout-hyppyä testissä)", () => {
    document.body.innerHTML = "";
    render(<Button loading>Lähetä</Button>);
    const button = screen.getByRole("button", { name: "Ladataan…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "true");
  });

  it("disabled-nappi ei laukea", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    let clicks = 0;
    render(
      <Button
        disabled
        onClick={() => {
          clicks += 1;
        }}
      >
        Estetty
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Estetty" }));
    expect(clicks).toBe(0);
  });
});

describe("IconButton", () => {
  it("aria-label + ikoni (ei pelkkää ikonia ilman nimeä)", () => {
    document.body.innerHTML = "";
    const { container } = render(<IconButton icon="close" label="Sulje valikko" />);
    const button = screen.getByRole("button", { name: "Sulje valikko" });
    expect(button).toHaveAttribute("data-ui", "icon-button");
    expect(container.querySelector('[data-ui="icon"][aria-hidden="true"]')).not.toBeNull();
  });
});

describe("Fab", () => {
  it("oletus Kirjaa + add-ikoni + teksti", () => {
    document.body.innerHTML = "";
    const { container } = render(<Fab />);
    const fab = screen.getByRole("button", { name: /Kirjaa/ });
    expect(fab).toHaveAttribute("data-ui", "fab");
    expect(container.querySelector('[data-ui="icon"][aria-hidden="true"]')).not.toBeNull();
    expect(fab).toHaveTextContent("Kirjaa");
  });
});

describe("haptics", () => {
  it("ilman tukea: null + no-op-hook (ei heittoa)", () => {
    expect(isHapticsSupported(undefined)).toBe(false);
    expect(isHapticsSupported("vibrate")).toBe(false);
    expect(readVibrateFunction()).toBeNull();
    function Probe(): React.JSX.Element {
      const trigger = useHaptics();
      expect(typeof trigger).toBe("function");
      trigger();
      trigger([10, 20]);
      return <p>ok</p>;
    }
    document.body.innerHTML = "";
    render(<Probe />);
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("tuella: funktio tunnistuu", () => {
    expect(isHapticsSupported(() => true)).toBe(true);
  });
});
