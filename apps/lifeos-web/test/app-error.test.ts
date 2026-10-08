// T037: virhekerroksen pure-testit (ei Reactia/DOM:ia).
// - Kääntäjät: joka koodille oikea taso + redaktoitu koodi.
// - Redaktio: sähköposti/token/secret/avain ei läpäise koodia tai näyttöä.
// - fromUnknown/fromBootstrapError eivät koskaan vuoda error.messagea.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  containsSensitiveData,
  fromBootstrapError,
  fromCapabilityError,
  fromConfigError,
  fromDataError,
  fromDomainError,
  fromUnknown,
  isSafeDiagnosticCode,
  reportError,
  sanitizeForDisplay,
  toSafeDiagnosticCode,
} from "../src/errors/appError.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isSafeDiagnosticCode", () => {
  it("hyväksyy konekoodit, hylkää PII:n ja muodon", () => {
    expect(isSafeDiagnosticCode("data.task.not-found")).toBe(true);
    expect(isSafeDiagnosticCode("db.migrate.failed")).toBe(true);
    expect(isSafeDiagnosticCode("app.unknown")).toBe(true);
    expect(isSafeDiagnosticCode("")).toBe(false);
    expect(isSafeDiagnosticCode("has space")).toBe(false);
    expect(isSafeDiagnosticCode("User@Example.COM")).toBe(false);
    expect(isSafeDiagnosticCode("token: abc123SECRET")).toBe(false);
  });
});

describe("containsSensitiveData / sanitizeForDisplay", () => {
  it("tunnistaa sähköpostin, bearerin, secretin ja avaimen", () => {
    expect(containsSensitiveData("ota yhteys User@Example.COM")).toBe(true);
    expect(containsSensitiveData("Bearer abcdefghijklmnop")).toBe(true);
    expect(containsSensitiveData("token: hunter2value")).toBe(true);
    expect(containsSensitiveData("client_secret=hunter2value")).toBe(true);
    expect(containsSensitiveData("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSensitiveData("tavallinen diagnostiikkakoodi")).toBe(false);
  });

  it("redaktoi näytettävän tekstin", () => {
    const cleaned = sanitizeForDisplay("lähetä User@Example.COM ja Bearer abcdefghijklmnop");
    expect(cleaned).not.toContain("User@Example.COM");
    expect(cleaned).toContain("[sähköposti]");
    expect(cleaned).toContain("[redaktoitu]");
  });
});

describe("toSafeDiagnosticCode", () => {
  it("palauttaa fallbackin vaaralliselle koodille", () => {
    expect(toSafeDiagnosticCode("data.ok", "app.unknown")).toBe("data.ok");
    expect(toSafeDiagnosticCode("evil code!", "data.error")).toBe("data.error");
    expect(toSafeDiagnosticCode("evil code!", "also evil!")).toBe("app.unknown");
  });
});

describe("fromDataError", () => {
  it("not-found/invalid -> warning ilman retry-toimintoa", () => {
    const warning = fromDataError({
      code: "not-found",
      userMessage: "Ei löytynyt.",
      diagnosticCode: "data.task.not-found",
    });
    expect(warning.level).toBe("warning");
    expect(warning.actionLabel).toBeNull();
    expect(warning.diagnosticCode).toBe("data.task.not-found");
  });

  it("transient/storage -> error retry-toiminnolla", () => {
    const error = fromDataError({
      code: "transient-failure",
      userMessage: "Yritä uudelleen.",
      diagnosticCode: "db.request.timeout",
    });
    expect(error.level).toBe("error");
    expect(error.actionLabel).toBe("Yritä uudelleen");
  });

  it("vaarallinen koodi vaihdetaan turvalliseen", () => {
    const error = fromDataError({
      code: "transient-failure",
      userMessage: "x",
      diagnosticCode: "evil code!",
    });
    expect(error.diagnosticCode).toBe("data.error");
  });
});

describe("fromCapabilityError", () => {
  it("unsupported/denied/unavailable -> warning", () => {
    for (const code of ["unsupported", "denied", "unavailable"] as const) {
      const result = fromCapabilityError({
        capability: "storage",
        code,
        userMessage: "Ei onnistu.",
        diagnosticCode: "storage.snapshot.failed",
      });
      expect(result.level).toBe("warning");
      expect(result.actionLabel).toBeNull();
    }
  });
});

describe("fromDomainError / fromConfigError", () => {
  it("konflikti ja siirtymä -> warning oikeilla koodeilla", () => {
    expect(fromDomainError({ code: "conflict-open", message: "x" }).diagnosticCode).toBe(
      "domain.conflict-open",
    );
    expect(fromDomainError({ code: "invalid-transition", message: "x" }).title).toContain(
      "mahdollinen",
    );
  });

  it("config-virhe redaktoi koodin", () => {
    const result = fromConfigError({ code: "missing-app-origin", message: "Puuttuu." });
    expect(result.level).toBe("error");
    expect(result.diagnosticCode).toBe("config.missing-app-origin");
  });
});

describe("fromUnknown / fromBootstrapError", () => {
  it("tuntematon Error ei vuoda messagea", () => {
    const error = new Error("salainen Bearer abcdefghijklmnop user@example.com");
    const result = fromUnknown(error);
    expect(result.level).toBe("error");
    expect(result.body).not.toContain("Bearer");
    expect(result.body).not.toContain("user@example.com");
    expect(result.diagnosticCode).toBe("app.unknown");
  });

  it("diagnosticCode poimitaan vain jos turvallinen", () => {
    const withCode = { diagnosticCode: "db.open.failed" };
    expect(fromUnknown(withCode).diagnosticCode).toBe("db.open.failed");
    const evil = { diagnosticCode: "evil code!" };
    expect(fromUnknown(evil).diagnosticCode).toBe("app.unknown");
  });

  it("bootstrap-config poimii ohjeen ja redaktoi", () => {
    const error = new Error("LifeOS config virheellinen: Puuttuu user@example.com");
    const result = fromBootstrapError(error);
    expect(result.title).toContain("Asetus");
    expect(result.body).not.toContain("user@example.com");
    expect(result.body).toContain("[sähköposti]");
  });

  it("bootstrap muu virhe -> geneerinen", () => {
    const result = fromBootstrapError(new Error("boom Bearer abcdefghijklmnop"));
    expect(result.title).toBe("Jokin epäonnistui");
    expect(result.body).not.toContain("Bearer");
  });
});

describe("reportError", () => {
  it("writes only a fixed development marker, never error content", () => {
    vi.stubEnv("DEV", true);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    reportError({
      title: "BP 180/120 journal text",
      body: "Bearer abcdefghijklmnop",
      actionLabel: null,
      diagnosticCode: "bp.180.120",
      level: "error",
    });

    expect(warning).toHaveBeenCalledExactlyOnceWith("[lifeos] Render error");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("180/120");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("abcdefghijklmnop");
  });

  it("does not write to the console in production", () => {
    vi.stubEnv("DEV", false);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    reportError({
      title: "Private health data",
      body: "Private journal text",
      actionLabel: null,
      diagnosticCode: "app.private-data",
      level: "error",
    });

    expect(warning).not.toHaveBeenCalled();
  });
});
