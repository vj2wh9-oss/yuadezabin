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
 * 外から届くもの（発注フォーム）
 *   POST   /v1/inbox/order       → 発注を1件足す（order/ の Worker が合鍵で送る）
 *   GET    /v1/inbox/orders      → { orders:[…], count, unread }
 *   PATCH  /v1/inbox/orders/<id> → { status, memo, projectId } 照合の結果を控える
 *   DELETE /v1/inbox/orders/<id> → 消す
 *   発注ページ自身は合鍵を持たない。ページの受け口（order/worker.js）だけが持ち、
 *   受け取った発注をここへ預ける。アプリは「発注」の画面でこれを読む。
 *   1件入るたびに、登録してある端末へ通知を送る（届いたことに気付けるように）。
 *
 * レシートの読み取り（OpenAI）
 *   GET    /v1/ocr/status  → { key, r2, model, strongModel, reasoning, maxTokens }（鍵は返さない）
 *   POST   /v1/ocr/receipt → 本文 {fileId} → { data:{store,date,total,items,…}, model, retried, usage }
 *                             R2 に置いた写真を読み、JSON だけ受け取る。
 *                             鍵は Worker の secret にだけ置き、アプリには渡さない
 *
 * 設定（wrangler.jsonc）
 *   KV 名前空間 SYNC を bind する
 *   R2 バケット FILES を bind する（ファイル共有を使うときだけ）
 *   ALLOW_ORIGIN にアプリの URL（省略時はどこからでも許可。合鍵で守る前提）
 *   通知を使うときだけ：
 *     triggers.crons に "* * * * *"
 *     secret VAPID_PUBLIC / VAPID_PRIVATE（アプリの設定画面で作れる）
 *     var VAPID_SUBJECT（"mailto:自分のメールアドレス"）
 *   レシートの読み取りを使うときだけ：
 *     secret OPENAI_API_KEY
 *     var OPENAI_MODEL / OPENAI_MODEL_STRONG / OPENAI_REASONING / OPENAI_MAX_TOKENS
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
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    // 生存確認。ブラウザでURLを開いたときに「動いているか」が分かるようにする。
    // 合鍵は要らないが、データは一切返さない（バインドの有無だけ）。
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        ok: true,
        service: '案件ポータルの同期API',
        bindings: { kv: !!env.SYNC, r2: !!env.FILES, openai: !!env.OPENAI_API_KEY },
        endpoints: ['/v1/meta', '/v1/state', '/v1/files', '/v1/push', '/v1/inbox/fanbox', '/v1/inbox/orders', '/v1/ocr', '/v1/roomreserve'],
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

      if (url.pathname === '/v1/inbox/order' || url.pathname === '/v1/inbox/orders'
        || url.pathname.startsWith('/v1/inbox/orders/')) {
        return orders(request, env, cors, url, id, ctx);
      }

      if (url.pathname.startsWith('/v1/ocr/')) {
        return ocr(request, env, cors, url, id);
      }

      if (url.pathname === '/v1/roomreserve') {
        return roomReserve(request, env, cors, url);
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

/* ---------------- ROOM RESERVE の予定を取り次ぐ ----------------

   ルームシェアの予定表（別に立てている Next.js のアプリ）は CORS を返さないので、
   ブラウザから直には読めない。ここが代わりに取りに行って、そのまま返す。

   向こうのアプリには一切さわらない。GET で読むだけ。
   踏み台にされないよう、行き先は vercel.app の /api/rooms/<id>/events に限る。 */

const ROOM_HOST = /(^|\.)vercel\.app$/;
const ROOM_ID = /^[A-Za-z0-9_-]{6,64}$/;

async function roomReserve(request, env, cors, url) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, cors);

  const base = String(url.searchParams.get('base') || '').trim();
  const room = String(url.searchParams.get('room') || '').trim();
  if (!ROOM_ID.test(room)) return json({ error: 'bad_room' }, 400, cors);

  let origin;
  try { origin = new URL(base); } catch (e) { return json({ error: 'bad_base' }, 400, cors); }
  if (origin.protocol !== 'https:' || !ROOM_HOST.test(origin.hostname)) {
    return json({ error: 'base_not_allowed', message: 'vercel.app の https だけ通します' }, 400, cors);
  }

  const target = origin.origin + '/api/rooms/' + encodeURIComponent(room) + '/events';
  let res;
  try {
    res = await fetch(target, { headers: { accept: 'application/json' }, cf: { cacheTtl: 0 } });
  } catch (e) {
    return json({ error: 'room_unreachable', message: String(e && e.message || e) }, 502, cors);
  }

  const text = await res.text();
  if (!res.ok) {
    return json({ error: 'room_error', status: res.status, message: text.slice(0, 300) }, 502, cors);
  }
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return json({ error: 'room_not_json', message: text.slice(0, 300) }, 502, cors);
  }
  return json({ ok: true, events: Array.isArray(data.events) ? data.events : [] }, 200, cors);
}

