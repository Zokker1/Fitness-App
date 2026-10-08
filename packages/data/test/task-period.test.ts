// T104: groupTasksInPeriod unit-testit (data-paketti, ei IO:ta).
// Kriteeri: tehtäviä voi tarkastella valitulla ajanjaksolla (§5 Päivä/Viikko/
// Kuukausi). Rajat: päivä = localDate; viikko ma–su; kuukausi kalenterikuukausi.
// Valmistuneet completedAt-päivällä omassa ryhmässään (uusin ensin); done ei
// vuoda due-ryhmään, tombstonet poissa, epävalidi dueAt pois.
import { describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";
import { groupTasksInPeriod, taskPeriodRange } from "@lifeos/data";

const TODAY = "2026-09-18"; // perjantai
const OFFSET = 180;

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: "2026-09-10T08:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    version: 1,
    title: id,
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId: null,
    tagIds: [],
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
    ...overrides,
  };
}

describe("taskPeriodRange (T104)", () => {
  it("päivä = yksittäinen paikallispäivä", () => {
    expect(taskPeriodRange("paiva", TODAY)).toEqual({
      startLocalDate: TODAY,
      endLocalDate: TODAY,
    });
  });

  it("viikko alkaa maanantaista ja päättyy sunnuntaiin (2026-09-18 = pe)", () => {
    expect(taskPeriodRange("viikko", TODAY)).toEqual({
      startLocalDate: "2026-09-14",
      endLocalDate: "2026-09-20",
    });
  });

  it("sunnuntai kuuluu samaan maanantaiin alkavaan viikkoon", () => {
    expect(taskPeriodRange("viikko", "2026-09-20")).toEqual({
      startLocalDate: "2026-09-14",
      endLocalDate: "2026-09-20",
    });
  });

  it("kuukausi = kalenterikuukauden 1.–viimeinen päivä", () => {
    expect(taskPeriodRange("kuukausi", TODAY)).toEqual({
      startLocalDate: "2026-09-01",
      endLocalDate: "2026-09-30",
    });
  });

  it("karkauskuukausi helmikuu 2024 = 29 päivää", () => {
    expect(taskPeriodRange("kuukausi", "2024-02-10")).toEqual({
      startLocalDate: "2024-02-01",
      endLocalDate: "2024-02-29",
    });
  });
});

describe("groupTasksInPeriod (T104)", () => {
  it("päiväjakso: tänään due sisällä, eilen/huomenna ulos; done omassa ryhmässään", () => {
    const result = groupTasksInPeriod({
      tasks: [
        task("t-today", { dueAt: "2026-09-18T09:00:00.000Z" }),
        task("t-yesterday", { dueAt: "2026-09-17T09:00:00.000Z" }),
        task("t-tomorrow", { dueAt: "2026-09-19T09:00:00.000Z" }),
        task("t-done-today", {
          status: "done",
          completedAt: "2026-09-18T11:00:00.000Z",
          dueAt: "2026-09-18T08:00:00.000Z",
        }),
        task("t-done-yesterday", {
          status: "done",
          completedAt: "2026-09-17T15:00:00.000Z",
        }),
      ],
      period: "paiva",
      localDate: TODAY,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.dueInPeriod.map((row) => row.id)).toEqual(["t-today"]);
    expect(result.completedInPeriod.map((row) => row.id)).toEqual(["t-done-today"]);
  });

  it("viikkojakso: maanantain ja sunnuntain rajat; järjestys dueAt nouseva", () => {
    const result = groupTasksInPeriod({
      tasks: [
        task("t-sun", { dueAt: "2026-09-20T09:00:00.000Z" }),
        task("t-mon", { dueAt: "2026-09-14T09:00:00.000Z" }),
        task("t-prev-sun", { dueAt: "2026-09-13T09:00:00.000Z" }),
        task("t-next-mon", { dueAt: "2026-09-21T09:00:00.000Z" }),
      ],
      period: "viikko",
      localDate: TODAY,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.dueInPeriod.map((row) => row.id)).toEqual(["t-mon", "t-sun"]);
  });

  it("kuukausijakso: 1. ja viimeinen päivä sisällä, naapurikuukaudet ulos", () => {
    const result = groupTasksInPeriod({
      tasks: [
        task("t-first", { dueAt: "2026-09-01T09:00:00.000Z" }),
        task("t-last", { dueAt: "2026-09-30T12:00:00.000Z" }),
        task("t-aug", { dueAt: "2026-08-31T09:00:00.000Z" }),
        task("t-oct", { dueAt: "2026-10-01T09:00:00.000Z" }),
      ],
      period: "kuukausi",
      localDate: TODAY,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.dueInPeriod.map((row) => row.id)).toEqual(["t-first", "t-last"]);
  });

  it("aikavyöhyke: 21:00 UTC +180 on paikallista seuraavaa päivää (sisällä)", () => {
    const result = groupTasksInPeriod({
      tasks: [task("t-late", { dueAt: "2026-09-17T21:00:00.000Z" })],
      period: "paiva",
      localDate: TODAY,
      timezoneOffsetMinutes: OFFSET,
    });
    // 17.9. klo 21 UTC = 18.9. klo 00:00 paikallista → päiväjaksossa.
    expect(result.dueInPeriod.map((row) => row.id)).toEqual(["t-late"]);
  });

  it("done ei vuoda due-ryhmään; tombstone ja epävalidi dueAt poissa", () => {
    const result = groupTasksInPeriod({
      tasks: [
        task("t-done", {
          status: "done",
          dueAt: "2026-09-18T09:00:00.000Z",
          completedAt: "2026-09-18T10:00:00.000Z",
        }),
        task("t-deleted", {
          deletedAt: "2026-09-18T08:00:00.000Z",
          dueAt: "2026-09-18T09:00:00.000Z",
        }),
        task("t-bad-due", { dueAt: "ei-päivämäärä" as unknown as Task["dueAt"] }),
      ],
      period: "paiva",
      localDate: TODAY,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.dueInPeriod).toEqual([]);
    expect(result.completedInPeriod.map((row) => row.id)).toEqual(["t-done"]);
  });

  it("due-tasatilanne: prioriteetti high ennen low, sitten createdAt", () => {
    const result = groupTasksInPeriod({
      tasks: [
        task("t-low", { dueAt: "2026-09-18T09:00:00.000Z", priority: "low" }),
        task("t-high-later", {
          dueAt: "2026-09-18T09:00:00.000Z",
          priority: "high",
          createdAt: "2026-09-11T08:00:00.000Z",
        }),
        task("t-high-earlier", {
          dueAt: "2026-09-18T09:00:00.000Z",
          priority: "high",
          createdAt: "2026-09-10T08:00:00.000Z",
        }),
      ],
      period: "paiva",
      localDate: TODAY,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.dueInPeriod.map((row) => row.id)).toEqual([
      "t-high-earlier",
      "t-high-later",
      "t-low",
    ]);
  });
});
