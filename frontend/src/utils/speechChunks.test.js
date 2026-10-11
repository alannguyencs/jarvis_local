import { describe, expect, it } from "vitest";
import { createChunker, sentences, speechChunks } from "./speechChunks";

describe("sentences", () => {
  it("splits after sentence ends and line breaks, keeping the punctuation", () => {
    expect(sentences('One. Two! "Three?" Four…\nFive')).toEqual(["One.", "Two!", '"Three?"', "Four…", "Five"]);
  });
  it("keeps decimals and drops pieces with no words", () => {
    expect(sentences("Paris has 2.1 million people. ---\n\n")).toEqual(["Paris has 2.1 million people."]);
  });
});

describe("speechChunks", () => {
  it("speaks the opening sentence alone, then larger pieces", () => {
    const rest = Array.from({ length: 6 }, (_, i) => `This is sentence number ${i + 2} of the answer, with some words.`);
    const chunks = speechChunks(["The moon is about four and a half billion years old.", ...rest].join(" "));
    expect(chunks[0]).toBe("The moon is about four and a half billion years old.");
    expect(chunks.length).toBe(3);
    expect(chunks[1].length).toBeGreaterThanOrEqual(200);
    expect(chunks.join(" ")).not.toMatch(/\s{2}/);
  });
  it("joins a very short opener with the next sentence", () => {
    expect(speechChunks("Sure. The capital of France is Paris.")).toEqual(["Sure. The capital of France is Paris."]);
  });
  it("keeps a short answer in one piece, and every word in some piece", () => {
    const text = "Paris. It is big. It is old.";
    expect(speechChunks(text).join(" ")).toBe(text);
  });
  it("gives nothing for an answer with no words", () => {
    expect(speechChunks("--- \n ***")).toEqual([]);
  });
});

describe("createChunker", () => {
  it("lets a sentence out only once it is finished, as the text streams in", () => {
    const chunker = createChunker();
    expect(chunker.push("The moon is about 384")).toEqual([]);
    expect(chunker.push(",000 kilometres away. It")).toEqual(["The moon is about 384,000 kilometres away."]);
    expect(chunker.push(" has no air.")).toEqual([]); // waiting: maybe more follows, and later pieces are bigger
    expect(chunker.flush()).toEqual(["It has no air."]);
  });
  it("does not end a sentence at a decimal point", () => {
    const chunker = createChunker();
    expect(chunker.push("Paris has about 2.")).toEqual([]);
    expect(chunker.push("1 million people living in the city itself. Wow")).toEqual([
      "Paris has about 2.1 million people living in the city itself.",
    ]);
  });
  it("gives the same pieces streamed word by word as all at once", () => {
    const text = Array.from({ length: 9 }, (_, i) => `Sentence ${i + 1} has a few words in it, more or less.`).join(" ");
    const chunker = createChunker();
    const streamed = [];
    for (const word of text.split(/(?= )/)) streamed.push(...chunker.push(word));
    streamed.push(...chunker.flush());
    expect(streamed).toEqual(speechChunks(text));
  });
});

describe("the first piece", () => {
  it("ends at a clause break when the opening sentence is long", () => {
    const opener =
      "Viruses and bacteria are both tiny, but bacteria are living cells that can reproduce on their own, while viruses need a host.";
    const [first, second] = speechChunks(`${opener} That is the main difference.`);
    // The second comma ends at character 96, past the limit: cut at the first.
    expect(first).toBe("Viruses and bacteria are both tiny,");
    expect(second).toBe(
      "but bacteria are living cells that can reproduce on their own, while viruses need a host. That is the main difference.",
    );
  });
  it("stays whole when there is no clause break in range", () => {
    const opener = "This opening sentence goes on and on without any commas at all until it is far longer than ninety characters.";
    expect(speechChunks(opener)).toEqual([opener]);
  });
  it("does not cut a short opening sentence", () => {
    expect(speechChunks("Yes, the capital of France is Paris.")).toEqual(["Yes, the capital of France is Paris."]);
  });
});
