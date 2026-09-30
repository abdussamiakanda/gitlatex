/**
 * Project templates. Source files live in ./files/<template>/… and are bundled
 * as raw strings; sample images are drawn on a canvas at creation time so the
 * repository contains no binary blobs.
 */
import type { TexEngine } from '../engine/protocol';

const RAW = import.meta.glob('./files/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  /** Material Symbols icon name. */
  icon: string;
  engine: TexEngine;
  mainFile: string;
  tags: string[];
  /** Images generated at creation time: path → chart title. */
  images?: Record<string, string>;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'welcome', name: 'Welcome tour', icon: 'waving_hand', engine: 'pdftex', mainFile: 'main.tex', tags: ['Start here'],
    description: 'A guided tour: slash commands, math, figures, tables and citations.',
    images: { 'images/sample-chart.png': 'Compile time per pass' } },
  { id: 'blank', name: 'Blank document', icon: 'description', engine: 'pdftex', mainFile: 'main.tex', tags: ['Minimal'],
    description: 'An empty article — just start writing.' },
  { id: 'paper', name: 'Research paper', icon: 'science', engine: 'pdftex', mainFile: 'main.tex', tags: ['Academic'],
    description: 'Abstract, theorems, figures, booktabs tables, natbib and cleveref.',
    images: { 'figures/results.png': 'Accuracy by method' } },
  { id: 'thesis', name: 'Thesis / report', icon: 'school', engine: 'pdftex', mainFile: 'main.tex', tags: ['Academic', 'Multi-file'],
    description: 'Title page, front matter, chapters in separate files, appendix, bibliography.' },
  { id: 'beamer', name: 'Beamer slides', icon: 'slideshow', engine: 'pdftex', mainFile: 'main.tex', tags: ['Presentation'],
    description: '16:9 Madrid theme with overlays, blocks and columns.' },
  { id: 'homework', name: 'Math homework', icon: 'calculate', engine: 'pdftex', mainFile: 'main.tex', tags: ['Education'],
    description: 'Problems and solutions with amsthm, enumitem and fancyhdr.' },
  { id: 'cv', name: 'Résumé / CV', icon: 'badge', engine: 'pdftex', mainFile: 'main.tex', tags: ['Career'],
    description: 'A clean one-page CV built with titlesec and enumitem.' },
  { id: 'letter', name: 'Formal letter', icon: 'mail', engine: 'pdftex', mainFile: 'main.tex', tags: ['Correspondence'],
    description: 'The classic letter class with address and signature.' },
  { id: 'tikz', name: 'TikZ & PGFPlots', icon: 'show_chart', engine: 'pdftex', mainFile: 'main.tex', tags: ['Graphics', 'On-demand packages'],
    description: 'Flowcharts and plots — packages are fetched on demand and cached offline.' },
  { id: 'xelatex', name: 'XeLaTeX + fontspec', icon: 'translate', engine: 'xetex', mainFile: 'main.tex', tags: ['Unicode', 'Fonts'],
    description: 'Native Unicode input and OpenType fonts with the XeTeX engine.' },
];

export function templateTextFiles(id: string): Record<string, string> {
  const prefix = `./files/${id}/`;
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(RAW)) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = text;
  return out;
}

/** Draw a small bar chart and return it as PNG bytes. */
export async function drawSampleChart(title: string): Promise<Uint8Array> {
  const w = 640;
  const h = 400;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f2937';
  g.font = 'bold 24px sans-serif';
  g.fillText(title, 32, 44);
  const values = [0.42, 0.68, 0.55, 0.83, 0.74, 0.95];
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const base = h - 50;
  const bw = 70;
  values.forEach((v, i) => {
    const x = 48 + i * 95;
    const bh = v * (h - 130);
    const grad = g.createLinearGradient(0, base - bh, 0, base);
    grad.addColorStop(0, '#6d5dfc');
    grad.addColorStop(1, '#22d3ee');
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(x, base - bh, bw, bh, 8);
    g.fill();
    g.fillStyle = '#374151';
    g.font = '18px sans-serif';
    g.fillText(labels[i], x + bw / 2 - 6, base + 28);
  });
  g.strokeStyle = '#9ca3af';
  g.beginPath();
  g.moveTo(32, base + 0.5);
  g.lineTo(w - 24, base + 0.5);
  g.stroke();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export async function templateFiles(id: string): Promise<{ path: string; text?: string; data?: Uint8Array }[]> {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[1];
  const files: { path: string; text?: string; data?: Uint8Array }[] = Object.entries(templateTextFiles(t.id)).map(
    ([path, text]) => ({ path, text }),
  );
  for (const [path, title] of Object.entries(t.images ?? {})) {
    try {
      files.push({ path, data: await drawSampleChart(title) });
    } catch {
      /* canvas unavailable (tests) — skip the sample image */
    }
  }
  return files;
}
