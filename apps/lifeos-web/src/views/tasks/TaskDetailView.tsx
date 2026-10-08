// T112: task detail -näkymä (§5). Kriteeri: kaikki kentät, historia ja
// linkitykset ovat selkeästi muokattavissa.
// - Kentät: otsikko, muistiinpano, prioriteetti, eräpäivä+klo (DatePicker/
//   TimePicker — tyhjä päivä = ei deadlinea §50), arvio, toisto, projekti,
//   tagit (pilkuilla — sama resolveTagIds kuin Quick Taskissa, T106).
// - Historia: luotu / päivitetty (versio) / valmistui / avattu uudelleen —
//   fi-FI, ei muokattavaa (alkuperäinen historia säilyy §6).
// - Muistilista renderöidään TaskChecklistilla (T108).
// TIEDOT: useData; tallennus updateTaskServicellä (T112) →
// lifeos:data-changed → inbox/projektit päivittyvät.
import { t, tOptions, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Display,
  EmptyState,
  Input,
  Meta,
  SectionHeading,
  SegmentedControl,
  Select,
  Skeleton,
  TimePicker,
} from "@lifeos/ui";
import {
  dueAtFromLocalParts,
  hasRecurrence,
  isoWeekday,
  localDueParts,
  timeboxSuggestion,
  updateTaskService,
} from "@lifeos/data";
import type { Project, Task, TaskChecklistItem, TaskRecurrence } from "@lifeos/domain";
import { useData } from "../../dataContext.tsx";
import { parseTagNames, resolveTagIds } from "../../quickadd/QuickTaskForm.tsx";
import { TaskChecklist } from "../today/TaskChecklist.tsx";

const PRIORITY_OPTIONS = [
  { value: "low", label: "Matala" },
  { value: "normal", label: "Normaali" },
  { value: "high", label: "Korkea" },
] as const;

const RECURRENCE_OPTIONS = [
  { value: "none", label: "Ei toistoa" },
  { value: "daily", label: "Päivittäin" },
  { value: "weekly", label: "Viikoittain" },
  { value: "monthly", label: "Kuukausittain" },
] as const;

const ESTIMATE_OPTIONS = [
  { value: "none", label: "Ei arviota" },
  { value: "10", label: "10 min" },
  { value: "25", label: "25 min" },
  { value: "45", label: "45 min" },
  { value: "90", label: "90 min" },
] as const;

const RECURRENCE_LABELS: Readonly<Record<NonNullable<Task["recurrence"]>["kind"], string>> = {
  daily: "päivittäin",
  weekly: "viikoittain",
  monthly: "kuukausittain",
  custom: "mukautetusti",
};

function formatStamp(stamp: string | null): string | null {
  if (stamp === null || Number.isNaN(Date.parse(stamp))) {
    return null;
  }
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(stamp));
}

function localDayKey(): string {
  const offset = -new Date().getTimezoneOffset();
  return new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
}

function estimateHint(estimate: string): string | undefined {
  if (estimate === "none") {
    return undefined;
  }
  const suggestion = timeboxSuggestion(Number.parseInt(estimate, 10));
  if (suggestion === null) {
    return undefined;
  }
  return suggestion.chunks === 1
    ? `Timebox-ehdotus: ${String(suggestion.minutes)} min`
    : `Timebox-ehdotus: ${String(suggestion.chunks)} × 25 min`;
}

function formatActualFocusTime(seconds: number): string {
  if (seconds < 60) {
    return "alle 1 min";
  }
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${String(minutes)} min`;
  }
  return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`;
}

export interface TaskDetailViewProps {
  /** Muokattavan tehtävän id (esim. ?task=<id> TaskRoutesta). */
  readonly taskId: string;
  /** Paluu inboxiin (poistaa task-parametrin, säilyttää muut suodattimet). */
  readonly onBack: () => void;
}

