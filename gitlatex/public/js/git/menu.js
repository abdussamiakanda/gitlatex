/**
 * The Git dropdown and the enabled/disabled state of its items.
 */

import { state } from "../core/state.js";
import { fetchApi } from "../core/api.js";
import { saveCurrentFile } from "../editor/session.js";

export function closeGitDropdown() {
  const wrapper = document.getElementById("toolbar-git");
  const btn = document.getElementById("git-dropdown-btn");
  const menu = document.getElementById("git-dropdown-menu");
  if (menu && menu.parentNode === document.body) {
    if (wrapper) wrapper.appendChild(menu);
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.minWidth = "";
    menu.style.display = "";
  }
  if (wrapper) wrapper.classList.remove("open");
  if (btn) btn.setAttribute("aria-expanded", "false");
  if (menu) menu.setAttribute("aria-hidden", "true");
}

export function setMenuItemState(btnId, labelId, baseLabel, enabled, label, title) {
  const btn = document.getElementById(btnId);
  const text = document.getElementById(labelId);
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = title || "";
  if (text) text.textContent = label || baseLabel;
}

export function setPullState(enabled, label, title) {
  setMenuItemState("git-pull-btn", "git-pull-label", "Pull", enabled, label, title);
}

export function setPushState(enabled, label, title) {
  setMenuItemState("git-push-btn", "git-push-label", "Push", enabled, label, title);
}

// Fetches from origin, so only called when the menu is opened.
export async function refreshGitMenuState() {
  setPullState(false, "Pull", "Checking for remote changes...");
  setPushState(false, "Push", "Checking for local changes...");
  try {
    if (state.currentFile) await saveCurrentFile();
    const res = await fetchApi("/remote-status");
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      const msg = "Restart the GitLaTeX server to enable this.";
      setPullState(false, "Pull", msg);
      setPushState(false, "Push", msg);
      return;
    }
    const data = await res.json();
    if (data.error) {
      const msg = "Could not reach remote: " + data.error;
      setPullState(false, "Pull", msg);
      setPushState(false, "Push", msg);
      return;
    }

    if (!data.hasRemote) {
      setPullState(false, "Pull", "This project has no remote.");
    } else if (!data.tracking) {
      setPullState(false, "Pull", "This branch isn't tracking a remote branch.");
    } else if (data.behind > 0) {
      setPullState(true, "Pull (" + data.behind + ")", "Pull " + data.behind + " commit(s) from " + data.tracking);
    } else {
      setPullState(false, "Pull", "Already up to date with " + data.tracking + ".");
    }

    if (!data.hasRemote) {
      setPushState(false, "Push", "This project has no remote.");
    } else if (data.dirty) {
      setPushState(true, "Push", "Commit all changes and push to " + (data.tracking || "origin"));
    } else if (data.ahead > 0) {
      setPushState(true, "Push (" + data.ahead + ")", "Push " + data.ahead + " commit(s) to " + data.tracking);
    } else {
      setPushState(false, "Push", "Nothing to push.");
    }
  } catch (e) {
    const msg = "Could not reach remote: " + (e.message || "network error");
    setPullState(false, "Pull", msg);
    setPushState(false, "Push", msg);
  }
}

export function toggleGitDropdown(e) {
  e.stopPropagation();
  const wrapper = document.getElementById("toolbar-git");
  const btn = document.getElementById("git-dropdown-btn");
  const menu = document.getElementById("git-dropdown-menu");
  const wasOpen = wrapper && wrapper.classList.contains("open");
  if (wasOpen) {
    closeGitDropdown();
    return;
  }
  if (!wrapper || !btn || !menu) return;
  const rect = btn.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = "auto";
  menu.style.right = (window.innerWidth - rect.right) + "px";
  menu.style.minWidth = Math.max(rect.width, 140) + "px";
  menu.style.display = "block";
  document.body.appendChild(menu);
  wrapper.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
  menu.setAttribute("aria-hidden", "false");
  refreshGitMenuState();
}
