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
 * 通知（Web Push）
 *   PUT    /v1/push/sub    → この端末の宛先を登録（本文は購読情報）
 *   DELETE /v1/push/sub    → 登録を外す（本文 {deviceId}）
 *   PUT    /v1/push/queue  → 送る予定の一覧を丸ごと差し替え
 *   GET    /v1/push/state  → { subs, queued, sent, vapid } 様子を見るため
 *   毎分の Cron で、時刻が来たものを送る（送った印を残すので二度送らない）
 *
 * 外から届くもの（FANBOX の取り込み）
 *   POST   /v1/inbox/fanbox → 本文 {rows|text, from} を1件だけ預かる（新しいものが上書き）
 *                              rows は [{ym:'2026-08', amount, fee, net}]
 *   GET    /v1/inbox/fanbox → { exists, at, from, source, rows, text }
 *   DELETE /v1/inbox/fanbox → 消す
 *   FANBOX のページで動かすブックマークレットが送り、アプリが受け取って読む。
 *   合鍵で守るので、CORS は fanbox.cc からの送信も通す。
 *
 * 設定（wrangler.jsonc）
 *   KV 名前空間 SYNC を bind する
 *   R2 バケット FILES を bind する（ファイル共有を使うときだけ）
 *   ALLOW_ORIGIN にアプリの URL（省略時はどこからでも許可。合鍵で守る前提）
 *   通知を使うときだけ：
 *     triggers.crons に "* * * * *"
 *     secret VAPID_PUBLIC / VAPID_PRIVATE（アプリの設定画面で作れる）
 *     var VAPID_SUBJECT（"mailto:自分のメールアドレス"）
 */

const MAX_BYTES = 20 * 1024 * 1024;   // KV の上限は25MBなので余裕をみる
const MIN_TOKEN = 24;                 // 合鍵の最低長
// Workers の受信上限（無料・Proは100MB）。これを超えるとそもそも届かない
const MAX_FILE_BYTES = 100 * 1024 * 1024;
// 外から預かる文字（FANBOX のページの文字）。表1枚ぶんに十分な大きさ
const MAX_INBOX_BYTES = 256 * 1024;
const INBOX_KEEP_DAYS = 14;
const MAX_INBOX_ROWS = 400;          // 月ごとの金額。30年ぶんあれば足りる

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    // 生存確認。ブラウザでURLを開いたときに「動いているか」が分かるようにする。
    // 合鍵は要らないが、データは一切返さない（バインドの有無だけ）。
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        ok: true,
        service: '案件ポータルの同期API',
        bindings: { kv: !!env.SYNC, r2: !!env.FILES },
        endpoints: ['/v1/meta', '/v1/state', '/v1/files', '/v1/push', '/v1/inbox/fanbox'],
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

      if (url.pathname.startsWith('/v1/push/')) {
        return push(request, env, cors, url, id);
      }

      if (url.pathname === '/v1/inbox/fanbox') {
        return inbox(request, env, cors, id);
      }
    } catch (e) {
      return json({ error: 'server_error', message: String(e && e.message || e) }, 500, cors);
    }

    return json({ error: 'not_found' }, 404, cors);
  },

  /* 毎分の Cron。時刻が来た通知を送る */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  }
};

/* ---------------- 外から届くもの（FANBOX の取り込み） ---------------- */

/**
 * FANBOX のページで動くブックマークレットからの預かり所。
 * 読み取りはしない。文字をそのまま置いておき、アプリ側が読み解く
 * （読み取りの決まりごとを1か所に集めておきたいため）。
 */
