import { Card, Switch } from "@lifeos/ui";
import { ErrorCard } from "../errors/ErrorCard.tsx";
import { t } from "../language.tsx";
import { useAppLock } from "./AppLockContext.tsx";

export function AppLockSettings(): React.JSX.Element {
  const { enabled, loading, saving, error, reload, setEnabled } = useAppLock();
  return (
    <Card heading={t("Automaattinen lukitus")} data-testid="app-lock-settings">
      <Switch
        checked={enabled === true}
        disabled={loading || enabled === null || saving}
        data-testid="app-lock-toggle"
        aria-describedby="app-lock-hint"
        onChange={(event) => {
          void setEnabled(event.target.checked);
        }}
      >
        {t("Lukitse avain viiden minuutin käyttämättömyyden jälkeen")}
      </Switch>
      <p id="app-lock-hint">
        {t(
          "Aktiivinen avain lukitaan viiden minuutin käyttämättömyyden tai taustallaolon jälkeen.",
        )}
      </p>
      {error !== null ? <ErrorCard error={error} onRetry={() => void reload()} /> : null}
    </Card>
  );
}
