// T091: Quick Task -lomake. 1–3 vuorovaikutusta: nimi → [eräpäivä] →
// [prioriteetti] → Tallenna.
// - Nimi (pakollinen): Input, Enter submittoi.
// - Eräpäivä (valinnainen, smart default TÄNÄÄN): SegmentedControl
//   [Tänään | Huomenna | Ei päivää] — ei kalenteria tähän (Keep it Simple).
// - T105: Prioriteetti (valinnainen, oletus Normaali): SegmentedControl
//   [Matala | Normaali | Korkea] — yksi valinnainen napautus, ei pakota
//   monimutkaisuutta (§21). Prioriteetti vaikuttaa järjestykseen muttei
//   piilota deadlineja (inbox järjestää deadline ensin, T105).
// - Tallenna-nappi: loading-tila kirjoituksen ajan, domain-virheet kenttään.
// Onnistunut luonti kutsuu onCreated(task) — kutsuja (QuickAdd) sulkee ja
// ilmoittaa TodayView'lle (dataChanged-eventti), jolloin tehtävä näkyy HETI.
// Ei navigointia pois (Käyttäjä jatkaa siitä mihin jäi, §21).
import { t, tOptions, tTemplate } from "../language.tsx";
import { useEffect, useRef, useState } from "react";
import { Button, DatePicker, Input, SegmentedControl, Select, TimePicker } from "@lifeos/ui";
import {
  createTask,
  dueAtFromLocalParts,
  isoWeekday,
  localDueParts,
  type DataResult,
  type EntityRepository,
  type TaskServiceDeps,
} from "@lifeos/data";
import type { Project, Task, TaskRecurrence, Tag, UtcTimestamp } from "@lifeos/domain";

export type QuickDueOption = "today" | "tomorrow" | "custom" | "none";
export type QuickPriorityOption = "low" | "normal" | "high";
export type QuickRecurrenceOption = "none" | "daily" | "weekly" | "monthly";

// T106: tagien luonti lomakkeella — yhtenäiset säännöt (trim, tiivistys,
// dedupe case-insensitiivisesti, enintään 8 tagia / 40 merkkiä).
const MAX_TAG_NAME = 40;
const MAX_TAGS_PER_TASK = 8;

export function parseTagNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim().replace(/\s+/g, " ");
    if (name.length === 0 || name.length > MAX_TAG_NAME) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_TAGS_PER_TASK) {
      break;
    }
  }
  return names;
}

/** Etsi olemassa olevat tagit nimellä (case-insensitive), luo puuttuvat. */
export async function resolveTagIds(
  names: readonly string[],
  tags: EntityRepository<Tag>,
): Promise<DataResult<readonly string[]>> {
  const listed = await tags.list();
  if (!listed.ok) {
    return listed;
  }
  const byKey = new Map(
    listed.value
      .filter((tag) => tag.deletedAt === null)
      .map((tag) => [tag.name.toLowerCase(), tag]),
  );
  const ids: string[] = [];
  for (const name of names) {
    const existing = byKey.get(name.toLowerCase());
    if (existing !== undefined) {
      ids.push(existing.id);
      continue;
    }
    const created = await tags.create({ name, colorKey: null, deletedAt: null });
    if (!created.ok) {
      return created;
    }
    ids.push(created.value.id);
  }
  return { ok: true, value: ids };
}

export interface QuickTaskFormProps {
  readonly deps: TaskServiceDeps;
  /** Paikallispäivä-avain "YYYY-MM-DD" (TodayView'n kanssa sama laskenta). */
  readonly localDate: string;
  /** Offset minuutteina paikallispäivän muunnoksiin. */
  readonly timezoneOffsetMinutes: number;
  /** T106: tagirepositorio — puuttuvat tagit luodaan tallennuksen yhteydessä. */
  readonly tags: EntityRepository<Tag>;
  /** T107: projektirepositorio — valinnainen projektilinkitys (§5). */
  readonly projects: EntityRepository<Project>;
  readonly onCreated: (task: Task) => void;
  readonly onCancel?: (() => void) | undefined;
}

/** Eräpäivä-UTC hetkestä: paikallispäivä + klo 18:00 paikallista.
    T109: "custom" → null (kutsuja muodostaa dueAtFromLocalPartsilla). */
export function quickDueAt(
  option: QuickDueOption,
  nowIso: string,
  timezoneOffsetMinutes: number,
): UtcTimestamp | null {
  if (option === "none" || option === "custom") {
    return null;
  }
  const base = Date.parse(nowIso) + timezoneOffsetMinutes * 60_000;
  const day = new Date(base);
  if (option === "tomorrow") {
    day.setUTCDate(day.getUTCDate() + 1);
  }
  day.setUTCHours(18, 0, 0, 0);
  return new Date(day.getTime() - timezoneOffsetMinutes * 60_000).toISOString();
}

