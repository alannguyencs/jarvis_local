import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", async (orig) => ({
  ...(await orig()),
  getHealth: vi.fn().mockResolvedValue({ status: "ok", stt_loaded: true }),
}));
vi.mock("../api/voice", () => ({
  stt: vi.fn().mockResolvedValue({ text: "What is the capital of France?", duration_s: 1.6 }),
  ask: vi.fn().mockResolvedValue({
    answer: "The capital of France is Paris.",
    session_id: "11111111-1111-1111-1111-111111111111",
    duration_ms: 3000,
  }),
  tts: vi.fn().mockResolvedValue(new Blob(["wav"], { type: "audio/wav" })),
}));

// A fake microphone: MediaRecorder that hands back one chunk on stop.
class FakeRecorder {
  constructor() {
    this.mimeType = "audio/webm";
    this.state = "inactive";
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) });
    setTimeout(() => this.onstop?.(), 0);
  }
  static isTypeSupported() {
    return true;
  }
}

// A fake speaker: "plays" until a test ends it with FakeAudio.last.finish().
class FakeAudio {
  static last = null;
  constructor(src) {
    this.src = src;
    this.paused = true;
    FakeAudio.last = this;
  }
  play() {
    this.paused = false;
    setTimeout(() => this.onplaying?.(), 0);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  finish() {
    this.paused = true;
    this.onended?.();
  }
}

beforeEach(() => {
  sessionStorage.clear();
  globalThis.MediaRecorder = FakeRecorder;
  globalThis.Audio = FakeAudio;
  FakeAudio.last = null;
  URL.createObjectURL = () => "blob:answer";
  URL.revokeObjectURL = () => {};
  // As in current Chrome, where it returns a Promise (jsdom returns nothing).
  Element.prototype.scrollIntoView = () => Promise.resolve();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
});
// React reports misuse (e.g. an effect returning a Promise) with console.error
// before it turns into a crash in the browser, so any of it fails the test.
let consoleError;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  cleanup(); // no vitest globals, so Testing Library can't do this itself
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  vi.clearAllMocks();
});

const flush = () => act(() => new Promise((r) => setTimeout(r, 20)));

async function tap(name) {
  const button = screen.getByRole("button", { name });
  fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
  await flush();
  await flush();
}

async function renderPage() {
  const { default: VoicePage } = await import("./VoicePage");
  render(<VoicePage />);
  await flush();
}

const status = () => screen.getByRole("status").textContent;

