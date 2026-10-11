// An answer is spoken in pieces so the voice starts sooner: the first piece
// is the opening sentence (ready in well under a second), and the rest come
// in larger pieces that are made while the earlier ones play. Speech is made
// about 8x faster than it is spoken, so the next piece is always ready.
//
// While Claude is still writing, only finished sentences are let out: a
// sentence is finished once whitespace follows its . ! ? (so "2." in "2.1"
// is not an end).

const FIRST_MIN_CHARS = 30;
// A longer opening sentence is cut at a clause break (, ; : —) for the first
// piece only: that piece decides when the voice starts, and the voice
// pauses there anyway. Later pieces are made while earlier ones play.
const FIRST_MAX_CHARS = 90;
const REST_MIN_CHARS = 200;
const CLAUSE_BREAK = /[,;:—–](?=\s)/g;

/** Where to end a too-long first piece: after the last clause break in range, else -1. */
function clauseCut(text) {
  let cut = -1;
  for (const m of text.matchAll(CLAUSE_BREAK)) {
    const end = m.index + 1;
    if (end > FIRST_MAX_CHARS) break;
    if (end >= FIRST_MIN_CHARS) cut = end;
  }
  return cut;
}
const BOUNDARY = /(?<=[.!?…]["')\]]*)\s+|\n+/g;

/** The answer's sentences, split after . ! ? (or a line break). */
export function sentences(text) {
  return text
    .split(new RegExp(BOUNDARY.source))
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/**
 * Cut an answer into pieces as it arrives. `push(text)` adds the next part
 * and returns the pieces now ready; `flush()` returns the rest at the end.
 * The first piece is at least FIRST_MIN_CHARS (so "Sure." is not spoken
 * alone) and, where a clause break allows, at most FIRST_MAX_CHARS; later
 * ones are at least REST_MIN_CHARS. Only that first long sentence is ever
 * cut, and only at a clause break.
 */
export function createChunker() {
  let unread = ""; // text after the last finished sentence
  let group = ""; // finished sentences not yet long enough for a piece
  let count = 0; // pieces let out so far

  function take(list) {
    const ready = [];
    for (const sentence of list) {
      group = group ? `${group} ${sentence}` : sentence;
      const cut = count === 0 && group.length > FIRST_MAX_CHARS ? clauseCut(group) : -1;
      if (cut > 0) {
        ready.push(group.slice(0, cut));
        group = group.slice(cut).trim();
        count += 1;
      }
      if (group.length >= (count === 0 ? FIRST_MIN_CHARS : REST_MIN_CHARS)) {
        ready.push(group);
        group = "";
        count += 1;
      }
    }
    return ready;
  }

  return {
    push(text) {
      unread += text;
      let end = 0;
      for (const m of unread.matchAll(BOUNDARY)) end = m.index + m[0].length;
      if (end === 0) return [];
      const finished = unread.slice(0, end);
      unread = unread.slice(end);
      return take(sentences(finished));
    },
    flush() {
      const ready = take(sentences(unread));
      unread = "";
      if (group) ready.push(group);
      group = "";
      return ready;
    },
  };
}

/** All the pieces of a finished answer. */
export function speechChunks(text) {
  const chunker = createChunker();
  return [...chunker.push(text), ...chunker.flush()];
}