/* ---------------- レシートの読み取り（OpenAI） ----------------

   アプリが R2 に置いた写真を、ここから OpenAI へ渡して JSON で受け取る。
   鍵はここ（Worker の secret）にだけ置き、アプリ側には一切渡さない。

   使う量を抑えるための決めごと
     ・返すのは JSON だけ。レシート全文の書き起こしは求めない
     ・道具（Web検索・ファイル検索）は付けない
     ・max_output_tokens で頭を打つ
     ・推論の出力は既定で切る（OPENAI_REASONING）
     ・まず軽いほう（OPENAI_MODEL）で読む。
       合計が合わない・不鮮明だと言われたときだけ、強いほう
       （OPENAI_MODEL_STRONG）で読み直す

   設定（Worker の Settings）
     secret OPENAI_API_KEY        …… OpenAI の API キー
     var    OPENAI_MODEL          …… ふだん使うモデルID
     var    OPENAI_MODEL_STRONG   …… 読み直すときのモデルID
     var    OPENAI_REASONING      …… 推論の深さ（空にすると項目ごと送らない）
     var    OPENAI_MAX_TOKENS     …… 返してよい長さ
     var    OPENAI_BASE           …… 既定 https://api.openai.com/v1 */

const OCR_DEFAULTS = {
  model: 'gpt-5.6-luna',
  strong: 'terra',
  reasoning: 'none',
  maxTokens: 1200,
  base: 'https://api.openai.com/v1'
};
const OCR_MAX_IMAGE = 8 * 1024 * 1024;    // これより大きい画像は送らない

/* 受け取りたい形。ここから外れた返事は通さない */
const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['store', 'date', 'total', 'items', 'itemsComplete', 'confidence', 'unclear'],
  properties: {
    store: { type: ['string', 'null'], description: '店舗名。読めなければ null' },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD。読めなければ null' },
    total: { type: ['number', 'null'], description: '合計金額（税込・円）。読めなければ null' },
    items: {
      type: 'array',
      description: '購入品目',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'price', 'qty'],
        properties: {
          name: { type: 'string' },
          price: { type: ['number', 'null'], description: 'その行の金額（円）' },
          qty: { type: ['number', 'null'], description: '個数。書いていなければ null' }
        }
      }
    },
    itemsComplete: { type: 'boolean', description: '品目をすべて拾えたか' },
    confidence: { type: 'number', description: '0〜1。読み取りの確からしさ' },
    unclear: { type: 'boolean', description: '字が潰れている・影で読めない箇所があるか' }
  }
};

const RECEIPT_PROMPT =
  'レシートの写真から次の項目だけを取り出し、指定の JSON で返してください。' +
  '全文の書き起こしや説明は不要です。' +
  '金額は円の数値のみ（記号・カンマなし）。日付は YYYY-MM-DD。' +
  '年が書かれていなければ、月日から最も近い過去の年を補ってください。' +
  '合計は「合計」「お買上げ計」など税込の総額を採り、お預り・お釣り・ポイントは合計にしません。' +
  '品目は商品名と金額の行だけを拾い、小計・値引・税・ポイントは品目に入れません。' +
  '読み取れない項目は null にし、推測で埋めないでください。' +
  '字が潰れて自信が持てないときは unclear を true にしてください。';

