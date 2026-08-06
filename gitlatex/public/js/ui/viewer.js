/**
 * The preview pane: images, PDFs, and the 'no preview available' state.
 */

import { API_BASE } from "../core/api.js";
import { hideDiffView } from "../git/diffview.js";

export function showEditorPane() {
  const pane = document.getElementById("editor-pane");
  const viewer = document.getElementById("file-viewer");
  hideDiffView();
  if (pane) pane.classList.remove("viewer-active");
  if (viewer) viewer.classList.add("hidden");
  if (viewer) viewer.setAttribute("aria-hidden", "true");
}

export function showFileViewer(path) {
  const pane = document.getElementById("editor-pane");
  const viewer = document.getElementById("file-viewer");
  const img = document.getElementById("file-viewer-img");
  const pdfFrame = document.getElementById("file-viewer-pdf");
  const unavailable = document.getElementById("file-viewer-unavailable");
  if (!pane || !viewer || !img || !pdfFrame || !unavailable) return;
  hideDiffView();
  const ext = path.toLowerCase().slice(path.lastIndexOf("."));
  const isPdf = ext === ".pdf";
  const url = (typeof API_BASE !== "undefined" ? API_BASE : "") + "/file-raw?path=" + encodeURIComponent(path);
  pane.classList.add("viewer-active");
  viewer.classList.remove("hidden");
  viewer.setAttribute("aria-hidden", "false");
  unavailable.classList.add("hidden");
  if (isPdf) {
    img.classList.add("hidden");
    pdfFrame.classList.remove("hidden");
    pdfFrame.src = url;
  } else {
    pdfFrame.classList.add("hidden");
    pdfFrame.removeAttribute("src");
    img.classList.remove("hidden");
    img.src = url;
  }
}

export function showPreviewNotAvailable() {
  const pane = document.getElementById("editor-pane");
  const viewer = document.getElementById("file-viewer");
  const img = document.getElementById("file-viewer-img");
  const pdfFrame = document.getElementById("file-viewer-pdf");
  const unavailable = document.getElementById("file-viewer-unavailable");
  if (!pane || !viewer || !img || !pdfFrame || !unavailable) return;
  pane.classList.add("viewer-active");
  viewer.classList.remove("hidden");
  viewer.setAttribute("aria-hidden", "false");
  img.classList.add("hidden");
  img.removeAttribute("src");
  pdfFrame.classList.add("hidden");
  pdfFrame.removeAttribute("src");
  unavailable.classList.remove("hidden");
}
