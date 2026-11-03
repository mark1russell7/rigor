/**
 * The seed of a text field of the page. The generator and the time-verdict explorer both use it.
 */

/** The seed of the text in the seed field: an integer is a number, other text is a string (hashed). */
export function seedFrom(text: string): number | string {
  const t = text.trim();
  return /^-?\d+$/.test(t) && Number.isSafeInteger(Number(t)) ? Number(t) : t;
}
