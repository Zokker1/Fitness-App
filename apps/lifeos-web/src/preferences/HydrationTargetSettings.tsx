// T230: nestetavoitteen vapaaehtoinen asetus.
import { t } from "../language.tsx";
import { useEffect, useState } from "react";
import { Button, Card, NumberInput } from "@lifeos/ui";
import { HYDRATION_TARGET_ML_MAXIMUM } from "@lifeos/domain";
import { useHydrationTarget } from "./HydrationTargetContext.tsx";

export function HydrationTargetSettings(): React.JSX.Element {
  const { targetMilliliters, reminderTime, loading, error, reload, setSettings } =
    useHydrationTarget();
  const [draft, setDraft] = useState("");
  const [reminderDraft, setReminderDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(targetMilliliters === null ? "" : String(targetMilliliters));
    setReminderDraft(reminderTime ?? "");
  }, [targetMilliliters, reminderTime]);

  const normalized = draft.trim();
  const parsed = normalized === "" ? null : Number(normalized);
  const valid =
    normalized === "" ||
    (Number.isInteger(parsed) &&
      parsed !== null &&
      parsed >= 1 &&
      parsed <= HYDRATION_TARGET_ML_MAXIMUM);
  const dirty =
    (targetMilliliters === null ? normalized !== "" : normalized !== String(targetMilliliters)) ||
    (reminderTime ?? "") !== (parsed === null ? "" : reminderDraft);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    setSaving(true);
    setSaved(false);
    const didSave = await setSettings(parsed, parsed === null ? null : reminderDraft || null);
    setSaved(didSave);
    setSaving(false);
  };

  return (
    <Card heading={t("Nestetavoite ja muistutus")}>
      <div data-testid="hydration-target-settings">
        <p>
          {t(
            "Aseta halutessasi päivän juomatavoite ja aika, jolloin sen toteutuminen tarkistetaan.",
          )}
        </p>
        {loading ? <p role="status">{t("Ladataan nestetavoitetta…")}</p> : null}
        {!loading ? (
          <form
            noValidate
            onSubmit={(event) => {
              void save(event);
            }}
          >
            <NumberInput
              label={t("Päivän tavoite (ml)")}
              min={1}
              max={HYDRATION_TARGET_ML_MAXIMUM}
              step={50}
              value={draft}
              disabled={saving}
              aria-invalid={!valid}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaved(false);
              }}
            />
            {!valid ? (
              <p role="alert">
                {t("Anna kokonaisluku välillä 1–")}
                {String(HYDRATION_TARGET_ML_MAXIMUM)} {t("ml.")}
              </p>
            ) : null}
            <label data-ui="hydration-reminder-time">
              {t("Tarkista tavoite klo")}
              <input
                type="time"
                data-ui="input"
                value={reminderDraft}
                disabled={saving || parsed === null}
                onChange={(event) => {
                  setReminderDraft(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <p data-ui="meta">
              {t(
                "Quick Water tarkistaa valittuna aikana tai sen jälkeen, jäikö kirjattu määrä tavoitteesta. Tarkistus tehdään Quick Waterin avautuessa ja sen ollessa näkyvissä; selainilmoituksia ei lähetetä.",
              )}
            </p>
            <p>
              <Button type="submit" variant="primary" loading={saving} disabled={!dirty || !valid}>
                {t("Tallenna")}
              </Button>
            </p>
            {saved ? <p role="status">{t("Nestetavoite tallennettiin.")}</p> : null}
          </form>
        ) : null}
        {error !== null ? (
          <div role="alert">
            <p>{t(error)}</p>
            <Button type="button" variant="ghost" onClick={() => void reload()}>
              {t("Yritä uudelleen")}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
