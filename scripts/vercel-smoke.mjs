// Shiftstone: runs the packaged Vercel function locally (cwd = function root, like Vercel) and requests a few pages,
// to catch files the tracer missed before deploying. Needs the app's env in the environment.
//   node scripts/vercel-smoke.mjs
import http from 'node:http';
import path from 'node:path';

const func = path.resolve(import.meta.dirname, '../.vercel/output/functions/index.func');
process.chdir(func);
const { default: handler } = await import(path.join(func, 'apps/remix/build/server/vercel.js'));
const server = http.createServer((req, res) => handler(req, res));
await new Promise((r) => server.listen(3999, r));
let bad = 0;
for (const p of ['/signin', '/signup', '/', '/api/health', '/forgot-password']) {
  const r = await fetch(`http://127.0.0.1:3999${p}`, { redirect: 'manual' });
  if (r.status >= 500) {
    bad++;
  }
  console.log(p, r.status);
}
server.close();
process.exit(bad ? 1 : 0);
