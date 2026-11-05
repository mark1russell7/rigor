import { describe, expect, it } from "vitest";
import { hasWord } from "./read-words.ts";

describe("hasWord", () => {
  // Each row is a text, a word and the answer. The first rows are the characters that a regular expression reads as syntax.
  const rows: readonly (readonly [string, string, boolean])[] = [
    ["x a\\b y", "a\\b", true],
    ["x ab y", "a\\b", false],
    ["x a\\\\b y", "a\\\\b", true],
    ["x a\\b y", "a\\\\b", false],
    ["x \\d y", "\\d", true],
    ["x 7 y", "\\d", false],
    ["axb", "a.b", false],
    ["a.b", "a.b", true],
    ["aab", "a+b", false],
    ["a+b", "a+b", true],
    ["b", "a*b", false],
    ["x", "[x]", false],
    ["ab", "a|b", false],
    ["ab", "(ab)", false],
    ["(ab)", "(ab)", true],
    ["x", "^x$", false],
    ["fetch(url)", "fetch", true],
    ["fetcher", "fetch", false],
    ["prefetch", "fetch", false],
    ["fetcher fetch", "fetch", true],
    ["fetch", "fetch", true],
    ["import('x')", "import(", true],
    ["reimport('x')", "import(", false],
    ["process.env.HOME", "process.env", true],
    ["process.environment", "process.env", false],
    ["processxenv", "process.env", false],
    ["", "fetch", false],
    ["fetch", "", false],
  ];
  it.each(rows)("the text %j with the word %j", (text, word, answer) => {
    expect(hasWord(text, word)).toBe(answer);
  });
});
