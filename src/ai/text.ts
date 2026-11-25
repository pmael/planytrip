// Small clean-ups of what the AI writes, shared by everything that stores it.

/** Models sometimes double-escape the quotes inside structured output: `\"light\"` should read `"light"`. */
export const tidyText = (text: string) => text.replace(/\\(["'])/g, "$1").trim();

/** Cuts a text to `max` characters, at a word when it can, with an ellipsis. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
