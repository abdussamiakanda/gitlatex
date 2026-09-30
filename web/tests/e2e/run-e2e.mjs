// Runs the TeX engine browser suite against a Vite dev server.
//
//   gitlatex --no-browser        # the dev server proxies /engine and /shelf to it
//   npm run e2e
//
// The engine suite drives engine-harness.html, which only the dev server serves.
// The editor itself is covered by the suites that run against a gitlatex
// server: e2e:gitlatex, e2e:features and e2e:synctex (see README).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Run a suite script as a child process; resolves to its exit code. */
function run(script, base) {
  return new Promise((resolve) => {
    console.log(`\n▶ ${script} → ${base}`);
    const child = spawn(process.execPath, [path.join(here, script), base], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const dev = await createServer({ logLevel: 'warn', server: { port: 5199, host: '127.0.0.1' } });
let failed = 0;
try {
  await dev.listen();
  failed += (await run('engine.mjs', dev.resolvedUrls.local[0])) ? 1 : 0;
} finally {
  await dev.close();
}
console.log(failed ? '\n✖ the engine suite failed' : '\n✔ engine suite passed');
process.exit(failed ? 1 : 0);
