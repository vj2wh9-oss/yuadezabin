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
 * Discord への夜のバックアップ
 *   GET    /v1/backup/status → { webhook, encrypted, last, hour }（webhook の URL は返さない）
 *   POST   /v1/backup/run    → いますぐ1回送る（試すため）
 *   毎日 0時（日本時間）に、KV のデータを gzip して Discord のチャンネルへ送る。
 *   secret DISCORD_WEBHOOK を入れたときだけ動く。
 *   secret BACKUP_KEY を入れると、送る前に暗号にする（合言葉から鍵を作る）。
 *
 * レシートの読み取り（OpenAI）
 *   GET    /v1/ocr/status  → { key, r2, model, strongModel, reasoning, maxTokens }（鍵は返さない）
 *   POST   /v1/ocr/receipt → 本文 {fileId} → { data:{store,date,total,items,…}, model, retried, usage }
 *   POST   /v1/menu        → 本文 {budget,slots,servings,avoid} → { data:{meals,shopping,total,note} }
 *   POST   /v1/ocr/card    → 本文 {fileId} → { data:{company,contact,email,tel,address,…}, model, retried, usage }
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
const BACKUP_HOUR_UTC = 15;          // 15:00 UTC ＝ 日本時間の 0時
const DISCORD_MAX = 20 * 1024 * 1024;   // Discord の添付の上限（既定 20MiB）

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
        bindings: {
          kv: !!env.SYNC, r2: !!env.FILES, openai: !!env.OPENAI_API_KEY,
          // 夜のバックアップの支度ができているか（値そのものは出さない）
          discord: !!env.DISCORD_WEBHOOK, backupKey: !!env.BACKUP_KEY,
          // ひらめきメモ・書類の送り先（URL そのものは出さない）
          memoWebhook: !!env.DISCORD_MEMO_WEBHOOK,
          estimateWebhook: !!env.DISCORD_ESTIMATE_WEBHOOK,
          invoiceWebhook: !!env.DISCORD_INVOICE_WEBHOOK,
          receiptWebhook: !!env.DISCORD_RECEIPT_WEBHOOK,
          // 貯金口座（鍵が入っているかだけ。中身は出さない）
          bank: bankReady(env),
          plotWebhook: !!env.DISCORD_PLOT_WEBHOOK
        },
        endpoints: ['/v1/meta', '/v1/state', '/v1/files', '/v1/push', '/v1/inbox/fanbox', '/v1/inbox/orders', '/v1/ocr', '/v1/roomreserve', '/v1/backup', '/v1/memo/send', '/v1/doc/send', '/v1/menu', '/v1/reschedule', '/v1/bank/balance', '/v1/plot', '/v1/plot/send'],
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

      if (url.pathname.startsWith('/v1/backup/')) {
        return backupApi(request, env, cors, url, id);
      }

      if (url.pathname === '/v1/memo/send') {
        return memoSend(request, env, cors);
      }

      if (url.pathname === '/v1/doc/send') {
        return docSend(request, env, cors, id);
      }

      if (url.pathname === '/v1/menu') {
        return menu(request, env, cors);
      }

      if (url.pathname === '/v1/reschedule') {
        return reschedule(request, env, cors);
      }

      if (url.pathname.indexOf('/v1/bank/') === 0) {
        return bank(request, env, cors, url);
      }

      if (url.pathname === '/v1/plot') {
        return plot(request, env, cors);
      }

      if (url.pathname === '/v1/plot/send') {
        return plotSend(request, env, cors);
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
    ctx.waitUntil(dailyBackup(env));
    ctx.waitUntil(dailyBank(env));
  }
};

/* ---------------- Discord への夜のバックアップ ----------------

   毎日 0時（日本時間）に、KV に入っているアプリのデータを丸ごと
   Discord のチャンネルへ送る。iPhone は寝ているので、送るのはここの役目。

   Cron は通知用の「毎分」に相乗りしている。毎分呼ばれても、
   その日ぶんを送ったかどうかを KV に控えて、1日1回だけにする。
   （通知を使わず毎分の Cron が無いときは、wrangler.jsonc の
     triggers.crons に "0 15 * * *" を足す）

   置き場が Discord である以上、送るものはそのまま人に読める。
   顧客管理の中身も入るので、secret BACKUP_KEY を入れて
   暗号にしておくことをすすめる。 */

const BK_MAGIC = 'M365BK1';          // 暗号にしたファイルの頭に置く目印

/** 日本時間での 'YYYY-MM-DD'（UTC+9） */
function jstDate(ms) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 何時（UTC）以降に送るか。var BACKUP_HOUR で変えられる（既定は日本の0時） */
function backupHour(env) {
  const n = Number(env.BACKUP_HOUR);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : BACKUP_HOUR_UTC;
}

async function dailyBackup(env) {
  if (!env.SYNC || !env.DISCORD_WEBHOOK) return;
  const now = Date.now();
  // その時刻を過ぎるまでは何もしない（既定は 15:00 UTC ＝ 日本の 0時）
  if (new Date(now).getUTCHours() < backupHour(env)) return;

  const today = jstDate(now);
  const list = await env.SYNC.list({ prefix: 'state:' });
  for (const k of list.keys) {
    const id = k.name.slice('state:'.length);
    const doneKey = 'backup:' + id + ':day';
    if ((await env.SYNC.get(doneKey, 'text')) === today) continue;   // もう送った
    // 先に印を付ける。送信中にもう一度呼ばれても二度送らない
    await env.SYNC.put(doneKey, today, { expirationTtl: 60 * 60 * 24 * 40 });
    try {
      await sendBackup(env, id, 'auto');
    } catch (e) {
      // 失敗したら印を外して、次の回でやり直す
      await env.SYNC.delete(doneKey);
      await env.SYNC.put('backup:' + id + ':last', JSON.stringify({
        at: new Date(now).toISOString(), ok: false, why: String((e && e.message) || e).slice(0, 300)
      }), { expirationTtl: 60 * 60 * 24 * 90 });
    }
  }
}

/**
 * 1人ぶんを送る。
 * @param {'auto'|'manual'} how
 * @returns {Promise<object>} 送った結果（画面に出すため）
 */
