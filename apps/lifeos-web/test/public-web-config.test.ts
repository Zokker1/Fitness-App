import { describe, expect, it } from "vitest";
import { validatePublicWebConfig } from "@lifeos/config";

const clientId = "lifeos-test.apps.googleusercontent.com";

function validate(appOrigin: string, options: { isDev?: boolean; runtimeOrigin?: string } = {}) {
  const runtimeOptions =
    options.runtimeOrigin === undefined ? {} : { runtimeOrigin: options.runtimeOrigin };
  return validatePublicWebConfig(
    { appOrigin, googleClientId: clientId },
    { isDev: options.isDev ?? false, ...runtimeOptions },
  );
}

describe("public web origin config", () => {
  it.each([
    "https://lifeos.example/path",
    "https://lifeos.example/",
    "https://lifeos.example?next=evil",
    "https://lifeos.example#fragment",
    "https://user@lifeos.example",
    "https://lifeos.example:0",
    "https://lifeos.example:65536",
    "http://localhost:5173.evil.example",
    "http://localhost.evil.example:5173",
    "http://127.0.0.1.attacker.example:5173",
    "http://127.0.0.1:99999",
    "https://bad..example",
  ])("rejects a malformed or non-origin value: %s", (appOrigin) => {
    expect(validate(appOrigin, { isDev: true }).ok).toBe(false);
  });

  it("accepts only exact local loopback origins for local config", () => {
    expect(validate("http://localhost:5173", { runtimeOrigin: "http://127.0.0.1:4173" }).ok).toBe(
      true,
    );
    expect(validate("http://127.0.0.1", { runtimeOrigin: "http://localhost:5173" }).ok).toBe(true);
    expect(
      validate("http://localhost:5173", { runtimeOrigin: "http://localhost:5173.evil.example" }),
    ).toMatchObject({ ok: false, error: { code: "insecure-production-origin" } });
  });

  it("matches deployed origins after normalizing the default HTTPS port", () => {
    expect(
      validate("https://lifeos.example", { runtimeOrigin: "https://LIFEOS.example:443" }).ok,
    ).toBe(true);
    expect(
      validate("https://lifeos.example", { runtimeOrigin: "https://other.example" }),
    ).toMatchObject({ ok: false, error: { code: "origin-mismatch" } });
    expect(
      validate("https://lifeos.example", { runtimeOrigin: "http://lifeos.example" }),
    ).toMatchObject({ ok: false, error: { code: "origin-mismatch" } });
  });

  it("allows a loopback preview for a production-configured build", () => {
    expect(validate("https://lifeos.example", { runtimeOrigin: "http://127.0.0.1:4173" }).ok).toBe(
      true,
    );
  });
});
