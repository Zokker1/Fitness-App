// T028: AppShell (§27) + T044: responsiivinen premium-kehys briefin (T040)
// layout-konseptin mukaan. Yksi yhteinen kehys mobiili- ja desktop-selaimille:
// - mobile (<720px): bottom navigation tärkeimmille + Lisää-painike joka
//   avaa drawer-valikon toissijaisille (dialogi, focus-trap, Esc sulkee,
//   focus palautuu avaajaan). Safe-area-insetit CSS env():llä.
// - desktop (>=720px): vasen rail täydellä listalla; sama linkkijoukko,
//   sama historia. Wide (>=1200px): valinnainen sivupalkki.
//
// - Ikonit + tekstilabelit aina yhdessä (§31: ei pelkkää ikonia).
// - Navigaatio pelkkiä Linkkejä (historia/back toimii, ei tilakaappausta);
//   Lisää-drawer on ainoa tilallinen poikkeus (dialogi, ei reitti).
// - Navimalli (primary/secondary/moreTarget) tulee shellNav.ts:stä (testattu
//   ilman selainta); tämä renderöi vain. Ikonit: paikalliset SVG-maskit, yksi Lucide-perhe.
// - T096: hakulaukaisimet annetaan ulkoa (navSearchButton/railSearchButton):
//   mobiilissa bottom-navin 5. sarake, desktopissa railin yläreuna. Kumpikin
//   avaa saman hakudialogin; haku ei ole navireitti (§3 lukittu).

import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { activeNavPath, buildShellNav } from "./shellNav.ts";
import type { ShellNavItem } from "./shellNav.ts";

export interface ShellRoute {
  readonly path: string;
  readonly label: string;
}

function NavLink({
  item,
  active,
}: {
  readonly item: ShellNavItem;
  readonly active: boolean;
}): React.JSX.Element {
  const location = useLocation();
  // Katselutila (?e2e=1) säilyy sivunvaihdossa: probe-ikkuna pysyy näkyvissä
  // koko katselun ajan eikä katoa navigoidessa. Tuotannossa (ei paramia)
  // linkit osoittavat pelkkiin polkuihin — ei käyttäjälle näkyvää eroa.
  const keepE2E = new URLSearchParams(location.search).get("e2e") === "1";
  return (
    <Link
      to={keepE2E ? { pathname: item.path, search: location.search } : item.path}
      aria-current={active ? "page" : undefined}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

interface AppShellProps {
  readonly routes: readonly ShellRoute[];
  readonly currentPath: string;
  readonly children: ReactNode;
  /**
   * T096: hakulaukaisimet (ei osa navimallia — annettu App:sta jotta AppShell
   * pysyy puhtaana navikehyksenä, §3 navimalli lukittu shellNav.ts:ssä).
   * Kumpikin valinnainen: mobiilin bottom-navin 5. sarake + desktop-railin
   * yläreuna.
   */
  readonly navSearchButton?: ReactNode;
  readonly railSearchButton?: ReactNode;
  readonly languageControl?: ReactNode;
  readonly labels?: Partial<{
    skipToContent: string;
    primaryNavigation: string;
    mobileNavigation: string;
    sidebar: string;
    sidebarNote: string;
    more: string;
    closeMenu: string;
  }>;
}

export function AppShell({
  routes,
  currentPath,
  children,
  navSearchButton,
  railSearchButton,
  languageControl,
  labels,
}: AppShellProps): React.JSX.Element {
  const nav = buildShellNav(routes, currentPath);
  const active = activeNavPath(routes, currentPath);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Reitin vaihtuessa drawer kiinni (navigointi drawerista sulkee sen).
  useEffect(() => {
    setMoreOpen(false);
  }, [currentPath]);

  // Focus-trap + Esc + palautus avaajaan (§31: focus ei katoa).
  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector("a, button");
    if (firstFocusable instanceof HTMLElement) {
      firstFocusable.focus();
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMoreOpen(false);
        moreButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || dialog === null) {
        return;
      }
      const focusables = [...dialog.querySelectorAll("a[href], button:not([disabled])")].filter(
        (element) => element instanceof HTMLElement,
      );
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) {
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
    };
  }, [moreOpen]);

  return (
    <div data-ui="app-shell">
      <a data-ui="skip-link" href="#main">
        {labels?.skipToContent ?? "Siirry sisältöön"}
      </a>
      <nav data-ui="rail" aria-label={labels?.primaryNavigation ?? "Päänavigaatio"}>
        <p data-ui="brand">
          <span data-ui="brand-mark" aria-hidden="true" />
          <span>LifeOS</span>
        </p>
        {railSearchButton}
        <ul>
          {nav.primary.map((item) => (
            <li key={item.path}>
              <NavLink item={item} active={active === item.path} />
            </li>
          ))}
          {nav.secondary.map((item) => (
            <li key={item.path}>
              <NavLink item={item} active={active === item.path} />
            </li>
          ))}
        </ul>
        {languageControl !== undefined ? (
          <div data-ui="rail-language-control">{languageControl}</div>
        ) : null}
      </nav>
      <div data-ui="content-column">
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        {/* T044: T045+ täyttää oikealla sisällöllä; complementary-rooli E2E:lle. */}
        <aside data-ui="aside" aria-label={labels?.sidebar ?? "Sivupalkki"}>
          <p data-ui="aside-title">{labels?.sidebar ?? "Sivupalkki"}</p>
          <p>
            {labels?.sidebarNote ?? "Täydentyy myöhemmissä lohkoissa (synkronointi, tehosteet)."}
          </p>
        </aside>
        <nav data-ui="bottom-nav" aria-label={labels?.mobileNavigation ?? "Mobiilinavigaatio"}>
          <ul>
            {nav.primary.map((item) => (
              <li key={item.path}>
                <NavLink item={item} active={active === item.path} />
              </li>
            ))}
            <li>{navSearchButton}</li>
            <li>
              <button
                ref={moreButtonRef}
                type="button"
                data-ui="more-button"
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                aria-current={nav.moreActive ? "page" : undefined}
                onClick={() => {
                  setMoreOpen((open) => !open);
                }}
              >
                <Icon name="more" />
                <span>{labels?.more ?? "Lisää"}</span>
              </button>
            </li>
          </ul>
        </nav>
      </div>
      {moreOpen ? (
        <div
          data-ui="drawer-scrim"
          onClick={() => {
            setMoreOpen(false);
          }}
          aria-hidden="true"
        />
      ) : null}
      <div
        ref={dialogRef}
        data-ui="more-drawer"
        data-open={moreOpen ? "true" : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={moreOpen ? undefined : "true"}
        inert={!moreOpen}
      >
        <div data-ui="more-drawer-header">
          <p id={titleId} data-ui="more-drawer-title">
            {labels?.more ?? "Lisää"}
          </p>
          <button
            type="button"
            data-ui="more-drawer-close"
            aria-label={labels?.closeMenu ?? "Sulje valikko"}
            onClick={() => {
              setMoreOpen(false);
              moreButtonRef.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        </div>
        <ul>
          {nav.secondary.map((item) => (
            <li key={item.path}>
              <NavLink item={item} active={active === item.path} />
            </li>
          ))}
        </ul>
        {languageControl !== undefined ? (
          <div data-ui="drawer-language-control">{languageControl}</div>
        ) : null}
      </div>
    </div>
  );
}
