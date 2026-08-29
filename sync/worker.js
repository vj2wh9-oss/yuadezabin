/**
 * 案件ポータルの同期API（Cloudflare Workers + KV + R2）
 *
 * 合鍵（トークン）ひとつが持ち主を表す。
 * 合鍵そのものは保存せず、SHA-256 にしたものを保管キーに使う。
 *
 * アプリのデータ（KV）
 *   GET  /v1/meta   → { exists, rev, savedAt, updatedAt, size, by }
 *   GET  /v1/state  → { rev, savedAt, updatedAt, by, data }
 *   PUT  /v1/state  → { rev, savedAt, data, by, force }
 *                     rev が食い違えば 409 と現在の内容を返す（勝手に上書きしない）
 *
 * 共有ファイル（R2）
 *   GET    /v1/files          → { files:[{id,name,folder,size,type,uploadedAt,projectId,by}], total }
 *   PUT    /v1/files/<id>     → 本文がそのままファイル。名前などは x-file-* ヘッダで渡す
 *   GET    /v1/files/<id>     → ファイルそのもの
 *   DELETE /v1/files/<id>     → 削除
 *
 * 設定（wrangler.jsonc）
 *   KV 名前空間 SYNC を bind する
 *   R2 バケット FILES を bind する（ファイル共有を使うときだけ）
 *   ALLOW_ORIGIN にアプリの URL（省略時はどこからでも許可。合鍵で守る前提）
 */

const MAX_BYTES = 20 * 1024 * 1024;   // KV の上限は25MBなので余裕をみる
const MIN_TOKEN = 24;                 // 合鍵の最低長
// Workers の受信上限（無料・Proは100MB）。これを超えるとそもそも届かない
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    // 生存確認。ブラウザでURLを開いたときに「動いているか」が分かるようにする。
    // 合鍵は要らないが、データは一切返さない（バインドの有無だけ）。
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        ok: true,
        service: '案件ポータルの同期API',
        bindings: { kv: !!env.SYNC, r2: !!env.FILES },
        endpoints: ['/v1/meta', '/v1/state', '/v1/files'],
        note: '各 /v1/... は Authorization: Bearer <合鍵> が必要です'
      }, 200, cors);
    }

    const token = bearer(request);
    if (!token || token.length < MIN_TOKEN) {
      return json({ error: 'unauthorized' }, 401, cors);
    }
    const id = await sha256(token);

    // 共有ファイル（R2）
    if (url.pathname === '/v1/files' || url.pathname.startsWith('/v1/files/')) {
      return files(request, env, cors, url, id);
    }

    if (!env.SYNC) return json({ error: 'kv_not_bound' }, 500, cors);

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

/* ---------------- 共有ファイル（R2） ---------------- */

async function files(request, env, cors, url, id) {
  if (!env.FILES) return json({ error: 'r2_not_bound' }, 500, cors);

  const prefix = 'files/' + id + '/';
  const rest = url.pathname.slice('/v1/files'.length).replace(/^\//, '');

  try {
    // 一覧
    if (!rest && request.method === 'GET') {
      const out = [];
      let cursor;
      let total = 0;
      // 1000件ずつしか返らないので最後まで辿る
      do {
        const page = await env.FILES.list({ prefix, cursor, include: ['customMetadata', 'httpMetadata'] });
        for (const o of page.objects) {
          const m = o.customMetadata || {};
          total += o.size;
          out.push({
            id: o.key.slice(prefix.length),
            name: m.name ? decodeURIComponent(m.name) : o.key.slice(prefix.length),
            // 置いたときのフォルダ。まだ同期していない端末でも置き場所が分かるようにする
            folder: m.folder ? decodeURIComponent(m.folder) : '',
            size: o.size,
            type: (o.httpMetadata && o.httpMetadata.contentType) || '',
            uploadedAt: m.uploadedAt || o.uploaded,
            projectId: m.projectId || '',
            by: m.by || ''
          });
        }
        cursor = page.truncated ? page.cursor : null;
      } while (cursor);
      out.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
      return json({ files: out, total }, 200, cors);
    }

    if (!rest) return json({ error: 'not_found' }, 404, cors);

    // ファイルIDに使えるのは英数字とハイフンだけ（パスを抜けられないように）
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(rest)) return json({ error: 'bad_id' }, 400, cors);
    const key = prefix + rest;

    // 受け取り
    if (request.method === 'PUT') {
      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > MAX_FILE_BYTES) return json({ error: 'too_large', max: MAX_FILE_BYTES }, 413, cors);

      // 本文はそのまま R2 へ流す（Worker のメモリに溜めない）
      const obj = await env.FILES.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get('x-file-type') || 'application/octet-stream' },
        customMetadata: {
          name: request.headers.get('x-file-name') || rest,   // URLエンコード済みで受け取る
          folder: request.headers.get('x-file-folder') || '', // 同上。'資料/ラフ' のようなパス
          projectId: request.headers.get('x-file-project') || '',
          by: (request.headers.get('x-file-by') || '').slice(0, 40),
          uploadedAt: new Date().toISOString()
        }
      });
      if (!obj) return json({ error: 'upload_failed' }, 500, cors);
      return json({ ok: true, id: rest, size: obj.size }, 200, cors);
    }

    // 取り出し
    if (request.method === 'GET') {
      const obj = await env.FILES.get(key);
      if (!obj) return json({ error: 'not_found' }, 404, cors);
      const m = obj.customMetadata || {};
      const name = m.name || rest;                       // URLエンコードされたまま使える
      const headers = new Headers(cors);
      obj.writeHttpMetadata(headers);
      headers.set('content-length', String(obj.size));
      headers.set('content-disposition', "attachment; filename*=UTF-8''" + name);
      headers.set('cache-control', 'no-store');
      return new Response(obj.body, { status: 200, headers });
    }

    if (request.method === 'DELETE') {
      await env.FILES.delete(key);
      return json({ ok: true }, 200, cors);
    }
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500, cors);
  }

  return json({ error: 'not_found' }, 404, cors);
}

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function corsHeaders(env) {
  return {
    'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
    'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-file-name, x-file-folder, x-file-type, x-file-project, x-file-by',
    'access-control-expose-headers': 'content-disposition, content-length',
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
