import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readTypeScriptSources(root: string): readonly { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/u.test(entry.name)) {
        files.push({ path, source: readFileSync(path, "utf8") });
      }
    }
  };
  walk(root);
  return files;
}

describe("browser diagnostics logging", () => {
  it("keeps browser console writes behind the redacted DEV error boundary", () => {
    const sources = readTypeScriptSources(resolve(process.cwd(), "src"));
    const writes = sources.flatMap(({ path, source }) => {
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, "");
      const calls =
        withoutComments.match(/\bconsole\.(?:log|warn|error|info|debug|table|trace|dir)\s*\(/gu) ??
        [];
      return calls.map((call) => ({ path, call }));
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(resolve(process.cwd(), "src/errors/appError.ts"));
    expect(writes[0]?.call).toBe("console.warn(");
  });
});
