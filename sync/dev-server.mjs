/**
 * worker.js を手元で動かすための小さなサーバー。
 * KV の代わりにメモリ（--file を付けると JSON ファイル）を使う。
 *
 *   node sync/dev-server.mjs [--port 8790] [--file .sync-dev.json]
 *
 * 本番と同じ worker.js をそのまま読み込むので、動きの確認に使える。
 * 保存は素朴なので、開発以外には使わないこと。
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import worker from './worker.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(opt('port', 8790));
const file = opt('file', '');

const store = new Map();
if (file && existsSync(file)) {
  for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) store.set(k, v);
}
const persist = () => {
  if (file) writeFileSync(file, JSON.stringify(Object.fromEntries(store)));
};

const KV = {
  async get(key, type) {
    const v = store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  },
  async put(key, value) { store.set(key, String(value)); persist(); },
  async delete(key) { store.delete(key); persist(); }
};

/* R2 の代わり。worker.js が使う put / get / delete / list だけを真似る */
const blobs = new Map();
const R2 = {
  async put(key, body, opts) {
    const buf = body instanceof Uint8Array ? Buffer.from(body)
      : body && typeof body.getReader === 'function' ? await readStream(body)
        : Buffer.from(body || '');
    blobs.set(key, { body: buf, size: buf.length, uploaded: new Date().toISOString(), ...opts });
    return { key, size: buf.length };
  },
  async get(key) {
    const o = blobs.get(key);
    if (!o) return null;
    return {
      key, size: o.size, body: o.body,
      customMetadata: o.customMetadata,
      httpMetadata: o.httpMetadata,
      async arrayBuffer() { return o.body.buffer.slice(o.body.byteOffset, o.body.byteOffset + o.body.length); },
      async text() { return o.body.toString('utf8'); },
      writeHttpMetadata(headers) {
        if (o.httpMetadata && o.httpMetadata.contentType) {
          headers.set('content-type', o.httpMetadata.contentType);
        }
      }
    };
  },
  async delete(key) { blobs.delete(key); },
  async list({ prefix }) {
    const objects = [...blobs.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, o]) => ({
        key, size: o.size, uploaded: o.uploaded,
        customMetadata: o.customMetadata, httpMetadata: o.httpMetadata
      }));
    return { objects, truncated: false };
  }
};

async function readStream(stream) {
  const parts = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

const env = { SYNC: KV, FILES: R2, ALLOW_ORIGIN: process.env.ALLOW_ORIGIN || '*' };
// OPENAI_* は手元の環境変数から通す（レシート読み取りの動きを確かめるため）
for (const k of Object.keys(process.env)) {
  if (k.startsWith('OPENAI_') || k.startsWith('VAPID_')) env[k] = process.env[k];
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request('http://localhost:' + port + req.url, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
  });

  let out;
  try {
    out = await worker.fetch(request, env);
  } catch (e) {
    out = new Response(JSON.stringify({ error: 'dev_server', message: String(e) }), { status: 500 });
  }
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, '127.0.0.1', () => {
  console.log('sync dev server: http://127.0.0.1:' + port + (file ? '  (保存先 ' + file + ')' : '  (メモリのみ)'));
});
