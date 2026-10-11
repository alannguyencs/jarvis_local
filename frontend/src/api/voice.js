// The voice loop's API calls.
import { ApiError, request, requestBlob, requestLines } from "./client";
import { fileNameFor } from "../utils/recording";

/** Recording Blob → { text, duration_s }. 422 (ApiError) when there is no speech. */
export function stt(blob) {
  const form = new FormData();
  form.append("audio", blob, fileNameFor(blob.type));
  return request("POST", "/api/stt", form);
}

/**
 * Question text → { answer, session_id, duration_ms, warm, first_text_ms }.
 * Pass the previous answer's session_id to ask a follow-up; 404 (ApiError)
 * when it is gone.
 */
export function ask(text, sessionId) {
  return request("POST", "/api/ask", sessionId ? { text, session_id: sessionId } : { text });
}

/**
 * Like ask(), with the answer as it is written: `onSession(id)` as soon as
 * the conversation is known, `onDelta(text)` for each new piece. Resolves to
 * what ask() returns; a failure rejects with ApiError (404 when the
 * conversation is gone). Aborting `signal` stops Claude.
 */
export async function askStream(text, sessionId, { onSession, onDelta, signal } = {}) {
  let done = null;
  let failure = null;
  await requestLines(
    "POST",
    "/api/ask/stream",
    sessionId ? { text, session_id: sessionId } : { text },
    (event) => {
      if (event.type === "session") onSession?.(event.session_id);
      else if (event.type === "delta") onDelta?.(event.text);
      else if (event.type === "done") done = event;
      else if (event.type === "error") failure = new ApiError(event.status, event.detail);
    },
    signal,
  );
  if (failure) throw failure;
  if (!done) throw new ApiError(502, "Claude's answer stopped before it was finished");
  return done;
}

/** Answer text → a WAV Blob of it read aloud (Markdown is stripped server-side). */
export function tts(text) {
  return requestBlob("POST", "/api/tts", { text }, "audio/wav");
}
