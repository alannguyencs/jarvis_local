import { describe, expect, it } from "vitest";
import { formatTiming } from "./timing";

describe("formatTiming", () => {
  it("lists every step in seconds", () => {
    expect(formatTiming({ stt: 420, claude: 1230, warm: true, sentence: 310, voice: 520, firstSound: 2610 })).toBe(
      "heard 0.4 s · Claude 1.2 s (warm) · sentence 0.3 s · voice 0.5 s · first sound 2.6 s",
    );
  });
  it("leaves out missing steps and the warm mark when cold", () => {
    expect(formatTiming({ stt: 400, claude: 3400, warm: false })).toBe("heard 0.4 s · Claude 3.4 s");
    expect(formatTiming(undefined)).toBe("");
  });
});
