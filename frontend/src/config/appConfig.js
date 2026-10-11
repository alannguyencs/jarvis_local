// The Jarvis Local backend. Empty = same origin (/api and /health are proxied in dev).
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