describe("VoicePage", () => {
  it("shows the question and the answer, speaks it, then is ready again", async () => {
    const { tts } = await import("../api/voice");
    await renderPage();
    await tap("Talk");
    await tap("Stop recording");

    expect(screen.getByText("What is the capital of France?")).toBeTruthy();
    expect(screen.getByText("The capital of France is Paris.")).toBeTruthy();
    expect(tts).toHaveBeenCalledWith("The capital of France is Paris.");
    expect(status()).toMatch(/Speaking/);
    expect(FakeAudio.last.paused).toBe(false);
    // Each step's time, measured from releasing the mic.
    expect(screen.getByText(/^heard \d+\.\d s · Claude \d+\.\d s · voice \d+\.\d s · first sound \d+\.\d s$/)).toBeTruthy();

    await act(async () => FakeAudio.last.finish());
    await flush();
    expect(status()).toMatch(/Ready/);
  });

  it("pressing the mic while it speaks cuts the voice off and listens", async () => {
    await renderPage();
    await tap("Talk");
    await tap("Stop recording");
    const speaker = FakeAudio.last;
    expect(status()).toMatch(/Speaking/);

    await tap("Talk");
    expect(speaker.paused).toBe(true);
    expect(status()).toMatch(/Listening/);
  });

  it("still shows the answer when it can't be spoken", async () => {
    const { tts } = await import("../api/voice");
    tts.mockRejectedValueOnce(new Error("TTS down"));
    await renderPage();
    await tap("Talk");
    await tap("Stop recording");

    expect(screen.getByText("The capital of France is Paris.")).toBeTruthy();
    expect(screen.getByText("Couldn't speak this answer: TTS down")).toBeTruthy();
    expect(status()).toMatch(/Ready/);
  });

  it("Space works like the mic: hold to talk, release to send", async () => {
    const { stt } = await import("../api/voice");
    await renderPage();
    fireEvent.keyDown(window, { code: "Space", key: " " });
    await flush();
    expect(status()).toMatch(/Listening/);
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true }); // key repeat is ignored
    await act(() => new Promise((r) => setTimeout(r, 400))); // held past the tap limit
    fireEvent.keyUp(window, { code: "Space", key: " " });
    await flush();
    await flush();
    expect(stt).toHaveBeenCalledTimes(1);
    expect(screen.getByText("The capital of France is Paris.")).toBeTruthy();
  });

  it("Stop speaking cuts the voice off; Replay plays the same audio again", async () => {
    const { tts } = await import("../api/voice");
    await renderPage();
    await tap("Talk");
    await tap("Stop recording");
    const first = FakeAudio.last;

    fireEvent.click(screen.getByRole("button", { name: "Stop speaking" }));
    await flush();
    expect(first.paused).toBe(true);
    expect(status()).toMatch(/Ready/);
    expect(screen.queryByRole("button", { name: "Stop speaking" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Replay this answer" }));
    await flush();
    expect(status()).toMatch(/Speaking/);
    expect(FakeAudio.last).not.toBe(first);
    expect(tts).toHaveBeenCalledTimes(1); // the audio came from the cache
    await act(async () => FakeAudio.last.finish());
    await flush();
    expect(status()).toMatch(/Ready/);
  });

  it("keeps the chat and session across a reload; New conversation clears both", async () => {
    const { ask } = await import("../api/voice");
    await renderPage();
    await tap("Talk");
    await tap("Stop recording");
    await act(async () => FakeAudio.last.finish());
    cleanup(); // the "reload"

    await renderPage();
    expect(screen.getByText("The capital of France is Paris.")).toBeTruthy();
    await tap("Talk");
    await tap("Stop recording");
    expect(ask).toHaveBeenLastCalledWith("What is the capital of France?", "11111111-1111-1111-1111-111111111111");

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    await flush();
    expect(screen.queryByText("The capital of France is Paris.")).toBeNull();
    expect(sessionStorage.getItem("jarvis-local:chat")).toBeNull();
  });

  it("Replay right after Stop reuses the audio request that is still running", async () => {
    const { tts } = await import("../api/voice");
    let deliver;
    tts.mockImplementationOnce(() => new Promise((r) => (deliver = r)));
    await renderPage();
    await tap("Talk");
    await tap("Stop recording");
    expect(status()).toMatch(/Speaking/); // the audio has not arrived yet

    fireEvent.click(screen.getByRole("button", { name: "Stop speaking" }));
    fireEvent.click(screen.getByRole("button", { name: "Replay this answer" }));
    await act(async () => deliver(new Blob(["wav"], { type: "audio/wav" })));
    await flush();
    expect(tts).toHaveBeenCalledTimes(1);
    expect(FakeAudio.last.paused).toBe(false); // only the replay plays
  });

  it("records every turn, not just the first two (the mic stays open)", async () => {
    const { stt } = await import("../api/voice");
    await renderPage();
    for (let turn = 1; turn <= 4; turn++) {
      await tap("Talk");
      expect(status()).toMatch(/Listening/);
      await tap("Stop recording");
      await act(async () => FakeAudio.last.finish());
      await flush();
      expect(stt).toHaveBeenCalledTimes(turn);
    }
  });

  it("speaks a long answer piece by piece: the opening sentence first", async () => {
    const { ask, tts } = await import("../api/voice");
    const long = [
      "The moon is about four and a half billion years old.",
      "It formed after a large body hit the early Earth, and the debris came together in orbit.",
      "It is slowly moving away from us, by about four centimetres every year.",
      "Its gravity causes most of the tides in our oceans.",
    ].join(" ");
    ask.mockResolvedValueOnce({ answer: long, session_id: "11111111-1111-1111-1111-111111111111", duration_ms: 1, warm: true });
    await renderPage();
    await tap("Talk");
    await tap("Stop recording");

    // Only the opening sentence was asked for before the voice started.
    expect(tts).toHaveBeenCalledTimes(2);
    expect(tts.mock.calls[0][0]).toBe("The moon is about four and a half billion years old.");
    expect(tts.mock.calls[1][0]).toMatch(/^It formed after/);
    const first = FakeAudio.last;
    await act(async () => first.finish());
    await flush();
    expect(FakeAudio.last).not.toBe(first); // the second piece plays next
    expect(status()).toMatch(/Speaking/);
    await act(async () => FakeAudio.last.finish());
    await flush();
    expect(status()).toMatch(/Ready/);
  });
});
