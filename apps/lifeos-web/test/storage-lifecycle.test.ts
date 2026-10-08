// T036: lifecycle-pure-testit (web-paketti, happy-dom). Deterministinen:
// käyttöaste, luokittelu, muotoilu, ohjeet. Ei selaimen Storage-APIa —
// puhdas lifecycle-moduuli suoraan src:stä (ei data-kerroksen kautta).
import { describe, expect, it } from "vitest";
import {
  buildStorageStatus,
  classifyStorageWarning,
  computeUsageRatio,
  formatBytesFi,
  formatRatioFi,
  getStorageGuidance,
  shouldRequestPersistence,
  warningToLevel,
} from "../src/storage/lifecycle.ts";

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

describe("computeUsageRatio", () => {
  it("laskee suhteen 0..1", () => {
    expect(computeUsageRatio(1000, 250)).toBeCloseTo(0.25);
    expect(computeUsageRatio(1000, 1000)).toBe(1);
  });

  it("rajaa yli yhden ja hylkää virheelliset", () => {
    expect(computeUsageRatio(1000, 5000)).toBe(1);
    expect(computeUsageRatio(null, 100)).toBeNull();
    expect(computeUsageRatio(100, null)).toBeNull();
    expect(computeUsageRatio(0, 0)).toBeNull();
    expect(computeUsageRatio(-100, 10)).toBeNull();
    expect(computeUsageRatio(100, -10)).toBeNull();
  });
});

describe("formatBytesFi / formatRatioFi", () => {
  it("muotoilee tavut suomeksi ilman salaisuuksia", () => {
    expect(formatBytesFi(null)).toBe("—");
    expect(formatBytesFi(-1)).toBe("—");
    expect(formatBytesFi(512)).toContain("t");
    expect(formatBytesFi(2048)).toContain("Kt");
    expect(formatBytesFi(3 * 1024 * 1024)).toContain("Mt");
  });

  it("muotoilee prosentin tai viivan", () => {
    expect(formatRatioFi(null)).toBe("—");
    expect(formatRatioFi(0.5)).toContain("50");
    expect(formatRatioFi(2)).toContain("100");
  });
});

describe("classifyStorageWarning", () => {
  it("ok pysyvässä matalassa käytössä", () => {
    expect(classifyStorageWarning(BASE_SNAPSHOT, BASE_DB)).toBe("none");
  });

  it("muisti-fallback on aina kriittinen", () => {
    expect(classifyStorageWarning(BASE_SNAPSHOT, { ...BASE_DB, backend: "memory" })).toBe(
      "muisti-fallback",
    );
  });

  it("best-effort kun persisted false ja käyttö matala", () => {
    expect(classifyStorageWarning({ ...BASE_SNAPSHOT, persisted: false }, BASE_DB)).toBe(
      "best-effort",
    );
  });

  it("quota-huomio 70%+ ja kriittinen 90%+", () => {
    expect(
      classifyStorageWarning(
        { ...BASE_SNAPSHOT, persisted: true, quotaBytes: 1000, usageBytes: 750 },
        BASE_DB,
      ),
    ).toBe("quota-huomio");
    expect(
      classifyStorageWarning(
        { ...BASE_SNAPSHOT, persisted: true, quotaBytes: 1000, usageBytes: 950 },
        BASE_DB,
      ),
    ).toBe("quota-kriittinen");
  });

  it("ei-tuettu kun mikään lukema ei saatavilla", () => {
    expect(
      classifyStorageWarning(
        { opfsSupported: false, persisted: null, quotaBytes: null, usageBytes: null },
        BASE_DB,
      ),
    ).toBe("ei-tuettu");
  });

  it("tuntematon kun snapshot puuttuu", () => {
    expect(classifyStorageWarning(null, BASE_DB)).toBe("tuntematon");
  });
});

describe("warningToLevel + buildStorageStatus", () => {
  it("tasot karttuvat oikein", () => {
    expect(warningToLevel("none")).toBe("ok");
    expect(warningToLevel("best-effort")).toBe("huomio");
    expect(warningToLevel("quota-huomio")).toBe("huomio");
    expect(warningToLevel("quota-kriittinen")).toBe("kriittinen");
    expect(warningToLevel("muisti-fallback")).toBe("kriittinen");
    expect(warningToLevel("ei-tuettu")).toBe("tuntematon");
    expect(warningToLevel("tuntematon")).toBe("tuntematon");
  });

  it("status kokoaa liput (backup-ohje + persist-nappi)", () => {
    const ok = buildStorageStatus(BASE_SNAPSHOT, BASE_DB);
    expect(ok.warning).toBe("none");
    expect(ok.needsBackupGuidance).toBe(false);
    expect(ok.canRequestPersistence).toBe(false);

    const bestEffort = buildStorageStatus({ ...BASE_SNAPSHOT, persisted: false }, BASE_DB);
    expect(bestEffort.needsBackupGuidance).toBe(true);
    expect(bestEffort.canRequestPersistence).toBe(true);

    const fallback = buildStorageStatus(BASE_SNAPSHOT, { ...BASE_DB, backend: "memory" });
    expect(fallback.level).toBe("kriittinen");
    // Välimuistissa persist-nappi ei auta — ohje korvaa sen.
    expect(fallback.canRequestPersistence).toBe(false);
  });

  it("shouldRequestPersistence vain kun persisted === false", () => {
    expect(shouldRequestPersistence({ ...BASE_SNAPSHOT, persisted: false })).toBe(true);
    expect(shouldRequestPersistence(BASE_SNAPSHOT)).toBe(false);
    expect(shouldRequestPersistence({ ...BASE_SNAPSHOT, persisted: null })).toBe(false);
  });
});

describe("getStorageGuidance", () => {
  it("jokaisella varoituksella on selkeä ohje ilman PII:tä", () => {
    const warnings = [
      "none",
      "best-effort",
      "quota-huomio",
      "quota-kriittinen",
      "muisti-fallback",
      "ei-tuettu",
      "tuntematon",
    ] as const;
    for (const warning of warnings) {
      const guidance = getStorageGuidance(warning);
      expect(guidance.title.length).toBeGreaterThan(0);
      expect(guidance.body.length).toBeGreaterThan(0);
    }
    // §59 kohta 18: quota-ohje ohjaa backupiin.
    expect(getStorageGuidance("quota-kriittinen").body).toMatch(/varmuuskopio/i);
    expect(getStorageGuidance("best-effort").body).toMatch(/sivustodata/i);
  });
});
