import { describe, expect, it } from "vitest";
import { compareDisables, findDisables } from "./disables.ts";

const A = "// Stryker disable next-line ConditionalExpression: the two branches give the same value";
const files = [
  { file: "src/a.ts", text: `const x = 1;\n  ${A}\nconst y = x ? 1 : 1;\n  ${A}\n` },
  { file: "src/b.ts", text: "// Stryker disable next-line all\nconst z = 2;\n" },
];

describe("disables", () => {
  const found = findDisables(files);

  it("finds each comment, trimmed", () => {
    expect(found).toEqual([
      { file: "src/a.ts", comment: A },
      { file: "src/a.ts", comment: A },
      { file: "src/b.ts", comment: "// Stryker disable next-line all" },
    ]);
  });

  it("refuses a comment with no reason", () => {
    const check = compareDisables(found, found);
    expect(check.ok).toBe(false);
    expect(check.noReason).toEqual([{ file: "src/b.ts", comment: "// Stryker disable next-line all" }]);
  });

  it("needs a mutator, a colon, a space and a text for a reason", () => {
    const reason = (comment: string): boolean => compareDisables([{ file: "f", comment }], [{ file: "f", comment }]).ok;
    expect(reason("// Stryker disable next-line all: the bound is equal")).toBe(true);
    expect(reason("// Stryker disable next-line all:")).toBe(false);
    expect(reason("// Stryker disable next-line all: ")).toBe(false);
    expect(reason("// Stryker disable next-line all:x")).toBe(false);
    expect(reason("// Stryker disable : x")).toBe(false);
  });

  // CodeQL js/polynomial-redos: a regular expression here was quadratic in the repeats of "Stryker disable "
  it("reads a long comment of repeats in linear time", () => {
    const comment = `// ${"Stryker disable ".repeat(200_000)}`;
    const start = performance.now();
    expect(compareDisables([{ file: "f", comment }], [{ file: "f", comment }]).ok).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("counts a comment two times when the file has it two times", () => {
    const a = found.filter((d) => d.file === "src/a.ts");
    expect(compareDisables(a, a).ok).toBe(true);
    expect(compareDisables(a, a.slice(1))).toMatchObject({ ok: false, added: [`src/a.ts: ${A}`], removed: [] });
    expect(compareDisables(a.slice(1), a)).toMatchObject({ ok: false, added: [], removed: [`src/a.ts: ${A}`] });
  });
});
