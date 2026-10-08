// T282: käyttäjä säätää kuutta muistutuskategoriaa erikseen.
import { Switch } from "@lifeos/ui";
import type { NotificationCategoryKey } from "@lifeos/domain";
import { t } from "../../language.tsx";
import { useNotificationCategories } from "../../preferences/NotificationCategoriesContext.tsx";
import { ErrorCard } from "../../errors/ErrorCard.tsx";
import "./notification-categories.css";

const CATEGORY_OPTIONS: readonly {
  readonly key: NotificationCategoryKey;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    key: "task",
    label: "Tehtävät",
    description: "Tehtäviin ja määräaikoihin liittyvät muistutukset.",
  },
  {
    key: "routine",
    label: "Rutiinit",
    description: "Rutiinien aikataulumuistutukset.",
  },
  {
    key: "focus",
    label: "Fokus",
    description: "Fokusjaksoihin liittyvät muistutukset.",
  },
  {
    key: "health",
    label: "Terveys",
    description: "Terveyskirjauksiin liittyvät muistutukset.",
  },
  {
    key: "supplement",
    label: "Lisäravinteet",
    description: "Lisäravinteiden aikataulumuistutukset.",
  },
  {
    key: "system",
    label: "Sovellus",
    description: "Sovelluksen toimintaan liittyvät ilmoitukset.",
  },
];

export function NotificationCategoriesSection(): React.JSX.Element {
  const { categories, loading, saving, error, reload, setEnabled } = useNotificationCategories();
  return (
    <section
      data-ui="notification-settings-subsection"
      data-testid="notification-categories-settings"
      aria-labelledby="notification-categories-heading"
    >
      <h3 id="notification-categories-heading" data-ui="notification-subheading">
        {t("Ilmoituskategoriat")}
      </h3>
      <p>
        {t(
          "Valitse, minkä tyyppiset muistutukset ovat käytössä. Asetus tallentuu tälle laitteelle.",
        )}
      </p>
      {loading ? <p role="status">{t("Ladataan asetusta…")}</p> : null}
      <ul data-ui="notification-category-list">
        {CATEGORY_OPTIONS.map((option) => (
          <li key={option.key}>
            <Switch
              checked={categories[option.key]}
              disabled={loading || saving}
              data-testid={`notification-category-${option.key}`}
              aria-describedby={`notification-category-${option.key}-description`}
              onChange={(event) => {
                void setEnabled(option.key, event.target.checked);
              }}
            >
              {t(option.label)}
            </Switch>
            <p id={`notification-category-${option.key}-description`}>{t(option.description)}</p>
          </li>
        ))}
      </ul>
      {error !== null ? <ErrorCard error={error} onRetry={() => void reload()} /> : null}
    </section>
  );
}