async function inbox(request, env, cors, id) {
  const key = 'inbox:' + id + ':fanbox';

  if (request.method === 'GET') {
    const rec = await env.SYNC.get(key, 'json');
    if (!rec) return json({ exists: false }, 200, cors);
    return json({
      exists: true, at: rec.at, from: rec.from || '', source: rec.source || '',
      rows: rec.rows || null, text: rec.text || ''
    }, 200, cors);
  }

  if (request.method === 'DELETE') {
    await env.SYNC.delete(key);
    return json({ ok: true }, 200, cors);
  }

  if (request.method === 'POST' || request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }

    // FANBOX の窓口から取れたとき（月ごとの金額そのもの）
    const rows = cleanRows(body && body.rows);
    const text = String(body && body.text || '');
    if (!rows.length && !text.trim()) return json({ error: 'empty' }, 400, cors);
    if (text.length > MAX_INBOX_BYTES) return json({ error: 'too_large' }, 413, cors);

    const rec = {
      at: new Date().toISOString(),
      from: String(body && body.from || '').slice(0, 80),
      source: rows.length ? 'api' : 'page',
      rows: rows.length ? rows : null,
      text: rows.length ? '' : text
    };
    // 置きっぱなしにしない。取り込まれなくても2週間で消える
    await env.SYNC.put(key, JSON.stringify(rec), { expirationTtl: INBOX_KEEP_DAYS * 24 * 3600 });
    return json({ ok: true, at: rec.at, rows: rows.length, length: rec.text.length }, 200, cors);
  }

  return json({ error: 'not_found' }, 404, cors);
}

/* 送られてきた月ごとの金額を、形だけ整える（中身は信用せず、型と桁だけ見る） */
function cleanRows(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, MAX_INBOX_ROWS)) {
    const ym = String(r && r.ym || '');
    const amount = Math.round(Number(r && r.amount));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) continue;
    if (!isFinite(amount) || amount < 0 || amount > 1e9) continue;
    out.push({
      ym,
      amount,
      fee: Math.max(0, Math.round(Number(r && r.fee) || 0)),
      net: Math.max(0, Math.round(Number(r && r.net) || 0))
    });
  }
  return out;
}

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

/* ---------------- 通知（Web Push） ----------------

   仕組み
     アプリ側が「いつ・何を出すか」をぜんぶ決めて、その一覧をここへ預ける。
     ここは時刻が来たものを送るだけで、予定の中身は解釈しない。
     こうしておくと、通知の種別を増やすときにこちら側を触らずに済む。 */

const SENT_KEEP_MS = 30 * 24 * 3600 * 1000;   // 送った印を残す期間
const LATE_MS = 6 * 3600 * 1000;              // これより古くなったものは送らない

