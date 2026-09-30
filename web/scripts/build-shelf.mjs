#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * build-shelf — turn a TeX Live installation into an on-demand "package shelf"
 * that can be served from any static host (GitHub Pages).
 *
 * The WebAssembly engine ships with a compact base TeX Live. Everything else
 * (TikZ/PGF, biblatex, cm-super fonts, publisher classes, …) goes on the shelf:
 *
 *   public/shelf/index.json        bundle table + file→bundle map + font names
 *   public/shelf/b/<name>.<hash>.tgz   one gzip'd tar per TeX package (TDS paths)
 *
 * At compile time the worker
 *   1. pre-scans the project (\usepackage, \documentclass, \usetikzlibrary, …)
 *      and fetches the bundles it predicts are needed (+ their dependencies),
 *   2. parses the TeX log after a run for "file not found" / "font not found"
 *      errors, fetches the matching bundle, and re-runs,
 *   3. mounts bundles in an extra TEXMF tree (/texmf-shelf) that kpathsea
 *      searches first via TEXMFAUXTREES,
 *   4. caches bundles with the Cache API so they are downloaded only once.
 *
 * Usage
 *   node scripts/build-shelf.mjs \
 *     --texmf /usr/share/texlive/texmf-dist --texmf /usr/share/texmf \
 *     --map /var/lib/texmf/fonts/map/pdftex/updmap/pdftex.map \
 *     --label "TeX Live 2023 (Ubuntu 24.04)" [--budget-mb 750] [--out public/shelf] \
 *     [--extra-texmf <dir> --extra-packages scripts/shelf-extra-packages.txt]
 *
 * --extra-texmf adds a tree (e.g. an unpacked texlive-fonts-extra, 1.7 GB) from
 * which only the listed packages — plus whatever they require from that same
 * tree — are shelved, keeping the site under the 1 GB GitHub Pages limit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createTar } from './lib/tar.mjs';
import { readFontNames, normaliseFontName } from './lib/font-names.mjs';
import { parseDataPackageLoader, DataPackageReader } from './lib/emscripten-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A comma list, or a file with one name per line (# comments allowed). */
function readList(arg) {
  const text = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg.replace(/,/g, '\n');
  return text.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
}

function parseArgs(argv) {
  const a = { texmf: [], map: [], engine: path.join(ROOT, 'public', 'engine'), out: path.join(ROOT, 'public', 'shelf'), label: 'TeX Live', budgetMb: 750, exclude: [], extraTexmf: [], extraPackages: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--texmf') a.texmf.push(path.resolve(v()));
    else if (k === '--map') a.map.push(path.resolve(v()));
    else if (k === '--engine') a.engine = path.resolve(v());
    else if (k === '--out') a.out = path.resolve(v());
    else if (k === '--label') a.label = v();
    else if (k === '--budget-mb') a.budgetMb = Number(v());
    else if (k === '--exclude') a.exclude.push(v());
    else if (k === '--extra-texmf') a.extraTexmf.push(path.resolve(v()));
    else if (k === '--extra-packages') a.extraPackages.push(...readList(v()));
    else throw new Error(`Unknown argument ${k}`);
  }
  if (!a.texmf.length) throw new Error('At least one --texmf <dir> is required');
  return a;
}

// ---------------------------------------------------------------------------
// File selection
// ---------------------------------------------------------------------------

const FONT_DIRS = new Set(['tfm', 'vf', 'type1', 'opentype', 'truetype', 'enc', 'map', 'misc']);
/** Font binaries are bundled one-per-file: a document rarely needs a whole family. */
const FONT_BINARY = /\.(pfb|otf|ttf|ttc)$/i;
const SKIP_NAME = /^(README|readme|Makefile|makefile|INSTALL|CHANGES|Changes|ChangeLog|MANIFEST|LICEN[CS]E|COPYING)(\..*)?$/;
const SKIP_EXT = /\.(dtx|ins|md|log|html?|orig|rej|bak|swp)$/i;

