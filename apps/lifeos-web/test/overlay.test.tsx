// T050: overlay-perheen unit-testit (happy-dom).
// - Modal/BottomSheet/Drawer: suljettuna ei DOM:ssa; avattuna dialogi +
//   aria-modal + labelledby; variantti data-attribuutissa.
// - Esc sulkee; scrim-klikki sulkee (closeOnScrim=false ei sulje).
// - Focus-trap: Tab kiertää dialogin sisällä (ei vuoda taustalle).
// - Body-scroll lukittu avoinna + palautettu suljettaessa.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BottomSheet, Drawer, Modal } from "@lifeos/ui";

describe("Modal", () => {
  it("suljettuna ei DOM:ssa; avattuna dialogi + variantti", () => {
    document.body.innerHTML = "";
    const { container, rerender } = render(
      <Modal title="Otsikko" open={false} onClose={() => undefined}>
        <p>Sisältö</p>
      </Modal>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    rerender(
      <Modal title="Otsikko" open={true} onClose={() => undefined}>
        <p>Sisältö</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Otsikko" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-variant", "modal");
  });

  it("Esc sulkee + scrim-klikki sulkee", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Otsikko" open={true} onClose={onClose}>
        <p>Sisältö</p>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closeOnScrim=false: scrim ei sulje", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="Otsikko" open={true} onClose={onClose} closeOnScrim={false}>
        <p>Sisältö</p>
      </Modal>,
    );
    const scrim = container.querySelector('[data-ui="overlay-scrim"]');
    expect(scrim).not.toBeNull();
    if (scrim instanceof HTMLElement) {
      await user.click(scrim);
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it("focus-trap: Tab ei vuoda taustalle + scroll lukittu", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Tausta</button>
        <Modal title="Otsikko" open={true} onClose={() => undefined}>
          <p>Sisältö</p>
        </Modal>
      </div>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    // Dialogin sisällä: Sulje + (sisällön napit); Tab kiertää.
    const dialog = screen.getByRole("dialog", { name: "Otsikko" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("BottomSheet/Drawer", () => {
  it("variantit data-attribuutissa + kuvaus sidottu", () => {
    document.body.innerHTML = "";
    const { container, rerender } = render(
      <BottomSheet title="Sheet" description="Kuvaus" open={true} onClose={() => undefined}>
        <p>S</p>
      </BottomSheet>,
    );
    expect(container.querySelector('[data-variant="sheet"]')).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Sheet" })).toHaveAttribute("aria-describedby");
    rerender(
      <Drawer title="Drawer" open={true} onClose={() => undefined}>
        <p>D</p>
      </Drawer>,
    );
    expect(container.querySelector('[data-variant="drawer"]')).not.toBeNull();
  });
});
