/** Visual comparison on the cursor page, independent of PDF metadata and zoom. */
export function changedTiles(before, after, width, height, size = 8) {
  const tiles = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      let changed = false;
      const w = Math.min(size, width - x), h = Math.min(size, height - y);
      for (let dy = 0; dy < h && !changed; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const i = ((y + dy) * width + x + dx) * 4;
          // Ignore tiny antialiasing differences; both renders use a white background.
          if ([0, 1, 2].some(c => Math.abs(before[i + c] - after[i + c]) > 24)) {
            changed = true;
            break;
          }
        }
      }
      if (changed) tiles.push({ x, y, w, h });
    }
  }
  return tiles;
}

export async function changedPageOverlay(before, after) {
  const oldSize = before.getViewport({ scale: 1 });
  const newSize = after.getViewport({ scale: 1 });
  // Different page sizes have no reliable common coordinate system.
  if (oldSize.width !== newSize.width || oldSize.height !== newSize.height) return null;
  // Bound comparison memory/cost; never render the entire document for a diff.
  const scale = Math.min(1, 1024 / Math.max(newSize.width, newSize.height));
  const viewport = after.getViewport({ scale });
  const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
  const canvases = [document.createElement("canvas"), document.createElement("canvas")];
  try {
    const pixels = [];
    for (const [i, page] of [before, after].entries()) {
      const canvas = canvases[i];
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }),
        background: "rgb(255,255,255)" }).promise;
      pixels.push(ctx.getImageData(0, 0, width, height).data);
    }
    const tiles = changedTiles(pixels[0], pixels[1], width, height);
    if (!tiles.length) return null;
    const overlay = document.createElement("canvas");
    overlay.width = width;
    overlay.height = height;
    overlay.className = "pdf-change-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const ctx = overlay.getContext("2d");
    ctx.fillStyle = "rgba(255, 185, 0, 0.35)";
    tiles.forEach(({ x, y, w, h }) => ctx.fillRect(x, y, w, h));
    return overlay;
  } finally {
    canvases.forEach(canvas => { canvas.width = canvas.height = 0; });
  }
}
