// The voice loop's API calls.
import { request, requestBlob } from "./client";
import { fileNameFor } from "../utils/recording";

/** Recording Blob → { text, duration_s }. 422 (ApiError) when there is no speech. */
export function stt(blob) {
  const form = new FormData();
  form.append("audio", blob, fileNameFor(blob.type));
  return request("POST", "/api/stt", form);
}

/**
 * Question text → { answer, session_id, duration_ms }. Pass the previous
 * answer's session_id to ask a follow-up; 404 (ApiError) when it is gone.
 */
export function ask(text, sessionId) {
  return request("POST", "/api/ask", sessionId ? { text, session_id: sessionId } : { text });
}

/** Answer text → a WAV Blob of it read aloud (Markdown is stripped server-side). */
export function tts(text) {
  return requestBlob("POST", "/api/tts", { text }, "audio/wav");
}
