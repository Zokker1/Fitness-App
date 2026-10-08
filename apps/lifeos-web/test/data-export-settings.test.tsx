import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataExportSettings } from "../src/views/settings/DataExportSettings.tsx";
import { FixtureProvider } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
});

describe("data deletion and retention guidance", () => {
  it("explains tombstones, local site-data clearing, and physical-erasure limits", () => {
    render(
      <FixtureProvider>
        <DataExportSettings />
      </FixtureProvider>,
    );

    const guidance = screen.getByTestId("deletion-retention-guidance");
    expect(guidance).toHaveTextContent(/tombstonen|tombstone/iu);
    expect(guidance).toHaveTextContent(/sivustodatan|site.{0,10}data/iu);
    expect(guidance).toHaveTextContent(/ylikirjoitusta|overwriting/iu);
    expect(guidance).toHaveTextContent(/Driveen|Drive/iu);
  });
});
