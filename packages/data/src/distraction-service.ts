// T167: kirjaa fokuksen aikana mieleen tuleva ajatus istuntoon pysyvästi.
// Palvelu sallii kirjauksen vain käynnissä olevaan tai tauolla olevaan
// sessioon, eikä muuta ajastimen tai session tilaa.

import type { Distraction, FocusSession } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

export interface DistractionServiceDeps {
  readonly clock: Clock;
  readonly sessions: EntityRepository<FocusSession>;
  readonly distractions: EntityRepository<Distraction>;
}

export interface RecordDistractionInput {
  readonly focusSessionId: string;
  readonly note: string;
}

export async function recordFocusDistraction(
  deps: DistractionServiceDeps,
  input: RecordDistractionInput,
): Promise<DataResult<Distraction>> {
  const note = input.note.trim();
  if (note.length === 0) {
    return {
      ok: false,
      error: invalidInput(
        "data.distraction.validation.empty-note",
        "Kirjaa ensin ajatus, jonka haluat laittaa sivuun.",
      ),
    };
  }

  const focusSessionId = input.focusSessionId.trim();
  if (focusSessionId.length === 0) {
    return {
      ok: false,
      error: invalidInput(
        "data.distraction.validation.empty-session-id",
        "Fokusistuntoa ei löytynyt. Aloita fokus uudelleen.",
      ),
    };
  }

  const session = await deps.sessions.getById(focusSessionId);
  if (!session.ok) {
    return session;
  }
  if (session.value.phase !== "running" && session.value.phase !== "paused") {
    return {
      ok: false,
      error: invalidInput(
        "data.distraction.validation.session-not-active",
        "Ajatuksen voi kirjata käynnissä olevaan tai tauolla olevaan fokusistuntoon.",
      ),
    };
  }

  return deps.distractions.create({
    focusSessionId: session.value.id,
    notedAt: deps.clock.nowIso(),
    note,
  });
}
