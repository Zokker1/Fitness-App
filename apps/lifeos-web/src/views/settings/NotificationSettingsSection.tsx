import { Card } from "@lifeos/ui";
import { t } from "../../language.tsx";
import { NotificationCategoriesSection } from "./NotificationCategoriesSection.tsx";
import { NotificationPermissionSection } from "./NotificationPermissionSection.tsx";
import "./notification-settings.css";

export function NotificationSettingsSection(): React.JSX.Element {
  return (
    <Card heading={t("Ilmoitukset")} data-testid="notification-settings">
      <div data-ui="notification-settings-content">
        <NotificationCategoriesSection />
        <NotificationPermissionSection />
      </div>
    </Card>
  );
}
