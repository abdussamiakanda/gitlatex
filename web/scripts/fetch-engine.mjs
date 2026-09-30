#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * fetch-engine — download the WebAssembly TeX engine into `public/engine/`
 * and generate `public/engine/manifest.json`, which the compile worker reads
 * at runtime.
 *
 * The engine is BusyTeX: TeX Live's real pdfTeX, XeTeX, LuaHBTeX, bibtex8,
 * makeindex and xdvipdfmx compiled by Emscripten into ONE multi-call
 * WebAssembly binary (think "busybox for TeX"). TeX Live's texmf tree ships as
 * LZ4-compressed Emscripten data packages that are mounted lazily at runtime.
 *
 * Usage
 *   node scripts/fetch-engine.mjs                       # default profile, download
 *   node scripts/fetch-engine.mjs --from <dir>          # copy from a local directory
 *   node scripts/fetch-engine.mjs --profile texlyre     # experimental TeX Live 2026 build
 *   node scripts/fetch-engine.mjs --packages texlive-basic,ubuntu-texlive-latex-extra
 *   node scripts/fetch-engine.mjs --force               # re-download even if present
 *
 * Everything lands under public/engine/, so `vite build` copies it verbatim
 * into dist/ and GitHub Pages serves it from the same origin as the app —
 * no CORS, no third-party runtime dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseDataPackageLoader } from './lib/emscripten-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A working copy for building the manifest; the app gets the engine from the
// gitlatex server (gitlatex/routes/engine.py), never from public/.
const OUT = path.join(ROOT, '.cache', 'engine');
const PACKAGE_MANIFEST = path.join(ROOT, '..', 'gitlatex', 'engine', 'manifest.json');

/**
 * Engine profiles. A profile describes where the assets come from and how the
 * worker must drive them (format files, environment, data packages).
 */
