import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const headersPath = resolve(process.cwd(), "public/_headers");
const headerConfig = readFileSync(headersPath, "utf8");
const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const themeBoot = readFileSync(resolve(process.cwd(), "public/theme-boot.js"), "utf8");
const headerValues = new Map<string, string>();

for (const line of headerConfig.split(/\r?\n/u)) {
  const match = /^\s{2}([^:]+):\s*(.+)$/u.exec(line);
  const name = match?.[1];
  const value = match?.[2];
  if (name !== undefined && value !== undefined) {
    headerValues.set(name.toLowerCase(), value);
  }
}

function parseCsp(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const directive of value.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/u);
    if (name !== undefined && name.length > 0) {
      directives.set(name, sources);
    }
  }
  return directives;
}

describe("production security headers", () => {
  it("sets the baseline browser security headers", () => {
    expect(headerConfig).toContain("/*");
    expect(headerValues.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headerValues.get("x-content-type-options")).toBe("nosniff");
    expect(headerValues.get("x-frame-options")).toBe("DENY");
    expect(headerValues.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("limits script execution and permits only the runtime's declared origins", () => {
    const cspValue = headerValues.get("content-security-policy");
    expect(cspValue).toBeDefined();
    expect(cspValue?.length).toBeLessThan(2000);
    const csp = parseCsp(cspValue ?? "");

    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("require-trusted-types-for")).toEqual(["'script'"]);
    expect(csp.get("script-src")).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
      "https://accounts.google.com/gsi/client",
    ]);
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
    expect(csp.get("script-src")).not.toContain("'unsafe-eval'");
    expect(csp.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
    expect(csp.get("connect-src")).toContain("https://www.googleapis.com");
    expect(csp.get("connect-src")).toContain("https://content.googleapis.com");
    expect(csp.get("connect-src")).toContain("https://accounts.google.com/gsi/");
    expect(csp.get("frame-src")).toContain("https://accounts.google.com/gsi/");
    expect(csp.get("font-src")).toEqual(["'self'"]);
    expect(csp.get("worker-src")).toEqual(["'self'"]);
  });

  it("keeps the early theme bootstrap external for the script policy", () => {
    expect(indexHtml).toContain('<script src="/theme-boot.js"></script>');
    expect(indexHtml).not.toMatch(/<script\s*>/u);
    expect(themeBoot).toContain('localStorage.getItem("lifeos.theme.v1")');
    expect(themeBoot).toContain('localStorage.getItem("lifeos.language.v1")');
    expect(themeBoot).toContain('createPolicy("default"');
    expect(themeBoot).toContain("url.origin === window.location.origin");
    expect(themeBoot).toContain('url.pathname === "/gsi/client"');
  });

  it("does not ship raw HTML string sinks in the application or UI source", () => {
    const sourceRoots = [
      resolve(process.cwd(), "src"),
      resolve(process.cwd(), "../../packages/ui/src"),
    ];
    const sourceFiles: string[] = [];
    const collect = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          collect(entryPath);
        } else if (/\.tsx?$/u.test(entry.name)) {
          sourceFiles.push(readFileSync(entryPath, "utf8"));
        }
      }
    };
    for (const root of sourceRoots) collect(root);
    expect(sourceFiles.join("\n")).not.toMatch(
      /\b(?:dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML)\b/u,
    );
  });
});
