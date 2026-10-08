// T029: julkinen selainconfig. Vain vaarattomat, jaettavaksi tarkoitetut
// arvot — ei salaisuuksia, ei tokeneita, ei avaimia (§45/ADR-001 §4).
// Kentät:
// - appOrigin: kanoninen tuotanto-origin (https://…). "localhost"-oikopolku
//   sallitaan DEV-tilassa (paikallinen kehitys) SEKÄ silloin kun sivu
//   todella tarjoillaan localhost/preview-originista (T033: vite preview,
//   Playwright-E2E, paikallinen smoke). Muu http-origin hylätään aina;
//   localhost väärässä originissa hylätään (ei tuotantodatan vuotoa
//   dev-ympäristöön, §45).
// - googleClientId: julkinen OAuth-client-id (ei secret; secret ei koskaan
//   kulje tähän, ks. assertNoSecrets + T307/T335).

export interface PublicWebConfigInput {
  readonly appOrigin: string;
  readonly googleClientId: string;
}

export type ConfigErrorCode =
  | "missing-app-origin"
  | "invalid-app-origin"
  | "origin-mismatch"
  | "insecure-production-origin"
  | "missing-google-client-id";

export interface ConfigError {
  readonly code: ConfigErrorCode;
  /** Suora korjausohje (fi), näytetään build-virheessä sellaisenaan. */
  readonly message: string;
}

export type ValidatedWebConfig = PublicWebConfigInput;

interface ParsedOrigin {
  readonly protocol: "http" | "https";
  readonly hostname: string;
  readonly port: number | null;
}

function parseOrigin(value: string): ParsedOrigin | null {
  // Tarkka origin ilman URL-globaalia (config-paketti on alustariippumaton).
  // Path, query, hash, userinfo, whitespace, tyhjä/virheellinen portti ja
  // epäkelvot hostname-labelit hylätään ennen kuin arvoa käytetään configina.
  const match = /^(https?):\/\/([^/:?#@]+|\[[0-9a-f:.]+\])(?::([0-9]+))?$/iu.exec(value);
  const protocolText = match?.[1]?.toLowerCase();
  const hostText = match?.[2]?.toLowerCase();
  const portText = match?.[3];
  if (protocolText !== "http" && protocolText !== "https") return null;
  if (hostText === undefined || hostText.length === 0) return null;

  const isIpv6 = hostText.startsWith("[") && hostText.endsWith("]");
  if (isIpv6) {
    // IPv6 loopback is the only bracketed address needed by current hosting
    // and local-preview flows; reject ambiguous/incompletely parsed literals.
    if (hostText !== "[::1]") return null;
  } else {
    if (hostText.length > 253 || hostText.startsWith(".") || hostText.endsWith(".")) return null;
    const labels = hostText.split(".");
    if (
      labels.some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label),
      )
    ) {
      return null;
    }
    if (/^[0-9.]+$/u.test(hostText)) {
      const octets = hostText.split(".");
      if (octets.length !== 4 || octets.some((octet) => Number(octet) > 255)) return null;
    }
  }

  const port = portText === undefined ? null : Number(portText);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65_535)) return null;
  return { protocol: protocolText, hostname: hostText, port };
}

function isLoopbackHttpOrigin(origin: ParsedOrigin): boolean {
  return (
    origin.protocol === "http" &&
    (origin.hostname === "localhost" || origin.hostname === "127.0.0.1")
  );
}

function isLoopbackOrigin(origin: ParsedOrigin): boolean {
  return (
    origin.hostname === "localhost" ||
    origin.hostname === "127.0.0.1" ||
    origin.hostname === "[::1]"
  );
}

function normalizedOrigin(origin: ParsedOrigin): string {
  const defaultPort = origin.protocol === "https" ? 443 : 80;
  const port =
    origin.port === null || origin.port === defaultPort ? "" : `:${origin.port.toString()}`;
  return `${origin.protocol}://${origin.hostname}${port}`;
}

export function validatePublicWebConfig(
  input: Partial<PublicWebConfigInput>,
  options: { readonly isDev: boolean; readonly runtimeOrigin?: string },
):
  | { readonly ok: true; readonly value: ValidatedWebConfig }
  | { readonly ok: false; readonly error: ConfigError } {
  const appOrigin = input.appOrigin?.trim() ?? "";
  if (appOrigin.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing-app-origin",
        message:
          "Puuttuva kriittinen asetus VITE_APP_ORIGIN. Aseta se .env-tiedostoon (katso .env.example).",
      },
    };
  }
  const configuredOrigin = appOrigin === "localhost" ? null : parseOrigin(appOrigin);
  if (
    appOrigin === "localhost" ||
    (configuredOrigin !== null && isLoopbackHttpOrigin(configuredOrigin))
  ) {
    // Localhost-config on sallittu paikallisessa kehityksessä ilman runtime-
    // tietoa sekä preview/E2E-ajossa, kun sivu todella tulee loopbackista.
    const runtimeText = options.runtimeOrigin?.trim() ?? "";
    const runtimeOrigin = runtimeText.length === 0 ? null : parseOrigin(runtimeText);
    const runtimeIsLoopback = runtimeOrigin !== null && isLoopbackHttpOrigin(runtimeOrigin);
    if (runtimeText.length > 0 && !runtimeIsLoopback) {
      return {
        ok: false,
        error: {
          code: "insecure-production-origin",
          message:
            "VITE_APP_ORIGIN on localhost mutta sivu tarjoillaan muualta. Tuotanto vaatii https-originin.",
        },
      };
    }
    if (runtimeText.length === 0 && !options.isDev) {
      return {
        ok: false,
        error: {
          code: "insecure-production-origin",
          message:
            "VITE_APP_ORIGIN on localhost mutta sivun runtime-origin puuttuu. Tuotanto vaatii https-originin.",
        },
      };
    }
  } else if (configuredOrigin === null || configuredOrigin.protocol !== "https") {
    return {
      ok: false,
      error: {
        code: "invalid-app-origin",
        message:
          "VITE_APP_ORIGIN on virheellinen. Käytä täyttä https-originia (esim. https://app.example.com) tai devissä localhostia.",
      },
    };
  } else {
    const runtimeText = options.runtimeOrigin?.trim() ?? "";
    if (runtimeText.length > 0) {
      const runtimeOrigin = parseOrigin(runtimeText);
      // Local preview on loopback is allowed for locally served production
      // builds. Any deployed remote origin must match the configured origin.
      const localPreview = runtimeOrigin !== null && isLoopbackOrigin(runtimeOrigin);
      if (
        runtimeOrigin === null ||
        (!localPreview && normalizedOrigin(runtimeOrigin) !== normalizedOrigin(configuredOrigin))
      ) {
        return {
          ok: false,
          error: {
            code: "origin-mismatch",
            message:
              "VITE_APP_ORIGIN ei vastaa sivun tarjoilu-originia. Päivitä OAuthin sallittu origin ja ympäristöasetus.",
          },
        };
      }
    }
  }

  const googleClientId = input.googleClientId?.trim() ?? "";
  if (googleClientId.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing-google-client-id",
        message:
          "Puuttuva kriittinen asetus VITE_GOOGLE_CLIENT_ID. Aseta se .env-tiedostoon (katso .env.example).",
      },
    };
  }

  return { ok: true, value: { appOrigin, googleClientId } };
}