const DUE_OPTIONS = [
  { value: "today", label: "Tänään" },
  { value: "tomorrow", label: "Huomenna" },
  { value: "custom", label: "Valitse päivä" },
  { value: "none", label: "Ei päivää" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "low", label: "Matala" },
  { value: "normal", label: "Normaali" },
  { value: "high", label: "Korkea" },
] as const;

// T110: toistovaihtoehdot (sääntö johdetaan eräpäivästä deterministisesti).
const RECURRENCE_OPTIONS = [
  { value: "none", label: "Ei toistoa" },
  { value: "daily", label: "Päivittäin" },
  { value: "weekly", label: "Viikoittain" },
  { value: "monthly", label: "Kuukausittain" },
] as const;

// T111: arvioidut kestot (pomodoro-ystävälliset esivalinnat, §8).
const ESTIMATE_OPTIONS = [
  { value: "none", label: "Ei arviota" },
  { value: "10", label: "10 min" },
  { value: "25", label: "25 min" },
  { value: "45", label: "45 min" },
  { value: "90", label: "90 min" },
] as const;

export function QuickTaskForm({
  deps,
  localDate,
  timezoneOffsetMinutes,
  tags,
  projects,
  onCreated,
  onCancel,
}: QuickTaskFormProps): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<QuickDueOption>("today");
  // T109: mukautettu eräpäivä (pvm + klo) — muunnos offsetilla UTC:ksi.
  const [customDate, setCustomDate] = useState(localDate);
  const [customTime, setCustomTime] = useState("18:00");
  const [priority, setPriority] = useState<QuickPriorityOption>("normal");
  const [tagsRaw, setTagsRaw] = useState("");
  const [projectId, setProjectId] = useState("");
  const [recurrence, setRecurrence] = useState<QuickRecurrenceOption>("none");
  const [estimate, setEstimate] = useState("none");
  const [projectOptions, setProjectOptions] = useState<
    readonly { readonly value: string; readonly label: string }[]
  >([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // T107: projektivalinnan vaihtoehdot ladataan kerran avauksessa.
  useEffect(() => {
    const guard = { cancelled: false };
    void projects
      .list()
      .then((listed) => {
        if (guard.cancelled || !listed.ok) {
          return;
        }
        setProjectOptions(
          listed.value
            .filter((project) => project.deletedAt === null)
            .map((project) => ({ value: project.id, label: project.name })),
        );
      })
      .catch(() => undefined);
    return () => {
      guard.cancelled = true;
    };
  }, [projects]);
  const canSubmit = title.trim().length > 0 && !saving;

  // T101: tuplanapautus-suoja — nappi lukittuu HETI synkronisesti (ei vasta
  // awaitin jälkeen), jottei kaksi klikkausta tuota kahta service-kutsua.
  // StrictMode-tuplakutsu submitille on estetty samalla (saving-lippu).
  const savingRef = useRef(false);
  const submit = (): void => {
    if (savingRef.current) {
      return;
    }
    if (title.trim().length === 0) {
      setError(t("Anna tehtävälle nimi."));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    void save().finally(() => {
      savingRef.current = false;
    });
  };

  const save = async (): Promise<void> => {
    setError("");
    const nowIso = new Date().toISOString();
    let dueAt: UtcTimestamp | null;
    if (due === "custom") {
      // T109: paikallisosat → UTC kutsujan offsetilla; puuttuva/epävalidi →
      // kenttävirhe (ei arvausta).
      const converted = dueAtFromLocalParts(customDate, customTime, timezoneOffsetMinutes);
      if (converted === null) {
        setError(t("Valitse eräpäivä ja kelvollinen kellonaika."));
        return;
      }
      dueAt = converted;
    } else {
      dueAt = quickDueAt(due, nowIso, timezoneOffsetMinutes);
    }
    const tagNames = parseTagNames(tagsRaw);
    // T111: arvio kokonaisluvuksi ("none" → null).
    const estimateMinutes = estimate === "none" ? null : Number.parseInt(estimate, 10);
    // T110: toistosääntö eräpäivän paikallispäivästä (deterministinen —
    // viikonpäivä/kuukaudenpäivä johtuu suoraan eräpäivästä).
    let recurrenceRule: TaskRecurrence | null = null;
    if (recurrence !== "none") {
      const effectiveDateKey =
        dueAt !== null
          ? (localDueParts(dueAt, timezoneOffsetMinutes)?.dateKey ?? localDate)
          : localDate;
      recurrenceRule =
        recurrence === "daily"
          ? { kind: "daily", everyDays: 1 }
          : recurrence === "weekly"
            ? { kind: "weekly", everyWeeks: 1, weekdays: [isoWeekday(effectiveDateKey)] }
            : {
                kind: "monthly",
                everyMonths: 1,
                dayOfMonth: Number(effectiveDateKey.slice(8, 10)),
              };
    }
    let tagIds: readonly string[] = [];
    if (tagNames.length > 0) {
      const resolved = await resolveTagIds(tagNames, tags);
      if (!resolved.ok) {
        setError(resolved.error.userMessage);
        return;
      }
      tagIds = resolved.value;
    }
    try {
      const result = await createTask(deps, {
        title: title.trim(),
        dueAt,
        priority,
        tagIds,
        projectId: projectId === "" ? null : projectId,
        recurrence: recurrenceRule,
        estimateMinutes,
      });
      if (!result.ok) {
        setError(result.error.userMessage);
        return;
      }
      setTitle("");
      setDue("today");
      setCustomDate(localDate);
      setCustomTime("18:00");
      setPriority("normal");
      setTagsRaw("");
      setProjectId("");
      setRecurrence("none");
      setEstimate("none");
      onCreated(result.value);
    } catch {
      setError(t("Tallennus epäonnistui. Yritä uudelleen."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      data-testid="quick-task-form"
      aria-label={t("Uusi tehtävä")}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        label={t("Tehtävän nimi")}
        placeholder={t("Esim. Osta maitoa")}
        value={title}
        error={error === "" ? undefined : t(error)}
        disabled={saving}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      <SegmentedControl
        label={t("Eräpäivä")}
        hint={tTemplate("Oletus tänään ({{0}})", [localDate])}
        options={tOptions([...DUE_OPTIONS])}
        value={due}
        onOptionChange={(value) => {
          if (value === "today" || value === "tomorrow" || value === "custom" || value === "none") {
            setDue(value);
          }
        }}
      />
      {due === "custom" ? (
        <div>
          <DatePicker
            label={t("Eräpäivä")}
            value={customDate}
            disabled={saving}
            onChange={(event) => {
              setCustomDate(event.target.value);
            }}
          />
          <TimePicker
            label={t("Kellonaika")}
            hint={t("Oletus 18:00")}
            value={customTime}
            disabled={saving}
            onChange={(event) => {
              setCustomTime(event.target.value);
            }}
          />
        </div>
      ) : null}
      <SegmentedControl
        label={t("Prioriteetti")}
        hint={t("Oletus normaali — korkea ei piilota muiden deadlineja.")}
        options={tOptions([...PRIORITY_OPTIONS])}
        value={priority}
        onOptionChange={(value) => {
          if (value === "low" || value === "normal" || value === "high") {
            setPriority(value);
          }
        }}
      />
      <Input
        label={t("Tagit (valinnainen)")}
        placeholder={t("esim. työ, asiakas")}
        value={tagsRaw}
        disabled={saving}
        onChange={(event) => {
          setTagsRaw(event.target.value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      {projectOptions.length > 0 ? (
        <Select
          label={t("Projekti (valinnainen)")}
          placeholder={t("Ei projektia")}
          options={tOptions([...projectOptions])}
          value={projectId}
          disabled={saving}
          onChange={(event) => {
            setProjectId(event.target.value);
          }}
        />
      ) : null}
      <Select
        label={t("Toisto")}
        hint={t("Toistuva tehtävä luo uuden instanssin valmistuessa.")}
        options={tOptions([...RECURRENCE_OPTIONS])}
        value={recurrence}
        disabled={saving}
        onChange={(event) => {
          if (
            event.target.value === "none" ||
            event.target.value === "daily" ||
            event.target.value === "weekly" ||
            event.target.value === "monthly"
          ) {
            setRecurrence(event.target.value);
          }
        }}
      />
      <Select
        label={t("Arvio (valinnainen)")}
        hint={t("Näytetään suunnittelussa ja timebox-ehdotuksessa.")}
        options={tOptions([...ESTIMATE_OPTIONS])}
        value={estimate}
        disabled={saving}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "none" || Number.parseInt(value, 10) > 0) {
            setEstimate(value);
          }
        }}
      />
      <p>
        <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>
          {t("Tallenna tehtävä")}
        </Button>{" "}
        {onCancel !== undefined ? (
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              onCancel();
            }}
          >
            {t("Peruuta")}
          </Button>
        ) : null}
      </p>
    </form>
  );
}
