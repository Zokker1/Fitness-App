// T247: tarkista mood-checkinin asteikot myös data-rajalla riippumatta siitä,
// tuleeko syöte lomakkeesta vai muusta kutsujasta.
import type { MoodCheckin, MoodCheckinScales } from "@lifeos/domain";
import { validateMoodCheckinScales } from "@lifeos/domain";
import { invalidInput, type DataResult } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

export interface MoodCheckinServiceDeps {
  readonly moodCheckins: EntityRepository<MoodCheckin>;
}

export interface CreateMoodCheckinInput extends MoodCheckinScales {
  readonly checkedAt: MoodCheckin["checkedAt"];
  readonly note: string | null;
}

export async function createMoodCheckinService(
  deps: MoodCheckinServiceDeps,
  input: CreateMoodCheckinInput,
): Promise<DataResult<MoodCheckin>> {
  const scales = validateMoodCheckinScales(input);
  if (!scales.ok) {
    return {
      ok: false,
      error: invalidInput("data.mood-checkin.scale", scales.error.message),
    };
  }
  if (input.note !== null && (typeof input.note !== "string" || input.note.length > 500)) {
    return {
      ok: false,
      error: invalidInput("data.mood-checkin.note", "Muistiinpano voi olla enintään 500 merkkiä."),
    };
  }
  return deps.moodCheckins.create({
    checkedAt: input.checkedAt,
    ...scales.value,
    note: input.note,
  });
}
