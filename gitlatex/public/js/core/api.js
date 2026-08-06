/**
 * Talking to the GitLaTeX server.
 *
 * Every request goes through fetchApi/fetchJson, so the base URL and the
 * HTML-instead-of-JSON failure mode are handled in exactly one place.
 */

/** API base URL: "" = same origin (API on same host:port as page). Fallback only for file:// or no origin. */
export function getApiBase() {
  if (typeof window === "undefined" || !window.location) return "http://localhost:5000";
  const o = window.location.origin;
  if (!o || o.startsWith("file")) return "http://localhost:5000";
  return "";
}
export const API_BASE = getApiBase();

export function fetchApi(url, options) {
  const base = getApiBase() || "";
  const path = (url || "").replace(/^\//, "");
  const fullUrl = base ? (base.replace(/\/$/, "") + "/" + path) : "/" + path;
  return fetch(fullUrl, options);
}

/** Fetch and parse JSON; on HTML or invalid JSON return { error: message }. */
export async function fetchJson(url, options) {
  const res = await fetchApi(url, options);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    const hint = (typeof API_BASE !== "undefined" && API_BASE) ? API_BASE : (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "http://localhost:5000";
    return { error: "Server returned an error page (status " + res.status + "). Is the backend running at " + (hint || "http://localhost:5000") + "?" };
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: "Invalid response (status " + res.status + "): " + (text.slice(0, 80) + (text.length > 80 ? "…" : "")) };
  }
}
