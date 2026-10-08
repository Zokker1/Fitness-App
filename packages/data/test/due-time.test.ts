// T109: due-time unit-testit (data-paketti).
// Kriteeri: aikavyöhyke, locale ja overdue-laskenta ovat oikein.
// - Muunnos paikallisosista → UTC (itä +180 ja länsi −240);
// - tasurakaisu dueAtFromLocalParts ↔ localDueParts;
// - overdue paikallispäivärajalla (21:00 UTC +180 = seuraava paikallispäivä →
//   EI myöhässä tänään-näkökulmasta); epävalidi dueAt ei ole koskaan
//   myöhässä;
// - fi-FI-muotoilu "23.9. klo 14.30" (UTC-siirretyistä osista).
import { describe, expect, it } from "vitest";
import { dueAtFromLocalParts, formatDueDateTime, isOverdue, localDueParts } from "@lifeos/data";

describe("dueAtFromLocalParts (T109)", () => {
  it("itä: 2026-09-23 14:30 (+180) → 11:30Z", () => {
    expect(dueAtFromLocalParts("2026-09-23", "14:30", 180)).toBe("2026-09-23T11:30:00.000Z");
  });

  it("länsi: 2026-09-23 14:30 (−240) → 18:30Z", () => {
    expect(dueAtFromLocalParts("2026-09-23", "14:30", -240)).toBe("2026-09-23T18:30:00.000Z");
  });

  it("epävalidit syötteet → null", () => {
    expect(dueAtFromLocalParts("2026-09-23", "25:99", 180)).toBeNull();
    expect(dueAtFromLocalParts("ei-päivä", "14:30", 180)).toBeNull();
    expect(dueAtFromLocalParts("2026-09-23", "ei-aikaa", 180)).toBeNull();
    expect(dueAtFromLocalParts("2026-13-01", "10:00", 180)).toBeNull();
  });
});

describe("localDueParts (T109)", () => {
  it("tasurakaisu: osat → hetki → samat osat (itä)", () => {
    const dueAt = dueAtFromLocalParts("2026-09-23", "09:05", 180);
    expect(dueAt).not.toBeNull();
    if (dueAt !== null) {
      expect(localDueParts(dueAt, 180)).toEqual({ dateKey: "2026-09-23", time: "09:05" });
    }
  });

  it("epävalidi hetki → null", () => {
    expect(localDueParts("ei-hetki", 180)).toBeNull();
  });
});

describe("isOverdue (T109)", () => {
  const TODAY = "2026-09-18";

  it("eilen paikallisesti → myöhässä; tänään → ei; huomenna → ei", () => {
    // 2026-09-17T12:00Z = 15:00 paikallista (+180) → eilen.
    expect(isOverdue("2026-09-17T12:00:00.000Z", TODAY, 180)).toBe(true);
    // 2026-09-18T12:00Z = 15:00 paikallista → tänään.
    expect(isOverdue("2026-09-18T12:00:00.000Z", TODAY, 180)).toBe(false);
    // 2026-09-19T12:00Z = 15:00 paikallista → huomenna.
    expect(isOverdue("2026-09-19T12:00:00.000Z", TODAY, 180)).toBe(false);
  });

  it("aikavyöhykeraja: 21:00Z edellisenä päivänä (+180) = tänään → ei myöhässä", () => {
    expect(isOverdue("2026-09-17T21:00:00.000Z", TODAY, 180)).toBe(false);
  });

  it("ei deadlinea tai epävalidi dueAt → ei koskaan myöhässä", () => {
    expect(isOverdue(null, TODAY, 180)).toBe(false);
    expect(isOverdue("ei-hetki", TODAY, 180)).toBe(false);
  });
});

describe("formatDueDateTime (T109)", () => {
  it("fi-FI: 23.9. klo 14.30 (paikalliset osat +180)", () => {
    // 11:30Z + 180 min = 14:30 paikallista.
    expect(formatDueDateTime("2026-09-23T11:30:00.000Z", 180)).toBe("23.9. klo 14.30");
  });

  it("kuukauden vaihto UTC-siirrolla: 30.9. 23:30 (+180) → 1.10. klo 02.30", () => {
    expect(formatDueDateTime("2026-09-30T23:30:00.000Z", 180)).toBe("1.10. klo 02.30");
  });

  it("epävalidi hetki → null", () => {
    expect(formatDueDateTime("ei-hetki", 180)).toBeNull();
  });
});
