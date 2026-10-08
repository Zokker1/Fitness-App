/** Persistent storage is the app default; `?storage=muisti` opts into memory. */
export function isPersistentStorage(search: string): boolean {
  return new URLSearchParams(search).get("storage") !== "muisti";
}

/** E2E's ordinary UI fixtures skip the key gate; explicit storage paths test it. */
export function isLocalContentEncryptionEnabled(
  search: string,
  mode = import.meta.env.MODE,
): boolean {
  const persistent = isPersistentStorage(search);
  const hasExplicitStorage = new URLSearchParams(search).has("storage");
  return persistent && (mode !== "e2e" || hasExplicitStorage);
}
