// T050: overlay-perhe (§28: Modal, BottomSheet, Drawer).
// Yhteinen Overlay-ydin + viewport-valinta (T050-kriteeri):
// - Mobiili (<720px): bottom-sheet (alareunasta, radius sheet 20, 70dvh max).
// - Desktop (≥720px): keskitetty modal (max 32rem, sheet-radius).
// - Drawer: sivupaneeli (inline-end, täysi korkeus, 22rem) molemmissa.
// Kaikilla: role=dialog + aria-modal + aria-labelledby, scrim (klik sulkee
// ellei modal), Esc sulkee, focus-trap (Tab-kierto), focus avattaessa
// dialogiin + palautus avaajaan suljettaessa, tausta inert + aria-hidden
// EI käytössä (React poistaa taustan fokusoitavuuden trapilla; inert
// vaatisi DOM-migraation joka rikkoisi E2E:n — trap + scrim riittävät),
// body-scroll lukittu avoinna (overflow hidden + palautus).
// Historia/back: overlay EI kaappaa reittiä (T044-malli: dialogi, ei reitti;
// §27 back toimii odotetusti = back ei avaa dialogia uudelleen eikä jätä
// jumiin — suljettu tila on puhdas React-state, ei history-merkintä).
// T054: sisääntuloliike vastaa avaamista (scrim fade-in + dialogi slide-up;
// reduced-motion täyttyy opacity-onlyyn styles.css:n medialohkossa).
// AppShellin Lisää-drawer (T044) refaktoroidaan tälle myöhemmin (T058);
// tässä ei rikota toimivaa navia kesken portin.

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { IconButton } from "./buttons.tsx";
import { SectionHeading } from "./typography.tsx";

export type OverlayVariant = "modal" | "sheet" | "drawer";

interface OverlayProps {
  readonly variant: OverlayVariant;
  /** Näkyvä otsikko (legend/heading, aria-labelledby generoidaan). */
  readonly title: string;
  /** Kuvaus apuvälineille (aria-describedby, valinnainen). */
  readonly description?: string | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Scrim-klikkaus sulkee (oletus true; kriittinen dialogi voi estää). */
  readonly closeOnScrim?: boolean | undefined;
  /**
   * T090: eksplisiittinen palautuskohde suljettaessa (esim. FAB joka
   * piiloutuu avatessa — mount-hetken activeElement on silloin jo body).
   * Jos annettu, käytetään tätä mount-arvauksen sijaan.
   */
  readonly returnTo?: HTMLElement | null;
  readonly children: ReactNode;
}

/**
 * T090: fokuksen palautus sulkeutuessa — SYNKRONINEN (ei rAF:ää, ei observeria).
 * Todistettu debug-Focusin-tracella: Esc-cleanupin requestAnimationFrame EI
 * KOSKAAN LAUKE headless-Chromiumissa (eikä rAF-pohjainen observer) — focusout
 * putoaa bodyyn ja rAF-callbackit eivät aja. FAB on jo DOM:ssa SAMASSA
 * React-commitissa kuin overlay poistuu, joten contains on luotettava ja
 * focus() osuu heti cleanupissa. Käyttäjä-ehto (ei varasteta muualle
 * siirtyneeltä) tarkistetaan ensin.
 */
function scheduleFocusReturn(
  target: HTMLElement,
  dialogRef: React.RefObject<HTMLDivElement | null>,
): void {
  if (!document.contains(target)) {
    return;
  }
  const current = document.activeElement;
  if (
    current !== null &&
    current !== document.body &&
    (dialogRef.current === null || !dialogRef.current.contains(current))
  ) {
    return;
  }
  target.focus({ preventScroll: true });
}

