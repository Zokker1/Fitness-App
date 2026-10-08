// T051: ydintilojen unit-testit (happy-dom).
// - EmptyState: ikoni + otsikko + vihje + toiminto; ilman ikonia sama
//   rakenne kuin ennen (placeholder-yhteensopiva); role=status.
// - Skeleton: rivimäärä clamp 1–6, ruudunlukijateksti, aria-hidden-viivat.
// - Alert: sävyt (danger=alert, muut status) + otsikko + sulku; ilman
//   otsikkoa/toimintoa ei tyhjiä kääreitä.
// - Toast: sävyt + viewport; duration sulkee ajastimella (vi timers);
//   ilman durationia ei ajastinta.
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alert, EmptyState, Skeleton, Toast, ToastViewport } from "@lifeos/ui";

describe("EmptyState", () => {
  it("ikoni + otsikko + vihje + toiminto", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <EmptyState
        title="Ei tehtäviä vielä"
        hint="Lisää ensimmäinen tehtävä."
        icon="check"
        action={<button type="button">Lisää</button>}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Ei tehtäviä vielä")).toBeInTheDocument();
    expect(screen.getByText("Lisää ensimmäinen tehtävä.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lisää" })).toBeInTheDocument();
    expect(container.querySelector('[data-ui="icon"][aria-hidden="true"]')).not.toBeNull();
  });

  it("ilman ikonia/toimintoa ei tyhjiä kääreitä", () => {
    document.body.innerHTML = "";
    const { container } = render(<EmptyState title="Tyhjä" />);
    expect(container.querySelector('[data-ui="empty-icon"]')).toBeNull();
    expect(container.querySelector('[data-ui="empty-action"]')).toBeNull();
    expect(screen.getByText("Tyhjä")).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("oletus 3 riviä + ruudunlukijateksti, viivat piilossa", () => {
    document.body.innerHTML = "";
    const { container } = render(<Skeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Ladataan…");
    expect(container.querySelectorAll('[data-ui="skeleton-line"]')).toHaveLength(3);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("clampaa rivit 1–6", () => {
    document.body.innerHTML = "";
    const { container, rerender } = render(<Skeleton lines={0} />);
    expect(container.querySelectorAll('[data-ui="skeleton-line"]')).toHaveLength(1);
    rerender(<Skeleton lines={99} />);
    expect(container.querySelectorAll('[data-ui="skeleton-line"]')).toHaveLength(6);
  });
});

describe("Alert", () => {
  it("danger=alert, muut status + ikoni + otsikko", () => {
    document.body.innerHTML = "";
    const { container, rerender } = render(
      <Alert tone="info" title="Synkronoitu">
        <p>Tallessa.</p>
      </Alert>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Synkronoitu")).toBeInTheDocument();
    expect(container.querySelector('[data-ui="icon"][aria-hidden="true"]')).not.toBeNull();
    rerender(
      <Alert tone="danger" title="Epäonnistui">
        <p>Yritä uudelleen.</p>
      </Alert>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("sulku kutsuu onDismiss; ilman sulkua ei nappia", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { container, rerender } = render(
      <Alert tone="warning" title="Huomio" onDismiss={onDismiss}>
        <p>Tarkista.</p>
      </Alert>,
    );
    await user.click(screen.getByRole("button", { name: "Sulje ilmoitus" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    rerender(
      <Alert tone="warning" title="Huomio">
        <p>Tarkista.</p>
      </Alert>,
    );
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("Toast", () => {
  it("viewport + sävy + sulku", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ToastViewport>
        <Toast tone="success" title="Tallennettu" body="Löydät näkymästä." onDismiss={onDismiss} />
      </ToastViewport>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Tallennettu")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sulje ilmoitus" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("duration sulkee ajastimella; ilman durationia ei ajastinta", () => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      const { rerender } = render(<Toast title="A" duration={5000} onDismiss={onDismiss} />);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      onDismiss.mockClear();
      rerender(<Toast title="B" onDismiss={onDismiss} />);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
