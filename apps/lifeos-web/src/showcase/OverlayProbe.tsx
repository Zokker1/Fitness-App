// T050: overlay-perheen E2E-luotain (näyteikkuna). Renderöityy vain kun
// URL:ssa ?e2e=1 (tuotannossa piilossa, sama malli kuin muut probet).
// Kolme avaajaa (Modal/BottomSheet/Drawer) + kontrolloitu auki-tila jotta
// E2E todistaa Esc/backdrop/focus-trap/back-navigoinnin + kuvakaappaukset
// visuaaliseen hyväksyntään. Ei domain-dataa, ei verkkoa, ei PII:tä.
import { useState } from "react";
import { BottomSheet, Button, Drawer, Modal } from "@lifeos/ui";

type OverlayKind = "modal" | "sheet" | "drawer" | null;

export function OverlayProbe(): React.JSX.Element {
  const [open, setOpen] = useState<OverlayKind>(null);
  const close = (): void => {
    setOpen(null);
  };
  return (
    <section data-testid="overlay-probe" aria-label="Overlay-perhe (E2E)">
      <h2>Overlayt</h2>
      <p>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen("modal");
          }}
        >
          Avaa modal
        </Button>{" "}
        <Button
          variant="secondary"
          onClick={() => {
            setOpen("sheet");
          }}
        >
          Avaa bottom-sheet
        </Button>{" "}
        <Button
          variant="secondary"
          onClick={() => {
            setOpen("drawer");
          }}
        >
          Avaa drawer
        </Button>
      </p>
      <Modal
        title="Esimerkki-modal"
        description="Keskitetty dialogi"
        open={open === "modal"}
        onClose={close}
      >
        <p>Modalin sisältö. Esc, scrim-klikki tai Sulje sulkee.</p>
        <p>
          <Button variant="primary" onClick={close}>
            Valmis
          </Button>
        </p>
      </Modal>
      <BottomSheet
        title="Esimerkki-sheet"
        description="Mobiilissa alareunasta, desktopissa keskellä"
        open={open === "sheet"}
        onClose={close}
      >
        <p>Sheetin sisältö. Sama sisältö molemmissa viewporteissa.</p>
        <p>
          <Button variant="primary" onClick={close}>
            Valmis
          </Button>
        </p>
      </BottomSheet>
      <Drawer
        title="Esimerkki-drawer"
        description="Sivupaneeli"
        open={open === "drawer"}
        onClose={close}
      >
        <p>Drawerin sisältö. Aina sivussa.</p>
        <p>
          <Button variant="primary" onClick={close}>
            Valmis
          </Button>
        </p>
      </Drawer>
    </section>
  );
}
