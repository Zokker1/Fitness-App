// T051: ydintilojen E2E-luotain (näyteikkuna). Renderöityy vain kun
// URL:ssa ?e2e=1 (tuotannossa piilossa, sama malli kuin CardProbe).
// Näyttää Empty/Skeleton/Alert/Toast-perheet + Alert-sävyt niin että E2E
// todistaa rakenteen + kuvakaappaukset visuaaliseen hyväksyntään.
// Toast on paikallaan (preview-nappi avaa Viewportin toastin 5 s ajastimella
// — E2E todistaa teko→palaute-ketjun ilman globaalia tilaa).
// Ei domain-dataa, ei verkkoa, ei PII:tä (synteettiset arvot).
import { useState } from "react";
import { Alert, Button, EmptyState, Skeleton, Toast, ToastViewport } from "@lifeos/ui";

export function StateProbe(): React.JSX.Element {
  const [toastOpen, setToastOpen] = useState(false);
  return (
    <section data-testid="state-probe" aria-label="Ydintilat (E2E)">
      <h2>Ydintilat</h2>
      <EmptyState
        title="Ei tehtäviä vielä"
        hint="Kun lisäät ensimmäisen tehtävän, se näkyy tässä."
        icon="check"
        action={<Button variant="secondary">Lisää tehtävä</Button>}
      />
      <Skeleton lines={3} />
      <Alert tone="info" title="Synkronoitu">
        <p>Kaikki muutokset ovat laitteella tallessa.</p>
      </Alert>
      <Alert tone="success" title="Tallennettu">
        <p>Muutos on tallessa laitteella.</p>
      </Alert>
      <Alert tone="warning" title="Tarkista mittaus">
        <p>Arvo poikkeaa tavallisesta. Tarkista mittaus ennen kuin jatkat.</p>
      </Alert>
      <Alert tone="danger" title="Tallennus epäonnistui">
        <p>Muutos ei tallentunut. Yritä uudelleen.</p>
      </Alert>
      <p>
        <Button
          variant="secondary"
          onClick={() => {
            setToastOpen(true);
          }}
        >
          Näytä ilmoitus
        </Button>
      </p>
      {toastOpen ? (
        <ToastViewport>
          <Toast
            tone="success"
            title="Tehtävä tallennettu"
            body="Löydät sen Tänään-näkymästä."
            duration={5000}
            onDismiss={() => {
              setToastOpen(false);
            }}
          />
        </ToastViewport>
      ) : null}
    </section>
  );
}