async function ocr(request, env, cors, url, id) {
  const rest = url.pathname.slice('/v1/ocr/'.length);

  // 設定できているかだけ返す。鍵そのものは絶対に返さない
  if (rest === 'status' && request.method === 'GET') {
    return json({
      ok: true,
      key: !!env.OPENAI_API_KEY,
      r2: !!env.FILES,
      model: env.OPENAI_MODEL || OCR_DEFAULTS.model,
      strongModel: env.OPENAI_MODEL_STRONG || OCR_DEFAULTS.strong,
      reasoning: env.OPENAI_REASONING === undefined ? OCR_DEFAULTS.reasoning : env.OPENAI_REASONING,
      maxTokens: Number(env.OPENAI_MAX_TOKENS || OCR_DEFAULTS.maxTokens)
    }, 200, cors);
  }

  if (rest !== 'receipt' || request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
  if (!env.OPENAI_API_KEY) return json({ error: 'no_api_key' }, 503, cors);
  if (!env.FILES) return json({ error: 'r2_not_bound' }, 500, cors);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }

  const fileId = String(body && body.fileId || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fileId)) return json({ error: 'bad_id' }, 400, cors);

  const obj = await env.FILES.get('files/' + id + '/' + fileId);
  if (!obj) return json({ error: 'not_found' }, 404, cors);
  if (obj.size > OCR_MAX_IMAGE) return json({ error: 'too_large', max: OCR_MAX_IMAGE }, 413, cors);

  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
  if (type.indexOf('image/') !== 0) return json({ error: 'not_image', type }, 400, cors);
  const dataUrl = 'data:' + type + ';base64,' + b64(new Uint8Array(await obj.arrayBuffer()));

  const light = String(body.model || env.OPENAI_MODEL || OCR_DEFAULTS.model);
  const strong = String(body.strongModel || env.OPENAI_MODEL_STRONG || OCR_DEFAULTS.strong);

  // 1回目は軽いほうで、画像も控えめに
  let pass = await askOpenAI(env, light, dataUrl, 'auto');
  if (!pass.ok) return json(pass.body, pass.status, cors);

  let why = needsRetry(pass.data);
  let retried = false;
  // 2回目は強いほうで、画像も細かく見てもらう
  if (why && strong && !body.noRetry) {
    const again = await askOpenAI(env, strong, dataUrl, 'high');
    if (again.ok) {
      retried = true;
      pass = again;
    }
  }

  return json({
    ok: true,
    data: pass.data,
    model: pass.model,
    retried,
    retryReason: retried ? why : '',
    usage: pass.usage
  }, 200, cors);
}

/* 読み直したほうがよいか。合わない・不鮮明のときだけ true */
function needsRetry(d) {
  if (!d) return 'no_data';
  if (d.unclear) return 'unclear';
  if (typeof d.confidence === 'number' && d.confidence < 0.6) return 'low_confidence';
  if (d.total === null || d.total === undefined || !(d.total > 0)) return 'no_total';
  if (!d.date) return 'no_date';

  const items = Array.isArray(d.items) ? d.items : [];
  const sum = items.reduce((a, x) => a + (Number(x && x.price) || 0), 0);
  // 品目の合計が総額を超えるのは読み違い。値引きや税で下回るのはふつうなので見逃す
  if (sum > d.total * 1.05 + 1) return 'items_over_total';
  // すべて拾えたと言うのに、総額と離れすぎているとき（税・値引きの幅を超える）
  if (items.length && d.itemsComplete && sum > 0 && sum < d.total * 0.7) return 'items_short';
  return '';
}

/**
 * OpenAI に1回だけ聞く。
 * @param {string} detail 画像の見かた 'auto' | 'high'
 */
