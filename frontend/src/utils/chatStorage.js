// The chat survives a page reload: its turns and Claude's session id live in
// sessionStorage (this tab only). Storage can be missing or throw (private
// windows, blocked site data), so every access is guarded and the page
// simply starts empty when it fails.
const KEY = "jarvis-local:chat";
const ROLES = new Set(["user", "assistant", "error"]);

/** { turns, sessionId } as saved, or an empty chat. */
export function loadChat(storage = globalThis.sessionStorage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY) || "null");
    const turns = Array.isArray(saved?.turns)
      ? saved.turns.filter((t) => Number.isInteger(t?.id) && ROLES.has(t.role) && typeof t.text === "string")
      : [];
    const sessionId = typeof saved?.sessionId === "string" ? saved.sessionId : null;
    return { turns, sessionId };
  } catch {
    return { turns: [], sessionId: null };
  }
}

export function saveChat({ turns, sessionId }, storage = globalThis.sessionStorage) {
  try {
    if (turns.length === 0 && !sessionId) storage.removeItem(KEY);
    else storage.setItem(KEY, JSON.stringify({ turns, sessionId }));
  } catch {
    /* storage full or blocked: the chat just won't survive a reload */
  }
}
