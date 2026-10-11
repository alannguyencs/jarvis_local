import { describe, expect, it } from "vitest";
import { formatTiming } from "./timing";

describe("formatTiming", () => {
  it("lists every step in seconds", () => {
    expect(formatTiming({ stt: 420, claude: 1530, warm: true, voice: 760, firstSound: 3110 })).toBe(
      "heard 0.4 s · Claude 1.5 s (warm) · voice 0.8 s · first sound 3.1 s",
    );
  });
  it("leaves out missing steps and the warm mark when cold", () => {
    expect(formatTiming({ stt: 400, claude: 3400, warm: false })).toBe("heard 0.4 s · Claude 3.4 s");
    expect(formatTiming(undefined)).toBe("");
  });
});
