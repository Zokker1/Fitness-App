// T081: Today-headerin puhtaiden apurien unit-testit (web-paketti,
// happy-dom). Päivämäärämuotoilu, tervehdyskartta ja sync-indikaattorin
// valintalogiikka — ei selaimen Storage-APIa, suoraan src:stä.
import { describe, expect, it } from "vitest";
import { formatTodayDate, greetingForPhase, syncIndicator } from "../src/views/today/header.ts";

describe("formatTodayDate", () => {
  it("muotoilee suomalaisen pitkän päivämäärän paikallisessa vyöhykkeessä", () => {
    // 2026-09-18T09:00:00Z = perjantai Helsingissä (UTC+3).
    expect(formatTodayDate("2026-09-18T09:00:00.000Z", 180)).toBe("perjantai 18. syyskuuta");
  });

  it("rajanylitys: UTC-aamuyö on edellinen päivä länsivyöhykkeellä", () => {
    // Sama hetki on torstai New Yorkissa (UTC−4).
    expect(formatTodayDate("2026-09-18T01:00:00.000Z", -240)).toBe("torstai 17. syyskuuta");
  });
});

describe("greetingForPhase", () => {
  it("kartta on täydellinen ja hillitty (ei koristeellisuutta, §4)", () => {
    expect(greetingForPhase("aamu")).toBe("Hyvää huomenta");
    expect(greetingForPhase("paiva")).toBe("Hyvää päivää");
    expect(greetingForPhase("ilta")).toBe("Hyvää iltaa");
    expect(greetingForPhase("yo")).toBe("Yö jatkuu");
  });
});

describe("syncIndicator", () => {
  it("offline voittaa tallennustilan (ei synkanka-valheita)", () => {
    expect(syncIndicator(false, "opfs-sahpool")).toEqual({
      label: "Offline — toimii ilman verkkoa",
      tone: "offline",
    });
  });

  it("muistifallback erottuu pysyvästä tallennuksesta", () => {
    expect(syncIndicator(true, "memory")).toEqual({
      label: "Välimuistissa",
      tone: "varoitus",
    });
    expect(syncIndicator(true, "opfs-sahpool")).toEqual({
      label: "Tallennettu laitteella",
      tone: "ok",
    });
    expect(syncIndicator(true, "tuntematon")).toEqual({
      label: "Tallennettu laitteella",
      tone: "ok",
    });
  });
});
