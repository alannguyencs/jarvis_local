import { describe, expect, it, vi } from "vitest";
import { createSpeechQueue } from "./speechQueue";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createSpeechQueue", () => {
  it("gives each piece's audio in order, waiting for pieces still to come", async () => {
    const make = vi.fn(async (text) => `audio:${text}`);
    const queue = createSpeechQueue(make);
    const got = [];
    const reading = (async () => {
      for await (const audio of queue) got.push(audio);
    })();
    queue.add("one");
    await tick();
    expect(got).toEqual(["audio:one"]);
    queue.add("two");
    queue.close();
    await reading;
    expect(got).toEqual(["audio:one", "audio:two"]);
  });

  it("asks for a piece only after the one before it has arrived", async () => {
    let deliver;
    const make = vi.fn((text) => (text === "one" ? new Promise((r) => (deliver = r)) : Promise.resolve(text)));
    const queue = createSpeechQueue(make);
    queue.add("one");
    queue.add("two");
    await tick();
    expect(make).toHaveBeenCalledTimes(1);
    deliver("one");
    await tick();
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("can be read again without asking twice, and reports a failed piece", async () => {
    const make = vi.fn(async (text) => {
      if (text === "bad") throw new Error("TTS down");
      return text;
    });
    const queue = createSpeechQueue(make);
    queue.add("good");
    queue.close();
    for await (const _ of queue);
    for await (const _ of queue);
    expect(make).toHaveBeenCalledTimes(1);

    const broken = createSpeechQueue(make);
    broken.add("bad");
    broken.close();
    await expect((async () => {
      for await (const _ of broken);
    })()).rejects.toThrow("TTS down");
  });
});
