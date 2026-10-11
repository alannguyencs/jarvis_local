// An answer is spoken in pieces so the voice starts sooner: the first piece
// is the opening sentence (ready in well under a second), and the rest come
// in larger pieces that are made while the earlier ones play. Speech is made
// about 8x faster than it is spoken, so the next piece is always ready.

const FIRST_MIN_CHARS = 30;
const REST_MIN_CHARS = 200;

/** The answer's sentences, split after . ! ? (or a line break). */
export function sentences(text) {
  return text
    .split(/(?<=[.!?…]["')\]]*)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/**
 * Pieces to speak, in order: a short first piece (at least FIRST_MIN_CHARS,
 * so "Sure." is not spoken alone), then pieces of at least REST_MIN_CHARS.
 * Sentences are never cut.
 */
export function speechChunks(text) {
  const chunks = [];
  let current = "";
  for (const sentence of sentences(text)) {
    current = current ? `${current} ${sentence}` : sentence;
    const min = chunks.length === 0 ? FIRST_MIN_CHARS : REST_MIN_CHARS;
    if (current.length >= min) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