/** @returns {string | null} bundle key, or null to skip */
function classify(rel, excludes) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  if (SKIP_NAME.test(base) || SKIP_EXT.test(base)) return null;
  if (excludes.some((e) => rel.startsWith(e))) return null;
  const top = parts[0];
  if (top === 'tex') {
    if (parts[1] === 'context' || parts.length < 3) return null;
    // tex/<format>/<package>/... → package; files directly in tex/<format>/ share a misc bundle
    return parts.length >= 4 ? parts[2] : `${parts[1]}-misc`;
  }
  if (top === 'bibtex') {
    if (!['bst', 'bib', 'csf'].includes(parts[1]) || parts.length < 3) return null;
    return parts.length >= 4 ? parts[2] : `bibtex-${parts[1]}-misc`;
  }
  if (top === 'makeindex') return parts.length >= 3 ? parts[1] : 'makeindex-misc';
  if (top === 'fonts') {
    if (!FONT_DIRS.has(parts[1])) return null;
    if (parts[1] === 'map' && !['dvips', 'pdftex', 'dvipdfmx'].includes(parts[2])) return null;
    if (parts[1] === 'misc' && parts[2] !== 'xetex') return null;
    if (FONT_BINARY.test(base)) return `font:${base}`;
    // fonts/<type>/<supplier>/<family>/… → family
    return parts.length >= 5 ? parts[3] : parts.length >= 4 ? parts[2] : null;
  }
  return null;
}

function* walk(dir, rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((x, y) => x.name.localeCompare(y.name));
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    let st;
    try {
      st = fs.statSync(abs); // follows symlinks (Debian links fonts into /usr/share/fonts)
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!rel && !['tex', 'fonts', 'bibtex', 'makeindex'].includes(e.name)) continue;
      yield* walk(abs, r);
    } else if (st.isFile()) yield { abs, rel: r, size: st.size };
  }
}

// ---------------------------------------------------------------------------
// Dependency extraction (static, conservative)
// ---------------------------------------------------------------------------

