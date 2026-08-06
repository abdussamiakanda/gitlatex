/**
 * User settings kept in localStorage.
 *
 * Pure get/set helpers - nothing here touches the DOM, so it is safe to import
 * from anywhere.
 */

export const THEME_KEY = "gitlatex-theme";
// localStorage keys for user settings (Compiler API URL and optional API key)
export const STORAGE_COMPILER_API_URL = "gitlatex-compiler-api";
export const STORAGE_COMPILER_API_KEY = "gitlatex-compiler-api-key";

export function normalizeCompilerApiUrl(url) {
  if (!url || !url.trim()) return "";
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return "https://" + u;
}

export function getStoredCompilerApi() {
  try {
    const u = localStorage.getItem(STORAGE_COMPILER_API_URL);
    return (u && u.trim()) ? u.trim() : "";
  } catch (_) {}
  return "";
}

export function setCompilerApi(url) {
  try {
    if (url && url.trim()) localStorage.setItem(STORAGE_COMPILER_API_URL, url.trim());
    else localStorage.removeItem(STORAGE_COMPILER_API_URL);
  } catch (_) {}
}

export function getStoredCompilerApiKey() {
  try {
    const k = localStorage.getItem(STORAGE_COMPILER_API_KEY);
    return (k && k.trim()) ? k.trim() : "";
  } catch (_) {}
  return "";
}

export function setCompilerApiKey(key) {
  try {
    if (key && key.trim()) localStorage.setItem(STORAGE_COMPILER_API_KEY, key.trim());
    else localStorage.removeItem(STORAGE_COMPILER_API_KEY);
  } catch (_) {}
}

export const LATEX_ENGINE_KEY = "gitlatex-engine";

export function getLatexEngine() {
  try {
    const e = localStorage.getItem(LATEX_ENGINE_KEY);
    if (e === "xelatex" || e === "lualatex" || e === "pdflatex") return e;
  } catch (_) {}
  return "pdflatex";
}

export function setLatexEngine(engine) {
  try { localStorage.setItem(LATEX_ENGINE_KEY, engine); } catch (_) {}
}

export const USE_API_KEY = "gitlatex-use-compiler-api";

// Explicit opt-in, so a saved URL can be kept without always compiling remotely.
// Legacy setups that only have a URL stored keep working.
export function getUseCompilerApi() {
  try {
    const v = localStorage.getItem(USE_API_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch (_) {}
  return !!getStoredCompilerApi();
}

export function setUseCompilerApi(on) {
  try { localStorage.setItem(USE_API_KEY, on ? "true" : "false"); } catch (_) {}
}