const PROFILES = {
  /**
   * Upstream BusyTeX (MIT build scripts), TeX Live 2022, pinned to an exact
   * commit of the busytex.github.io deployment so builds are reproducible.
   * Additive data packages: texlive-basic is always loaded, the Ubuntu
   * collections are mounted on demand when a document needs them.
   */
  busytex: {
    id: 'busytex-tl2022',
    name: 'BusyTeX · TeX Live 2022',
    texlive: '2022',
    // LuaLaTeX is present in the binary but its format cannot restore Lua
    // bytecode registers ("expl3.lua: bad bytecode register"), so it is disabled.
    engines: ['pdftex', 'xetex'],
    source: 'https://raw.githubusercontent.com/busytex/busytex.github.io/29e71e1aa7bab9d836a4d1122fdba88d2d1382e9/dist/',
    js: 'busytex.js',
    wasm: 'busytex.wasm',
    packages: [
      { id: 'texlive-basic', label: 'TeX Live basic (LaTeX kernel, fonts, BibTeX styles)', preload: true },
      { id: 'ubuntu-texlive-latex-base', label: 'LaTeX base collection' },
      { id: 'ubuntu-texlive-latex-recommended', label: 'LaTeX recommended (beamer, booktabs, listings, xcolor…)' },
      { id: 'ubuntu-texlive-latex-extra', label: 'LaTeX extra (titlesec, enumitem, tcolorbox, cleveref…)' },
      { id: 'ubuntu-texlive-fonts-recommended', label: 'Recommended fonts (TeX Gyre, URW, …)' },
      { id: 'ubuntu-texlive-science', label: 'Science (siunitx, algorithm2e, …)' },
    ],
    sha256: {
      'busytex.js': 'ef11cdc4d36f8bf9c1fd40e5779bb24ff096d0fb69cccd021b158b01e1aa874f',
      'busytex.wasm': '44023c0197226276d61db370da15e95ec1c98fd1abf084041011d636689cdd82',
      'texlive-basic.data': 'fa1d51b0ed1a65548232e60f9bdc3eeb3ed96bcf87250c43f2843dc64337cead',
      'texlive-basic.js': '06a7878bb0ddd650df05ac66b4872c8a37d309617ce052c7b8184042e355eaa9',
      'ubuntu-texlive-fonts-recommended.data': '5e8006b4e371aee2bf710f3976a986364f7081dd9f1365ea2c98e884158f5f2d',
      'ubuntu-texlive-fonts-recommended.js': 'a590155feddcce16880ba51ce029e7592b0348464dd9a65c38487677429d9bc6',
      'ubuntu-texlive-latex-base.data': 'a0d0f2fb20ddabf0c40d9a2b969fd12514babbc71c92c0e847e1d5a0ba032b4f',
      'ubuntu-texlive-latex-base.js': 'c7cd429567185a4f9b48a37a34750fa861496a5b3188022d3d1d9b743fe8747d',
      'ubuntu-texlive-latex-extra.data': '8e3581093015af2ffdbe77cee4c0aefa8d0e2a86b8e22eeb2d9fe4108c6260ee',
      'ubuntu-texlive-latex-extra.js': '23aa09244b374c44b71e841eec9b97f22363ac5bec69c465b7f1b65253831f9f',
      'ubuntu-texlive-latex-recommended.data': 'a6ea762272218d9b4ae8fe937c379a9d7a4f656fd4fde2ac2ff95f1e69e6fd23',
      'ubuntu-texlive-latex-recommended.js': '02882e14e587390c9c03bdb9df34a78512731f01c7652e5d81deb04d0124bfa2',
      'ubuntu-texlive-science.data': '3aab1ad9e93df5bd864ed3c9b66cf43fbfee650455bc7eaeac8374b196c896b8',
      'ubuntu-texlive-science.js': '3e4fccb122c66bb80fbc82ab8f0b5a911106a141f48d9f2093630dbcf35ae304',
    },
    fmt: {
      pdftex: '/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt',
      xetex: '/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt',
      luahbtex: '/texlive/texmf-dist/texmf-var/web2c/luahbtex/luahblatex.fmt',
    },
    env: {
      TEXMFDIST: '/texlive/texmf-dist:/texmf/texmf-dist',
      TEXMFVAR: '/texlive/texmf-dist/texmf-var',
      TEXMFCNF: '/texlive/texmf-dist/web2c',
      TEXMFLOG: '/tmp/texmf.log',
      FONTCONFIG_PATH: '/etc/fonts',
    },
    features: { kpseRemote: false, biber: false },
  },

  /**
   * EXPERIMENTAL: TeXlyre's BusyTeX build (TeX Live 2026, AGPL-3.0 assets).
   * Its data packages are *supersets* (extra ⊃ recommended ⊃ basic), so the
   * worker loads exactly one of them. The build also contains a kpathsea hook
   * that can fetch missing files from a remote TeX Live endpoint.
   */
  texlyre: {
    id: 'texlyre-tl2026',
    name: 'TeXlyre BusyTeX · TeX Live 2026 (experimental)',
    texlive: '2026',
    engines: ['pdftex', 'xetex', 'luatex'],
    archive: 'https://github.com/TeXlyre/texlyre-busytex/releases/download/assets-v1.4.0/busytex-assets.tar.gz',
    archiveSubdir: 'busytex',
    js: 'busytex.js',
    wasm: 'busytex.wasm',
    packages: [
      { id: 'texlive-basic', label: 'TeX Live basic', preload: true, supersetLevel: 0 },
      { id: 'texlive-recommended', label: 'TeX Live recommended (includes basic)', supersetLevel: 1 },
      { id: 'texlive-extra', label: 'TeX Live extra (includes recommended)', supersetLevel: 2 },
    ],
    sha256: {},
    fmt: {
      pdftex: '/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt',
      xetex: '/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt',
      luahbtex: '/texlive/texmf-dist/texmf-var/web2c/luahbtex/luahblatex.fmt',
    },
    env: {
      TEXMFDIST: '/texlive/texmf-dist:/texmf/texmf-dist',
      TEXMFVAR: '/texlive/texmf-dist/texmf-var',
      TEXMFCACHE: '/texlive/texmf-dist/texmf-var',
      TEXMFCNF: '/texlive/texmf-dist/web2c',
      TEXMFLOG: '/tmp/texmf.log',
      FONTCONFIG_PATH: '/texlive',
      FONTCONFIG_FILE: '/texlive/fonts.conf',
      ICU_DATA: '/texlive/',
      TEXLIVE_REMOTE_ENDPOINT: '',
    },
    features: { kpseRemote: true, biber: false },
  },
};

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { profile: 'busytex', from: null, force: false, packages: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') args.profile = argv[++i];
    else if (a === '--from') args.from = path.resolve(argv[++i]);
    else if (a === '--force') args.force = true;
    else if (a === '--packages') args.packages = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 26).join('\n'));
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let lastLog = 0;
  for await (const chunk of res.body) {
    out.write(chunk);
    got += chunk.length;
    if (Date.now() - lastLog > 2000) {
      lastLog = Date.now();
      process.stdout.write(`  … ${path.basename(dest)} ${mb(got)}${total ? ' / ' + mb(total) : ''}\r`);
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  fs.renameSync(tmp, dest);
}

/**
 * Basenames a data package provides that TeX may report as missing: packages and
 * classes, bib styles, font definitions and — for font collections — metrics,
 * virtual fonts, Type 1 binaries and encodings. The worker maps a missing name
 * to the collection that provides it and mounts it.
 */
function providesOf(files) {
  const texExts = /\.(sty|cls|bst|bbx|cbx|lbx|ldf|tex|fd|def|cfg|clo)$/;
  const fontExts = /\.(tfm|vf|pfb|enc|otf)$/;
  const set = new Set();
  for (const f of files) {
    const p = f.filename;
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (p.includes('/fonts/')) {
      if (fontExts.test(base)) set.add(base);
      continue;
    }
    if (!p.includes('/tex/') && !p.includes('/bibtex/')) continue;
    if (!texExts.test(base)) continue;
    // `.tex` files are only interesting when they are tikz/pgf libraries or package parts.
    if (base.endsWith('.tex') && !/^(tikzlibrary|pgflibrary|pgfplotslibrary)/.test(base)) continue;
    set.add(base);
  }
  return [...set].sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = PROFILES[args.profile];
  if (!profile) throw new Error(`Unknown profile "${args.profile}". Available: ${Object.keys(PROFILES).join(', ')}`);

  const dir = path.join(OUT, profile.id);
  fs.mkdirSync(dir, { recursive: true });
  const wanted = profile.packages.filter((p) => !args.packages || args.packages.includes(p.id) || p.preload);

  const names = [profile.js, profile.wasm, ...wanted.flatMap((p) => [`${p.id}.js`, `${p.id}.data`])];
  console.log(`▶ Engine profile: ${profile.name}`);

  if (profile.archive && !args.from) {
    // Release archive (TeXlyre) → download + extract once.
    const have = names.every((n) => fs.existsSync(path.join(dir, n)));
    if (!have || args.force) {
      const tgz = path.join(OUT, 'engine-archive.tar.gz');
      console.log(`  ↓ ${profile.archive}`);
      await download(profile.archive, tgz);
      const tmp = path.join(OUT, '.extract');
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' });
      const src = fs.existsSync(path.join(tmp, profile.archiveSubdir)) ? path.join(tmp, profile.archiveSubdir) : tmp;
      for (const n of names) {
        const s = path.join(src, n);
        if (!fs.existsSync(s)) throw new Error(`Archive is missing ${n}`);
        fs.renameSync(s, path.join(dir, n));
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(tgz, { force: true });
    }
  } else {
    for (const n of names) {
      const dest = path.join(dir, n);
      const expected = profile.sha256[n];
      if (!args.force && fs.existsSync(dest) && (!expected || sha256(dest) === expected)) {
        console.log(`  ✓ ${n} (cached)`);
        continue;
      }
      if (args.from) {
        fs.copyFileSync(path.join(args.from, n), dest);
        console.log(`  ⧉ ${n} ← ${args.from}`);
      } else {
        console.log(`  ↓ ${n}`);
        await download(profile.source + n, dest);
      }
      if (expected) {
        const got = sha256(dest);
        if (got !== expected) {
          fs.rmSync(dest);
          throw new Error(`Checksum mismatch for ${n}: expected ${expected}, got ${got}`);
        }
      }
    }
  }

  // Build the manifest the worker consumes.
  const packages = wanted.map((p) => {
    const meta = parseDataPackageLoader(fs.readFileSync(path.join(dir, `${p.id}.js`), 'utf8'));
    return {
      id: p.id,
      label: p.label,
      js: `${p.id}.js`,
      data: `${p.id}.data`,
      bytes: fs.statSync(path.join(dir, `${p.id}.data`)).size,
      fileCount: meta.files.length,
      preload: Boolean(p.preload),
      supersetLevel: p.supersetLevel ?? null,
      provides: providesOf(meta.files),
    };
  });

  // Short content hashes let the worker cache assets forever and still pick up new builds.
  const hashes = Object.fromEntries(names.map((n) => [n, sha256(path.join(dir, n)).slice(0, 12)]));

  const manifest = {
    schema: 1,
    id: profile.id,
    name: profile.name,
    texlive: profile.texlive,
    engines: profile.engines,
    base: `${profile.id}/`,
    js: profile.js,
    wasm: profile.wasm,
    wasmBytes: fs.statSync(path.join(dir, profile.wasm)).size,
    memHeaderBytes: 2 ** 26,
    fmt: profile.fmt,
    env: profile.env,
    features: profile.features,
    packages,
    hashes,
    // Lets the gitlatex server fetch and verify assets itself (gitlatex/routes/engine.py).
    upstream: profile.source ?? null,
    sha256: profile.source ? Object.fromEntries(names.map((n) => [n, sha256(path.join(dir, n))])) : null,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
  // The Python package ships only the manifest; the server downloads the
  // assets it lists on first use (see gitlatex/routes/engine.py).
  if (profile.source) fs.writeFileSync(PACKAGE_MANIFEST, JSON.stringify(manifest));

  const total = names.reduce((s, n) => s + fs.statSync(path.join(dir, n)).size, 0);
  console.log(`✔ Engine ready in .cache/engine/${profile.id}/ (${mb(total)}), manifest written.`);
  for (const p of packages) console.log(`  · ${p.id.padEnd(36)} ${mb(p.bytes).padStart(9)}  ${p.provides.length} files`);
}

main().catch((err) => {
  console.error(`✖ fetch-engine failed: ${err.message}`);
  process.exit(1);
});
