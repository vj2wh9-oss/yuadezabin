/**
 * 案件ポータルの同期API（Cloudflare Workers + KV）
 *
 * 保管するのは「アプリのデータ1件」だけ。合鍵（トークン）ひとつが持ち主を表す。
 * 合鍵そのものは保存せず、SHA-256 にしたものを保管キーに使う。
 *
 *   GET  /v1/meta   → { exists, rev, savedAt, updatedAt, size, by }
 *   GET  /v1/state  → { rev, savedAt, updatedAt, by, data }
 *   PUT  /v1/state  → { rev, savedAt, data, by, force }
 *                     rev が食い違えば 409 と現在の内容を返す（勝手に上書きしない）
 *
 * 設定（wrangler.jsonc）
 *   KV 名前空間 SYNC を bind する
 *   ALLOW_ORIGIN にアプリの URL（省略時はどこからでも許可。合鍵で守る前提）
 */

const MAX_BYTES = 20 * 1024 * 1024;   // KV の上限は25MBなので余裕をみる
const MIN_TOKEN = 24;                 // 合鍵の最低長

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const token = bearer(request);
    if (!token || token.length < MIN_TOKEN) {
      return json({ error: 'unauthorized' }, 401, cors);
    }
    if (!env.SYNC) return json({ error: 'kv_not_bound' }, 500, cors);

    const id = await sha256(token);
    const dataKey = 'state:' + id;
    const metaKey = 'meta:' + id;

    try {
      if (url.pathname === '/v1/meta' && request.method === 'GET') {
        const meta = await env.SYNC.get(metaKey, 'json');
        return json(meta ? { exists: true, ...meta } : { exists: false, rev: 0 }, 200, cors);
      }

      if (url.pathname === '/v1/state' && request.method === 'GET') {
        const raw = await env.SYNC.get(dataKey, 'text');
        if (!raw) return json({ exists: false, rev: 0 }, 404, cors);
        const meta = (await env.SYNC.get(metaKey, 'json')) || {};
        return new Response(
          '{"exists":true,"rev":' + (meta.rev || 0) +
          ',"savedAt":' + JSON.stringify(meta.savedAt || '') +
          ',"updatedAt":' + JSON.stringify(meta.updatedAt || '') +
          ',"by":' + JSON.stringify(meta.by || '') +
          ',"data":' + raw + '}',
          { status: 200, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } }
        );
      }

      if (url.pathname === '/v1/state' && request.method === 'PUT') {
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
        if (!body || typeof body.data !== 'object' || body.data === null) {
          return json({ error: 'bad_body' }, 400, cors);
        }

        const payload = JSON.stringify(body.data);
        if (payload.length > MAX_BYTES) return json({ error: 'too_large' }, 413, cors);

        const cur = (await env.SYNC.get(metaKey, 'json')) || { rev: 0 };
        const sent = Number(body.rev) || 0;

        // 相手が進んでいたら、こちらの言い分だけで上書きしない
        if (!body.force && sent !== cur.rev) {
          const raw = await env.SYNC.get(dataKey, 'text');
          return new Response(
            '{"error":"conflict","rev":' + (cur.rev || 0) +
            ',"savedAt":' + JSON.stringify(cur.savedAt || '') +
            ',"updatedAt":' + JSON.stringify(cur.updatedAt || '') +
            ',"by":' + JSON.stringify(cur.by || '') +
            ',"data":' + (raw || 'null') + '}',
            { status: 409, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } }
          );
        }

        const meta = {
          rev: (cur.rev || 0) + 1,
          savedAt: String(body.savedAt || ''),
          updatedAt: new Date().toISOString(),
          size: payload.length,
          by: String(body.by || '').slice(0, 40)
        };
        await env.SYNC.put(dataKey, payload);
        await env.SYNC.put(metaKey, JSON.stringify(meta));
        return json({ ok: true, ...meta }, 200, cors);
      }

      if (url.pathname === '/v1/state' && request.method === 'DELETE') {
        await env.SYNC.delete(dataKey);
        await env.SYNC.delete(metaKey);
        return json({ ok: true }, 200, cors);
      }
    } catch (e) {
      return json({ error: 'server_error', message: String(e && e.message || e) }, 500, cors);
    }

    return json({ error: 'not_found' }, 404, cors);
  }
};

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function corsHeaders(env) {
  return {
    'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
    'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    'cache-control': 'no-store'
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' }
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
