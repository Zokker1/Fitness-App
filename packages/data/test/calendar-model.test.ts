// T120: calendar query model -unit-testit (data-paketti).
// Kriteeri: päivä/viikko/kuukausi-data johdetaan yhdestä aikamallista.
// - day = 1 päivä; week = ma–su (7); month = kokonaisia viikkorivejä
//   täyttöpäivillä naapurikuukausista (inMonth=false);
// - weekday 1=ma…7=su; isToday vain kutsujan paikallispäivällä;
// - epävalidi paikallispäivä → heittää (ohjelmointivirhe).
import { describe, expect, it } from "vitest";
import { buildCalendarModel } from "@lifeos/data";

// 2026-09-18 on perjantai (weekday 5).
const TODAY = "2026-09-18";

describe("buildCalendarModel — day (T120)", () => {
  it("päivänäkymä: yksittäinen päivä, oikea viikonpäivä, isToday", () => {
    const model = buildCalendarModel({ view: "day", localDate: TODAY });
    expect(model.startLocalDate).toBe(TODAY);
    expect(model.endLocalDate).toBe(TODAY);
    expect(model.days).toHaveLength(1);
    const day = model.days[0];
    expect(day?.dateKey).toBe(TODAY);
    expect(day?.weekday).toBe(5);
    expect(day?.isToday).toBe(true);
    expect(day?.inMonth).toBe(true);
  });
});

describe("buildCalendarModel — week (T120)", () => {
  it("viikko: maanantaista sunnuntaiin, weekdays 1..7 järjestyksessä", () => {
    const model = buildCalendarModel({ view: "week", localDate: TODAY });
    expect(model.startLocalDate).toBe("2026-09-14");
    expect(model.endLocalDate).toBe("2026-09-20");
    expect(model.days).toHaveLength(7);
    expect(model.days.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(model.days.every((day) => day.inMonth)).toBe(true);
    const friday = model.days.find((day) => day.dateKey === TODAY);
    expect(friday?.isToday).toBe(true);
    const monday = model.days[0];
    expect(monday?.isToday).toBe(false);
  });
});

describe("buildCalendarModel — month (T120)", () => {
  it("syyskuu 2026: täydelliset viikkorivit + täyttöpäivät naapurikuukausista", () => {
    const model = buildCalendarModel({ view: "month", localDate: TODAY });
    // Ruudukko: ma 31.8. – su 4.10. = 35 päivää (5 viikkoriviä).
    expect(model.startLocalDate).toBe("2026-08-31");
    expect(model.endLocalDate).toBe("2026-10-04");
    expect(model.days).toHaveLength(35);
    expect(model.days.length % 7).toBe(0);
    // Täyttöpäivät: elokuun loppu ja lokakuun alku eivät ole syyskuussa.
    expect(model.days[0]?.inMonth).toBe(false);
    expect(model.days[0]?.dateKey).toBe("2026-08-31");
    expect(model.days[1]?.dateKey).toBe("2026-09-01");
    expect(model.days[1]?.inMonth).toBe(true);
    expect(model.days[30]?.dateKey).toBe("2026-09-30");
    expect(model.days[30]?.inMonth).toBe(true);
    expect(model.days[31]?.dateKey).toBe("2026-10-01");
    expect(model.days[31]?.inMonth).toBe(false);
    // isToday vain paikallispäivällä.
    const todayCells = model.days.filter((day) => day.isToday);
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0]?.dateKey).toBe(TODAY);
  });

  it("helmikuu 2024 (karkausvuosi): 29.2. ruudukossa, 5 viikkoriviä", () => {
    const model = buildCalendarModel({ view: "month", localDate: "2024-02-10" });
    expect(model.startLocalDate).toBe("2024-01-29");
    expect(model.endLocalDate).toBe("2024-03-03");
    expect(model.days).toHaveLength(35);
    const febDays = model.days.filter((day) => day.inMonth);
    expect(febDays).toHaveLength(29);
    expect(febDays[28]?.dateKey).toBe("2024-02-29");
  });

  it("helmikuu 2025 (ei karkausvuosi): 28 päivää sisällä", () => {
    const model = buildCalendarModel({ view: "month", localDate: "2025-02-10" });
    const febDays = model.days.filter((day) => day.inMonth);
    expect(febDays).toHaveLength(28);
  });
});

describe("validointi (T120)", () => {
  it("epävalidi paikallispäivä → heittää", () => {
    expect(() => buildCalendarModel({ view: "day", localDate: "ei-päivä" })).toThrow();
    expect(() => buildCalendarModel({ view: "month", localDate: "2026-13-40" })).toThrow();
  });
});
