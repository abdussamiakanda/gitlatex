import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ChangeTile { x: number; y: number; w: number; h: number }

/** Visual comparison on the cursor page, independent of PDF metadata and zoom. */
export function changedTiles(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number, size = 8): ChangeTile[] {
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

export async function changedPageTiles(before: PDFPageProxy, after: PDFPageProxy): Promise<ChangeTile[]> {
  const oldSize = before.getViewport({ scale: 1 });
  const newSize = after.getViewport({ scale: 1 });
  // Different page sizes have no reliable common coordinate system.
  if (oldSize.width !== newSize.width || oldSize.height !== newSize.height) return [];
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
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      await page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale }),
        background: "rgb(255,255,255)" }).promise;
      pixels.push(ctx.getImageData(0, 0, width, height).data);
    }
    const tiles = changedTiles(pixels[0], pixels[1], width, height);
    if (!tiles.length) return [];
    return tiles.map(({ x, y, w, h }) => ({
      x: x / width * 100, y: y / height * 100, w: w / width * 100, h: h / height * 100,
    }));
  } finally {
    canvases.forEach(canvas => { canvas.width = canvas.height = 0; });
  }
}
