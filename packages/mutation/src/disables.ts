/**
 * A comment `// Stryker disable next-line <Mutator>: <reason>` disables a mutant that is equivalent. The disable
 * raises the score, so each one is also in a list with its reason. These functions find the comments in the
 * sources and compare them with the list.
 */

/** One disable comment of a source file. */
export interface Disable {
  readonly file: string;
  readonly comment: string;
}

/** The result of `compareDisables`. */
export interface DisableCheck {
  /** The comments of the sources that are not in the list, as `file: comment`. */
  readonly added: readonly string[];
  /** The comments of the list that are not in the sources, as `file: comment`. */
  readonly removed: readonly string[];
  /** The comments with no reason after a colon. */
  readonly noReason: readonly Disable[];
  readonly ok: boolean;
}

/** This function finds each `Stryker disable` comment of the files. A file name uses `/`. */
export function findDisables(files: readonly { readonly file: string; readonly text: string }[]): Disable[] {
  return files.flatMap(({ file, text }) =>
    text
      .split("\n")
      .filter((line) => line.includes("Stryker disable"))
      .map((line) => ({ file, comment: line.trim() })),
  );
}

const counts = (xs: readonly Disable[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = `${x.file}: ${x.comment}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};

/** This function compares the comments of the sources with the list. A file with the same comment two times needs it two times in the list. */
export function compareDisables(found: readonly Disable[], listed: readonly Disable[]): DisableCheck {
  const noReason = found.filter((d) => !/Stryker disable [^:]+: \S/.test(d.comment));
  const a = counts(found);
  const b = counts(listed);
  const added = [...a].filter(([k, n]) => n > (b.get(k) ?? 0)).map(([k]) => k);
  const removed = [...b].filter(([k, n]) => n > (a.get(k) ?? 0)).map(([k]) => k);
  return { added, removed, noReason, ok: added.length === 0 && removed.length === 0 && noReason.length === 0 };
}
