import { describe, expect, it } from "vitest";
import { fileNameFor, micErrorMessage, pickMimeType } from "./recording";

describe("pickMimeType", () => {
  it("prefers webm/opus", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });
  it("falls back to mp4 on Safari", () => {
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
  });
  it("returns empty when nothing listed is supported", () => {
    expect(pickMimeType(() => false)).toBe("");
  });
});

describe("fileNameFor", () => {
  it("uses the subtype without codecs", () => {
    expect(fileNameFor("audio/webm;codecs=opus")).toBe("recording.webm");
    expect(fileNameFor("audio/mp4")).toBe("recording.mp4");
  });
  it("defaults to webm", () => {
    expect(fileNameFor("")).toBe("recording.webm");
  });
});

describe("micErrorMessage", () => {
  it("explains a blocked microphone", () => {
    expect(micErrorMessage({ name: "NotAllowedError" })).toMatch(/blocked/);
  });
  it("explains a missing microphone", () => {
    expect(micErrorMessage({ name: "NotFoundError" })).toBe("No microphone found.");
  });
});
