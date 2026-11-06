import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fencedBlocks, mapImports, markdownExamples } from "./index.ts";

const root = mkdtempSync(join(import.meta.dirname, "..", "node_modules", ".tmp-markdown-examples-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** This function writes a file under the root of the test and gives its name. */
function write(name: string, text: string): string {
  const path = join(root, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return name;
}

const fence = "```";

describe("fencedBlocks", () => {
  it("gives each block with its language, its flags and the line of its fence", () => {
    const text = ["# Title", "", `${fence}ts`, "a();", `${fence}`, "", "~~~~ js no-run", "b();", "~~~~", `${fence}`, "c();", `${fence}`].join("\n");
    expect(fencedBlocks(text)).toEqual([
      { lang: "ts", flags: [], line: 3, code: "a();" },
      { lang: "js", flags: ["no-run"], line: 7, code: "b();" },
      { lang: "", flags: [], line: 10, code: "c();" },
    ]);
  });

  it("closes a fence only with the same character and at least the same length", () => {
    const text = [`${fence}${fence[0]}ts`, `${fence}`, "~~~", `${fence}${fence[0]}`].join("\n");
    expect(fencedBlocks(text)).toEqual([{ lang: "ts", flags: [], line: 1, code: `${fence}\n~~~` }]);
  });

  it("removes the indent of the opening fence, and runs an open block to the end", () => {
    const text = ["- item", "", `  ${fence}ts`, "  const x = 1;", "    nested();", "", `${fence}ts`, "open();"].join("\n");
    expect(fencedBlocks(text)).toEqual([
      { lang: "ts", flags: [], line: 3, code: "const x = 1;\n  nested();\n\n```ts\nopen();" },
    ]);
  });

  it("reads Windows line ends", () => {
    expect(fencedBlocks(`${fence}ts\r\nx();\r\n${fence}\r\n`)).toEqual([{ lang: "ts", flags: [], line: 1, code: "x();" }]);
  });
});

describe("mapImports", () => {
  it("maps each listed specifier to a file URL, and keeps the others", () => {
    const code = [
      `import { a } from "pkg";`,
      `import type { B } from 'pkg/sub';`,
      `import "pkg";`,
      `const m = await import("pkg");`,
      `import assert from "node:assert/strict";`,
      `const text = "from pkg";`,
    ].join("\n");
    const mapped = mapImports(code, { pkg: "/src/index.ts", "pkg/sub": "src/sub.ts" }, "/root");
    const lines = mapped.split("\n");
    expect(lines[0]).toMatch(/^import \{ a \} from "file:\/\/\/.*src\/index\.ts";$/);
    expect(lines[1]).toMatch(/^import type \{ B \} from 'file:\/\/\/.*root\/src\/sub\.ts';$/);
    expect(lines[2]).toMatch(/^import "file:\/\/\/.*src\/index\.ts";$/);
    expect(lines[3]).toMatch(/^const m = await import\("file:\/\/\/.*src\/index\.ts"\);$/);
    expect(lines[4]).toBe(`import assert from "node:assert/strict";`);
    expect(lines[5]).toBe(`const text = "from pkg";`);
  });
});

describe("markdownExamples", () => {
  const lib = write("lib/index.ts", "export const double = (value: number): number => value * 2;\n");
  const doc = write(
    "docs/guide.md",
    [
      "# Guide",
      "",
      `${fence}ts`,
      `import assert from "node:assert/strict";`,
      `import { double } from "my-lib";`,
      "assert.equal(double(2), 4);",
      fence,
      "",
      `${fence}ts no-run`,
      "this block does not compile",
      fence,
      "",
      `${fence}sh`,
      "npm i my-lib",
      fence,
      "",
      `${fence}ts`,
      `import assert from "node:assert/strict";`,
      `import { double } from "my-lib";`,
      "assert.equal(double(2), 5);",
      fence,
      "",
      `${fence}ts`,
      "const value: number = await Promise.resolve(3);",
      `if (value !== 3) throw new Error("no top-level await");`,
      fence,
    ].join("\n")
  );
  const cases = markdownExamples([doc], { root, imports: { "my-lib": lib } });

  it("gives one case for each block of the selected languages, with the flag no-run left out", () => {
    expect(cases.map((example) => example.name)).toEqual(["docs/guide.md:3", "docs/guide.md:17", "docs/guide.md:23"]);
    expect(cases[0]!.code).toContain(`from "my-lib"`);
  });

  it("runs a block that holds, with the import mapped to its source", async () => {
    await expect(cases[0]!.run()).resolves.toBeUndefined();
  });

  it("runs a block with top-level await", async () => {
    await expect(cases[2]!.run()).resolves.toBeUndefined();
  });

  it("fails a block whose assert fails, with its file and line (flip test)", async () => {
    const failed = cases[1]!.run();
    await expect(failed).rejects.toThrow(/^docs\/guide\.md:17: /);
    const error = await failed.catch((reason: unknown) => reason);
    expect((error as Error).cause).toMatchObject({ code: "ERR_ASSERTION" });
  });

  it("runs a block again on each call", async () => {
    const counter = write("lib/counter.ts", "export const seen: number[] = [];\n");
    const again = write("docs/again.md", [`${fence}ts`, `import { seen } from "counter";`, "seen.push(1);", fence].join("\n"));
    const [example] = markdownExamples([again], { root, imports: { counter } });
    await example!.run();
    await example!.run();
    const { seen } = (await import(join(root, counter))) as { seen: number[] };
    expect(seen).toEqual([1, 1]);
  });

  it("refuses a language that it cannot run", () => {
    expect(() => markdownExamples([doc], { root, lang: ["sh"] })).toThrow(RangeError);
  });
});
