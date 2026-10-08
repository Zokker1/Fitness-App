// T246: web-oletusadapteri pitää laitetoimittajan API:t pois domainista.
// Tässä toteutuksessa ei tarkisteta selaimen tukea eikä pyydetä käyttöoikeuksia.
import type { WearableProvider, WearableProviderError, WearableProviderResult } from "@lifeos/data";

const unavailableError: WearableProviderError = {
  code: "unsupported",
  userMessage: "Laitetuontia ei ole yhdistetty tässä versiossa.",
  diagnosticCode: "wearable-provider.unavailable",
};

function unavailable<T>(): Promise<WearableProviderResult<T>> {
  return Promise.resolve({ ok: false, error: unavailableError });
}

/** Rehellinen oletusadapteri ei pyydä lupia eikä tee laite- tai verkkokutsuja. */
export function createUnavailableWearableProvider(): WearableProvider {
  return {
    providerId: "unavailable",
    displayName: "Laitetuonti",
    getAvailability: () => Promise.resolve({ ok: true, value: { state: "unsupported" } }),
    requestReadAccess: () => unavailable(),
    listRecords: () => unavailable(),
  };
}
