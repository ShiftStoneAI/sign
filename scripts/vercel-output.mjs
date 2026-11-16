// Shiftstone: turns the normal build (apps/remix/build) into Vercel's Build Output API layout, so `vercel deploy
// --prebuilt` ships it with no build on Vercel:
//
//   .vercel/output/static/                 apps/remix/build/client (assets, served by Vercel's CDN)
//   .vercel/output/functions/index.func/   one Node function: the Hono + React Router server and only the
//                                          node_modules files it uses (traced with @vercel/nft), plus fonts/logo
//   .vercel/output/config.json             static files first, everything else to the function; Vercel Cron
//
// Run after `npm run build` on Linux x64 (native modules and the Prisma engine must match Vercel's runtime):
//   node scripts/vercel-output.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nodeFileTrace } from '@vercel/nft';

const root = path.resolve(import.meta.dirname, '..');
const app = path.join(root, 'apps/remix');
const out = path.join(root, '.vercel/output');
const func = path.join(out, 'functions/index.func');
const entry = path.join(app, 'build/server/vercel.js');

if (!existsSync(entry)) {
  throw new Error('No build: run `npm run build` first.');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(func, { recursive: true });

// Static assets.
cpSync(path.join(app, 'build/client'), path.join(out, 'static'), { recursive: true });

// The function: trace from the entry, then add what's loaded by computed paths.
const { fileList, warnings } = await nodeFileTrace([entry], { base: root, processCwd: app });
const files = new Set(fileList);

const addDir = (dir) => {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) {
    return;
  }
  for (const name of readdirSync(abs, { recursive: true })) {
    const rel = path.join(dir, String(name));
    if (statSync(path.join(root, rel)).isFile()) {
      files.add(rel);
    }
  }
};
addDir('apps/remix/build/server'); // RR build, hono modules, translations (dynamic imports)
addDir('node_modules/.prisma/client'); // generated client + query engines
addDir('node_modules/@prisma/client');

// Never ship test browsers or other platforms' engines.
const skip = (f) =>
  /(^|\/)(playwright-core\/\.local-browsers|ms-playwright)\//.test(f) ||
  /libquery_engine-(darwin|debian|linux-musl|windows)/.test(f) ||
  /\.map$/.test(f);

let bytes = 0;
for (const f of files) {
  if (skip(f)) {
    continue;
  }
  const src = path.join(root, f);
  if (!existsSync(src) || !statSync(src).isFile()) {
    continue;
  }
  const dest = path.join(func, f);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { dereference: true });
  bytes += statSync(src).size;
}

// The server reads fonts and the certificate logo from `${process.cwd()}/public`; a function's cwd is its root.
for (const dir of ['public/fonts', 'public/static']) {
  cpSync(path.join(app, dir), path.join(func, dir), { recursive: true });
}

writeFileSync(
  path.join(func, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs24.x',
      handler: 'apps/remix/build/server/vercel.js',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 300,
      memory: 2048,
    },
    null,
    2,
  ),
);

writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, immutable, max-age=31536000' }, continue: true },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index' },
      ],
      crons: [{ path: '/api/cron/jobs', schedule: '*/5 * * * *' }],
    },
    null,
    2,
  ),
);

console.log(`[vercel-output] function: ${files.size} files, ${(bytes / 1e6).toFixed(1)} MB (limit 250 MB unzipped)`);
for (const w of warnings) {
  if (!String(w.message).includes('Failed to resolve dependency')) {
    console.log('[nft]', w.message);
  }
}