const TEXT_EXT = /\.(sty|cls|tex|def|cfg|clo|ldf|fd|ltx|bbx|cbx|lbx|dbx)$/i;
const DEP_PATTERNS = [
  [/\\RequirePackage(?:WithOptions)?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, (n) => `${n}.sty`],
  [/\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, (n) => `${n}.sty`],
  [/\\LoadClass(?:WithOptions)?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, (n) => `${n}.cls`],
  [/\\usetikzlibrary\s*\{([^}]+)\}/g, (n) => `tikzlibrary${n}.code.tex`],
  [/\\usepgflibrary\s*\{([^}]+)\}/g, (n) => `pgflibrary${n}.code.tex`],
  [/\\input\s*\{?\s*([A-Za-z0-9_.-]+\.(?:tex|def|sty|cfg))/g, (n) => n],
  // `\input binhex` / `\input{binhex}` — no extension means .tex
  [/\\input\s*(?:\{\s*|\s)([A-Za-z][A-Za-z0-9_-]*)(?![\w.])/g, (n) => `${n}.tex`],
];


function extractDeps(text) {
  const out = new Set();
  for (const [re, toFile] of DEP_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      for (let name of m[1].split(',')) {
        name = name.replace(/%.*$/, '').trim();
        if (!name || /[\\#@$]/.test(name)) continue;
        out.add(toFile(name));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extra trees: shelve only selected packages
// ---------------------------------------------------------------------------

/** The TeX Live package a TDS path belongs to: tex/<fmt>/<pkg>/…, fonts/<type>/<supplier>/<pkg>/…, bibtex/<t>/<pkg>/… */
function familyOf(rel) {
  const p = rel.split('/');
  if (p[0] === 'fonts') return p.length >= 5 ? p[3] : p.length >= 4 ? p[2] : null;
  return p.length >= 4 ? p[2] : null;
}

/**
 * Pick the files of `wanted` packages from extra trees, following \RequirePackage
 * chains into other packages of the same trees. Returns the files and the
 * pdfTeX/dvips map files of the chosen packages (merged into the overlay map).
 */
function selectExtra(roots, wanted, excludes, isAvailable) {
  const byFamily = new Map(); // family → files
  const ownerOf = new Map(); // basename → family
  for (const root of roots) {
    for (const f of walk(root)) {
      if (!classify(f.rel, excludes) && !/^fonts\/map\/(dvips|pdftex)\//.test(f.rel)) continue;
      const fam = familyOf(f.rel);
      if (!fam) continue;
      if (!byFamily.has(fam)) byFamily.set(fam, []);
      byFamily.get(fam).push(f);
      const base = f.rel.slice(f.rel.lastIndexOf('/') + 1);
      if (!ownerOf.has(base)) ownerOf.set(base, fam);
    }
  }
  const chosen = new Set();
  const missing = [];
  const queue = [...wanted];
  while (queue.length) {
    const fam = queue.shift();
    if (chosen.has(fam)) continue;
    if (!byFamily.has(fam)) {
      missing.push(fam);
      continue;
    }
    chosen.add(fam);
    for (const f of byFamily.get(fam)) {
      if (!TEXT_EXT.test(f.rel) || f.size > 2_000_000) continue;
      for (const dep of extractDeps(fs.readFileSync(f.abs, 'latin1'))) {
        const owner = ownerOf.get(dep);
        if (owner && !chosen.has(owner) && !isAvailable(dep)) queue.push(owner);
      }
    }
  }
  if (missing.length) console.warn(`  ! extra packages not found: ${missing.join(', ')}`);
  const files = [];
  const maps = [];
  for (const fam of chosen) {
    for (const f of byFamily.get(fam)) {
      if (/^fonts\/map\/(dvips|pdftex)\/.*\.map$/.test(f.rel)) maps.push(fs.readFileSync(f.abs, 'utf8'));
      files.push(f);
    }
  }
  return { files, maps, families: [...chosen].sort() };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function engineBaseNames(engineDir) {
  const manifestPath = path.join(engineDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No engine manifest at ${manifestPath}. Run "npm run engine:fetch" first.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const names = new Set();
  const optional = new Set(); // provided by collections that are not preloaded
  let baseMap = '';
  for (const p of manifest.packages) {
    const js = path.join(engineDir, manifest.base, p.js);
    const meta = parseDataPackageLoader(fs.readFileSync(js, 'utf8'));
    for (const f of meta.files) names.add(f.filename.slice(f.filename.lastIndexOf('/') + 1));
    if (!p.preload) for (const n of p.provides) optional.add(n);
    const mapFile = meta.files.find((f) => f.filename.endsWith('/fonts/map/pdftex/updmap/pdftex.map'));
    if (mapFile && !baseMap) {
      const reader = new DataPackageReader(js, path.join(engineDir, manifest.base, p.data));
      baseMap = new TextDecoder().decode(reader.read(mapFile.filename));
    }
  }
  const preloaded = new Set(manifest.packages.filter((p) => p.preload).flatMap((p) => p.provides));
  for (const n of preloaded) optional.delete(n);
  return { manifest, names, baseMap, optional };
}

/** Merge pdftex.map files: later maps only add fonts not already mapped. */
function mergeMaps(maps) {
  const seen = new Set();
  const lines = ['% pdftex.map generated by TexBrowser build-shelf (merged system + engine maps)'];
  for (const text of maps) {
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('%')) continue;
      const tfm = t.split(/\s+/)[0];
      if (seen.has(tfm)) continue;
      seen.add(tfm);
      lines.push(t);
    }
  }
  return lines.join('\n') + '\n';
}

const safe = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
const hash8 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const { manifest, names: baseNames, baseMap, optional } = engineBaseNames(args.engine);
  console.log(`▶ Building package shelf for engine ${manifest.id} (${baseNames.size} base files)`);

  /** @type {Map<string, {rel: string, abs: string, size: number}[]>} */
  const groups = new Map();
  const chosen = new Map(); // basename → key (first wins)
  let skippedBase = 0;
  const sources = args.texmf.map((root) => walk(root));
  let extraMaps = [];
  if (args.extraTexmf.length) {
    // Anything the main trees or the engine already have is not pulled from the extras.
    const mainNames = new Set();
    for (const root of args.texmf) for (const f of walk(root)) mainNames.add(f.rel.slice(f.rel.lastIndexOf('/') + 1));
    const extra = selectExtra(args.extraTexmf, args.extraPackages, args.exclude, (n) => baseNames.has(n) || mainNames.has(n));
    console.log(`  + ${extra.families.length} packages from extra trees: ${extra.families.join(', ')}`);
    sources.push(extra.files);
    extraMaps = extra.maps;
  }
  for (const source of sources) {
    for (const f of source) {
      const key = classify(f.rel, args.exclude);
      if (!key) continue;
      const base = f.rel.slice(f.rel.lastIndexOf('/') + 1);
      if (baseNames.has(base)) {
        skippedBase++;
        continue;
      }
      if (chosen.has(base)) continue;
      chosen.set(base, key);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
  }

  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(path.join(args.out, 'b'), { recursive: true });

  const keys = [...groups.keys()].sort();
  const indexOf = new Map(keys.map((k, i) => [k, i]));
  const bundles = [];
  const fileLines = [];
  const fontNames = {};
  const depsByKey = new Map();
  const hintsByKey = new Map();
  let totalBytes = 0;

  for (const key of keys) {
    const files = groups.get(key);
    const entries = [];
    const deps = new Set();
    const hintDeps = new Set();
    for (const f of files) {
      const data = new Uint8Array(fs.readFileSync(f.abs));
      entries.push({ path: f.rel, data });
      const base = f.rel.slice(f.rel.lastIndexOf('/') + 1);
      fileLines.push(`${base}\t${indexOf.get(key)}`);
      if (TEXT_EXT.test(base) && data.length < 2_000_000) {
        const found = extractDeps(new TextDecoder('latin1').decode(data));
        for (const dep of found) deps.add(dep);
        // Only packages/classes (not optional .code.tex libraries) hint at engine collections to pre-mount.
        if (/\.(sty|cls)$/i.test(base)) for (const dep of found) hintDeps.add(dep);
      }
      if (/\.(otf|ttf|ttc)$/i.test(base)) {
        for (const n of readFontNames(data)) fontNames[normaliseFontName(n)] ??= indexOf.get(key);
      }
    }
    depsByKey.set(key, deps);
    hintsByKey.set(key, hintDeps);
    const gz = zlib.gzipSync(createTar(entries), { level: 9 });
    const file = `b/${safe(key)}.${hash8(gz)}.tgz`;
    fs.writeFileSync(path.join(args.out, file), gz);
    totalBytes += gz.length;
    bundles.push({ n: key, f: file, s: gz.length, u: files.reduce((s, f) => s + f.size, 0), c: files.length, d: [] });
  }

  // Resolve dependency file names to bundle indices.
  for (const [key, deps] of depsByKey) {
    const self = indexOf.get(key);
    const ids = new Set();
    const hints = new Set();
    for (const dep of hintsByKey.get(key)) if (optional.has(dep)) hints.add(dep);
    for (const dep of deps) {
      const k = chosen.get(dep);
      if (k === undefined) continue;
      const i = indexOf.get(k);
      if (i !== undefined && i !== self) ids.add(i);
    }
    bundles[self].d = [...ids].sort((a, b) => a - b);
    if (hints.size) bundles[self].x = [...hints].sort();
  }

  // Overlay: merged font map (system first, then engine base for anything missing).
  const systemMaps = args.map.filter((m) => fs.existsSync(m)).map((m) => fs.readFileSync(m, 'utf8'));
  const overlayEntries = [
    { path: 'fonts/map/pdftex/updmap/pdftex.map', data: new TextEncoder().encode(mergeMaps([...systemMaps, ...extraMaps, baseMap])) },
  ];
  const overlayGz = zlib.gzipSync(createTar(overlayEntries), { level: 9 });
  const overlayFile = `b/overlay.${hash8(overlayGz)}.tgz`;
  fs.writeFileSync(path.join(args.out, overlayFile), overlayGz);
  totalBytes += overlayGz.length;

  const index = {
    schema: 1,
    label: args.label,
    engine: manifest.id,
    generatedAt: new Date().toISOString(),
    overlay: { f: overlayFile, s: overlayGz.length },
    bundles,
    fonts: fontNames,
    files: fileLines.join('\n'),
  };
  fs.writeFileSync(path.join(args.out, 'index.json'), JSON.stringify(index));

  const budget = args.budgetMb * 1048576;
  console.log(`✔ Shelf: ${bundles.length} bundles, ${fileLines.length} files, ${mb(totalBytes)} compressed (skipped ${skippedBase} files already in the engine) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const biggest = [...bundles].sort((a, b) => b.s - a.s).slice(0, 8);
  console.log('  largest bundles: ' + biggest.map((b) => `${b.n} ${mb(b.s)}`).join(', '));
  if (totalBytes > budget) {
    console.error(`✖ Shelf exceeds the ${args.budgetMb} MB budget (GitHub Pages sites are limited to 1 GB). Use --exclude to drop directories.`);
    process.exit(2);
  }
}

main();
