/**
 * Push, pull, status and diff, driven from the Git menu.
 */

import { state } from "../core/state.js";
import { fetchApi } from "../core/api.js";
import { loadFile, loadFiles, saveCurrentFile } from "../editor/session.js";
import { invalidateVersions } from "./diffview.js";
import { loadCommits, openVersionsPanel } from "./versions.js";
import { ensureConsoleVisible, setConsole } from "../ui/consolepane.js";

export async function pushChanges() {
  ensureConsoleVisible();
  setConsole("Committing and pushing...");
  try {
    if (state.currentFile) await saveCurrentFile();
    const res = await fetchApi("/push", { method: "POST" });
    const data = await res.json();
    if (data.error) {
      setConsole("Push error: " + data.error);
      return;
    }
    setConsole(data.committed ? "Committed and pushed to remote." : "Pushed to remote.");
    invalidateVersions();
  } catch (e) {
    setConsole("Push failed: " + (e.message || ""));
  }
}

export async function pullChanges() {
  ensureConsoleVisible();
  setConsole("Pulling from remote...");
  try {
    if (state.currentFile) await saveCurrentFile();
    const res = await fetchApi("/pull", { method: "POST" });
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      setConsole("Pull error: server did not recognise /pull (HTTP " + res.status + ").\nRestart the GitLaTeX server to load the new endpoint.");
      return;
    }
    const data = await res.json();
    if (data.error) {
      setConsole("Pull error: " + data.error);
      return;
    }
    setConsole("Pulled from remote.\n" + (data.output || ""));
    invalidateVersions();
    if (data.changed) {
      const reopen = state.currentFile;
      await loadFiles();
      if (reopen) await loadFile(reopen);
    }
  } catch (e) {
    setConsole("Pull failed: " + (e.message || ""));
  }
}

export function formatStatus(s) {
  const lines = [];
  if (s.detached) lines.push("HEAD is detached (not on a branch).");
  else lines.push("On branch " + (s.current || "?"));

  if (!s.hasCommits) {
    lines.push("No commits yet.");
  } else if (!s.tracking) {
    lines.push("No upstream branch set.");
  } else if (s.ahead || s.behind) {
    const parts = [];
    if (s.ahead) parts.push(s.ahead + " ahead");
    if (s.behind) parts.push(s.behind + " behind");
    lines.push(parts.join(", ") + " of " + s.tracking + " (as of the last fetch)");
  } else {
    lines.push("Up to date with " + s.tracking + " (as of the last fetch)");
  }

  const groups = [
    ["Staged", s.staged],
    ["Modified", s.modified],
    ["Deleted", s.deleted],
    ["Untracked", s.untracked]
  ];
  let any = false;
  groups.forEach(function (g) {
    const list = g[1] || [];
    if (!list.length) return;
    any = true;
    lines.push("");
    lines.push(g[0] + " (" + list.length + "):");
    list.forEach(function (p) { lines.push("  " + p); });
  });
  if (!any) {
    lines.push("");
    lines.push("Working tree clean.");
  }
  return lines.join("\n");
}

export async function showStatus() {
  ensureConsoleVisible();
  setConsole("Checking status...");
  try {
    if (state.currentFile) await saveCurrentFile();
    const res = await fetchApi("/status");
    const data = await res.json();
    setConsole(data.error ? "Status error: " + data.error : formatStatus(data.status || {}));
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

// Shows uncommitted changes in the Versions panel's side-by-side diff.
export async function showDiff() {
  openVersionsPanel();
  if (!state.versionsLoaded) await loadCommits();
  const item = document.querySelector(".working-item");
  if (!item) return;
  if (!item.classList.contains("expanded")) {
    item.querySelector(".version-expand")?.click();
  }
}
