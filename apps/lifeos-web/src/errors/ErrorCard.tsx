// T037: virhekortti. Yksi tapa näyttää AppError käyttäjälle:
// - role=alert (error) / role=status (warning), focus siirtyy otsikkoon.
// - Vain title/body/action/diagnosticCode — ei koskaan error.message/stackia.
// - "Yritä uudelleen" renderöityy vain kun onRetry annettu.
// - Tekninen koodi on aina isSafeDiagnosticCode (moduuli takaa).
import { t } from "../language.tsx";
import { useEffect, useRef } from "react";
import { Button } from "@lifeos/ui";
import type { AppError } from "./appError.ts";

export interface ErrorCardProps {
  readonly error: AppError;
  readonly onRetry?: () => void;
}

export function ErrorCard({ error, onRetry }: ErrorCardProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // §31: focus ei katoa virhenäkymään siirryttäessä.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const role = error.level === "error" ? "alert" : "status";
  return (
    <div role={role} data-ui="error-card" data-level={error.level}>
      <h2 ref={headingRef} tabIndex={-1}>
        {t(error.title)}
      </h2>
      <p>{t(error.body)}</p>
      {error.actionLabel !== null && onRetry !== undefined ? (
        <p>
          <Button variant="primary" onClick={onRetry}>
            {t(error.actionLabel)}
          </Button>
        </p>
      ) : null}
      <p data-testid="error-diagnostic-code">
        {t("Tekninen koodi: ")}
        {error.diagnosticCode}
      </p>
    </div>
  );
}