async function askOpenAI(env, model, dataUrl, detail) {
  const base = String(env.OPENAI_BASE || OCR_DEFAULTS.base).replace(/\/+$/, '');
  const maxTokens = Number(env.OPENAI_MAX_TOKENS || OCR_DEFAULTS.maxTokens);
  const effort = env.OPENAI_REASONING === undefined ? OCR_DEFAULTS.reasoning : String(env.OPENAI_REASONING);

  const payload = {
    model,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: RECEIPT_PROMPT },
        { type: 'input_image', image_url: dataUrl, detail }
      ]
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'receipt',
        strict: true,
        schema: RECEIPT_SCHEMA
      }
    },
    max_output_tokens: maxTokens,
    // 道具は付けない（Web検索・ファイル検索を使わせない）
    tools: [],
    // 送った画像を向こうに残さない
    store: false
  };
  // 推論の深さ。空にしておけば項目ごと送らない（対応していないモデル向け）
  if (effort) payload.reasoning = { effort };

  let res;
  try {
    res = await fetch(base + '/responses', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.OPENAI_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return { ok: false, status: 502, body: { error: 'openai_unreachable', message: String(e && e.message || e) } };
  }

  const text = await res.text();
  if (!res.ok) {
    let detailMsg = text.slice(0, 600);
    try { detailMsg = JSON.parse(text).error?.message || detailMsg; } catch (e) { /* そのまま出す */ }
    return { ok: false, status: res.status === 401 ? 502 : res.status,
      body: { error: 'openai_error', status: res.status, model, message: detailMsg } };
  }

  let out;
  try { out = JSON.parse(text); } catch (e) {
    return { ok: false, status: 502, body: { error: 'openai_bad_json' } };
  }

  const content = pickText(out);
  if (!content) {
    return { ok: false, status: 502,
      body: { error: 'openai_empty', model, status: out.status || '', incomplete: out.incomplete_details || null } };
  }

  let data;
  try { data = JSON.parse(content); } catch (e) {
    return { ok: false, status: 502, body: { error: 'not_json', sample: content.slice(0, 200) } };
  }
  return { ok: true, data, model, usage: out.usage || null };
}

