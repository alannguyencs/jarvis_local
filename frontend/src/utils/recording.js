// MediaRecorder formats, best first: Chrome and Firefox record webm/opus,
// Safari records mp4. The backend's ffmpeg reads all of them.
export const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/** The first format the browser can record, or "" to let it choose. */
export function pickMimeType(isSupported = (t) => MediaRecorder.isTypeSupported(t)) {
  return MIME_TYPES.find((t) => isSupported(t)) || "";
}

/** A file name for the upload, e.g. "recording.webm" for "audio/webm;codecs=opus". */
export function fileNameFor(mimeType) {
  const sub = (mimeType || "").split(";")[0].split("/")[1];
  return `recording.${sub || "webm"}`;
}

/** What to tell the user when the microphone can't be opened. */
export function micErrorMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "Microphone access is blocked. Allow it for this site in the browser's address bar, then try again.";
  }
  if (error?.name === "NotFoundError") return "No microphone found.";
  return `Could not open the microphone: ${error?.message || error}`;
}
