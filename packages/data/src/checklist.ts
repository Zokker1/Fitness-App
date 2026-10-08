// T108: checklist/subtasks-logiikka (pure data-funktio, ei IO:ta).
// Kriteeri: "Alitehtävät ovat järjestettävissä ja completion-logiikka
// testattu." (§5 checklist/subtasks)
// - Järjestys: sortOrder nouseva, tasatilanteissa createdAt (deterministinen).
// - Siirto (ylös/alas): naapurivaihto sortOrder-arvoja vaihtamalla — toimii
//   myös duplikaatti-arvoilla (vertailu displayOrder-avaimella).
// - Rajat: ensimmäinen ei nouse, viimeinen ei laske (boundary), tuntematon
//   id → not-found. Ei poikkeusta ulos.
// - Completion: item.done itsenäinen totuusarvo — emme auto-sulje
//   päätehtävää (käyttäjä päättää; ei oletuksia §51). Progress lasketaan
//   rehellisesti valmiiden osuutena.
import type { TaskChecklistItem } from "@lifeos/domain";

export type ChecklistMoveDirection = "up" | "down";

export interface ChecklistSortUpdate {
  readonly id: string;
  readonly sortOrder: number;
}

export type ChecklistMoveResult =
  | { readonly ok: true; readonly updates: readonly ChecklistSortUpdate[] }
  | { readonly ok: false; readonly error: "not-found" | "boundary" };

export interface ChecklistProgress {
  readonly done: number;
  readonly total: number;
}

/** Näyttöjärjestys: sortOrder, sitten createdAt (vakio tasapelissä). */
export function sortChecklistItems(
  items: readonly TaskChecklistItem[],
): readonly TaskChecklistItem[] {
  return [...items].sort((a, b) => {
    const aKey = `${String(a.sortOrder).padStart(12, "0")}:${a.createdAt}`;
    const bKey = `${String(b.sortOrder).padStart(12, "0")}:${b.createdAt}`;
    if (aKey === bKey) {
      return 0;
    }
    return aKey < bKey ? -1 : 1;
  });
}

/** Siirrä alitehtävä ylös/alas — palauttaa naapureiden uudet sortOrderit. */
export function moveChecklistItem(
  items: readonly TaskChecklistItem[],
  itemId: string,
  direction: ChecklistMoveDirection,
): ChecklistMoveResult {
  const sorted = sortChecklistItems(items);
  const index = sorted.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return { ok: false, error: "not-found" };
  }
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  const moving = sorted[index];
  const target = sorted[targetIndex];
  if (moving === undefined || target === undefined) {
    return { ok: false, error: "boundary" };
  }
  return {
    ok: true,
    updates: [
      { id: moving.id, sortOrder: target.sortOrder },
      { id: target.id, sortOrder: moving.sortOrder },
    ],
  };
}

/** Rehellinen progress: valmiit / kaikki (tombstonet suodatettu kutsujalla). */
export function checklistProgress(items: readonly TaskChecklistItem[]): ChecklistProgress {
  return { done: items.filter((item) => item.done).length, total: items.length };
}

/** Seuraava vapaa sortOrder (max + 1; tyhjä lista → 0). */
export function nextChecklistSortOrder(items: readonly TaskChecklistItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0);
}

// T116: tehtävän pilkkominen nopeasti — käyttäjä kirjoittaa useamman vaiheen
// kerralla (pilkku tai rivinvaihto erottimena); sama siisti sääntö kuin
// tageissa T106: trim, välilyöntitiivistys, dedupe case-insensitiivisesti.
export const MAX_STEP_TITLE = 80;
export const MAX_STEPS_PER_SPLIT = 12;

export function parseStepTitles(raw: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const part of raw.split(/\r?\n|,/)) {
    const title = part.trim().replace(/\s+/g, " ");
    if (title.length === 0 || title.length > MAX_STEP_TITLE) {
      continue;
    }
    const key = title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    titles.push(title);
    if (titles.length >= MAX_STEPS_PER_SPLIT) {
      break;
    }
  }
  return titles;
}

/** T113: siirrä alitehtävä kohdeindeksiin (raahaus) — sortOrderit
    numeroidaan uudelleen 0..n-1 näkyvässä järjestyksessä; päivitetään vain
    muuttuneet. toIndexclampataan [0, n-1]; tuntematon id → not-found. */
export function reorderChecklistItems(
  items: readonly TaskChecklistItem[],
  itemId: string,
  toIndex: number,
): ChecklistMoveResult {
  const sorted = sortChecklistItems(items);
  const fromIndex = sorted.findIndex((item) => item.id === itemId);
  if (fromIndex === -1) {
    return { ok: false, error: "not-found" };
  }
  const clamped = Math.max(0, Math.min(toIndex, sorted.length - 1));
  const reordered = [...sorted];
  const moving = reordered[fromIndex];
  if (moving === undefined) {
    return { ok: false, error: "not-found" };
  }
  reordered.splice(fromIndex, 1);
  reordered.splice(clamped, 0, moving);
  const updates: ChecklistSortUpdate[] = [];
  reordered.forEach((item, index) => {
    if (item.sortOrder !== index) {
      updates.push({ id: item.id, sortOrder: index });
    }
  });
  return { ok: true, updates };
}