async function sendBackup(env, id, how) {
  if (!env.DISCORD_WEBHOOK) throw new Error('DISCORD_WEBHOOK が入っていません');

  const raw = await env.SYNC.get('state:' + id, 'text');
  if (!raw) throw new Error('まだデータがありません');
  const meta = (await env.SYNC.get('meta:' + id, 'json')) || {};

  const state = JSON.parse(raw);
  const counts = countOf(state);
  // 合言葉の潰した形は持ち出さない。4桁ならその場で総当たりされる。
  // 戻したあとは、顧客管理の合言葉を決め直してもらう
  if (state.settings) delete state.settings.crmPass;

  const body = new TextEncoder().encode(JSON.stringify(state));
  const gz = await gzip(body);

  let file = gz, name = 'meteo365-' + jstDate(Date.now()) + '.json.gz';
  let locked = false;
  if (env.BACKUP_KEY) {
    file = await encrypt(gz, env.BACKUP_KEY);
    name += '.enc';
    locked = true;
  }
  if (file.byteLength > DISCORD_MAX) {
    throw new Error('大きすぎて送れません（' + mb(file.byteLength) + '）');
  }

  const lines = [
    '**METEO365 バックアップ** ' + jstDate(Date.now()) + (how === 'manual' ? '（手動）' : ''),
    '案件 ' + counts.projects + '件／顧客 ' + counts.clients + '件／書類 ' + counts.docs
      + '件／レシート ' + counts.expenses + '件',
    'もとの大きさ ' + mb(body.byteLength) + ' → 送った大きさ ' + mb(file.byteLength)
      + (locked ? '（暗号あり）' : '（暗号なし）'),
    meta.savedAt ? '最後の保存 ' + meta.savedAt : ''
  ].filter(Boolean);

  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content: lines.join('\n'),
    allowed_mentions: { parse: [] }        // 文中の @ で人を呼ばない
  }));
  form.append('files[0]', new Blob([file], { type: 'application/octet-stream' }), name);

  const res = await fetch(env.DISCORD_WEBHOOK, { method: 'POST', body: form });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error('Discord が受け取りませんでした（' + res.status + '）' + text);
  }

  const done = {
    at: new Date().toISOString(), ok: true, how: how,
    name: name, size: file.byteLength, raw: body.byteLength, locked: locked, counts: counts
  };
  await env.SYNC.put('backup:' + id + ':last', JSON.stringify(done),
    { expirationTtl: 60 * 60 * 24 * 90 });
  return done;
}

function countOf(state) {
  const s = (state && state.settings) || {};
  let docs = 0;
  (state.projects || []).forEach(function (p) { docs += ((p.docs || []).length); });
  return {
    projects: (state.projects || []).length,
    clients: (s.clients || []).length,
    expenses: (s.expenses || []).length,
    docs: docs
  };
}

function mb(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + 'MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + 'KB';
  return n + 'B';
}

async function gzip(bytes) {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* 合言葉から鍵を作って、AES-GCM で包む。
   出来上がりは  目印(7) | 塩(16) | iv(12) | 中身  の並び。
   アプリ側（js/backup.js）が同じ形で開ける。 */
async function encrypt(bytes, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes));

  const magic = new TextEncoder().encode(BK_MAGIC);
  const out = new Uint8Array(magic.length + salt.length + iv.length + sealed.length);
  out.set(magic, 0);
  out.set(salt, magic.length);
  out.set(iv, magic.length + salt.length);
  out.set(sealed, magic.length + salt.length + iv.length);
  return out;
}

/* 鍵の作り直し回数。Workers は10万回までしか受け付けないので、そこが上限。
   回数を増やせないぶんは、合言葉を長くして補う（README に書いてある）。
   ここを変えると前に送ったファイルが開かなくなるので、動かさないこと。 */
const BK_ITER = 100000;

async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass),
    'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: BK_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* ---------------- 様子を見る・いま送る ---------------- */

async function backupApi(request, env, cors, url, id) {
  if (url.pathname === '/v1/backup/status' && request.method === 'GET') {
    const last = await env.SYNC.get('backup:' + id + ':last', 'json');
    return json({
      webhook: !!env.DISCORD_WEBHOOK,      // URL そのものは返さない
      encrypted: !!env.BACKUP_KEY,
      hour: backupHour(env),               // 既定は 15（日本時間の 0時）
      today: (await env.SYNC.get('backup:' + id + ':day', 'text')) || '',
      last: last || null
    }, 200, cors);
  }

  if (url.pathname === '/v1/backup/run' && request.method === 'POST') {
    try {
      const done = await sendBackup(env, id, 'manual');
      return json({ ok: true, ...done }, 200, cors);
    } catch (e) {
      return json({ ok: false, error: 'backup_failed', message: String((e && e.message) || e) }, 502, cors);
    }
  }

  return json({ error: 'not_found' }, 404, cors);
}

/* ---------------- ひらめきメモを Discord へ ----------------

   送り先の Webhook URL は secret（DISCORD_MEMO_WEBHOOK）にだけ置く。
   アプリ側には持たせない。持たせると、公開しているコードや端末、
   バックアップのファイルにまで URL が乗ってしまう。
   URL を知っていれば誰でもそのチャンネルに書き込めるため。

   ファイルではなく、そのまま読める文として送る。 */

const DISCORD_LIMIT = 2000;      // 1通に入れられる字数

async function memoSend(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
  if (!env.DISCORD_MEMO_WEBHOOK) return json({ error: 'no_memo_webhook' }, 503, cors);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }

  const title = String((body && body.title) || '').trim().slice(0, 120);
  const text = String((body && body.text) || '').trim().slice(0, 4000);
  const date = String((body && body.date) || '').trim().slice(0, 10);
  if (!text && !title) return json({ error: 'empty' }, 400, cors);

  const head = (title ? '**' + escapeMd(title) + '**' : '**ひらめきメモ**')
    + (date ? '　' + date : '');
  const parts = chunk(head + '\n' + text, DISCORD_LIMIT);

  // 長いものは何通かに分ける。順番が入れ替わらないよう、1通ずつ送る
  for (let i = 0; i < parts.length; i++) {
    const res = await fetch(env.DISCORD_MEMO_WEBHOOK + '?wait=true', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: parts[i],
        allowed_mentions: { parse: [] }        // 文中の @ で人を呼ばない
      })
    });
    if (!res.ok) {
      const msg = (await res.text()).slice(0, 300);
      return json({ error: 'discord_error', status: res.status, message: msg }, 502, cors);
    }
  }
  return json({ ok: true, parts: parts.length }, 200, cors);
}

