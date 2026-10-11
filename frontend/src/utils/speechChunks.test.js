import { describe, expect, it } from "vitest";
import { sentences, speechChunks } from "./speechChunks";

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
