/**
 * Running a build, locally or against a remote Compiler API.
 */

import { state } from "../core/state.js";
import { applyProblems, renderProblems } from "./problems.js";
import { fetchApi, getApiBase } from "../core/api.js";
import { getLatexEngine, getStoredCompilerApi, getStoredCompilerApiKey, getUseCompilerApi, normalizeCompilerApiUrl } from "../core/storage.js";
import { getMainFile } from "../editor/mainfile.js";
import { refreshProjectIndex } from "../editor/projectindex.js";
import { saveCurrentFile } from "../editor/session.js";
import { setConsole } from "../ui/consolepane.js";
import { pdfUrlFor, showPdf } from "../ui/pdfviewer.js";

export function setCompileLoading(loading) {
  const btn = document.getElementById("btn-compile");
  if (!btn) return;
  const icon = btn.querySelector(".btn-compile-icon");
  const text = btn.querySelector(".btn-compile-text");
  if (loading) {
    btn.classList.add("loading");
    btn.disabled = true;
    if (icon) icon.textContent = "sync";
    if (text) text.textContent = "Compiling…";
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
    if (icon) icon.textContent = "build";
    if (text) text.textContent = "Compile";
  }
}

export async function compile() {
  if (state.currentFile && state.currentFile.endsWith(".tex")) await saveCurrentFile();
  const mainFile = getMainFile() || "main.tex";
  const compilerApi = getUseCompilerApi() ? getStoredCompilerApi() : "";
  setCompileLoading(true);
  try {
    if (compilerApi) {
      const compilerUrl = normalizeCompilerApiUrl(compilerApi);
      const bundleRes = await fetchApi("/repo-files-content");
      const bundleData = await bundleRes.json();
      const files = Array.isArray(bundleData.files) ? bundleData.files : [];
      const apiKey = getStoredCompilerApiKey();
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
      const res = await fetch(compilerUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ main: mainFile, files, engine: getLatexEngine() })
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.pdf) {
        const pdfPath = mainFile.replace(/\.tex$/i, ".pdf");
        const pdfStr = typeof data.pdf === "string" ? data.pdf : "";
        const isDataUrl = pdfStr.includes("base64,");
        if (isDataUrl) {
          const base64 = pdfStr.includes(",") ? pdfStr.slice(pdfStr.indexOf(",") + 1).trim() : pdfStr;
          if (!base64) {
            showPdf(data.pdf);
            setConsole("Compiled " + mainFile + " via API.");
          } else {
            const savePayload = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pdfPath, content: base64 }) };
            const trySave = async (path) => {
              const saveRes = await fetchApi(path, savePayload);
              let saveData = {};
              try {
                saveData = await saveRes.json();
              } catch (_) {
                saveData = { error: "Invalid response (status " + saveRes.status + ")" };
              }
              return { saveRes, saveData };
            };
            let saveRes, saveData;
            const r1 = await trySave("/save-pdf");
            if (r1.saveRes.status === 404) {
              const r2 = await trySave("/api/save-pdf");
              saveRes = r2.saveRes;
              saveData = r2.saveData;
            } else {
              saveRes = r1.saveRes;
              saveData = r1.saveData;
            }
            try {
              if (saveRes.ok && saveData.success) {
                showPdf(pdfUrlFor(pdfPath) + (pdfPath.includes("/") ? "&" : "?") + "t=" + Date.now(), pdfPath);
                setConsole("Compiled " + mainFile + " via API. PDF saved to " + pdfPath);
              } else {
                showPdf(data.pdf);
                setConsole("Compiled " + mainFile + " via API. Save to repo failed: " + (saveData.error || saveRes.status || "unknown"));
              }
            } catch (e) {
              showPdf(data.pdf);
              setConsole("Compiled " + mainFile + " via API. Save to repo failed: " + (e.message || "network error"));
            }
          }
        } else {
          showPdf(data.pdf);
          setConsole("Compiled " + mainFile + " via API.");
        }
      } else if (data.error) {
        setConsole("Compile error:\n" + (data.error || res.statusText));
      } else {
        setConsole("Compile failed: " + (res.statusText || "Invalid response from API"));
      }
    } else {
      const res = await fetchApi("/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainFile, engine: getLatexEngine() })
      });
      let data = {};
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        setConsole("Compile failed: Server returned invalid JSON (status " + res.status + "). Is the backend running?");
        return;
      }
      applyProblems(data.problems || []);
      if (data.success && data.pdf) {
        // Cache-bust so the viewer shows the freshly built PDF.
        showPdf((getApiBase() || "") + data.pdf + "?t=" + Date.now(), mainFile.replace(/\.tex$/i, ".pdf"));
        renderProblems(data.problems || [], describeBuild(mainFile, data), data.log);
      } else if (data.error) {
        renderProblems(data.problems || [], "Compile error: " + data.error, data.log);
      } else {
        setConsole("Compile failed: " + (res.statusText || res.status || "Unknown error"));
      }
      refreshProjectIndex();
    }
  } catch (e) {
    const hint = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "http://localhost:5000";
    setConsole("Compile failed: " + (e.message || "Network error") + ". Check that a repo is selected and the server is running at " + hint + ".");
  } finally {
    setCompileLoading(false);
  }
}

export function describeBuild(mainFile, data) {
  const steps = data.steps || [];
  const bib = steps.find(s => s.tool === "bibtex" || s.tool === "biber");
  const runs = steps.filter(s => s.tool === data.engine).length;
  let msg = "Compiled " + mainFile + " with " + (data.engine || "pdflatex") +
    " (" + runs + " pass" + (runs === 1 ? "" : "es");
  if (bib && !bib.missing) msg += " + " + bib.tool;
  msg += ").";
  if (bib && bib.missing) {
    msg += "\n" + bib.tool + " is not installed - citations will stay unresolved.";
  }
  return msg;
}
