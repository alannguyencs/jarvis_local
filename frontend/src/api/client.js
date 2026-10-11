// Fetch wrapper for the Jarvis Local API. No sign-in, so no token handling.
import { API_BASE_URL } from "../config/appConfig";

/** Any non-2xx answer. `detail` is the server's message, readable as-is. */
export class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** FastAPI's `detail`: a string, or a list of field errors (422). */
async function readDetail(res) {
  try {
    const { detail } = await res.json();
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) => `${d.loc?.slice(1).join(".") || "request"}: ${d.msg.replace(/^Value error, /, "")}`)
        .join("; ");
    }
  } catch {
    /* not JSON */
  }
  return `Request failed (${res.status})`;
}

async function send(method, path, body, accept, signal) {
  const headers = { Accept: accept };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined || isForm ? body : JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res;
}

/**
 * Call the API and return the parsed JSON; throws ApiError on a non-2xx
 * answer. A FormData body is sent as-is (multipart, for uploads); anything
 * else is sent as JSON.
 */
export async function request(method, path, body) {
  const res = await send(method, path, body, "application/json");
  return res.status === 204 ? null : res.json();
}

/**
 * Like request(), for an endpoint that streams newline-delimited JSON: calls
 * `onEvent(event)` for each line as it arrives and resolves when the stream
 * ends. `signal` (an AbortSignal) stops it; that rejects with an AbortError.
 */
export async function requestLines(method, path, body, onEvent, signal) {
  const res = await send(method, path, body, "application/x-ndjson", signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n");
    buffered = lines.pop();
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
    if (done) break;
  }
  if (buffered.trim()) onEvent(JSON.parse(buffered));
}

/** Like request(), for an endpoint that answers with a file: returns a Blob. */
export async function requestBlob(method, path, body, accept = "*/*") {
  return (await send(method, path, body, accept)).blob();
}

export const getHealth = () => request("GET", "/health");
