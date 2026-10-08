// T283: selainilmoitusluvan tila ja käyttäjän eksplisiittinen lupapyyntö.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NotificationPermissionState } from "@lifeos/capabilities";
import { Button } from "@lifeos/ui";
import { createBrowserCapabilities } from "../../adapters/index.ts";
import { fromCapabilityError, fromUnknown } from "../../errors/appError.ts";
import type { AppError } from "../../errors/appError.ts";
import { ErrorCard } from "../../errors/ErrorCard.tsx";
import { t } from "../../language.tsx";
import "./notification-permission.css";

function permissionStatusText(
  loading: boolean,
  unsupported: boolean,
  permission: NotificationPermissionState | null,
  hasError: boolean,
): string {
  if (loading) return t("Tarkistetaan selaimen ilmoituslupaa…");
  if (unsupported) {
    return t("Selain ei tue ilmoituksia. Sovelluksen sisäiset muistutukset toimivat edelleen.");
  }
  if (hasError) return t("Ilmoitusluvan tilan tarkistus epäonnistui. Voit yrittää uudelleen.");
  if (permission === "granted") {
    return t(
      "Selainilmoitukset ovat sallittuja. Voit muuttaa luvan myöhemmin selaimen sivustoasetuksista.",
    );
  }
  if (permission === "denied") {
    return t(
      "Selain on estänyt ilmoitukset. Muuta lupa tämän sivuston selaimen asetuksista. Sovelluksen sisäiset muistutukset toimivat edelleen.",
    );
  }
  return t(
    "Ilmoituslupaa ei ole pyydetty. Voit jatkaa muistutusten käyttöä sovelluksen sisällä tai sallia selainilmoitukset.",
  );
}

export function NotificationPermissionSection(): React.JSX.Element {
  const capabilities = useMemo(() => createBrowserCapabilities(), []);
  const [permission, setPermission] = useState<NotificationPermissionState | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await capabilities.notifications.permission();
      if (result.ok) {
        setPermission(result.value);
        setUnsupported(false);
        setError(null);
      } else if (result.error.code === "unsupported") {
        setPermission(null);
        setUnsupported(true);
        setError(null);
      } else {
        setPermission(null);
        setUnsupported(false);
        setError(fromCapabilityError(result.error));
      }
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [capabilities]);

  const requestPermission = useCallback(async (): Promise<void> => {
    setRequesting(true);
    setError(null);
    try {
      // Tämä kutsu käynnistyy suoraan painikkeen käyttäjän tapahtumasta.
      const result = await capabilities.notifications.requestPermission();
      if (result.ok) {
        setPermission(result.value);
        setUnsupported(false);
      } else if (result.error.code === "unsupported") {
        setPermission(null);
        setUnsupported(true);
      } else {
        setError(fromCapabilityError(result.error));
      }
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setRequesting(false);
    }
  }, [capabilities]);

  useEffect(() => {
    void refresh();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const status = permissionStatusText(loading, unsupported, permission, error !== null);

  return (
    <section
      data-ui="notification-settings-subsection"
      data-ui-variant="browser-permissions"
      data-testid="notification-permission-settings"
      aria-labelledby="notification-permission-heading"
    >
      <h3 id="notification-permission-heading" data-ui="notification-subheading">
        {t("Selainilmoitukset")}
      </h3>
      <p>
        {t(
          "Selain kysyy lupaa vasta painikkeesta. Luvan jälkeen muistutuksesta voidaan näyttää selainilmoitus, kun LifeOS on auki; selain voi lykätä taustavälilehden ajoa eikä takaa muistutuksia suljettuna.",
        )}
      </p>
      <p role="status" aria-live="polite" data-ui="notification-permission-status">
        {status}
      </p>
      {!loading && !unsupported && permission === "default" ? (
        <p>
          <Button
            variant="primary"
            loading={requesting}
            disabled={requesting}
            onClick={() => void requestPermission()}
          >
            {t("Salli selainilmoitukset")}
          </Button>
        </p>
      ) : null}
      {error !== null ? <ErrorCard error={error} onRetry={() => void refresh()} /> : null}
    </section>
  );
}
