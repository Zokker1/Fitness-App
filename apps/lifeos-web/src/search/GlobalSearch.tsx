// T096: global search -komponentti (§4, §21–§22). Yksi paikka haulle
// molemmissa layouteissa: hakulaukaisin mobiilin bottom-navissa (TÄYTTÄÄ
// a-em:n paikan — 5. sarake pysyy, T044-rakenne säilyy) + railin yläreunassa
// desktopissa (§4: mobiilissa ylhäällä TAI bottom navissa — bottom nav
// valittu jotta sisältöalue pysyy rauhassa). Molemmat avaavat saman
// BottomSheet-dialogin (T050-perhe: focus-trap, Esc, scrim, palautus).
//
// Käyttö molemmilla:
// - keyboard: Enter hakee, nuolet liikkuvat osumissa, Enter valitsee
//   (T097: valinta navigoi kohdereitille searchTargetFor-kartan mukaan);
// - kosketus: 44px rivit, ryhmäotsikot h3-tasolla (ei klikattavia).
// Ryhmittely tyypeittäin SEARCH_RESULT_LABELS-järjestyksessä (T095).
// Tyhjä kysely: ohjeteksti (ei tuloksia, ei vuotoa). Ei osumia: rehellinen
// tyhjätila. Tulosrivit: otsikko ja mittauksen muistiinpanon esikatselu.
import { t } from "../language.tsx";
import { useEffect, useId, useMemo, useState } from "react";
import { BottomSheet, Icon, Input } from "@lifeos/ui";
import {
  SEARCH_RESULT_LABELS,
  normalizeSearchText,
  searchIndex,
  type SearchIndex as SearchIndexData,
  type SearchResultKind as SearchDocumentKind,
  type SearchResults,
} from "@lifeos/data";

export interface GlobalSearchProps {
  readonly index: SearchIndexData;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** T097: osuman valinta navigoi — kutsuja (useGlobalSearch) on jo kytkenyt
   * reitityksen (searchTargetFor). Tässä vain delegointi ilman logiikkaa. */
  readonly onSelect: (kind: string, id: string) => void;
  readonly returnTo?: HTMLElement | null;
  /**
   * T097: E2E-seedauskoukku — probe syöttää dataa repositoryjen sijaan
   * (tuotannossa aina undefined). EI tuotantokäyttöä.
   */
  readonly seedDocuments?: readonly { kind: string; id: string; title: string }[];
}

const KIND_ORDER = [
  "task",
  "project",
  "tag",
  "goal",
  "routine",
  "journal",
  "food",
  "recipe",
  "measurement",
] as const;

