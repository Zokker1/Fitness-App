import { SegmentedControl } from "@lifeos/ui";
import { t, useLanguage, tOptions } from "./language.tsx";
import "./language-selector.css";

const LANGUAGE_OPTIONS = [
  { value: "fi", label: "FI" },
  { value: "en", label: "EN" },
] as const;

export function LanguageSelector(): React.JSX.Element {
  const { language, setLanguage } = useLanguage();

  return (
    <div data-ui="language-control" data-testid="language-selector">
      <SegmentedControl
        label={t("Kieli")}
        name="application-language"
        options={tOptions(LANGUAGE_OPTIONS)}
        value={language}
        onOptionChange={(value) => {
          if (value === "fi" || value === "en") setLanguage(value);
        }}
      />
    </div>
  );
}
