// T096: global search -probe (kehitysnäkymä, vain ?e2e=1&probe=haku).
// Todistaa GlobalSearchin E2E:ssä: dialogi aukeaa, ryhmittely, keyboard-
// navigointi, onSelect. T097: probe näyttää myös mihin kartta navigoisi
// (sama searchTargetFor-funktio kuin tuotannon useGlobalSearch-hookissa);
// varsinainen navigointi todistetaan tuotannossa (E2E alla).
import { useState } from "react";
import { Button } from "@lifeos/ui";
import { GlobalSearch } from "../search/GlobalSearch.tsx";
import { searchTargetFor } from "../search/searchTarget.ts";

export function SearchProbe(): React.JSX.Element {
  const [selected, setSelected] = useState("ei valintaa");
  const [open, setOpen] = useState(true);
  // T097: E2E-seedaus GlobalSearchin seedDocuments-koukulla (EI erillistä
  // staattista indeksiä — sama komponentti + sama kartta kuin tuotannossa).
  // Probedata on pelkkiä (kind,id,title)-kolmikoita (ei raakadataa).
  const seedDocuments = [
    { kind: "task", id: "sx-t1", title: "Osta maitoa" },
    { kind: "task", id: "sx-t2", title: "Osta leipää" },
    { kind: "project", id: "sx-p1", title: "Maitokauppa" },
    { kind: "tag", id: "sx-g1", title: "maito" },
    { kind: "goal", id: "sx-go1", title: "Maitoa joka päivä" },
    { kind: "routine", id: "sx-r1", title: "Aamumaito" },
    { kind: "journal", id: "sx-j1", title: "Maitopäivä" },
  ] as const;
  // T097: oikea navigointi E2E:ssä vaatisi kirjoitettavan kannan — probe
  // näyttää mihin kartta navigoisi (sama searchTargetFor kuin tuotannossa).
  const [navigated, setNavigated] = useState("ei navigointia");
  return (
    <section data-testid="search-probe" aria-label="Haku (E2E)">
      <h2>Haku</h2>
      <GlobalSearch
        index={{ documents: [] }}
        open={open}
        onOpenChange={setOpen}
        seedDocuments={seedDocuments}
        onSelect={(kind, id) => {
          setSelected(`${kind}:${id}`);
          const target = searchTargetFor(kind, id);
          setNavigated(target ?? "ei kohdetta (tuntematon laji)");
        }}
      />
      {!open ? (
        <Button
          variant="primary"
          data-testid="search-probe-open"
          onClick={() => {
            setOpen(true);
          }}
        >
          Avaa haku
        </Button>
      ) : null}
      <p data-testid="search-probe-selected">Valinta: {selected}</p>
      <p data-testid="search-probe-navigated">Kohde: {navigated}</p>
    </section>
  );
}
