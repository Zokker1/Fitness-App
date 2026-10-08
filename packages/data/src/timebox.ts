// T111: arvioitu kesto + timebox-ehdotus (pure data-funktio, ei IO:ta).
// Kriteeri: "Kesto näkyy suunnittelussa ja timebox-ehdotuksessa."
// - timeboxSuggestion: arvio → ehdotettu timebox (pyöristys 5 min:lle,
//   haarukka 5–120 min; ≤ 45 min yksi lohko, sitä suurempi jaetaan 25 min
//   pomodoro-paloihin §8 — 5 minuutin aloitus pysyy mahdollisena).
// - sumEstimateMinutes: rehellinen summa avoimista arvioista (nullit ja
//   tombstonet eivät lisää).
// - formatMinutes: fi-FI "45 min" / "1 t" / "1 t 5 min".
import type { Task } from "@lifeos/domain";

export interface TimeboxSuggestion {
  /** Ehdotettu lohkon pituus minuutteina (5–120, pyöristetty 5 min:lle). */
  readonly minutes: number;
  /** 1 = yksi lohko; muulloin 25 min pomodoro-palojen lukumäärä. */
  readonly chunks: number;
}

export function timeboxSuggestion(estimateMinutes: number): TimeboxSuggestion | null {
  if (!Number.isFinite(estimateMinutes) || estimateMinutes <= 0) {
    return null;
  }
  const rounded = Math.max(5, Math.round(estimateMinutes / 5) * 5);
  const capped = Math.min(rounded, 120);
  const chunks = capped <= 45 ? 1 : Math.ceil(capped / 25);
  return { minutes: capped, chunks };
}

/** Avoimien tehtävien arvioiden summa (nullit ohitetaan). */
export function sumEstimateMinutes(tasks: readonly Task[]): number {
  return tasks.reduce((total, task) => {
    const estimate = task.estimateMinutes;
    return typeof estimate === "number" && Number.isFinite(estimate) && estimate > 0
      ? total + estimate
      : total;
  }, 0);
}

/** fi-FI kestomääreet: "45 min", "1 t", "1 t 5 min". Epävalidi → null. */
export function formatMinutes(total: number): string | null {
  if (!Number.isFinite(total) || total < 0) {
    return null;
  }
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `${String(minutes)} min`;
  }
  if (minutes === 0) {
    return `${String(hours)} t`;
  }
  return `${String(hours)} t ${String(minutes)} min`;
}