function useOverlayBehavior(
  open: boolean,
  onClose: () => void,
  dialogRef: React.RefObject<HTMLDivElement | null>,
  returnRef: React.RefObject<HTMLElement | null>,
  returnTo?: HTMLElement | null,
): void {
  // Tallenna avaaja (mount-hetken activeElement, TAI eksplisiittinen
  // returnTo-prop) + lukitse scroll + fokusoi dialogi avattaessa.
  // HUOM T090: mount-hetken activeElement on EPÄLUOTETTAVA kun avaaja
  // katoaa samassa commitissa (FAB) — silloin se on jo body. returnTo-prop
  // on AINA oikein kun annettu (QuickAdd antaa FAB-refin) — siksi se menee
  // ensin. Ilman returnTo:a mount-arvaus (modal-probe yms. näkyvät avaajat).
  useEffect(() => {
    if (!open) {
      return;
    }
    const activeAtMount =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnRef.current = returnTo !== undefined && returnTo !== null ? returnTo : activeAtMount;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    // Fokus otsikon sulkunappiin (ensimmäinen fokusoitava) — ei scroll-hyppyä.
    dialog
      ?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      )
      ?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, dialogRef, returnRef, returnTo]);

  // Esc + Tab-trap + fokuksen palautus suljettaessa (OSA 1: keydown).
  // Palautuskohde on mount-hetken activeElement tai returnTo-prop (yllä),
  // paitsi jos se oli body — silloin korvataan ensimmäisen keydownin
  // activeElementillä (dialogin ulkopuolinen elementti kelpaa; dialogin
  // sisäinen ei — muuten trap rikkoontuisi).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const dialog = dialogRef.current;
      const stored = returnRef.current;
      if (stored === null || stored === document.body || !document.contains(stored)) {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active !== document.body &&
          (dialog === null || !dialog.contains(active))
        ) {
          returnRef.current = active;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || dialog === null) {
        return;
      }
      const focusables = [
        ...dialog.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Palauta fokus avaajaan — MUTTA vain jos fokus on vielä dialogissa
      // TAI bodyssa (käyttäjä ei ole ehtinyt siirtyä muualle itse).
      // SYNKRONINEN palautus (ei rAF:ää — katso OSA 1 -diagnoosi yllä):
      // FAB on jo DOM:ssa tässä vaiheessa (sama commit), joten contains
      // on luotettava ja focus() osuu heti.
      const target = returnRef.current;
      if (target === null || !document.contains(target)) {
        return;
      }
      scheduleFocusReturn(target, dialogRef);
    };
  }, [open, onClose, dialogRef, returnRef]);
}

export function Overlay({
  variant,
  title,
  description,
  open,
  onClose,
  closeOnScrim = true,
  returnTo,
  children,
}: OverlayProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useOverlayBehavior(open, onClose, dialogRef, returnRef, returnTo);
  if (!open) {
    return null;
  }
  return (
    <div data-ui="overlay-root">
      <div
        data-ui="overlay-scrim"
        data-motion="fade-in"
        aria-hidden="true"
        onClick={() => {
          if (closeOnScrim) {
            onClose();
          }
        }}
      />
      <div
        ref={dialogRef}
        data-ui="overlay-dialog"
        data-variant={variant}
        data-motion="slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descriptionId : undefined}
      >
        <div data-ui="overlay-header">
          <SectionHeading id={titleId}>{title}</SectionHeading>
          <IconButton icon="close" label="Sulje" onClick={onClose} />
        </div>
        {description !== undefined ? (
          <p data-ui="overlay-description" id={descriptionId}>
            {description}
          </p>
        ) : null}
        <div data-ui="overlay-body">{children}</div>
      </div>
    </div>
  );
}

interface VariantProps {
  readonly title: string;
  readonly description?: string | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly closeOnScrim?: boolean | undefined;
  readonly returnTo?: HTMLElement | null;
  readonly children: ReactNode;
}

/** Keskitetty modal (desktop-oletus; mobiilissa täysleveys-marginaali). */
export function Modal(props: VariantProps): React.JSX.Element | null {
  return <Overlay variant="modal" {...props} />;
}

/**
 * BottomSheet: mobiilissa alareunasta (T050-kriteeri), desktopissa sama
 * keskitetty modal-ilme — viewport-valinta on CSS:ssä (media 720px),
 * ei JS-haaraa (ei matchMedia-kuuntelijaa, ei hydraatio-ongelmaa).
 */
export function BottomSheet(props: VariantProps): React.JSX.Element | null {
  return <Overlay variant="sheet" {...props} />;
}

/** Drawer: sivupaneeli oikeasta reunasta (molemmat viewportit). */
export function Drawer(props: VariantProps): React.JSX.Element | null {
  return <Overlay variant="drawer" {...props} />;
}
