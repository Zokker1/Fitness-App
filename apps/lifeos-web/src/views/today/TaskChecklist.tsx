// T108: tehtävän muistilista (§5 checklist/subtasks).
// Kriteeri: alitehtävät järjestettävissä + completion-logiikka testattu.
// - Suljettu: "Muistilista (n/m)" -toggle (progress rehellisenä lukuna).
// - Auki: alitehtävät checkboxein (done itsenäinen — ei auto-sulje
//   päätehtävää §51), ylös/alas-painikkeet (näppäimistö ✓), raahauskahva
//   (T113: Pointer Events — hiiri + touch sama polku) ja poisto/lisäys.
// TIEDOT: taskChecklistItems-repo useData:n kautta; onChanged → kutsujan
// refresh (sama kaava kuin muissa näkymissä).
import { t, tTemplate } from "../../language.tsx";
import { useRef, useState } from "react";
import { Button, Checkbox, IconButton, Input } from "@lifeos/ui";
import type { TaskChecklistItem } from "@lifeos/domain";
import {
  checklistProgress,
  moveChecklistItem,
  nextChecklistSortOrder,
  parseStepTitles,
  reorderChecklistItems,
  sortChecklistItems,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";

export interface TaskChecklistProps {
  readonly taskId: string;
  readonly items: readonly TaskChecklistItem[];
  readonly onChanged: () => void;
}

export function TaskChecklist({ taskId, items, onChanged }: TaskChecklistProps): React.JSX.Element {
  const { taskChecklistItems } = useData();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const sorted = sortChecklistItems(items.filter((item) => item.deletedAt === null));
  // T113: raahaus — optimistinen järjestys vedon ajaksi + rivireferenssit
  // kohteen laskentaan (pointerY vs. rivien keskipisteet).
  const [dragOrder, setDragOrder] = useState<readonly string[] | null>(null);
  const dragState = useRef<{ readonly id: string; readonly pointerId: number } | null>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const progress = checklistProgress(items);
  const displayItems =
    dragOrder === null
      ? sorted
      : dragOrder
          .map((id) => sorted.find((item) => item.id === id))
          .filter((item): item is TaskChecklistItem => item !== undefined);

  const beginDrag = (id: string, event: React.PointerEvent<HTMLButtonElement>): void => {
    if (dragOrder !== null) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    dragState.current = { id, pointerId: event.pointerId };
    setDragOrder(sorted.map((item) => item.id));
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const state = dragState.current;
    const order = dragOrder;
    if (state === null || order === null || state.pointerId !== event.pointerId) {
      return;
    }
    // Kohde = rivien lukumäärä, joiden keskipiste on osoittimen yläpuolella.
    let target = 0;
    for (const id of order) {
      const row = rowRefs.current.get(id);
      if (row === undefined) {
        continue;
      }
      const rect = row.getBoundingClientRect();
      if (event.clientY > rect.top + rect.height / 2) {
        target += 1;
      }
    }
    const from = order.indexOf(state.id);
    const to = Math.max(0, Math.min(target, order.length - 1));
    if (from === to) {
      return;
    }
    const next = [...order];
    const moved = next[from];
    if (moved === undefined) {
      return;
    }
    next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragOrder(next);
  };

  const endDrag = async (event: React.PointerEvent<HTMLButtonElement>): Promise<void> => {
    const state = dragState.current;
    const order = dragOrder;
    dragState.current = null;
    if (state === null || order === null || state.pointerId !== event.pointerId) {
      setDragOrder(null);
      return;
    }
    const toIndex = order.indexOf(state.id);
    setDragOrder(null);
    const result = reorderChecklistItems(items, state.id, toIndex);
    if (!result.ok || result.updates.length === 0) {
      return;
    }
    for (const update of result.updates) {
      await taskChecklistItems.update(update.id, { sortOrder: update.sortOrder });
    }
    onChanged();
  };

  const cancelDrag = (): void => {
    dragState.current = null;
    setDragOrder(null);
  };

  const add = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || saving) {
      return;
    }
    setSaving(true);
    try {
      const created = await taskChecklistItems.create({
        taskId,
        title: trimmed,
        done: false,
        sortOrder: nextChecklistSortOrder(items),
        deletedAt: null,
      });
      if (created.ok) {
        setTitle("");
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (item: TaskChecklistItem): Promise<void> => {
    const updated = await taskChecklistItems.update(item.id, { done: !item.done });
    if (updated.ok) {
      onChanged();
    }
  };

  const move = async (item: TaskChecklistItem, direction: "up" | "down"): Promise<void> => {
    const result = moveChecklistItem(items, item.id, direction);
    if (!result.ok) {
      return;
    }
    for (const update of result.updates) {
      await taskChecklistItems.update(update.id, { sortOrder: update.sortOrder });
    }
    onChanged();
  };

  const remove = async (item: TaskChecklistItem): Promise<void> => {
    const removed = await taskChecklistItems.remove(item.id);
    if (removed.ok) {
      onChanged();
    }
  };

  // T116: pilkkominen nopeasti — monta vaihetta kerralla (pilkku tai
  // rivinvaihto erottimena), sortOrder jatkuu peräkkäin, yksi refresh lopussa.
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitRaw, setSplitRaw] = useState("");
  const [splitSaving, setSplitSaving] = useState(false);
  const splitTitles = parseStepTitles(splitRaw);

  const addSteps = async (): Promise<void> => {
    if (splitTitles.length === 0 || splitSaving) {
      return;
    }
    setSplitSaving(true);
    try {
      let sortOrder = nextChecklistSortOrder(items);
      for (const stepTitle of splitTitles) {
        const created = await taskChecklistItems.create({
          taskId,
          title: stepTitle,
          done: false,
          sortOrder,
          deletedAt: null,
        });
        if (!created.ok) {
          break;
        }
        sortOrder += 1;
      }
      setSplitRaw("");
      setSplitOpen(false);
      onChanged();
    } finally {
      setSplitSaving(false);
    }
  };

  return (
    <div data-testid={`checklist-${taskId}`} data-ui="task-checklist">
      <Button
        variant="ghost"
        data-testid={`checklist-toggle-${taskId}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {t("Muistilista (")}
        {String(progress.done)}/{String(progress.total)})
      </Button>
      {open ? (
        <div data-testid={`checklist-editor-${taskId}`}>
          <ul
            data-ui="card-log-list"
            data-checklist-dragging={dragOrder !== null ? "true" : undefined}
          >
            {displayItems.map((item, index) => (
              <li
                key={item.id}
                data-ui="card-log-row"
                data-testid={`checklist-item-${item.id}`}
                ref={(element) => {
                  if (element !== null) {
                    rowRefs.current.set(item.id, element);
                  } else {
                    rowRefs.current.delete(item.id);
                  }
                }}
              >
                <div>
                  <IconButton
                    icon="more"
                    label={tTemplate("Raahaa järjestyksessä: {{0}}", [item.title])}
                    data-testid={`checklist-drag-${item.id}`}
                    data-checklist-handle=""
                    onPointerDown={(event) => {
                      beginDrag(item.id, event);
                    }}
                    onPointerMove={moveDrag}
                    onPointerUp={(event) => {
                      void endDrag(event);
                    }}
                    onPointerCancel={cancelDrag}
                  />
                  <Checkbox
                    id={`checklist-check-${item.id}`}
                    data-ui="task-checkbox"
                    data-testid={`checklist-check-${item.id}`}
                    checked={item.done}
                    aria-label={tTemplate("Merkitse alitehtävä valmiiksi: {{0}}", [item.title])}
                    onChange={() => void toggle(item)}
                  >
                    {item.title}
                  </Checkbox>
                </div>
                <div>
                  <IconButton
                    icon="chevron"
                    label={tTemplate("Siirrä ylös: {{0}}", [item.title])}
                    data-testid={`checklist-up-${item.id}`}
                    disabled={index === 0}
                    onClick={() => void move(item, "up")}
                  />
                  <IconButton
                    icon="chevron"
                    label={tTemplate("Siirrä alas: {{0}}", [item.title])}
                    data-testid={`checklist-down-${item.id}`}
                    data-checklist-move="down"
                    disabled={index === displayItems.length - 1}
                    onClick={() => void move(item, "down")}
                  />
                  <IconButton
                    icon="close"
                    label={tTemplate("Poista alitehtävä: {{0}}", [item.title])}
                    data-testid={`checklist-remove-${item.id}`}
                    onClick={() => void remove(item)}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div>
            <Input
              label={t("Uusi alitehtävä")}
              placeholder={t("Esim. Osta harja")}
              value={title}
              disabled={saving}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />{" "}
            <Button
              variant="secondary"
              data-testid={`checklist-add-${taskId}`}
              loading={saving}
              disabled={title.trim().length === 0 || saving}
              onClick={() => void add()}
            >
              {t("Lisää")}
            </Button>
          </div>
          <p>
            <Button
              variant="ghost"
              data-testid={`checklist-split-toggle-${taskId}`}
              aria-expanded={splitOpen}
              onClick={() => {
                setSplitOpen((value) => !value);
              }}
            >
              {t("Pilko ison tehtävän vaiheiksi")}
            </Button>
          </p>
          {splitOpen ? (
            <div data-testid={`checklist-split-${taskId}`}>
              <Input
                label={t("Ison tehtävän vaiheet")}
                hint={t("Erottele vaiheet pilkulla (enintään 12).")}
                placeholder={t("Esim. mittaa, tilaa, asenna")}
                value={splitRaw}
                disabled={splitSaving}
                onChange={(event) => {
                  setSplitRaw(event.target.value);
                }}
              />
              <p>
                <Button
                  variant="secondary"
                  data-testid={`checklist-split-add-${taskId}`}
                  loading={splitSaving}
                  disabled={splitTitles.length === 0 || splitSaving}
                  onClick={() => void addSteps()}
                >
                  {t("Lisää vaiheet")}
                </Button>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
