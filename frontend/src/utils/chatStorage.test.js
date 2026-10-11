import { describe, expect, it } from "vitest";
import { loadChat, saveChat } from "./chatStorage";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

const throwing = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

describe("chatStorage", () => {
  it("round-trips turns and the session id", () => {
    const storage = memoryStorage();
    const chat = { turns: [{ id: 1, role: "user", text: "hi" }], sessionId: "abc" };
    saveChat(chat, storage);
    expect(loadChat(storage)).toEqual(chat);
  });

  it("starts empty when nothing is saved", () => {
    expect(loadChat(memoryStorage())).toEqual({ turns: [], sessionId: null });
  });

  it("drops malformed turns and ignores broken JSON", () => {
    const storage = memoryStorage();
    storage.setItem(
      "jarvis-local:chat",
      JSON.stringify({ turns: [{ id: 1, role: "user", text: "ok" }, { id: "x", role: "user", text: 1 }, null] }),
    );
    expect(loadChat(storage).turns).toEqual([{ id: 1, role: "user", text: "ok" }]);
    storage.setItem("jarvis-local:chat", "{not json");
    expect(loadChat(storage)).toEqual({ turns: [], sessionId: null });
  });

  it("clears the key for an empty chat", () => {
    const storage = memoryStorage();
    saveChat({ turns: [{ id: 1, role: "user", text: "hi" }], sessionId: "abc" }, storage);
    saveChat({ turns: [], sessionId: null }, storage);
    expect(storage.data.size).toBe(0);
  });

  it("never throws when storage is blocked", () => {
    expect(loadChat(throwing)).toEqual({ turns: [], sessionId: null });
    expect(() => saveChat({ turns: [], sessionId: "a" }, throwing)).not.toThrow();
  });
});
