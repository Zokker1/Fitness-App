// T096: tuotannon hakukokemus — hook kasaa GlobalSearchin datan
// repositoryista (T080-malli: ei ad hoc -hakuketjuja komponentissa).
// Palauttaa kolme elementtiä: bottom-navin hakunapin, railin hakunapin ja
// hakudialogin. Indeksi rakennetaan dialogin avautuessa (tuore data joka
// kerta; muistissa, ei verkkohakuja — offline toimii).
// "/" näppäinoikotie: avaa haun kaikkialla paitsi tekstikentissä
// (ei kaappaa syötettä — sama raja kuin QuickAdd Alt+N).
// Valinta: T097 navigoi kohdereitille (searchTargetFor) ja sulkee dialogin;
// tuntematon laji / tyhjä id → sulkee ilman navigointia (ei arvailua).
import { tTemplate } from "../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  buildSearchIndex,
  normalizeSearchText,
  type SearchDocument,
  type SearchIndex as SearchIndexData,
} from "@lifeos/data";
import { useData } from "../dataContext.tsx";
import { GlobalSearch, SearchNavButton, SearchRailButton } from "./GlobalSearch.tsx";
import { searchTargetFor } from "./searchTarget.ts";

async function listOrEmpty<T>(
  list: () => Promise<{ ok: boolean; value?: readonly T[] }>,
): Promise<readonly T[]> {
  try {
    const result = await list();
    if (!result.ok || result.value === undefined) {
      return [];
    }
    return result.value;
  } catch {
    return [];
  }
}

export interface GlobalSearchSlots {
  readonly navButton: React.JSX.Element;
  readonly railButton: React.JSX.Element;
  readonly dialog: React.JSX.Element;
}

export function useGlobalSearch(): GlobalSearchSlots {
  const {
    tasks,
    projects,
    tags,
    goals,
    routines,
    routineSteps,
    journalEntries,
    foods,
    recipes,
    measurements,
  } = useData();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<SearchIndexData>({ documents: [] });

  // T097: E2E-seedaus (?e2e=1&searchSeed=<sana>) — tuottaa deterministisen
  // dokumenttijoukon ILMAN repository-kirjoituksia (tuotantokoodi, mutta
  // aktivoituu vain e2e-flagilla; ei tuotantokäyttöä, ei raakadataa):
  // repository-data + seedi yhdistetään ennen indeksiä.
  const searchSeed = useMemo(() => {
    if (searchParams.get("e2e") !== "1") {
      return null;
    }
    const seed = (searchParams.get("searchSeed") ?? "").trim();
    return seed.length > 0 ? seed : null;
  }, [searchParams]);

  const openSearch = useCallback(() => {
    setOpen(true);
  }, []);

  const navigate = useNavigate();

  const handleSelect = useCallback(
    (kind: string, id: string) => {
      const target = searchTargetFor(kind, id);
      setOpen(false);
      if (target !== null) {
        void navigate(target);
      }
    },
    [navigate],
  );

  // "/" kaikkialla paitsi tekstikentissä (ei kaappaa syötettä).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      openSearch();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openSearch]);

  // Indeksi rakennetaan dialogin avautuessa (tuore data joka kerta).
  useEffect(() => {
    if (!open) {
      return;
    }
    const guard = { cancelled: false };
    void (async () => {
      const [
        taskList,
        projectList,
        tagList,
        goalList,
        routineList,
        stepList,
        journalList,
        foodList,
        recipeList,
        measurementList,
      ] = await Promise.all([
        listOrEmpty(() => tasks.list()),
        listOrEmpty(() => projects.list()),
        listOrEmpty(() => tags.list()),
        listOrEmpty(() => goals.list()),
        listOrEmpty(() => routines.list()),
        listOrEmpty(() => routineSteps.list()),
        listOrEmpty(() => journalEntries.list()),
        listOrEmpty(() => foods.list()),
        listOrEmpty(() => recipes.list()),
        listOrEmpty(() => measurements.list()),
      ]);
      if (guard.cancelled) {
        return;
      }
      const base = buildSearchIndex({
        tasks: taskList,
        projects: projectList,
        tags: tagList,
        goals: goalList,
        routines: routineList,
        routineSteps: stepList,
        journalEntries: journalList,
        foods: foodList,
        recipes: recipeList,
        measurements: measurementList,
      });
      // T097: E2E-seed liitetään repository-datan JATKOKSI (tuotantokanta on
      // tyhjä E2E:ssä, joten käytännössä pelkkä seedi; ei korvaa dataa).
      if (searchSeed === null) {
        setDocuments(base);
      } else {
        const text = normalizeSearchText(searchSeed);
        const seedDocuments: SearchDocument[] = [
          { kind: "task", id: "seed-t1", title: tTemplate("{{0}} tehtävä", [searchSeed]), text },
          { kind: "project", id: "seed-p1", title: `${searchSeed} projekti`, text },
          { kind: "goal", id: "seed-g1", title: `${searchSeed} tavoite`, text },
          { kind: "routine", id: "seed-r1", title: `${searchSeed} rutiini`, text },
          {
            kind: "journal",
            id: "seed-j1",
            title: tTemplate("{{0}} päiväkirja", [searchSeed]),
            text,
          },
        ];
        setDocuments({ documents: [...base.documents, ...seedDocuments] });
      }
    })().catch(() => undefined);
    return () => {
      guard.cancelled = true;
    };
  }, [
    open,
    tasks,
    projects,
    tags,
    goals,
    routines,
    routineSteps,
    journalEntries,
    foods,
    recipes,
    measurements,
    searchSeed,
  ]);

  return {
    navButton: <SearchNavButton onOpen={openSearch} />,
    railButton: <SearchRailButton onOpen={openSearch} />,
    dialog: (
      <GlobalSearch index={documents} open={open} onOpenChange={setOpen} onSelect={handleSelect} />
    ),
  };
}
