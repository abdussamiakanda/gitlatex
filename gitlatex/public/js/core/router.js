/**
 * Hash routing between the home, settings, docs and editor views.
 */

import { openEditorPage } from "../editor/session.js";
import { loadRepoList } from "../home/repolist.js";
import { populateSettings } from "../ui/settings.js";
import { applyTheme, getStoredTheme } from "../ui/theme.js";

// ----- Routing -----
export function getRoute() {
  const hash = (window.location.hash || "#/").slice(1);
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "editor" && parts[1]) return { page: "editor", repo: parts[1] };
  if (parts[0] === "settings") return { page: "settings" };
  if (parts[0] === "compiler-api") return { page: "compiler-api" };
  return { page: "home" };
}

export function showView(viewId) {
  document.querySelectorAll(".view").forEach(v => {
    v.classList.toggle("hidden", v.id !== viewId);
  });
}

export function route() {
  const r = getRoute();
  if (r.page === "home") {
    showView("home-view");
    loadRepoList();
    return;
  }
  if (r.page === "settings") {
    showView("settings-view");
    applyTheme(getStoredTheme());
    populateSettings();
    return;
  }
  if (r.page === "compiler-api") {
    showView("compiler-api-view");
    const content = document.querySelector("#compiler-api-view .settings-content");
    if (content) content.scrollTop = 0;
    return;
  }
  showView("editor-view");
  document.getElementById("editor-repo-name").textContent = decodeURIComponent(r.repo);
  openEditorPage(r.repo);
}

export function openEditor(repoName) {
  window.location.hash = "#/editor/" + encodeURIComponent(repoName);
}