async function push(request, env, cors, url, id) {
  const subsKey = 'push:' + id + ':subs';
  const queueKey = 'push:' + id + ':queue';
  const sentKey = 'push:' + id + ':sent';

  if (url.pathname === '/v1/push/sub' && request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
    const sub = body && body.sub;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json({ error: 'bad_sub' }, 400, cors);
    }
    const device = String(body.deviceId || '').slice(0, 64) || (await sha256(sub.endpoint)).slice(0, 16);
    const subs = (await env.SYNC.get(subsKey, 'json')) || [];
    // 同じ端末・同じ宛先は入れ替える（機種変や再登録で増えないように）
    const next = subs.filter(x => x.deviceId !== device && x.endpoint !== sub.endpoint);
    next.push({
      deviceId: device,
      endpoint: String(sub.endpoint).slice(0, 800),
      p256dh: String(sub.keys.p256dh).slice(0, 200),
      auth: String(sub.keys.auth).slice(0, 100),
      name: String(body.name || '').slice(0, 40),
      addedAt: new Date().toISOString()
    });
    await env.SYNC.put(subsKey, JSON.stringify(next.slice(-10)));
    return json({ ok: true, subs: next.length }, 200, cors);
  }

  if (url.pathname === '/v1/push/sub' && request.method === 'DELETE') {
    let body = {};
    try { body = await request.json(); } catch (e) { /* 本文なしなら全部消す */ }
    const subs = (await env.SYNC.get(subsKey, 'json')) || [];
    const device = body && body.deviceId;
    const next = device ? subs.filter(x => x.deviceId !== device) : [];
    await env.SYNC.put(subsKey, JSON.stringify(next));
    return json({ ok: true, subs: next.length }, 200, cors);
  }

  if (url.pathname === '/v1/push/queue' && request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
    const items = Array.isArray(body && body.items) ? body.items : null;
    if (!items) return json({ error: 'bad_body' }, 400, cors);
    const clean = items.slice(0, 500).map(x => ({
      id: String(x.id || '').slice(0, 120),
      at: String(x.at || '').slice(0, 30),
      title: String(x.title || '').slice(0, 80),
      body: String(x.body || '').slice(0, 200),
      tag: String(x.tag || '').slice(0, 60),
      url: String(x.url || '').slice(0, 200)
    })).filter(x => x.id && x.at && x.title);
    await env.SYNC.put(queueKey, JSON.stringify(clean));
    return json({ ok: true, queued: clean.length }, 200, cors);
  }

  if (url.pathname === '/v1/push/state' && request.method === 'GET') {
    const subs = (await env.SYNC.get(subsKey, 'json')) || [];
    const queue = (await env.SYNC.get(queueKey, 'json')) || [];
    const sent = (await env.SYNC.get(sentKey, 'json')) || {};
    const now = Date.now();
    return json({
      ok: true,
      vapid: !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE),
      // 公開鍵は名前のとおり公開してよいもの。ブラウザが購読するのに要る
      vapidPublic: env.VAPID_PUBLIC || '',
      subject: env.VAPID_SUBJECT || '',
      subs: subs.map(x => ({ deviceId: x.deviceId, name: x.name, addedAt: x.addedAt })),
      queued: queue.length,
      pending: queue.filter(x => Date.parse(x.at) > now).length,
      sent: Object.keys(sent).length,
      next: queue.filter(x => Date.parse(x.at) > now)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] || null
    }, 200, cors);
  }

  // 今すぐ1件送ってみる（設定できているかの確認用）
  if (url.pathname === '/v1/push/test' && request.method === 'POST') {
    const subs = (await env.SYNC.get(subsKey, 'json')) || [];
    if (!subs.length) return json({ error: 'no_subscription' }, 400, cors);
    const r = await deliver(env, subs, {
      id: 'test', title: 'METEO365', body: '通知はここに出ます', tag: 'test', url: '#/home'
    });
    if (r.gone.length) {
      await env.SYNC.put(subsKey, JSON.stringify(subs.filter(x => r.gone.indexOf(x.endpoint) < 0)));
    }
    return json({ ok: r.sent > 0, sent: r.sent, failed: r.failed, detail: r.detail }, 200, cors);
  }

  return json({ error: 'not_found' }, 404, cors);
}

/* 時刻が来たものを送る。持ち主ごとに回す */
async function sendDue(env) {
  if (!env.SYNC || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return;
  const now = Date.now();
  // 合鍵の一覧は持たないので、通知を使っている持ち主だけを引く
  const list = await env.SYNC.list({ prefix: 'push:' });
  const owners = {};
  for (const k of list.keys) {
    const m = /^push:([^:]+):queue$/.exec(k.name);
    if (m) owners[m[1]] = true;
  }
  for (const id of Object.keys(owners)) {
    try { await sendDueOne(env, id, now); } catch (e) { /* 1人で止めない */ }
  }
}

async function sendDueOne(env, id, now) {
  const subsKey = 'push:' + id + ':subs';
  const queueKey = 'push:' + id + ':queue';
  const sentKey = 'push:' + id + ':sent';

  const subs = (await env.SYNC.get(subsKey, 'json')) || [];
  if (!subs.length) return;
  const queue = (await env.SYNC.get(queueKey, 'json')) || [];
  if (!queue.length) return;
  const sent = (await env.SYNC.get(sentKey, 'json')) || {};

  const due = queue.filter(x => {
    const t = Date.parse(x.at);
    return t && t <= now && t > now - LATE_MS && !sent[x.id];
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 20);
  if (!due.length) return;

  let live = subs;
  for (const item of due) {
    const r = await deliver(env, live, item);
    if (r.gone.length) live = live.filter(x => r.gone.indexOf(x.endpoint) < 0);
    sent[item.id] = now;      // 送れなくても印を付ける（毎分ぶつけ続けない）
  }

  // 古い印を落とす
  for (const k of Object.keys(sent)) if (now - sent[k] > SENT_KEEP_MS) delete sent[k];

  await env.SYNC.put(sentKey, JSON.stringify(sent));
  if (live.length !== subs.length) await env.SYNC.put(subsKey, JSON.stringify(live));
}

/* 1件を、登録されている端末すべてへ送る */
async function deliver(env, subs, item) {
  const payload = JSON.stringify({
    title: item.title, body: item.body || '', tag: item.tag || item.id, url: item.url || '#/home'
  });
  let sentN = 0, failed = 0;
  const gone = [], detail = [];
  for (const s of subs) {
    try {
      const packet = await encryptPayload(payload, s.p256dh, s.auth);
      const auth = await vapidHeader(s.endpoint, env.VAPID_SUBJECT || 'mailto:noreply@example.com',
        env.VAPID_PUBLIC, env.VAPID_PRIVATE);
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          authorization: auth,
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: '86400',
          urgency: 'normal'
        },
        body: packet
      });
      if (res.status === 404 || res.status === 410) { gone.push(s.endpoint); failed++; }
      else if (res.ok || res.status === 201) sentN++;
      else failed++;
      detail.push({ device: s.deviceId, status: res.status });
    } catch (e) {
      failed++;
      detail.push({ device: s.deviceId, error: String(e && e.message || e).slice(0, 80) });
    }
  }
  return { sent: sentN, failed: failed, gone: gone, detail: detail };
}

