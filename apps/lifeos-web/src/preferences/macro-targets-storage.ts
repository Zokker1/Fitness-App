import { DEFAULT_MACRO_TARGETS, validateMacroTargets } from "@lifeos/domain";
import type { MacroTargets } from "@lifeos/domain";

export const LOCAL_MACRO_TARGETS_KEY = "lifeos-macro-targets";

/** Muistipohjaisen tilan ravintotavoitteet; tallenteet validoidaan domain-säännöillä. */
export function readLocalMacroTargets(): MacroTargets {
  const raw = window.localStorage.getItem(LOCAL_MACRO_TARGETS_KEY);
  if (raw === null) {
    return { ...DEFAULT_MACRO_TARGETS };
  }
  const validated = validateMacroTargets(JSON.parse(raw) as unknown);
  if (!validated.ok) {
    throw new Error(validated.error.message);
  }
  return validated.value;
}

/** Tallentaa vain domain-validoinnin läpäisseet ravintotavoitteet. */
export function writeLocalMacroTargets(targets: MacroTargets): void {
  const validated = validateMacroTargets(targets);
  if (!validated.ok) {
    throw new Error(validated.error.message);
  }
  window.localStorage.setItem(LOCAL_MACRO_TARGETS_KEY, JSON.stringify(validated.value));
}
