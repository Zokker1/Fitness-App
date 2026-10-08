import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "@lifeos/ui";

describe("Checkbox", () => {
  it("käyttää näkyvää labelia ja välittää natiivin valinnan", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox onChange={onChange} data-testid="shared-checkbox">
        Päivän tehtävä
      </Checkbox>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Päivän tehtävä" });
    expect(checkbox.closest("label")).toHaveAttribute("data-ui", "checkbox");
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("säilyttää controlled-tilan ja disabled-eston", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox checked disabled onChange={onChange}>
        Lukittu valinta
      </Checkbox>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Lukittu valinta" });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
    expect(onChange).not.toHaveBeenCalled();
  });
});