export function TaskDetailView({ taskId, onBack }: TaskDetailViewProps): React.JSX.Element {
  const { tasks, tags, projects, taskChecklistItems } = useData();
  const [task, setTask] = useState<Task | undefined>(undefined);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projectOptions, setProjectOptions] = useState<readonly Project[]>([]);
  const [checklist, setChecklist] = useState<readonly TaskChecklistItem[]>([]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("normal");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("18:00");
  const [estimate, setEstimate] = useState("none");
  const [recurrence, setRecurrence] = useState("none");
  const [projectId, setProjectId] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    const [fetched, listedTags, listedProjects, listedChecklist] = await Promise.all([
      tasks.getById(taskId),
      tags.list(),
      projects.list(),
      taskChecklistItems.list(),
    ]);
    if (!fetched.ok) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const current = fetched.value;
    setTask(current);
    setTitle(current.title);
    setNotes(current.notes ?? "");
    setPriority(current.priority);
    const offset = -new Date().getTimezoneOffset();
    const dueParts = current.dueAt !== null ? localDueParts(current.dueAt, offset) : null;
    setDueDate(dueParts?.dateKey ?? "");
    setDueTime(dueParts?.time ?? "18:00");
    setEstimate(
      typeof current.estimateMinutes === "number" && current.estimateMinutes > 0
        ? String(current.estimateMinutes)
        : "none",
    );
    setRecurrence(hasRecurrence(current) ? current.recurrence.kind : "none");
    setProjectId(current.projectId ?? "");
    if (listedTags.ok) {
      const nameById = new Map<string, string>();
      for (const tag of listedTags.value) {
        if (tag.deletedAt === null) {
          nameById.set(tag.id, tag.name);
        }
      }
      setTagsRaw(
        current.tagIds
          .map((id) => nameById.get(id))
          .filter((name): name is string => name !== undefined)
          .join(", "),
      );
    }
    if (listedProjects.ok) {
      setProjectOptions(listedProjects.value.filter((project) => project.deletedAt === null));
    }
    if (listedChecklist.ok) {
      setChecklist(
        listedChecklist.value.filter((item) => item.deletedAt === null && item.taskId === taskId),
      );
    }
    setLoading(false);
  }, [tasks, tags, projects, taskChecklistItems, taskId]);

  useEffect(() => {
    const guard = { cancelled: false };
    void reload()
      .catch(() => undefined)
      .finally(() => {
        if (!guard.cancelled) {
          setLoading(false);
        }
      });
    return () => {
      guard.cancelled = true;
    };
  }, [reload]);

  const save = async (): Promise<void> => {
    setError("");
    setSaved(false);
    const offset = -new Date().getTimezoneOffset();
    let dueAt: Task["dueAt"] = null;
    if (dueDate !== "") {
      const converted = dueAtFromLocalParts(dueDate, dueTime, offset);
      if (converted === null) {
        setError(t("Valitse kelvollinen eräpäivä ja kellonaika."));
        return;
      }
      dueAt = converted;
    }
    const estimateMinutes = estimate === "none" ? null : Number.parseInt(estimate, 10);
    const tagIds = await resolveTagIds(parseTagNames(tagsRaw), tags);
    if (!tagIds.ok) {
      setError(tagIds.error.userMessage);
      return;
    }
    const ruleBaseDate = dueDate !== "" ? dueDate : localDayKey();
    const recurrenceRule: TaskRecurrence | null =
      recurrence === "none"
        ? null
        : recurrence === "daily"
          ? { kind: "daily", everyDays: 1 }
          : recurrence === "weekly"
            ? { kind: "weekly", everyWeeks: 1, weekdays: [isoWeekday(ruleBaseDate)] }
            : { kind: "monthly", everyMonths: 1, dayOfMonth: Number(ruleBaseDate.slice(8, 10)) };
    setSaving(true);
    try {
      const updated = await updateTaskService(
        { clock: { nowIso: () => new Date().toISOString() }, tasks },
        taskId,
        {
          title: title.trim(),
          notes: notes.trim() === "" ? null : notes,
          priority,
          dueAt,
          estimateMinutes,
          projectId: projectId === "" ? null : projectId,
          tagIds: tagIds.value,
          recurrence: recurrenceRule,
        },
      );
      if (!updated.ok) {
        setError(updated.error.userMessage);
        return;
      }
      setSaved(true);
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      void reload().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section aria-label={t("Tehtävän tiedot")} data-testid="task-detail">
        <Display>{t("Tehtävä")}</Display>
        <Skeleton lines={4} label={t("Ladataan tehtävää…")} />
      </section>
    );
  }
  if (notFound || task === undefined) {
    return (
      <section aria-label={t("Tehtävän tiedot")} data-testid="task-detail">
        <Display>{t("Tehtävä")}</Display>
        <EmptyState
          icon="alert"
          title={t("Tehtävää ei löytynyt.")}
          hint={t("Se on saatettu poistaa. Palaa tehtävälistaan.")}
          action={
            <Button variant="secondary" onClick={onBack}>
              {t("Takaisin tehtäviin")}
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section aria-label={t("Tehtävän tiedot")} data-testid="task-detail">
      <Display>{t("Tehtävän tiedot")}</Display>
      <Meta>
        {task.status === "done" ? t("Valmis") : t("Avoin")} {t(" — versio ")}
        {String(task.version)}
      </Meta>
      {error !== "" ? (
        <Alert tone="warning" title={t("Tallennus ei onnistunut")}>
          <p>{t(error)}</p>
        </Alert>
      ) : null}
      {saved ? (
        <div data-testid="task-detail-saved">
          <Meta>{t("Muutokset tallennettu.")}</Meta>
        </div>
      ) : null}
      <Card heading={t("Kentät")}>
        <Input
          label={t("Otsikko")}
          value={title}
          disabled={saving}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <Input
          label={t("Muistiinpano")}
          value={notes}
          disabled={saving}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
        <SegmentedControl
          label={t("Prioriteetti")}
          options={tOptions([...PRIORITY_OPTIONS])}
          value={priority}
          onOptionChange={(value) => {
            if (value === "low" || value === "normal" || value === "high") {
              setPriority(value);
            }
          }}
        />
        <DatePicker
          label={t("Eräpäivä")}
          hint={t("Tyhjä = ei deadlinea")}
          value={dueDate}
          onChange={(event) => {
            setDueDate(event.target.value);
          }}
        />
        <TimePicker
          label={t("Kellonaika")}
          value={dueTime}
          onChange={(event) => {
            setDueTime(event.target.value);
          }}
        />
        <Select
          label={t("Arvio")}
          options={tOptions([...ESTIMATE_OPTIONS])}
          {...(estimateHint(estimate) !== undefined ? { hint: estimateHint(estimate) } : {})}
          value={estimate}
          onChange={(event) => {
            setEstimate(event.target.value);
          }}
        />
        <Select
          label={t("Toisto")}
          options={tOptions([...RECURRENCE_OPTIONS])}
          value={recurrence}
          onChange={(event) => {
            setRecurrence(event.target.value);
          }}
        />
        <Select
          label={t("Projekti")}
          placeholder={t("Ei projektia")}
          options={tOptions(
            projectOptions.map((project) => ({
              value: project.id,
              label: project.name,
            })),
          )}
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
          }}
        />
        <Input
          label={t("Tagit (pilkuilla)")}
          value={tagsRaw}
          onChange={(event) => {
            setTagsRaw(event.target.value);
          }}
        />
        <p>
          <Button
            variant="primary"
            loading={saving}
            disabled={title.trim().length === 0 || saving}
            data-testid="task-detail-save"
            onClick={() => void save()}
          >
            {t("Tallenna muutokset")}
          </Button>{" "}
          <Button variant="ghost" data-testid="task-detail-back" onClick={onBack}>
            {t("Takaisin tehtäviin")}
          </Button>
        </p>
      </Card>
      <Card heading={t("Muistilista")}>
        <TaskChecklist
          taskId={taskId}
          items={checklist}
          onChanged={() => void reload().catch(() => undefined)}
        />
      </Card>
      <Card heading={t("Historia ja linkitykset")}>
        <SectionHeading>{t("Historia")}</SectionHeading>
        <Meta>
          {t("Luotu ")}
          {formatStamp(task.createdAt) ?? "—"}
        </Meta>
        {(task.actualSeconds ?? 0) > 0 ? (
          <Meta>
            {t("Fokus kirjattu: ")}
            {formatActualFocusTime(task.actualSeconds ?? 0)}
          </Meta>
        ) : null}
        <Meta>
          {t("Päivitetty")}
          {formatStamp(task.updatedAt) ?? "—"} {t(" (versio ")}
          {String(task.version)})
        </Meta>
        {task.completedAt !== null ? (
          <Meta>
            {t("Valmistui ")}
            {formatStamp(task.completedAt)}
          </Meta>
        ) : null}
        {task.reopenedAt !== null ? (
          <Meta>
            {t("Avattu uudelleen ")}
            {formatStamp(task.reopenedAt)}
          </Meta>
        ) : null}
        {hasRecurrence(task) ? (
          <Meta>
            {t("Toistuu: ")}
            {t(RECURRENCE_LABELS[task.recurrence.kind])}
          </Meta>
        ) : null}
        <SectionHeading>{t("Linkitykset")}</SectionHeading>
        <Meta>
          {t("Projekti:")}{" "}
          {projectId === ""
            ? t("ei projektia")
            : (projectOptions.find((p) => p.id === projectId)?.name ?? projectId)}
        </Meta>
        <Meta>
          {t("Tagit:")}{" "}
          {tagsRaw.trim() === ""
            ? t("ei tageja")
            : parseTagNames(tagsRaw)
                .map((name) => `#${name}`)
                .join(", ")}
        </Meta>
        <Meta>
          {t("Muistilista:")}
          {String(checklist.filter((item) => item.done).length)}/{String(checklist.length)}
        </Meta>
      </Card>
    </section>
  );
}
