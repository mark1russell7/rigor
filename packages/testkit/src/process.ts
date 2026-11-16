/**
 * The entries `/child` and `/stop` share these parts. They are the tail of the output of a child, the text of its end
 * and a wait with a time limit. This module is not an entry of the package.
 */

import type { ChildExit } from "./child.ts";

/** The fixtures keep this number of characters of the output of a child. */
export const OUTPUT_LIMIT: number = 256 * 1024;

/** This function gives the text with its last `OUTPUT_LIMIT` characters, at most. */
export function outputTail(text: string): string {
  return text.length > OUTPUT_LIMIT ? text.slice(-OUTPUT_LIMIT) : text;
}

/** This function gives the text of the end of a child. */
export function describeExit(exit: ChildExit | undefined): string {
  if (exit?.signal) return `the signal ${exit.signal}`;
  return `the code ${String(exit?.code)}`;
}

/** This function gives the value of a promise, or `undefined` when the promise takes more than `ms`. */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}