/* 見出しに使う記号だけ逃がす。本文はそのままの見た目で送りたいので触らない */
function escapeMd(s) { return s.replace(/([*_`~|\\])/g, '\\$1'); }

/* 字数で切る。切れ目はなるべく行の変わり目にする */
function chunk(s, max) {
  const out = [];
  let rest = String(s);
  while (rest.length > max) {
    let at = rest.lastIndexOf('\n', max);
    if (at < max * 0.5) at = max;         // 行が長すぎるときは、そこで切る
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, '');
  }
  if (rest) out.push(rest);
  return out.length ? out : [''];
}

/* ---------------- 今日の献立を考える ----------------

   今日あと使える金額から、自炊の献立と買い物の一覧を出す。
   写真は関わらないので、読み取り（/v1/ocr）とは別の入口にする。

   決まりごと（頼みかたに入れてある）：
     ・お米はいつも家にあるものとして、買い物に入れない
     ・冷凍食品は使ってよいが、頼りすぎない
     ・値段はスーパーの並の売値。買う単位（1袋・1パック）で数える
     ・予算に収める。余らせるのは構わないが、超えない */

const MENU_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['meals', 'shopping', 'total', 'note'],
  properties: {
    meals: {
      type: 'array',
      description: '献立。頼まれた食事のぶんだけ',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'name', 'dishes', 'minutes'],
        properties: {
          slot: { type: 'string', enum: ['lunch', 'dinner'], description: 'lunch=昼 dinner=夕' },
          name: { type: 'string', description: '献立の呼び名。例）鶏の照り焼き定食' },
          dishes: {
            type: 'array',
            description: '一品ずつ。大きめの主菜1品と副菜1品は必ず入れる',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['role', 'name', 'seasonings', 'steps'],
              properties: {
                role: {
                  type: 'string', enum: ['主菜', '副菜', '汁物', '主食'],
                  description: 'その一品の役どころ'
                },
                name: { type: 'string', description: '品名。例）鶏の照り焼き' },
                seasonings: {
                  type: 'array',
                  description: '使う調味料と分量。家にある調味料でも分量は必ず書く',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'qty'],
                    properties: {
                      name: { type: 'string', description: '例）しょうゆ' },
                      qty: { type: 'string', description: '分量。例）大さじ2 / 小さじ1/2 / 100ml' }
                    }
                  }
                },
                steps: {
                  type: 'array',
                  description: 'その一品の作り方。2〜5行。材料と調味料の分量も書く',
                  items: { type: 'string' }
                }
              }
            }
          },
          minutes: { type: 'number', description: '作るのにかかるおよその分' }
        }
      }
    },
    shopping: {
      type: 'array',
      description: '買うもの。お米は入れない。家にある調味料も入れない',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'price'],
        properties: {
          name: { type: 'string', description: '品名' },
          qty: { type: 'string', description: '買う単位。例）1パック / 1袋 / 200g' },
          price: { type: 'number', description: 'スーパーの並の売値（円・税込）' }
        }
      }
    },
    total: { type: 'number', description: '買い物の合計（円）' },
    note: { type: 'string', description: 'ひとこと。使い切りかたや作り置きの助言など' }
  }
};

const SLOT_JA = { lunch: '昼ごはん', dinner: '晩ごはん' };

function menuPrompt(o) {
  const slots = (o.slots || []).map((s) => SLOT_JA[s] || s).join('と');
  const people = o.servings === 2 ? '成人男性2人分' : '成人男性1人分';
  const lines = [
    '日本のスーパーで買える材料で、自炊の献立を考えてください。',
    '予算は買い物の合計で ' + o.budget + ' 円まで。これを超えないでください。',
    '作るのは ' + slots + '。量は' + people + 'です。',
    '1食は、大きめの主菜を1品と、副菜を1品の、あわせて2品以上にしてください。'
      + '予算と手間に余裕があれば汁物やごはんを足しても構いません。',
    '副菜はもやし・豆腐・卵・きのこ・旬の野菜など、安く作れるもので構いません。',
    'お米はいつも家にあるので、買い物には入れないでください（ごはんは献立に入れて構いません）。',
    '塩・こしょう・しょうゆ・みそ・砂糖・みりん・酒・油などの基本の調味料も、'
      + '家にあるものとして買い物には入れないでください。',
    'ただし使う調味料は、一品ごとに seasonings へ必ず分量まで書いてください'
      + '（大さじ1、小さじ1/2、100ml、ひとつまみ など）。「適量」は使わないでください。',
    '冷凍食品は使ってもよいですが、頼りすぎないでください（使うなら1品まで）。',
    '値段はスーパーの並の売値（税込）で、買う単位（1パック・1袋など）で数えてください。',
    '買ったものは使い切るか、余りの使い道を note に書いてください。',
    '手順は一品ごとに、家庭の台所でできる範囲で2〜5行。'
      + '手順の中でも材料と調味料の分量が分かるように書いてください。'
  ];
  if (o.leftovers && o.leftovers.length) {
    lines.push('家に次の残り物があります。日もちしないので、できるだけ先に使い切ってください：'
      + o.leftovers.map((x) => x.name + (x.qty ? '（' + x.qty + '）' : '')
        + (x.until ? ' ' + x.until + 'まで' : '')
        + (x.kept ? '（作り置き。そのまま出せます）' : '')).join('、'));
    lines.push('残り物で足りるところは、新しく買わないでください。');
  }
  if (o.avoid && o.avoid.length) {
    lines.push('次の献立は最近出したので、それとは別のものにしてください：'
      + o.avoid.slice(0, 12).join('、'));
  }
  if (o.season) lines.push('いまの季節は' + o.season + 'です。旬のものがあれば使ってください。');
  return lines.join('\n');
}

async function menu(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
  if (!env.OPENAI_API_KEY) return json({ error: 'no_api_key' }, 503, cors);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }

  const budget = Math.round(Number(body && body.budget) || 0);
  if (!(budget > 0)) return json({ error: 'no_budget' }, 400, cors);

  // 1日の順（昼→晩）にそろえる。押した順のままだと言い回しが逆になる
  const asked = Array.isArray(body.slots) ? body.slots : [];
  const slots = ['lunch', 'dinner'].filter((s) => asked.indexOf(s) >= 0);
  if (!slots.length) return json({ error: 'no_slots' }, 400, cors);

  const o = {
    budget: Math.min(budget, 100000),
    slots,
    servings: Number(body.servings) === 2 ? 2 : 1,
    avoid: (Array.isArray(body.avoid) ? body.avoid : [])
      .map((s) => String(s || '').slice(0, 40)).filter(Boolean),
    // 家の残り物。先に使い切ってもらう
    leftovers: (Array.isArray(body.leftovers) ? body.leftovers : []).slice(0, 12)
      .map((x) => ({
        name: String((x && x.name) || '').slice(0, 40),
        qty: String((x && x.qty) || '').slice(0, 20),
        until: /^\d{4}-\d{2}-\d{2}$/.test(String(x && x.until)) ? x.until : '',
        kept: !!(x && x.kept)
      })).filter((x) => x.name),
    season: String(body.season || '').slice(0, 10)
  };

  const model = String(body.model || env.OPENAI_MENU_MODEL || env.OPENAI_MODEL || OCR_DEFAULTS.model);
  const pass = await askMenu(env, model, o);
  if (!pass.ok) return json(pass.body, pass.status, cors);

  // 献立ができてから、家にある調味料と呼び方を突き合わせる。
  // ここで初めて家の在庫を見るので、献立の中身には影響しない。
  // 失敗しても献立は返す（アプリ側が言い換え表で当てる）
  const have = (Array.isArray(body.pantry) ? body.pantry : []).slice(0, 60)
    .map((s) => String(s || '').trim().slice(0, 40)).filter(Boolean);
  const matchModel = String(env.OPENAI_MATCH_MODEL || model);
  const match = await askMatch(env, matchModel, usedSeasonings(pass.data), have);

  return json({ ok: true, data: pass.data, match: match, model: pass.model, usage: pass.usage },
    200, cors);
}

/* ---- 呼び方の突き合わせ ----

   「しょうが(チューブ)」と「おろししょうが」のように、献立の書き方と
   家にある調味料の書き方はそろわない。名前だけを見て、同じものかどうかを
   決めてもらう。献立ができたあとに聞くので、献立そのものには効かない。 */

const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pairs'],
  properties: {
    pairs: {
      type: 'array',
      description: '使う調味料ひとつにつき1件',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['used', 'have'],
        properties: {
          used: { type: 'string', description: '献立で使う調味料の名前。渡した字のまま' },
          have: { type: 'string', description: '同じものが家にあればその名前（渡した字のまま）。無ければ空文字' }
        }
      }
    }
  }
};

function matchPrompt(used, have) {
  return [
    '料理で使う調味料の名前を、家にある調味料の名前と突き合わせてください。',
    '呼び方が違っても中身が同じものは、同じものとして結び付けてください'
      + '（例：「しょうが(チューブ)」と「おろししょうが」、「醤油」と「しょうゆ」、'
      + '「顆粒だし」と「ほんだし」）。',
    '中身が違うものは結び付けないでください'
      + '（例：「ごま油」と「サラダ油」、「しょうゆ」と「めんつゆ」、「酢」と「ポン酢」、'
      + '「砂糖」と「黒糖」、「バター」と「マーガリン」）。',
    '家にある中に同じものが無ければ、have は空文字にしてください。',
    '名前は渡した字のまま返し、使う調味料はひとつ残らず返してください。',
    '',
    '【使う調味料】' + used.join('、'),
    '【家にある調味料】' + (have.length ? have.join('、') : 'なし')
  ].join('\n');
}

/**
 * 献立で使う調味料が家にあるかを、名前だけ見て突き合わせる
 * @returns {object} {使う名前: 家にある名前 or ''}。聞けなければ null
 */
async function askMatch(env, model, used, have) {
  if (!used.length || !have.length) return null;
  const pass = await askJson(env, model, matchPrompt(used, have), 'pantry_match', MATCH_SCHEMA,
    Number(env.OPENAI_MATCH_MAX_TOKENS || 1500));
  if (!pass.ok) return null;

  const out = {};
  (Array.isArray(pass.data && pass.data.pairs) ? pass.data.pairs : []).forEach((x) => {
    const u = String((x && x.used) || '');
    const h = String((x && x.have) || '');
    if (used.indexOf(u) < 0) return;              // 渡していない名前は捨てる
    out[u] = have.indexOf(h) >= 0 ? h : '';       // 家にある名前そのものでなければ「無い」
  });
  return out;
}

/* 献立で使う調味料の名前を、重複なく取り出す */
function usedSeasonings(data) {
  const out = [];
  ((data && data.meals) || []).forEach((m) => {
    ((m && m.dishes) || []).forEach((d) => {
      ((d && d.seasonings) || []).forEach((s) => {
        const n = String((s && s.name) || '').trim();
        if (n && out.indexOf(n) < 0) out.push(n);
      });
    });
  });
  return out;
}

async function askMenu(env, model, o) {
  return askJson(env, model, menuPrompt(o), 'menu', MENU_SCHEMA,
    // 一品ごとに調味料と手順を書くぶん、返りが長くなる
    Number(env.OPENAI_MENU_MAX_TOKENS || 4000));
}

/* 文だけ渡して、決めた型の JSON をもらう（献立と、呼び方の突き合わせで使う） */
async function askJson(env, model, prompt, schemaName, schema, maxTokens) {
  const base = String(env.OPENAI_BASE || OCR_DEFAULTS.base).replace(/\/+$/, '');
  const effort = env.OPENAI_REASONING === undefined ? OCR_DEFAULTS.reasoning : String(env.OPENAI_REASONING);

  const payload = {
    model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    text: {
      format: { type: 'json_schema', name: schemaName, strict: true, schema: schema }
    },
    max_output_tokens: maxTokens,
    tools: [],
    store: false
  };
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
      body: { error: 'openai_empty', model, incomplete: out.incomplete_details || null } };
  }
  let data;
  try { data = JSON.parse(content); } catch (e) {
    return { ok: false, status: 502, body: { error: 'not_json', sample: content.slice(0, 200) } };
  }
  return { ok: true, data, model, usage: out.usage || null };
}

/* ---------------- プロット相談 ----------------

   物語の大きな流れだけを作ってもらう。性的な場面は書かせず、
   その位置に印（kind:'adult'）を置くだけにする。アプリ側はそこに
   「ここから成人向けシーン」と出す。
   登場人物は全員おとなにする。未成年を思わせる言葉が混ざったら、
   一度だけ言い直してもらい、それでも混ざるなら断る。 */

const PLOT_LENGTHS = ['short', 'long'];

const PLOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'logline', 'characters', 'beats', 'note'],
  properties: {
    title: { type: 'string', description: '仮の題' },
    logline: { type: 'string', description: '話のあらすじを1〜2行で' },
    characters: {
      type: 'array',
      description: '主要人物。頼まれた人数ちょうど',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role', 'age', 'note'],
        properties: {
          name: { type: 'string', description: '呼び名' },
          role: { type: 'string', description: '立ち位置。例）攻／受、主人公、相手役' },
          age: { type: 'string', description: '年齢。必ず20代以上のおとな。例）28歳' },
          note: { type: 'string', description: '性格・職業・関係。1〜2行' }
        }
      }
    },
    beats: {
      type: 'array',
      description: '話の流れ。頭から終わりまで順に',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'kind', 'text', 'page'],
        properties: {
          label: { type: 'string', description: '場面の見出し' },
          kind: {
            type: 'string', enum: ['story', 'adult'],
            description: 'story=ふつうの場面 adult=成人向けの場面（中身は書かない）'
          },
          text: { type: 'string', description: 'その場面で起きること。kind が adult のときは空文字' },
          page: { type: 'string', description: '目安のページ数。例）8P' }
        }
      }
    },
    note: { type: 'string', description: '組み立ての狙いや注意。無ければ空文字' }
  }
};

/* 未成年を思わせる言葉。ここに引っかかったら出さない */
const PLOT_BAN = ['小学', '中学', '高校', '学生', '生徒', '児童', '幼', '少年', 'ショタ',
  '制服', '学園', '学校', 'ランドセル', '未成年', '10代', '十代', 'JK', 'JC'];

function plotPrompt(o, strict) {
  const lines = [
    '男性同士（ゲイ向け）のマンガのプロットを考えてください。作者は成人向け同人作家です。',
    '書くのは物語の大きな流れだけです。台詞や細かい描写は要りません。',
    '',
    '【長さ】' + (o.length === 'long' ? '長編' : '短編') + '（およそ ' + o.pages + 'ページ）',
    '【ジャンル】' + (o.genre || 'おまかせ'),
    '【入れたいシーン】' + (o.want || 'とくになし'),
    '【主要人物】' + o.people + '人',
    '',
    '守ること：',
    '・登場人物は全員はっきりとおとな（20代以上の社会人）にしてください。',
    '・未成年を思わせる設定・言葉は一切使わないでください'
      + '（学生、生徒、学校、学園、制服、幼い、少年 などは禁止です）。',
    '・性的な場面そのものは書かないでください。その位置には kind を "adult" にした場面を置き、'
      + 'text は空文字にしてください。前後のふつうの場面だけを書きます。',
    '・場面ごとに、目安のページ数を入れてください。合計が ' + o.pages + 'ページ前後になるように。',
    '・場面は' + (o.length === 'long' ? '10〜16' : '5〜9') + 'つくらいに分けてください。'
  ];
  if (strict) {
    lines.push('・前回の答えに未成年を思わせる言葉が混ざっていました。'
      + '年齢・職業・場所をすべておとなのものに置き換えてください。');
  }
  return lines.join('\n');
}

/* 年齢は必ずおとなにする。数が小さければ言い方を変える */
function plotAge(s) {
  const t = String(s || '').trim().slice(0, 20);
  const m = /(\d{1,3})/.exec(t);
  if (m && Number(m[1]) < 20) return '成人';
  return t || '成人';
}

function plotClean(data, o) {
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  return {
    title: str(data && data.title, 80),
    logline: str(data && data.logline, 300),
    characters: (Array.isArray(data && data.characters) ? data.characters : [])
      .slice(0, 8).map((c) => ({
        name: str(c && c.name, 40),
        role: str(c && c.role, 30),
        age: plotAge(c && c.age),
        note: str(c && c.note, 200)
      })).filter((c) => c.name),
    beats: (Array.isArray(data && data.beats) ? data.beats : []).slice(0, 24).map((b) => {
      const kind = (b && b.kind) === 'adult' ? 'adult' : 'story';
      return {
        label: str(b && b.label, 60),
        kind: kind,
        // 成人向けの場面は、中身を持たせない
        text: kind === 'adult' ? '' : str(b && b.text, 600),
        page: str(b && b.page, 20)
      };
    }).filter((b) => b.label || b.text || b.kind === 'adult'),
    note: str(data && data.note, 300),
    length: o.length, pages: o.pages, genre: o.genre, people: o.people
  };
}

/* 未成年を思わせる言葉が混ざっていないか */
function plotBanned(p) {
  const hay = [p.title, p.logline, p.note]
    .concat(p.characters.map((c) => c.name + c.role + c.age + c.note))
    .concat(p.beats.map((b) => b.label + b.text)).join('\n');
  for (const w of PLOT_BAN) {
    if (hay.indexOf(w) >= 0) return w;
  }
  return '';
}

async function plot(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
  if (!env.OPENAI_API_KEY) return json({ error: 'no_api_key' }, 503, cors);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }

  const o = {
    length: PLOT_LENGTHS.indexOf(body && body.length) >= 0 ? body.length : 'short',
    pages: Math.min(600, Math.max(4, Math.round(Number(body && body.pages) || 24))),
    genre: String((body && body.genre) || '').slice(0, 120),
    want: String((body && body.want) || '').slice(0, 600),
    people: Math.min(6, Math.max(1, Math.round(Number(body && body.people) || 2)))
  };

  const model = String(body.model || env.OPENAI_PLOT_MODEL || env.OPENAI_MODEL || OCR_DEFAULTS.model);
  const max = Number(env.OPENAI_PLOT_MAX_TOKENS || 4000);

  let pass = await askJson(env, model, plotPrompt(o, false), 'plot', PLOT_SCHEMA, max);
  if (!pass.ok) return json(pass.body, pass.status, cors);
  let out = plotClean(pass.data, o);
  let bad = plotBanned(out);

  // 一度だけ言い直してもらう
  if (bad) {
    pass = await askJson(env, model, plotPrompt(o, true), 'plot', PLOT_SCHEMA, max);
    if (!pass.ok) return json(pass.body, pass.status, cors);
    out = plotClean(pass.data, o);
    bad = plotBanned(out);
  }
  if (bad) return json({ error: 'plot_unsafe', word: bad }, 422, cors);

  return json({ ok: true, data: out, model: pass.model, usage: pass.usage }, 200, cors);
}

/* できたプロットを Discord のチャンネルへ送る */
async function plotSend(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
  if (!env.DISCORD_PLOT_WEBHOOK) return json({ error: 'no_plot_webhook' }, 503, cors);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
  const p = plotClean(body && body.plot, {
    length: (body && body.plot && body.plot.length) || 'short',
    pages: (body && body.plot && body.plot.pages) || 0,
    genre: (body && body.plot && body.plot.genre) || '',
    people: (body && body.plot && body.plot.people) || 0
  });
  if (!p.title && !p.beats.length) return json({ error: 'empty' }, 400, cors);

  const head = '**' + escapeMd(p.title || 'プロット') + '**'
    + '　' + (p.length === 'long' ? '長編' : '短編') + (p.pages ? ' ' + p.pages + 'P' : '')
    + (p.genre ? '　' + escapeMd(p.genre) : '');
  const lines = [head];
  if (p.logline) lines.push(p.logline);
  if (p.characters.length) {
    lines.push('', '＜人物＞');
    p.characters.forEach((c) => {
      lines.push('・' + c.name + '（' + c.age + (c.role ? '／' + c.role : '') + '）'
        + (c.note ? ' ' + c.note : ''));
    });
  }
  lines.push('', '＜流れ＞');
  p.beats.forEach((b, i) => {
    if (b.kind === 'adult') {
      lines.push((i + 1) + '. ここから成人向けシーン' + (b.page ? '（' + b.page + '）' : ''));
      return;
    }
    lines.push((i + 1) + '. ' + b.label + (b.page ? '（' + b.page + '）' : ''));
    if (b.text) lines.push('　　' + b.text);
  });
  if (p.note) lines.push('', p.note);

  const parts = chunk(lines.join('\n'), DISCORD_LIMIT);
  for (let i = 0; i < parts.length; i++) {
    const res = await fetch(env.DISCORD_PLOT_WEBHOOK + '?wait=true', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: parts[i], allowed_mentions: { parse: [] } })
    });
    if (!res.ok) {
      const msg = (await res.text()).slice(0, 300);
      return json({ error: 'discord_error', status: res.status, message: msg }, 502, cors);
    }
  }
  return json({ ok: true, parts: parts.length }, 200, cors);
}

/* ---------------- 貯金口座の残高 ----------------

   GMOあおぞらネット銀行の API（個人向け）から、貯蓄用口座の残高を読む。
   鍵はここ（Worker の secret）にだけ置き、アプリには渡さない。
   アプリが受け取るのは「いくらあるか」という数字だけ。

   secret（wrangler secret put ...）
     BANK_ACCESS_TOKEN     …… アクセストークンをそのまま使うとき（sunabar など）
     BANK_CLIENT_ID        …┐
     BANK_CLIENT_SECRET    …┼ OAuth で更新しながら使うとき
     BANK_REFRESH_TOKEN    …┘

   var（wrangler.jsonc の vars か、ダッシュボードで足す）
     BANK_BASE          …… API の入口（既定は本番の個人向け）
     BANK_BALANCE_PATH  …… 残高の道（既定 /accounts/balances）
     BANK_TOKEN_PATH    …… トークンの道（既定 /oauth/token）
     BANK_ACCOUNT_ID    …… 口座を1つに絞るとき
     BANK_LIST_KEY / BANK_AMOUNT_KEY / BANK_NAME_KEY / BANK_ID_KEY
                        …… 返ってくる JSON の名前が違うときの逃げ道

   道や名前が合っているかは /v1/bank/debug で確かめられる（鍵は出ない）。 */

const BANK_DEFAULTS = {
  base: 'https://api.gmo-aozora.com/ganb/api/personal/v1',
  balancePath: '/accounts/balances',
  tokenPath: '/oauth/token',
  listKey: 'balances',
  amountKey: 'balance',
  nameKey: 'accountTypeName',
  idKey: 'accountId'
};

function bankConf(env) {
  const v = (k, d) => (env[k] === undefined || env[k] === '' ? d : String(env[k]));
  return {
    base: v('BANK_BASE', BANK_DEFAULTS.base).replace(/\/+$/, ''),
    balancePath: v('BANK_BALANCE_PATH', BANK_DEFAULTS.balancePath),
    tokenPath: v('BANK_TOKEN_PATH', BANK_DEFAULTS.tokenPath),
    accountId: v('BANK_ACCOUNT_ID', ''),
    listKey: v('BANK_LIST_KEY', BANK_DEFAULTS.listKey),
    amountKey: v('BANK_AMOUNT_KEY', BANK_DEFAULTS.amountKey),
    nameKey: v('BANK_NAME_KEY', BANK_DEFAULTS.nameKey),
    idKey: v('BANK_ID_KEY', BANK_DEFAULTS.idKey)
  };
}

function bankReady(env) {
  return !!(env.BANK_ACCESS_TOKEN
    || (env.BANK_CLIENT_ID && env.BANK_CLIENT_SECRET && env.BANK_REFRESH_TOKEN));
}

/**
 * 使えるアクセストークンを1つ用意する。
 * そのまま渡されていればそれを、OAuth なら更新して KV に取っておく。
 */
async function bankToken(env) {
  if (env.BANK_ACCESS_TOKEN) return String(env.BANK_ACCESS_TOKEN);
  if (!(env.BANK_CLIENT_ID && env.BANK_CLIENT_SECRET && env.BANK_REFRESH_TOKEN)) return '';

  const cached = env.SYNC ? await env.SYNC.get('bank:token', 'json') : null;
  if (cached && cached.token && cached.until > Date.now() + 60000) return cached.token;

  const c = bankConf(env);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(env.BANK_REFRESH_TOKEN),
    client_id: String(env.BANK_CLIENT_ID),
    client_secret: String(env.BANK_CLIENT_SECRET)
  });
  const res = await fetch(c.base + c.tokenPath, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString()
  });
  const text = await res.text();
  if (!res.ok) throw new Error('token ' + res.status + ' ' + text.slice(0, 200));
  let out;
  try { out = JSON.parse(text); } catch (e) { throw new Error('token が JSON ではありません'); }
  const token = String(out.access_token || '');
  if (!token) throw new Error('token が入っていません');
  const life = Math.max(60, Number(out.expires_in) || 3600) * 1000;
  if (env.SYNC) {
    await env.SYNC.put('bank:token', JSON.stringify({ token, until: Date.now() + life }),
      { expirationTtl: Math.ceil(life / 1000) + 60 });
  }
  return token;
}

/* 返ってきた JSON から口座の並びを探す。
   名前が違っても拾えるよう、最後は中を舐めて「数字を持った並び」を探す */
function bankPickList(data, c) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[c.listKey])) return data[c.listKey];
  const seen = [];
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 4 || seen.length) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') { seen.push(v); return; }
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(data, 0);
  return seen[0] || [];
}

/* HTML のエラーページから、題と1行目だけ取り出す */
function htmlSummary(text) {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1] || '';
  const h1 = (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text) || [])[1] || '';
  const body = (title + (h1 && h1 !== title ? '／' + h1 : '')).replace(/\s+/g, ' ').trim();
  return body ? body.slice(0, 120) : 'HTML のエラーページが返りました';
}

function bankNum(v) {
  const n = Number(String(v == null ? '' : v).replace(/[,\s円]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/* 1口座ぶんを、こちらの形にそろえる */
function bankAccount(row, c) {
  const pick = (keys) => {
    for (const k of keys) {
      if (row && row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
    }
    return '';
  };
  const amount = pick([c.amountKey, 'balance', 'currentBalance', 'amount', 'balanceAmount']);
  return {
    id: String(pick([c.idKey, 'accountId', 'accountNumber', 'id'])).slice(0, 40),
    name: String(pick([c.nameKey, 'accountTypeName', 'accountName', 'name', 'branchName'])).slice(0, 40),
    balance: bankNum(amount)
  };
}

/** 残高を読んで、こちらの形にして返す */
async function bankFetch(env) {
  const c = bankConf(env);
  const token = await bankToken(env);
  if (!token) return { ok: false, status: 503, body: { error: 'no_bank_token' } };

  let res, text;
  try {
    res = await fetch(c.base + c.balancePath, {
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' }
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 502,
      body: { error: 'bank_unreachable', message: String((e && e.message) || e).slice(0, 200) } };
  }
  if (!res.ok) {
    // API まで届かず、途中の入口が HTML のエラーページを返すことがある。
    // そのまま出すと読めないので、要点だけにする
    const html = /^\s*<(!doctype|html)/i.test(text);
    return { ok: false, status: res.status === 401 ? 502 : res.status,
      body: {
        error: 'bank_error', status: res.status, html: html,
        message: html ? htmlSummary(text) : text.slice(0, 300)
      } };
  }
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return { ok: false, status: 502, body: { error: 'bank_not_json', sample: text.slice(0, 200) } };
  }

  const all = bankPickList(data, c).map((r) => bankAccount(r, c)).filter((a) => a.name || a.id);
  let accounts = all;
  if (c.accountId) accounts = all.filter((a) => a.id === c.accountId);
  // 絞り込みが合っていないのを、0円と取り違えないようにする
  if (c.accountId && !accounts.length && all.length) {
    return { ok: false, status: 409, body: {
      error: 'bank_no_match', wanted: c.accountId, ids: all.map((a) => a.id).slice(0, 10)
    } };
  }
  const total = accounts.reduce((n, a) => n + a.balance, 0);
  return { ok: true, data: { accounts, total, at: new Date().toISOString() } };
}

/* その日ぶんを控える。日ごとに1つで、上書きしていく */
async function bankSnap(env, data) {
  if (!env.SYNC || !data) return;
  const day = jstDate(Date.now());
  await env.SYNC.put('bank:day:' + day, JSON.stringify({ total: data.total, at: data.at }),
    { expirationTtl: 60 * 60 * 24 * 400 });
  await env.SYNC.put('bank:last', JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 400 });
}

async function bankHistory(env, days) {
  if (!env.SYNC) return {};
  const n = Math.min(400, Math.max(1, Number(days) || 180));
  const out = {};
  const list = await env.SYNC.list({ prefix: 'bank:day:' });
  const from = jstDate(Date.now() - n * 86400000);
  for (const k of list.keys) {
    const day = k.name.slice('bank:day:'.length);
    if (day < from) continue;
    const v = await env.SYNC.get(k.name, 'json');
    if (v) out[day] = v.total;
  }
  return out;
}

async function bank(request, env, cors, url) {
  const path = url.pathname.slice('/v1/bank/'.length);

  if (path === 'balance') {
    if (!bankReady(env)) return json({ error: 'no_bank_token' }, 503, cors);
    let pass;
    try { pass = await bankFetch(env); } catch (e) {
      return json({ error: 'bank_error', message: String((e && e.message) || e).slice(0, 300) }, 502, cors);
    }
    if (!pass.ok) return json(pass.body, pass.status, cors);
    await bankSnap(env, pass.data);
    const history = await bankHistory(env, url.searchParams.get('days'));
    return json({ ok: true, data: pass.data, history }, 200, cors);
  }

  if (path === 'history') {
    const last = env.SYNC ? await env.SYNC.get('bank:last', 'json') : null;
    return json({ ok: true, data: last, history: await bankHistory(env, url.searchParams.get('days')) },
      200, cors);
  }

  /* つながるかを確かめる。どこで詰まっているかが分かるよう、
     返ってきた中身を少しだけ見せる（鍵は出さない） */
  if (path === 'debug') {
    const c = bankConf(env);
    const info = {
      base: c.base, balancePath: c.balancePath,
      auth: env.BANK_ACCESS_TOKEN ? 'token' : bankReady(env) ? 'oauth' : 'none',
      accountId: c.accountId || '(絞っていません)'
    };
    if (!bankReady(env)) return json({ ok: false, error: 'no_bank_token', conf: info }, 503, cors);
    let token = '';
    try { token = await bankToken(env); } catch (e) {
      return json({ ok: false, error: 'token_failed', conf: info,
        message: String((e && e.message) || e).slice(0, 300) }, 502, cors);
    }
    let res, text;
    try {
      res = await fetch(c.base + c.balancePath, {
        headers: { authorization: 'Bearer ' + token, accept: 'application/json' }
      });
      text = await res.text();
    } catch (e) {
      return json({ ok: false, error: 'bank_unreachable', conf: info,
        message: String((e && e.message) || e).slice(0, 200) }, 502, cors);
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* そのまま出す */ }
    const accounts = parsed ? bankPickList(parsed, c).map((r) => bankAccount(r, c)) : [];
    return json({
      ok: res.ok, status: res.status, conf: info,
      accounts,
      // 名前が合わないときのために、返ってきた形をそのまま少しだけ
      sample: text.slice(0, 900)
    }, 200, cors);
  }

  return json({ error: 'not_found' }, 404, cors);
}

/* 1日1回、夜のうちに残高を控えておく（アプリを開いていなくても残る） */
async function dailyBank(env) {
  if (!env.SYNC || !bankReady(env)) return;
  const now = Date.now();
  if (new Date(now).getUTCHours() < backupHour(env)) return;
  const today = jstDate(now);
  if ((await env.SYNC.get('bank:day:' + today, 'text'))) return;   // もう控えてある
  try {
    const pass = await bankFetch(env);
    if (pass.ok) await bankSnap(env, pass.data);
  } catch (e) { /* next time */ }
}

/* ---------------- 遅れたときの立て直し ----------------

   締切に間に合いそうにないとき、どこを削るか・どれだけ上げるか・
   いつまで延ばせるかを、いくつかの案として出してもらう。
   ここでは案を出すだけで、予定そのものは書き換えない。 */

const PLAN_KINDS = ['pace', 'cut', 'move', 'help', 'other'];

const RESCHEDULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'risk', 'plans', 'note'],
  properties: {
    summary: { type: 'string', description: 'いまの状況をひと言で（1〜2行）' },
    risk: { type: 'string', enum: ['low', 'mid', 'high'], description: 'このままで間に合うか' },
    plans: {
      type: 'array',
      description: '立て直しの案を2〜3つ。効きめの大きい順',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'detail', 'perDay', 'risk'],
        properties: {
          title: { type: 'string', description: '案の名前。例）仕上げを軽くする' },
          kind: {
            type: 'string', enum: PLAN_KINDS,
            description: 'pace=ペースを上げる cut=減らす move=締切を動かす help=人に頼む other=その他'
          },
          detail: { type: 'string', description: '何をどうするか。2〜4行' },
          perDay: { type: 'number', description: 'その案での1日あたりの目安。数で出せなければ0' },
          risk: { type: 'string', enum: ['low', 'mid', 'high'], description: 'この案の危うさ' }
        }
      }
    },
    note: { type: 'string', description: '気をつけること。無ければ空文字' }
  }
};

function reschedulePrompt(o) {
  const lines = [
    '同人・フリーランスで漫画とイラストを描いている人の作業計画です。',
    '締切に間に合いそうにありません。立て直しの案を2〜3つ出してください。',
    '',
    '【案件】' + o.title + '（' + o.kind + '）',
    '【締切】' + o.deadline + '（今日は ' + o.today + '。あと ' + o.daysLeft + '日。'
      + '今日と締切日を入れて、作業できる日は ' + o.workdaysLeft + '日）'
  ];
  if (o.tasks.length) {
    lines.push('【残っている工程】');
    o.tasks.forEach((t) => {
      lines.push('・' + t.name + '：残り ' + t.remaining + t.unit
        + (t.behind ? '（' + t.behind + t.unit + '遅れ）' : '')
        + '、割り当ては ' + t.days + '日で1日 ' + t.perDay + t.unit
        + (t.end ? '、' + t.end + 'まで' : ''));
    });
  }
  if (o.pace) lines.push('【いつものペース】作業した日で1日あたり ' + o.pace + '（直近60日）');
  if (o.otherLoad) lines.push('【ほかの案件】同じころに1日あたり ' + o.otherLoad + ' のノルマがあります');
  if (o.limit) lines.push('【1日の上限】' + o.limit + '（本人が決めた上限）');
  if (o.note) lines.push('【本人のメモ】' + o.note);
  lines.push('');
  lines.push('案は、この人がひとりで今日から実行できることにしてください。');
  lines.push('「ペースを上げる」だけで終わらせず、削れるところ（作画の手間、ページ数、'
    + '仕上げの度合い、新刊を減らす）や、締切そのものを動かせるか'
    + '（印刷所の割増や、相手への連絡）も考えてください。');
  lines.push('数で言えるところは数で書いてください（1日◯ページ、◯日短縮 など）。');
  lines.push('できない約束や、体を壊すような案は出さないでください。');
  return lines.join('\n');
}

async function reschedule(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
  if (!env.OPENAI_API_KEY) return json({ error: 'no_api_key' }, 503, cors);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }

  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));
  const o = {
    title: str(body.title, 60) || '（名前なし）',
    kind: str(body.kind, 20) || '案件',
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(body.deadline)) ? body.deadline : '',
    today: /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? body.today : '',
    daysLeft: num(body.daysLeft),
    workdaysLeft: num(body.workdaysLeft),
    limit: num(body.limit),
    otherLoad: num(body.otherLoad),
    pace: str(body.pace, 20),
    note: str(body.note, 300),
    tasks: (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 12).map((t) => ({
      name: str(t && t.name, 40),
      unit: str(t && t.unit, 8),
      remaining: num(t && t.remaining),
      behind: num(t && t.behind),
      days: num(t && t.days),
      perDay: num(t && t.perDay),
      end: /^\d{4}-\d{2}-\d{2}$/.test(String(t && t.end)) ? t.end : ''
    })).filter((t) => t.name)
  };
  if (!o.deadline || !o.today) return json({ error: 'no_deadline' }, 400, cors);

  const model = String(body.model || env.OPENAI_ADVICE_MODEL || env.OPENAI_MODEL || OCR_DEFAULTS.model);
  const pass = await askJson(env, model, reschedulePrompt(o), 'reschedule', RESCHEDULE_SCHEMA,
    Number(env.OPENAI_ADVICE_MAX_TOKENS || 3000));
  if (!pass.ok) return json(pass.body, pass.status, cors);

  return json({ ok: true, data: pass.data, model: pass.model, usage: pass.usage }, 200, cors);
}

/* ---------------- 書類を Discord へ ----------------

   見積書・請求書・領収書は、それぞれ別のチャンネルへ送る。
   送り先はどれも secret にだけ置く（アプリ側には持たせない）。

   置いてある PDF を R2 から出して、そのまま添える。 */

const DOC_HOOKS = {
  estimate: { env: 'DISCORD_ESTIMATE_WEBHOOK', label: '見積書' },
  invoice: { env: 'DISCORD_INVOICE_WEBHOOK', label: '請求書' },
  receipt: { env: 'DISCORD_RECEIPT_WEBHOOK', label: '領収書' }
};

async function docSend(request, env, cors, id) {
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
  if (!env.FILES) return json({ error: 'r2_not_bound' }, 500, cors);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }

  const kind = DOC_HOOKS[String(body && body.type || '')];
  if (!kind) return json({ error: 'bad_type' }, 400, cors);
  const hook = env[kind.env];
  if (!hook) return json({ error: 'no_doc_webhook', which: kind.env, label: kind.label }, 503, cors);

  const fileId = String(body.fileId || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fileId)) return json({ error: 'bad_id' }, 400, cors);

  const obj = await env.FILES.get('files/' + id + '/' + fileId);
  if (!obj) return json({ error: 'not_found' }, 404, cors);
  if (obj.size > DISCORD_MAX) {
    return json({ error: 'too_large', size: obj.size, max: DISCORD_MAX }, 413, cors);
  }

  const name = String(body.name || (kind.label + '.pdf')).slice(0, 120);
  const lines = [
    '**' + kind.label + '**' + (body.number ? '　No. ' + escapeMd(String(body.number)) : ''),
    body.client ? '宛先　' + escapeMd(String(body.client).slice(0, 80)) : '',
    body.total ? '金額　' + escapeMd(String(body.total)) : '',
    body.issueDate ? '発行日　' + escapeMd(String(body.issueDate)) : '',
    body.project ? '案件　' + escapeMd(String(body.project).slice(0, 80)) : ''
  ].filter(Boolean);

  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content: lines.join('\n'),
    allowed_mentions: { parse: [] }
  }));
  form.append('files[0]', new Blob([await obj.arrayBuffer()], { type: 'application/pdf' }), name);

  const res = await fetch(hook + '?wait=true', { method: 'POST', body: form });
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 300);
    return json({ error: 'discord_error', status: res.status, message: msg }, 502, cors);
  }
  return json({ ok: true, label: kind.label, size: obj.size }, 200, cors);
}

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

/* 名刺から拾いたいところ。顧客管理の欄にそのまま入る形にしておく */
const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['company', 'contact', 'title', 'email', 'tel', 'fax', 'zip', 'address', 'url', 'note', 'confidence', 'unclear'],
  properties: {
    company: { type: ['string', 'null'], description: '会社名・団体名。読めなければ null' },
    contact: { type: ['string', 'null'], description: '担当者の氏名。読めなければ null' },
    title: { type: ['string', 'null'], description: '部署・役職。読めなければ null' },
    email: { type: ['string', 'null'], description: 'メールアドレス。読めなければ null' },
    tel: { type: ['string', 'null'], description: '電話番号。携帯と代表があれば代表を優先' },
    fax: { type: ['string', 'null'], description: 'FAX番号。読めなければ null' },
    zip: { type: ['string', 'null'], description: '郵便番号。ハイフンあり（100-0001）' },
    address: { type: ['string', 'null'], description: '住所。郵便番号は含めない' },
    url: { type: ['string', 'null'], description: 'ウェブサイト。読めなければ null' },
    note: { type: ['string', 'null'], description: 'そのほか名刺に書いてあること。無ければ null' },
    confidence: { type: 'number', description: '0〜1。読み取りの確からしさ' },
    unclear: { type: 'boolean', description: '字が潰れている・影で読めない箇所があるか' }
  }
};

const CARD_PROMPT =
  '名刺の写真から次の項目だけを取り出し、指定の JSON で返してください。' +
  '全文の書き起こしや説明は不要です。' +
  '会社名は法人格（株式会社・有限会社など）も書いてあるとおりに含めてください。' +
  '氏名は姓と名のあいだを全角空白ひとつにそろえ、ふりがなやローマ字表記は含めないでください。' +
  '部署と役職が別々に書いてあるときは「部署 役職」の順につなげて title に入れてください。' +
  '電話番号は書いてあるとおりの区切りで返し、携帯（090・080・070）と代表番号が' +
  '両方あるときは代表番号を tel にしてください。' +
  '郵便番号は 100-0001 の形にし、address には含めないでください。' +
  '両面が写っているときは、日本語の面を優先して拾ってください。' +
  '読み取れない項目は null にし、推測で埋めないでください。' +
  '字が潰れて自信が持てないときは unclear を true にしてください。';

/* 読み取りの種類。増やすときはここに足す */
const OCR_KINDS = {
  receipt: { name: 'receipt', prompt: RECEIPT_PROMPT, schema: RECEIPT_SCHEMA, retry: needsRetry },
  card: { name: 'card', prompt: CARD_PROMPT, schema: CARD_SCHEMA, retry: cardNeedsRetry }
};

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
      maxTokens: Number(env.OPENAI_MAX_TOKENS || OCR_DEFAULTS.maxTokens),
      kinds: Object.keys(OCR_KINDS)
    }, 200, cors);
  }

  const spec = OCR_KINDS[rest];
  if (!spec || request.method !== 'POST') return json({ error: 'not_found' }, 404, cors);
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
  let pass = await askOpenAI(env, light, dataUrl, 'auto', spec);
  if (!pass.ok) return json(pass.body, pass.status, cors);

  let why = spec.retry(pass.data);
  let retried = false;
  // 2回目は強いほうで、画像も細かく見てもらう
  if (why && strong && !body.noRetry) {
    const again = await askOpenAI(env, strong, dataUrl, 'high', spec);
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

/* 名刺を読み直したほうがよいか。
   会社名か担当者名のどちらかは必ず載っているので、両方空なら読めていない */
function cardNeedsRetry(d) {
  if (!d) return 'no_data';
  if (d.unclear) return 'unclear';
  if (typeof d.confidence === 'number' && d.confidence < 0.6) return 'low_confidence';
  if (!String(d.company || '').trim() && !String(d.contact || '').trim()) return 'no_name';
  // 名刺に連絡先が1つも無いことはまずない
  if (!String(d.email || '').trim() && !String(d.tel || '').trim()
    && !String(d.address || '').trim()) return 'no_contact';
  return '';
}

/**
 * OpenAI に1回だけ聞く。
 * @param {string} detail 画像の見かた 'auto' | 'high'
 * @param {object} spec 読み取りの種類 {name, prompt, schema}
 */
async function askOpenAI(env, model, dataUrl, detail, spec) {
  const base = String(env.OPENAI_BASE || OCR_DEFAULTS.base).replace(/\/+$/, '');
  const maxTokens = Number(env.OPENAI_MAX_TOKENS || OCR_DEFAULTS.maxTokens);
  const effort = env.OPENAI_REASONING === undefined ? OCR_DEFAULTS.reasoning : String(env.OPENAI_REASONING);

  const payload = {
    model,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: spec.prompt },
        { type: 'input_image', image_url: dataUrl, detail }
      ]
    }],
    text: {
      format: {
        type: 'json_schema',
        name: spec.name,
        strict: true,
        schema: spec.schema
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
