// T046: Button-perheen E2E-luotain (näyteikkuna). Renderöityy vain kun
// URL:ssa ?e2e=1 (tuotannossa piilossa, sama malli kuin PersistenceProbe).
// Näyttää kaikki variantit + IconButton + FAB staattisesti jotta E2E voi
// todistaa states/touch-targetit/focuksen + ottaa kuvakaappaukset
// visuaaliseen hyväksyntään. Ei domain-dataa, ei verkkoa, ei PII:tä.
// FAB on tässä näyteikkunassa staattisena (data-static poistaa fixed-
// positionoinnin) jotta se ei peitä muuta sisältöä; tuotantokäyttö (T090)
// käyttää fixed-versiota navin yläpuolella.
import { Button, Fab, IconButton } from "@lifeos/ui";

export function ButtonProbe(): React.JSX.Element {
  return (
    <section data-testid="button-probe" aria-label="Button-perhe (E2E)">
      <h2>Nappiperhe</h2>
      <p>
        <Button variant="primary">Ensisijainen</Button>{" "}
        <Button variant="secondary">Toissijainen</Button> <Button variant="danger">Poista</Button>{" "}
        <Button variant="ghost">Peruuta</Button>
      </p>
      <p>
        <Button variant="primary" loading>
          Lähetä
        </Button>{" "}
        <Button variant="secondary" disabled>
          Estetty
        </Button>
      </p>
      <p>
        <IconButton icon="close" label="Sulje valikko" />{" "}
        <IconButton icon="check" label="Vahvista" />
      </p>
      <p data-testid="button-probe-fab-static">
        <span data-ui="fab-static">
          <Fab />
        </span>
      </p>
    </section>
  );
}
