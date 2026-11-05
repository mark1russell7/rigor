/** The test of a word against the text of a bundle. This file is internal, so its name is not in the public API. */

const isWordCharacter = (character: string | undefined): boolean => character !== undefined && /\w/.test(character);

/**
 * This function tells if a text holds a word. Each character of the word is literal, so no character of the word needs an escape.
 * A word edge that is a word character must also be a word boundary in the text, so `fetch` is not in `fetcher`, and `import(` is not in `reimport(`.
 * An empty word is in no text.
 */
export function hasWord(text: string, word: string): boolean {
  if (word === "") return false;
  const startEdge = isWordCharacter(word[0]);
  const endEdge = isWordCharacter(word.at(-1));
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    const startOk = !startEdge || !isWordCharacter(text[at - 1]);
    const endOk = !endEdge || !isWordCharacter(text[at + word.length]);
    if (startOk && endOk) return true;
  }
  return false;
}