/* ---------------- Web Push の暗号化（RFC 8291 aes128gcm / RFC 8292 VAPID） ----------------
   参照実装（http_ece）で復号できることを確かめてある */

const PUSH_ENC = new TextEncoder();

function b64u(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function catBytes(...parts) {
  let n = 0;
  for (const a of parts) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of parts) { out.set(a, o); o += a.length; }
  return out;
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

async function encryptPayload(payload, p256dh, authSecretB64) {
  const clientPub = unb64u(p256dh);
  const authSecret = unb64u(authSecretB64);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));

  const clientKey = await crypto.subtle.importKey(
    'raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, eph.privateKey, 256));

  const ikm = await hkdf(authSecret, shared,
    catBytes(PUSH_ENC.encode('WebPush: info\0'), clientPub, ephPub), 32);
  const cek = await hkdf(salt, ikm, PUSH_ENC.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, PUSH_ENC.encode('Content-Encoding: nonce\0'), 12);

  // 中身のうしろに区切りの 0x02 を付けてから暗号化する
  const body = catBytes(PUSH_ENC.encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, body));

  // 見出し: salt(16) + レコード長(4) + 鍵の長さ(1) + 使い捨て公開鍵(65)
  const rs = 4096;
  const header = new Uint8Array(86);
  header.set(salt, 0);
  header[16] = (rs >>> 24) & 255; header[17] = (rs >>> 16) & 255;
  header[18] = (rs >>> 8) & 255; header[19] = rs & 255;
  header[20] = 65;
  header.set(ephPub, 21);
  return catBytes(header, ct);
}

async function vapidHeader(endpoint, subject, pub, priv) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const head = b64u(PUSH_ENC.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(PUSH_ENC.encode(JSON.stringify({ aud, exp, sub: subject })));
  const pubRaw = unb64u(pub), privRaw = unb64u(priv);
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', ext: true,
    d: b64u(privRaw), x: b64u(pubRaw.slice(1, 33)), y: b64u(pubRaw.slice(33, 65))
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, PUSH_ENC.encode(head + '.' + body)));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + pub;
}

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/**
 * CORS のヘッダ。
 * ALLOW_ORIGIN を決めているときでも、FANBOX のページからの送信だけは通す
 * （取り込みのブックマークレットがそこで動くため）。合鍵で守るので開けても危なくない。
 *
 * 作者ごとのページは datemeteo.fanbox.cc のように下の階層に付くので、
 * fanbox.cc とその下の名前をまとめて許す。
 */
const FANBOX_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*fanbox\.cc$/i;

function corsHeaders(env, request) {
  const from = request && request.headers.get('origin');
  const allow = env.ALLOW_ORIGIN && from && FANBOX_ORIGIN.test(from)
    ? from
    : (env.ALLOW_ORIGIN || '*');
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
