/** SQL fixture IDs and serialized documents must be text, never objects. */
export function sqlText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error("Expected a text SQL fixture value");
  return value;
}

export function parseSqlDocument(value: unknown): Record<string, unknown> {
  const parsed: unknown = JSON.parse(sqlText(value));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected an object SQL fixture document");
  }
  return parsed as Record<string, unknown>;
}
