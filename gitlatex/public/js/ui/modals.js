/**
 * Promise-based replacements for window.prompt and window.confirm.
 */

// ----- Modals (input & confirm) -----
export function showInputModal(options) {
  const {
    title = "Input",
    label = "Value",
    placeholder = "",
    submitLabel = "Submit",
    defaultValue = ""
  } = options || {};
  const overlay = document.getElementById("input-modal");
  const titleEl = document.getElementById("input-modal-title");
  const labelEl = document.getElementById("input-modal-label");
  const field = document.getElementById("input-modal-field");
  const submitBtn = document.getElementById("input-modal-submit");
  const cancelBtn = document.getElementById("input-modal-cancel");
  const cancelX = document.getElementById("input-modal-cancel-btn");
  if (!overlay || !field) return Promise.resolve(null);
  titleEl.textContent = title;
  labelEl.textContent = label;
  field.placeholder = placeholder;
  field.value = defaultValue;
  submitBtn.textContent = submitLabel;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  field.focus();
  return new Promise((resolve) => {
    function finish(value) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKey);
      overlay.removeEventListener("click", clickOut);
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter") {
        e.preventDefault();
        submitBtn.click();
      }
    }
    function clickOut(e) {
      if (e.target === overlay) finish(null);
    }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", clickOut);
    submitBtn.onclick = () => {
      const v = field.value.trim();
      finish(v || null);
    };
    cancelBtn.onclick = () => finish(null);
    cancelX.onclick = () => finish(null);
  });
}

export function showConfirmModal(options) {
  const { message = "Are you sure?", confirmLabel = "Confirm" } = options || {};
  const overlay = document.getElementById("confirm-modal");
  const titleEl = document.getElementById("confirm-modal-title");
  const messageEl = document.getElementById("confirm-modal-message");
  const okBtn = document.getElementById("confirm-modal-ok");
  const cancelBtn = document.getElementById("confirm-modal-cancel");
  const closeBtn = document.getElementById("confirm-modal-close-btn");
  if (!overlay || !messageEl) return Promise.resolve(false);
  messageEl.textContent = message;
  okBtn.textContent = confirmLabel;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  return new Promise((resolve) => {
    function finish(ok) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKey);
      overlay.removeEventListener("click", clickOut);
      resolve(ok);
    }
    function onKey(e) {
      if (e.key === "Escape") finish(false);
    }
    function clickOut(e) {
      if (e.target === overlay) finish(false);
    }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", clickOut);
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    closeBtn.onclick = () => finish(false);
  });
}
