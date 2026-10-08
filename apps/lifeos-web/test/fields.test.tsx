// T047: lomakekenttien unit-testit (happy-dom).
// T048: + DatePicker/TimePicker/SegmentedControl.
// - Label-sidonta: joka kentällä label (for/id) — ei placeholder-labelia.
// - Virhe: aria-invalid + aria-describedby (hint+error) + role=alert + ikoni.
// - Select: natiivi select + vaihtoehdot + chevron-koriste.
// - Combobox: role=combobox + datalist-ehdotukset + list-sidonta.
// - Date/time: natiivi type + label + ISO-arvo.
// - Segmented: radiogroup + valinta vaihtuu + keyboard (arrow) + virhe.
// - Disabled: kenttä ei ota syötettä.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Combobox,
  DatePicker,
  Input,
  NumberInput,
  SegmentedControl,
  Select,
  TimePicker,
} from "@lifeos/ui";

describe("Input", () => {
  it("label sidottu (for/id), hint + error kuvattuina", () => {
    document.body.innerHTML = "";
    render(<Input label="Tehtävän nimi" hint="Lyhyt nimi riittää" error="Nimi puuttuu" />);
    const field = screen.getByLabelText("Tehtävän nimi");
    expect(field).toHaveAttribute("aria-invalid", "true");
    const described = field.getAttribute("aria-describedby") ?? "";
    expect(described).toContain("-hint");
    expect(described).toContain("-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Nimi puuttuu");
  });

  it("kirjoitus toimii kontrolloimattomana", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    render(<Input label="Haku" />);
    await user.type(screen.getByLabelText("Haku"), "maito");
    expect(screen.getByLabelText("Haku")).toHaveValue("maito");
  });

  it("disabled ei ota syötettä", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    render(<Input label="Lukittu" disabled />);
    expect(screen.getByLabelText("Lukittu")).toBeDisabled();
    await user.type(screen.getByLabelText("Lukittu"), "x").catch(() => undefined);
    expect(screen.getByLabelText("Lukittu")).toHaveValue("");
  });
});

describe("NumberInput", () => {
  it("type=number + decimal-näppäimistö + label", () => {
    document.body.innerHTML = "";
    render(<NumberInput label="Määrä" min={0} max={10} />);
    const field = screen.getByLabelText("Määrä");
    expect(field).toHaveAttribute("type", "number");
    expect(field).toHaveAttribute("inputmode", "decimal");
  });
});

describe("Select", () => {
  it("natiivi select + vaihtoehdot + chevron", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const { container } = render(
      <Select
        label="Prioriteetti"
        placeholder="Valitse…"
        options={[
          { value: "low", label: "Matala" },
          { value: "high", label: "Korkea" },
        ]}
      />,
    );
    const select = screen.getByLabelText("Prioriteetti");
    expect(select.tagName).toBe("SELECT");
    expect(container.querySelector('[data-ui="icon"][aria-hidden="true"]')).not.toBeNull();
    await user.selectOptions(select, "high");
    expect(select).toHaveValue("high");
  });

  it("virhe näkyy + aria-invalid", () => {
    document.body.innerHTML = "";
    render(<Select label="Tila" error="Valitse tila" options={[{ value: "a", label: "A" }]} />);
    expect(screen.getByLabelText("Tila")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Valitse tila");
  });
});

describe("Combobox", () => {
  it("combobox-rooli + datalist-ehdotukset", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    render(<Combobox label="Tagi" suggestions={["koti", "työ"]} />);
    const field = screen.getByRole("combobox", { name: "Tagi" });
    expect(field).toHaveAttribute("list");
    await user.type(field, "ko");
    expect(field).toHaveValue("ko");
  });
});

describe("DatePicker", () => {
  it("natiivi date + label + ISO-arvo", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    render(<DatePicker label="Päivämäärä" />);
    const field = screen.getByLabelText("Päivämäärä");
    expect(field).toHaveAttribute("type", "date");
    await user.type(field, "2026-09-16");
    expect(field).toHaveValue("2026-09-16");
  });

  it("virhe näkyy + aria-invalid", () => {
    document.body.innerHTML = "";
    render(<DatePicker label="Päivämäärä" error="Valitse päivä" />);
    expect(screen.getByLabelText("Päivämäärä")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Valitse päivä");
  });
});

describe("TimePicker", () => {
  it("natiivi time + label + 24h-arvo", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    render(<TimePicker label="Kellonaika" />);
    const field = screen.getByLabelText("Kellonaika");
    expect(field).toHaveAttribute("type", "time");
    await user.type(field, "08:30");
    expect(field).toHaveValue("08:30");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "day", label: "Päivä" },
    { value: "week", label: "Viikko" },
    { value: "month", label: "Kuukausi" },
  ];

  it("radiogroup + klikkaus vaihtaa + label sidottu", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl label="Näkymä" options={options} value="day" onOptionChange={onChange} />,
    );
    // fieldset+legend = natiivi group-rooli (radiot ryhmitettynä oikein).
    expect(screen.getByRole("group", { name: "Näkymä" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Päivä" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Viikko" }));
    expect(onChange).toHaveBeenCalledWith("week");
    rerender(
      <SegmentedControl label="Näkymä" options={options} value="week" onOptionChange={onChange} />,
    );
    expect(screen.getByRole("radio", { name: "Viikko" })).toBeChecked();
  });

  it("keyboard: nuolella seuraavaan (natiivi radio-käytös)", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Näkymä" options={options} value="day" onOptionChange={onChange} />,
    );
    screen.getByRole("radio", { name: "Päivä" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("week");
  });

  it("virhe näkyy + hint kuvattuna", () => {
    document.body.innerHTML = "";
    render(
      <SegmentedControl
        label="Näkymä"
        hint="Valitse aikaväli"
        error="Valinta puuttuu"
        options={options}
        value="day"
        onOptionChange={() => undefined}
      />,
    );
    const group = screen.getByRole("group", { name: "Näkymä" });
    expect(group.getAttribute("aria-describedby") ?? "").toContain("-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Valinta puuttuu");
  });

  it("disabled estää vaihdon", async () => {
    document.body.innerHTML = "";
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Näkymä"
        options={options}
        value="day"
        onOptionChange={onChange}
        disabled
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Viikko" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