export function GlobalSearch({
  index,
  open,
  onOpenChange,
  onSelect,
  returnTo,
  seedDocuments,
}: GlobalSearchProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  // T097: E2E-seedaus (probe) korvaa indeksin sisällön; tuotannossa aina
  // tyhjä → puhdas repository-data.
  const effectiveIndex = useMemo(
    () =>
      seedDocuments === undefined
        ? index
        : {
            documents: seedDocuments.map((document_) => ({
              kind: document_.kind as SearchDocumentKind,
              id: document_.id,
              title: document_.title,
              text: normalizeSearchText(document_.title),
            })),
          },
    [index, seedDocuments],
  );
  const results: SearchResults = useMemo(
    () => searchIndex(effectiveIndex, query),
    [effectiveIndex, query],
  );
  const flat = useMemo(
    () => KIND_ORDER.flatMap((kind) => results[kind].map((hit) => ({ ...hit }))),
    [results],
  );
  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const totalHits = flat.length;

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const choose = (kind: string, id: string): void => {
    onSelect(kind, id);
  };

  const onInputKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown" && totalHits > 0) {
      event.preventDefault();
      setActive((current) => (current + 1) % totalHits);
    } else if (event.key === "ArrowUp" && totalHits > 0) {
      event.preventDefault();
      setActive((current) => (current - 1 + totalHits) % totalHits);
    } else if (event.key === "Enter" && totalHits > 0) {
      const hit = flat[active];
      if (hit !== undefined) {
        event.preventDefault();
        choose(hit.kind, hit.id);
      }
    }
  };

  return (
    <BottomSheet
      title={t("Haku")}
      description={t(
        "Hae tehtävistä, tavoitteista, rutiineista ja muistiinpanoista. Nuolinäppäimillä voi liikkua, Enter avaa.",
      )}
      open={open}
      onClose={() => {
        onOpenChange(false);
      }}
      returnTo={returnTo ?? null}
    >
      <div data-ui="global-search">
        <Input
          label={t("Hakusana")}
          placeholder={t("Esim. maitoa")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={onInputKeyDown}
          role="combobox"
          aria-expanded={hasQuery}
          aria-controls={listId}
          aria-activedescendant={totalHits > 0 ? `search-hit-${String(active)}` : undefined}
        />
        {!hasQuery ? (
          <p data-ui="meta" data-testid="search-hint">
            {t(
              "Kirjoita hakusana — haku kattaa tehtävät, tavoitteet, rutiinit, päiväkirjan, ruoat ja mittaukset.",
            )}
          </p>
        ) : totalHits === 0 ? (
          <p data-ui="meta" data-testid="search-empty">
            {t("Ei osumia haulle “")}
            {trimmed}”.
          </p>
        ) : (
          <div
            role="listbox"
            id={listId}
            aria-label={t("Hakutulokset")}
            data-testid="search-results"
          >
            <p data-ui="meta" data-testid="search-count">
              {totalHits === 1 ? t("1 osuma") : `${String(totalHits)} osumaa`}
            </p>
            {KIND_ORDER.map((kind) => {
              const hits = results[kind];
              if (hits.length === 0) {
                return null;
              }
              return (
                <section key={kind} data-testid={`search-group-${kind}`}>
                  <h3 data-ui="search-group-title">{t(SEARCH_RESULT_LABELS[kind])}</h3>
                  <ul data-ui="search-group-list">
                    {hits.map((hit) => {
                      const flatIndex = flat.findIndex(
                        (item) => item.kind === hit.kind && item.id === hit.id,
                      );
                      const isActive = flatIndex === active;
                      return (
                        <li key={hit.id}>
                          <button
                            type="button"
                            id={`search-hit-${String(flatIndex)}`}
                            role="option"
                            aria-selected={isActive}
                            data-active={isActive ? "true" : undefined}
                            data-testid={`search-hit-${hit.kind}-${hit.id}`}
                            onClick={() => {
                              choose(hit.kind, hit.id);
                            }}
                            onMouseEnter={() => {
                              setActive(flatIndex);
                            }}
                          >
                            <span data-ui="search-result-title">{hit.title}</span>
                            {hit.preview !== undefined ? (
                              <span data-ui="search-result-preview">
                                {t("Muistiinpano:")}
                                {hit.preview}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

/** Hakulaukaisin bottom-naviin (mobiili): korvaa a-em paikan. */
export function SearchNavButton({ onOpen }: { readonly onOpen: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      data-ui="more-button"
      data-testid="global-search-button"
      aria-label={t("Haku")}
      title={t("Haku (/)")}
      onClick={() => {
        onOpen();
      }}
    >
      <Icon name="search" />
      <span>{t("Haku")}</span>
    </button>
  );
}

/** Hakulaukaisin railiin (desktop): täyden levyinen hakupainike. */
export function SearchRailButton({ onOpen }: { readonly onOpen: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      data-ui="search-rail-button"
      data-testid="global-search-button"
      title={t("Haku (/)")}
      onClick={() => {
        onOpen();
      }}
    >
      <Icon name="search" />
      <span>{t("Hae…")}</span>
      <kbd aria-hidden="true">/</kbd>
    </button>
  );
}
