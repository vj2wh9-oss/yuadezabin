/**
 * テストをまとめて走らせる。
 *
 *   node tests/run.mjs                   ぜんぶ
 *   node tests/run.mjs behind preset     名前で絞る
 *
 * アプリを配るサーバーは、このスクリプトが自分で立てて、終わったら畳む。
 * 同期のテストだけは sync/dev-server.mjs も立てる（本番と同じ worker.js を読む）。
 *
 * Playwright が要る。入っていなければ、その旨だけ出して終わる。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const APP_PORT = 8778;
const SYNC_PORT = 8790;

const TYPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

/* ---------------- アプリを配るサーバー ---------------- */

function serveApp(port) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path.endsWith('/')) path += 'index.html';
    // 上へ抜けさせない
    if (path.includes('..')) { res.writeHead(400).end(); return; }
    const file = join(ROOT, path);
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPE[extname(file)] || 'application/octet-stream',
        // テストのたびに古いものを掴まないように
        'cache-control': 'no-store'
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ありません: ' + path);
    }
  });
  return new Promise((ok, ng) => {
    server.on('error', ng);
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}

/* ---------------- 同期のサーバー（要るときだけ） ---------------- */

async function serveSync(port) {
  const child = spawn(process.execPath, [join(ROOT, 'sync', 'dev-server.mjs'), '--port', String(port)], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe']
  });
  const errs = [];
  child.stderr.on('data', (b) => errs.push(String(b)));
  // 立ち上がるまで待つ
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/');
      if (r.ok || r.status === 404) return child;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('同期のサーバーが立ち上がりませんでした\n' + errs.join(''));
}

/* ---------------- ここから本体 ---------------- */

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

try {
  const { playwright } = await import('./lib/playwright.mjs');
  await playwright();
} catch (e) {
  console.error(e && e.missing ? e.message : (e && e.stack) || e);
  process.exit(2);
}

const dir = join(HERE, 'cases');
const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).sort();
const cases = [];
for (const f of files) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  const c = mod.default;
  if (!c || typeof c.run !== 'function') continue;
  const key = f.replace(/\.mjs$/, '');
  if (only.length && !only.some((o) => key.includes(o) || c.name.includes(o))) continue;
  cases.push({ key, ...c });
}

if (!cases.length) {
  console.error('走らせるものがありません' + (only.length ? '（絞り込み: ' + only.join(' ') + '）' : ''));
  process.exit(2);
}

const app = await serveApp(APP_PORT);
const base = 'http://127.0.0.1:' + APP_PORT;
let sync = null;
if (cases.some((c) => c.needsSync)) sync = await serveSync(SYNC_PORT);

const t0 = Date.now();
let bad = 0;
const summary = [];

for (const c of cases) {
  const started = Date.now();
  let s;
  try {
    s = await c.run({ base, syncBase: 'http://127.0.0.1:' + SYNC_PORT });
  } catch (e) {
    console.log('\n■ ' + c.name);
    console.log('  途中で止まりました: ' + (e && e.message ? e.message : e));
    bad++;
    summary.push({ name: c.name, bad: 1, ms: Date.now() - started });
    continue;
  }
  console.log('\n■ ' + s.name);
  for (const r of s.rows) {
    if (r.note !== undefined) { console.log('      ' + r.note); continue; }
    if (r.good) console.log('  OK  ' + r.what);
    else console.log('  NG  ' + r.what + ' → ' + JSON.stringify(r.got) + '（期待 ' + JSON.stringify(r.want) + '）');
  }
  bad += s.bad;
  summary.push({ name: s.name, bad: s.bad, ms: Date.now() - started });
}

app.close();
if (sync) sync.kill();
if (existsSync(join(ROOT, '.sync-dev.json'))) { /* --file を付けていないので出ないはず */ }

console.log('\n' + '─'.repeat(46));
for (const r of summary) {
  console.log((r.bad ? 'NG  ' : 'OK  ') + r.name + '  ' + Math.round(r.ms / 100) / 10 + '秒'
    + (r.bad ? '（' + r.bad + '件 だめ）' : ''));
}
console.log('─'.repeat(46));
console.log(bad ? '=> ' + bad + '件 だめ（' + Math.round((Date.now() - t0) / 100) / 10 + '秒）'
  : '=> ぜんぶ通った（' + Math.round((Date.now() - t0) / 100) / 10 + '秒）');
process.exit(bad ? 1 : 0);
