/**
 * Loading states.
 *
 * Three shapes, and that is deliberately all:
 *
 *   showSkeleton(el, variant, count)  a list is being fetched and we know
 *                                     roughly what it will look like
 *   setPaneLoading(el, on, text)      a whole pane is unusable until something
 *                                     finishes (Monaco booting, a file opening)
 *   setButtonLoading(btn, on, text)   an action is in flight
 *
 * Skeletons are preferred for lists because they hold the layout still - the
 * content lands in the space its placeholder already occupied instead of
 * shifting the page. Use setPaneLoading when there is no shape to imitate.
 *
 * Everything here also sets aria-busy, so screen readers announce the wait
 * rather than reading an empty container.
 */

// Rough shape of one row per list, as [width%, ...] per line.
const VARIANTS = {
  // Mirrors the five columns of a .repo-row so the table does not resize.
  "repo-row": { rows: 5, markup: (i) =>
    '<div class="skeleton-square"></div>' +
    '<div class="skeleton-line" style="width:' + [58, 40, 66, 47, 53][i % 5] + '%"></div>' +
    '<div class="skeleton-line skeleton-pill"></div>' +
    '<div class="skeleton-line skeleton-chip"></div>' +
    '<div class="skeleton-line skeleton-chip"></div>' },
  "tree-row": { rows: 7, markup: (i) =>
    '<div class="skeleton-square"></div>' +
    '<div class="skeleton-line" style="width:' + [70, 52, 61, 44, 66, 48, 57][i % 7] + '%"></div>' },
  "commit-row": { rows: 5, markup: () =>
    '<div class="skeleton-line skeleton-title"></div>' +
    '<div class="skeleton-line skeleton-sub"></div>' },
  "file-row": { rows: 3, markup: (i) =>
    '<div class="skeleton-line" style="width:' + [64, 48, 56][i % 3] + '%"></div>' },
};

/**
 * Fills `container` with placeholder rows shaped like the content that is
 * coming. Replaces whatever is there; render the real content over it when the
 * data arrives.
 */
export function showSkeleton(container, variant, count) {
  if (!container) return;
  const spec = VARIANTS[variant];
  if (!spec) return;
  const n = count || spec.rows;
  let html = "";
  for (let i = 0; i < n; i++) {
    html += '<div class="skeleton-row skeleton-row-' + variant + '">' + spec.markup(i) + "</div>";
  }
  container.innerHTML = '<div class="skeleton" aria-hidden="true">' + html + "</div>";
  container.setAttribute("aria-busy", "true");
}

/** Marks the container done. Callers that write real content still need to. */
export function clearSkeleton(container) {
  if (!container) return;
  container.removeAttribute("aria-busy");
  const skel = container.querySelector(":scope > .skeleton");
  if (skel) skel.remove();
}

/**
 * Covers a pane with a spinner and a line of text. Used where there is no list
 * shape to imitate - the editor while Monaco loads, the PDF pane while a build
 * runs. Safe to call repeatedly; the overlay is created once per pane.
 */
export function setPaneLoading(pane, on, text) {
  if (!pane) return;
  let overlay = pane.querySelector(":scope > .pane-loading");
  if (!on) {
    if (overlay) overlay.remove();
    pane.removeAttribute("aria-busy");
    return;
  }
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "pane-loading";
    overlay.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="pane-loading-text"></span>';
    pane.appendChild(overlay);
  }
  overlay.querySelector(".pane-loading-text").textContent = text || "Loading...";
  overlay.setAttribute("role", "status");
  pane.setAttribute("aria-busy", "true");
}

/**
 * Busy state for a button: disabled, spinner, optional replacement label.
 * Restores the original label when switched off.
 */
export function setButtonLoading(btn, on, busyText) {
  if (!btn) return;
  // Buttons whose text sits in a span (so an icon can sit beside it) mark that
  // span; everything else just has its own text content swapped.
  const labelEl = btn.querySelector("[data-btn-label], .btn-label, .clone-btn-text") || btn;
  if (on) {
    if (btn.dataset.idleLabel === undefined) btn.dataset.idleLabel = labelEl.textContent;
    if (busyText) labelEl.textContent = busyText;
    btn.classList.add("loading");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  } else {
    if (btn.dataset.idleLabel !== undefined) {
      labelEl.textContent = btn.dataset.idleLabel;
      delete btn.dataset.idleLabel;
    }
    btn.classList.remove("loading");
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
  }
}
