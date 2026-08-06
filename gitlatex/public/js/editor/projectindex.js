/**
 * Project-wide labels and citation keys, fetched for autocomplete.
 */

import { state } from "../core/state.js";
import { fetchApi } from "../core/api.js";

// ----- Project index: labels and citation keys for autocomplete -----

export async function refreshProjectIndex() {
  try {
    const res = await fetchApi("/project-index");
    if (!(res.headers.get("content-type") || "").includes("application/json")) return;
    const data = await res.json();
    if (data.error) return;
    state.projectLabels = data.labels || [];
    state.projectCitations = data.citations || [];
  } catch (_) {}
}
