// T036: StorageStatusCard + StorageBanner -testit (happy-dom).
// - Kortti näyttää tilanumerot, ohjeen ja persist-napin vain kun järkevää.
// - Banneri renderöityy vain huomio/kriittinen-tasolla oikealla roolilla.
// Ei capability/SQL-kutsuja — puhdas lifecycle-status syötteenä.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { buildStorageStatus } from "../src/storage/lifecycle.ts";
import { StorageStatusCard } from "../src/storage/StorageStatusCard.tsx";
import { StorageBanner } from "../src/storage/StorageBanner.tsx";

const BASE_SNAPSHOT = {
  opfsSupported: true,
  persisted: true as boolean | null,
  quotaBytes: 1_000_000_000,
  usageBytes: 100_000_000,
};

const BASE_DB = {
  backend: "opfs-sahpool",
  persisted: true,
  open: true,
  integrity: "ok",
  schemaVersion: 1,
};

function cardProps(status: ReturnType<typeof buildStorageStatus>) {
  return {
    status,
    loading: false,
    loadError: null as string | null,
    requesting: false,
    requestError: null as string | null,
    requestGranted: null as boolean | null,
    onRequestPersistence: vi.fn(),
  };
}

describe("StorageStatusCard", () => {
  it("näyttää pysyvän tilan + quota-luvut + sivustodata-riskin", () => {
    const status = buildStorageStatus(BASE_SNAPSHOT, BASE_DB);
    render(<StorageStatusCard {...cardProps(status)} />);
    expect(screen.getByText("Pysyvä")).toBeInTheDocument();
    expect(screen.getAllByText(/sivustodatan tyhjennys/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("näyttää persist-napin best-effortissa ja kutsuu handleria", () => {
    const status = buildStorageStatus({ ...BASE_SNAPSHOT, persisted: false }, BASE_DB);
    const onRequestPersistence = vi.fn();
    render(
      <StorageStatusCard {...cardProps(status)} onRequestPersistence={onRequestPersistence} />,
    );
    const button = screen.getByRole("button", { name: /pysyvää tallennusta/i });
    expect(button).toBeInTheDocument();
    button.click();
    expect(onRequestPersistence).toHaveBeenCalledTimes(1);
  });

  it("näyttää myönnön/hylkäyksen palautteen", () => {
    const status = buildStorageStatus(BASE_SNAPSHOT, BASE_DB);
    const { rerender } = render(<StorageStatusCard {...cardProps(status)} requestGranted={true} />);
    expect(screen.getByText(/nyt pysyvä/i)).toBeInTheDocument();
    rerender(<StorageStatusCard {...cardProps(status)} requestGranted={false} />);
    expect(screen.getByText(/ei myöntänyt/i)).toBeInTheDocument();
  });

  it("näyttää lataus- ja virhetilan", () => {
    const status = buildStorageStatus(BASE_SNAPSHOT, BASE_DB);
    const { unmount } = render(<StorageStatusCard {...cardProps(status)} loading={true} />);
    expect(screen.getByText(/tarkistetaan/i)).toBeInTheDocument();
    unmount();
    render(<StorageStatusCard {...cardProps(status)} loadError="Luku epäonnistui." />);
    expect(screen.getByText("Luku epäonnistui.")).toBeInTheDocument();
  });
});

describe("StorageBanner", () => {
  it("ei renderöidy ok/tuntematon-tasolla", () => {
    const ok = buildStorageStatus(BASE_SNAPSHOT, BASE_DB);
    const { container, unmount } = render(
      <MemoryRouter>
        <StorageBanner status={ok} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
    unmount();
    const unknown = buildStorageStatus(null, BASE_DB);
    const second = render(
      <MemoryRouter>
        <StorageBanner status={unknown} />
      </MemoryRouter>,
    );
    expect(second.container.textContent).toBe("");
  });

  it("huomio-taso: role=status + linkki asetuksiin", () => {
    const status = buildStorageStatus({ ...BASE_SNAPSHOT, persisted: false }, BASE_DB);
    render(
      <MemoryRouter>
        <StorageBanner status={status} />
      </MemoryRouter>,
    );
    // Banneri on ainoa status-rooli tässä renderissä (korttia ei mukana).
    expect(screen.getByRole("status", { name: /tallennus/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /tallennusasetukset/i })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("kriittinen taso: role=alert", () => {
    const status = buildStorageStatus(BASE_SNAPSHOT, { ...BASE_DB, backend: "memory" });
    render(
      <MemoryRouter>
        <StorageBanner status={status} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
