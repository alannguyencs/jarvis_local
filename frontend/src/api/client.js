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

async function send(method, path, body, accept) {
  const headers = { Accept: accept };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined || isForm ? body : JSON.stringify(body),
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

/** Like request(), for an endpoint that answers with a file: returns a Blob. */
export async function requestBlob(method, path, body, accept = "*/*") {
  return (await send(method, path, body, accept)).blob();
}

export const getHealth = () => request("GET", "/health");
