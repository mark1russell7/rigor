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

  it("counts a comment two times when the file has it two times", () => {
    const a = found.filter((d) => d.file === "src/a.ts");
    expect(compareDisables(a, a).ok).toBe(true);
    expect(compareDisables(a, a.slice(1))).toMatchObject({ ok: false, added: [`src/a.ts: ${A}`], removed: [] });
    expect(compareDisables(a.slice(1), a)).toMatchObject({ ok: false, added: [], removed: [`src/a.ts: ${A}`] });
  });
});
