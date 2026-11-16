import { STATUS_CODES } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as entry from "./applier-entry.ts";
import * as root from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** This function gives the specifiers of the static imports and re-exports of a source file. */
function specifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^\s*(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1] as string);
}

describe("the entry applier", () => {
  it("reaches no module of Node.js through the files of this package", () => {
    const seen = new Set<string>();
    const nodeModules: string[] = [];
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const s of specifiers(file)) {
        if (s.startsWith("node:")) nodeModules.push(`${file}: ${s}`);
        else if (s.startsWith(".")) visit(join(dirname(file), s));
      }
    };
    visit(join(here, "applier-entry.ts"));
    expect([...seen].map((f) => f.slice(here.length + 1)).sort()).toEqual(["answer.ts", "applier-entry.ts", "applier.ts", "framers.ts"]);
    expect(nodeModules).toEqual([]);
  });

  it("exports the same values as the entry of the package", () => {
    for (const [name, value] of Object.entries(entry)) expect((root as Record<string, unknown>)[name], name).toBe(value);
  });

  it("has the reason of each status of node:http", () => {
    const node = Object.fromEntries(Object.entries(STATUS_CODES).map(([code, reason]) => [Number(code), reason]));
    expect(entry.REASONS).toEqual(node);
  });
});
