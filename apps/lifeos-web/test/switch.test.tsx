import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "@lifeos/ui";

describe("Switch", () => {
  it("antaa natiiville checkboxille switch-roolin ja näkyvän nimen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Switch checked={false} onChange={onChange} data-testid="visibility-switch">
        Näytä edistyminen
      </Switch>,
    );

    const control = screen.getByRole("switch", { name: "Näytä edistyminen" });
    expect(control).toHaveAttribute("type", "checkbox");
    expect(control.closest("label")).toHaveAttribute("data-ui", "switch");
    await user.tab();
    expect(control).toHaveFocus();
    await user.click(control);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("välittää valitun ja disabled-tilan natiivisti", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Switch checked disabled onChange={onChange}>
        Lukittu asetus
      </Switch>,
    );

    const control = screen.getByRole("switch", { name: "Lukittu asetus" });
    expect(control).toBeChecked();
    expect(control).toBeDisabled();
    await user.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});
