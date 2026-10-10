import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * The build lands in ../gitlatex/ui, which the gitlatex server serves at `/`.
 *
 * `npm run dev` serves the UI with hot reload and forwards every API call to a
 * gitlatex server on :5000 (start it with `gitlatex --no-browser`), including
 * /engine and /shelf, which the server downloads and caches on first use.
 */
const API = process.env.GITLATEX_API ?? 'http://127.0.0.1:5000';
const API_ROUTES = [
  '/api', '/repos', '/select-repo', '/create-workspace', '/delete-repo', '/clone',
  '/file-raw', '/compile', '/save-pdf', '/pdf', '/synctex',
  '/status', '/remote-status', '/working-files', '/working-file', '/commits', '/commit-files', '/commit-file',
  '/compare-files', '/compare-file', '/push', '/pull', '/diff', '/engine', '/shelf', '/classic', '/review',
];

// monaco-vim imports Monaco's internals by their old `monaco-editor/esm/vs/...`
// paths, which Monaco 0.57's exports map no longer resolves. Point them at the
// real files; `editor.api` is then the same module instance the app uses.
const MONACO_ESM = fileURLToPath(new URL('./node_modules/monaco-editor/esm/vs/', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: /^monaco-editor\/esm\/vs\/(.*?)(\.js)?$/, replacement: `${MONACO_ESM}$1.js` }],
  },
  worker: { format: 'es' },
  build: {
    outDir: '../gitlatex/ui',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    // Maps make a crash in a local build point at real files and lines;
    // pyproject.toml keeps them out of the PyPI package.
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: Object.fromEntries(API_ROUTES.map((r) => [r, { target: API, changeOrigin: true }])),
  },
  preview: { port: 4173 },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
} as import('vite').UserConfig);
