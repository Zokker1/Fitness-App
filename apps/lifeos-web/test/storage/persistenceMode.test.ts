import { describe, expect, it } from "vitest";
import {
  isLocalContentEncryptionEnabled,
  isPersistentStorage,
} from "../../src/storage/persistenceMode.ts";

describe("isPersistentStorage", () => {
  it("keeps persistent storage as the normal app default", () => {
    expect(isPersistentStorage("")).toBe(true);
  });

  it("keeps persistent storage as the E2E runtime default", () => {
    expect(isPersistentStorage("")).toBe(true);
  });

  it("honors explicit persistent and memory overrides in every mode", () => {
    expect(isPersistentStorage("?storage=pysyva")).toBe(true);
    expect(isPersistentStorage("?storage=muisti")).toBe(false);
  });

  it("requires encryption in production and on explicit E2E storage paths", () => {
    expect(isLocalContentEncryptionEnabled("", "production")).toBe(true);
    expect(isLocalContentEncryptionEnabled("", "e2e")).toBe(false);
    expect(isLocalContentEncryptionEnabled("?storage=pysyva", "e2e")).toBe(true);
    expect(isLocalContentEncryptionEnabled("?storage=muisti", "production")).toBe(false);
  });
});