/* Responses の返事から、本文の文字だけを取り出す */
function pickText(out) {
  if (typeof out.output_text === 'string' && out.output_text) return out.output_text;
  const parts = [];
  for (const item of out.output || []) {
    for (const c of item.content || []) {
      if (typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('');
}

/* バイト列を base64 に。まとめて渡すと積みが溢れるので小分けにする */
function b64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(s);
}

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

/* ---------------- 外から届くもの（発注フォーム） ----------------

   発注は「1件ずつ」ではなく、1つの入れ物にまとめて置く。
   数が少なく（1日に数件）、アプリ側は常に一覧で見るため、
   出し入れが1回で済むほうが簡単で、KV の読み書きも減る。

   置き場： orders:<持ち主> → { list:[発注…] }

   照合の結果（status）はここに書く。PC と iPhone のどちらから触っても
   同じものを見るので、出先で受領にした案件が、家の PC でも受領になっている。 */

const MAX_ORDERS = 300;              // これを超えたら古いものから落とす
const ORDER_KEEP_DAYS = 180;         // 触っていない発注を置いておく日数
const ORDER_STATUS = ['new', 'matched', 'unmatched', 'done'];

async function orders(request, env, cors, url, id, ctx) {
  const key = 'orders:' + id;

  /* 発注ページの受け口から1件届いた */
  if (url.pathname === '/v1/inbox/order' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }

    const order = cleanOrder(body);
    if (!order) return json({ error: 'bad_body' }, 400, cors);

    const box = (await env.SYNC.get(key, 'json')) || { list: [] };
    // 同じ受付番号が二度届いても増やさない（送り直しがあるため）
    if (box.list.some(o => o.id === order.id)) {
      return json({ ok: true, id: order.id, duplicate: true }, 200, cors);
    }
    box.list.unshift(order);
    await putOrders(env, key, box);

    // 届いたことに気付けるよう、登録してある端末へ知らせる。
    // 通知が送れなくても、発注を預かったことは変わらない
    const tell = notifyOrder(env, id, order);
    if (ctx && ctx.waitUntil) ctx.waitUntil(tell); else await tell.catch(() => {});

    return json({ ok: true, id: order.id }, 200, cors);
  }

  /* アプリが一覧を取りに来た */
  if (url.pathname === '/v1/inbox/orders' && request.method === 'GET') {
    const box = (await env.SYNC.get(key, 'json')) || { list: [] };
    return json({
      orders: box.list,
      count: box.list.length,
      unread: box.list.filter(o => o.status === 'new').length
    }, 200, cors);
  }

  /* 照合の結果を控える／消す */
  if (url.pathname.startsWith('/v1/inbox/orders/')) {
    const target = decodeURIComponent(url.pathname.slice('/v1/inbox/orders/'.length));
    const box = (await env.SYNC.get(key, 'json')) || { list: [] };
    const hit = box.list.filter(o => o.id === target)[0];
    if (!hit) return json({ error: 'not_found' }, 404, cors);

    if (request.method === 'DELETE') {
      box.list = box.list.filter(o => o.id !== target);
      await putOrders(env, key, box);
      return json({ ok: true }, 200, cors);
    }

    if (request.method === 'PATCH' || request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
      if (body && ORDER_STATUS.indexOf(body.status) >= 0) {
        hit.status = body.status;
        hit.statusAt = new Date().toISOString();
      }
      if (body && typeof body.memo === 'string') hit.memo = orderText(body.memo, 500);
      if (body && typeof body.projectId === 'string') hit.projectId = orderText(body.projectId, 40);
      await putOrders(env, key, box);
      return json({ ok: true, order: hit }, 200, cors);
    }
  }

  return json({ error: 'not_found' }, 404, cors);
}

/**
 * 発注が届いたことを、登録してある端末へ知らせる。
 * 予定表（queue）は時刻が来たら送る仕組みなので、そちらには載せずに直接送る。
 */
async function notifyOrder(env, id, order) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return;      // 通知の鍵が無い
  const subsKey = 'push:' + id + ':subs';
  const subs = (await env.SYNC.get(subsKey, 'json')) || [];
  if (!subs.length) return;                                  // 宛先がまだ無い

  const r = await deliver(env, subs, {
    id: 'order-' + order.id,
    title: '新規発注が届きました',
    // 誰からかが分かると、開く前に見当がつく
    body: order.company + (order.serviceLabel ? '　' + order.serviceLabel : ''),
    tag: 'order-' + order.id,        // 発注ごとに分ける（まとめられて消えないように）
    url: '#/orders'
  });

  // 期限切れの宛先は落としておく（機種変のあとなど）
  if (r.gone.length) {
    await env.SYNC.put(subsKey, JSON.stringify(subs.filter(x => r.gone.indexOf(x.endpoint) < 0)));
  }
}

/* 古いものを落としてから置き直す。触っていないものは半年で消える */
async function putOrders(env, key, box) {
  const limit = new Date(Date.now() - ORDER_KEEP_DAYS * 24 * 3600 * 1000).toISOString();
  box.list = box.list
    .filter(o => o.status === 'new' || (o.statusAt || o.at || '') > limit)
    .slice(0, MAX_ORDERS);
  box.at = new Date().toISOString();
  await env.SYNC.put(key, JSON.stringify(box));
}

/* 届いた発注の形を整える。中身は信用せず、型と長さだけを見る */
function cleanOrder(o) {
  if (!o || typeof o !== 'object') return null;
  const id = orderText(o.id, 40);
  const company = orderText(o.company, 100);
  if (!id || !company) return null;

  return {
    id,
    at: /^\d{4}-\d{2}-\d{2}T/.test(String(o.at || '')) ? String(o.at) : new Date().toISOString(),
    company,
    person: orderText(o.person, 60),
    email: orderText(o.email, 254),
    service: orderText(o.service, 40),
    serviceLabel: orderText(o.serviceLabel, 80),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(o.deadline || '')) ? String(o.deadline) : '',
    format: orderText(o.format, 40),
    formatLabel: orderText(o.formatLabel, 80),
    note: orderText(o.note, 1000),
    country: orderText(o.country, 4),
    status: 'new',        // 照合はこれから。アプリ側で変える
    statusAt: '',
    memo: '',
    projectId: ''        // カレンダーに入れた案件。二度作らないための目印
  };
}

function orderText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .slice(0, max);
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
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
