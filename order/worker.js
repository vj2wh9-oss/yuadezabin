/**
 * 発注ページの受け口（Cloudflare Workers）
 *
 *   GET  /（ほか静的なファイル）→ order/public のページをそのまま返す
 *   POST /api/order            → 発注を1件受け取る
 *   GET  /api/health           → 動いているかどうかだけを返す（中身は返さない）
 *
 * 受け取った1件でやること
 *   1. 形を確かめる（選択肢は public/form.json と照らす。ここに写しは持たない）
 *   2. KV に控える（30日で自動的に消える。届けそこねたときの取り戻し用）
 *   3. keisuke@yuadezabin.com へメールで送る
 *   4. 同期サーバーの受け口 /v1/inbox/order へ送る（アプリの「発注」に出る）
 *
 * 3 と 4 は落ちても発注そのものは受け付ける（KV に残るので、次の発注のときに送り直す）。
 *
 * お客様の情報について
 *   - このページは合言葉を持たない代わりに、読み出す口をひとつも開けていない。
 *     入った発注を外から読む方法は無く、出口はメールとアプリの2つだけ。
 *   - IP アドレスはそのまま持たない（連投よけのため、塩を混ぜた指紋だけを短時間置く）。
 *   - 控えは30日で消える。長く持つのはアプリ側（手元の端末）。
 *
 * 設定（wrangler.jsonc と secret）
 *   KV 名前空間 ORDERS
 *   var  MAIL_TO      送り先（keisuke@yuadezabin.com）
 *   var  MAIL_FROM    差出人（そのドメインで Email Routing を有効にしたもの）
 *   var  SYNC_URL     同期サーバーの URL
 *   secret SYNC_TOKEN 同期の合鍵。ここだけが持ち、ブラウザには一切出さない
 *   secret TURNSTILE_SECRET  人かどうかの確認（入れたときだけ働く）
 *   secret RESEND_API_KEY    Cloudflare のメール送信が使えないときの代わり（任意）
 *   send_email MAIL   Cloudflare の Email Routing で送るときの結び付け
 */

import { EmailMessage } from 'cloudflare:email';

const MAX_BODY = 16 * 1024;        // 発注1件。これを超えることはない
const KEEP_DAYS = 30;              // KV に控えを置く日数
const FLUSH_AT_ONCE = 5;           // 1回の受付で送り直す件数

// 連投よけ。人が普通に発注する速さなら当たらない値にする
const RATE = [
  { key: 'm', windowSec: 600, max: 5 },        // 10分で5件
  { key: 'd', windowSec: 86400, max: 20 }      // 1日で20件
];

// 受付番号に使う文字。読み違えやすい I O 0 1 は外す
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/order') return receive(request, env, ctx, url);
    if (url.pathname === '/api/health') return health(env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

    // 静的なファイル。ふつうはここへ来る前に Cloudflare が返している
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('not found', { status: 404 });
  }
};

/* ---------------- 動いているかどうか ---------------- */

function health(env) {
  return json({
    ok: true,
    service: '発注の受け口',
    bindings: {
      kv: !!env.ORDERS,
      mail: !!env.MAIL,
      resend: !!env.RESEND_API_KEY,
      sync: !!(env.SYNC_URL && env.SYNC_TOKEN),
      turnstile: !!env.TURNSTILE_SECRET
    },
    endpoints: ['/api/order']
  });
}

/* ---------------- 発注を受け取る ---------------- */

async function receive(request, env, ctx, url) {
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404);

  // このサイトの画面からの送信だけを受ける。
  // 別のサイトに置かれた偽のフォームから送られても、ここで止まる。
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'forbidden' }, 403);

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json({ error: 'too_large' }, 413);

  const text = await readCapped(request, MAX_BODY);
  if (text === null) return json({ error: 'too_large' }, 413);

  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad_json' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'bad_json' }, 400);

  // 自動送信よけ。人には見えない欄なので、何か入っていれば機械
  // （受け付けたふりをして黙って捨てる。手口を教えないため）
  if (String(body.website || '').trim()) return json({ ok: true, id: fakeCode() });

  if (!env.ORDERS) return json({ error: 'not_ready' }, 503);

  // 連投よけ。IP そのものは持たず、塩を混ぜた指紋で数える
  const fp = await fingerprint(request, env, url);
  const over = await rateLimited(env, fp);
  if (over) return json({ error: 'rate_limited' }, 429);

  // 人かどうかの確認（鍵を入れているときだけ）
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env, body.turnstile, request);
    if (!ok) return json({ error: 'human_check' }, 403);
  }

  const conf = await catalog(env, url);
  if (!conf) return json({ error: 'not_ready' }, 503);

  const clean = validate(body, conf);
  if (clean.error) return json({ error: 'invalid', field: clean.error }, 400);

  const order = {
    id: await code(env),
    at: new Date().toISOString(),
    company: clean.company,
    person: clean.person,
    email: clean.email,
    service: clean.service,
    serviceLabel: labelOf(conf.services, clean.service),
    deadline: clean.deadline,
    format: clean.format,
    formatLabel: labelOf(conf.formats, clean.format),
    note: clean.note,
    // どこの国から届いたか。おかしな発注を見分けるためだけに残す
    country: String((request.cf && request.cf.country) || '')
  };

  const ttl = KEEP_DAYS * 24 * 3600;
  try {
    await env.ORDERS.put('order:' + order.id, JSON.stringify(order), { expirationTtl: ttl });
  } catch (e) {
    return json({ error: 'not_ready' }, 503);
  }

  const [mailed, forwarded] = await Promise.all([
    sendMail(env, order).then(() => true).catch(() => false),
    forward(env, order).then(() => true).catch(() => false)
  ]);
  const left = { mail: !mailed, app: !forwarded };

  if (left.mail || left.app) {
    await env.ORDERS.put('pending:' + order.id, JSON.stringify(left), { expirationTtl: ttl })
      .catch(() => { /* 控えは order: に残っている */ });
  }

  // 前に届けそこねたものを、ついでに送り直す。返事は待たせない
  ctx.waitUntil(flush(env));

  return json({ ok: true, id: order.id });
}

/* 送りきれなかったものを送り直す。うまくいったぶんだけ印を消す */
async function flush(env) {
  let list;
  try { list = await env.ORDERS.list({ prefix: 'pending:', limit: FLUSH_AT_ONCE }); }
  catch (e) { return; }

  for (const k of (list.keys || [])) {
    const id = k.name.slice('pending:'.length);
    const order = await env.ORDERS.get('order:' + id, 'json').catch(() => null);
    if (!order) { await env.ORDERS.delete(k.name).catch(() => {}); continue; }

    const left = (await env.ORDERS.get(k.name, 'json').catch(() => null)) || { mail: true, app: true };
    if (left.mail) left.mail = !(await sendMail(env, order).then(() => true).catch(() => false));
    if (left.app) left.app = !(await forward(env, order).then(() => true).catch(() => false));

    if (!left.mail && !left.app) await env.ORDERS.delete(k.name).catch(() => {});
    else await env.ORDERS.put(k.name, JSON.stringify(left), { expirationTtl: KEEP_DAYS * 24 * 3600 }).catch(() => {});
  }
}

/* ---------------- 入力の確かめ ---------------- */

// 選択肢は public/form.json ひとつだけ。ここでは読むだけで写しを持たない
let catalogCache = null;
let catalogAt = 0;

async function catalog(env, url) {
  if (catalogCache && Date.now() - catalogAt < 60000) return catalogCache;
  try {
    const res = await env.ASSETS.fetch(new URL('/form.json', url.origin).toString());
    if (!res.ok) return catalogCache;
    const conf = await res.json();
    if (!conf || !Array.isArray(conf.services) || !Array.isArray(conf.formats)) return catalogCache;
    catalogCache = conf;
    catalogAt = Date.now();
    return conf;
  } catch (e) {
    return catalogCache;
  }
}

/**
 * 送られてきたものを、こちらの決まりに当てて整える。
 * 中身は信用せず、長さと形だけを見る。だめなら { error: 欄の名前 }。
 */
function validate(body, conf) {
  const lim = conf.limits || {};
  const company = str(body.company, num(lim.company, 100));
  const person = str(body.person, num(lim.person, 60));
  const email = str(body.email, num(lim.email, 254));
  const note = str(body.note, num(lim.note, 1000));
  const service = str(body.service, 40);
  const format = str(body.format, 40);
  const deadline = str(body.deadline, 10);

  if (!company) return { error: 'company' };
  if (!email || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return { error: 'email' };
  if (!has(conf.services, service)) return { error: 'service' };
  if (!has(conf.formats, format)) return { error: 'format' };

  const dl = conf.deadline || {};
  const min = addDays(todayISO(), num(dl.minLeadDays, 0));
  const max = addDays(todayISO(), num(dl.maxAheadDays, 365));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return { error: 'deadline' };
  // 時差でお客様の「今日」が1日ずれることがあるので、手前に1日みておく
  if (deadline < addDays(min, -1) || deadline > max) return { error: 'deadline' };

  return { company, person, email, service, format, deadline, note };
}

/* 文字を整える。長すぎるものを切り、改行以外の制御文字は落とす
   （メールの見出しなどに紛れ込ませる細工を防ぐため） */
function str(v, max) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .slice(0, Math.max(0, max));
}

function num(v, def) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

function has(list, id) {
  return !!id && (list || []).some(o => o && o.id === id);
}

function labelOf(list, id) {
  const hit = (list || []).filter(o => o && o.id === id)[0];
  return hit ? String(hit.label || id) : String(id);
}

function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  // 日本のお客様が見ている日付に合わせる（サーバーは UTC のため）
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function addDays(iso, n) {
  const p = iso.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/* ---------------- 受付番号 ---------------- */

/** YZ-20260903-K7Q4 の形。同じ番号にならないよう、ぶつかったら引き直す */
async function code(env) {
  for (let i = 0; i < 5; i++) {
    const id = 'YZ-' + todayISO().replace(/-/g, '') + '-' + rand(4);
    const dup = await env.ORDERS.get('order:' + id, 'text').catch(() => null);
    if (!dup) return id;
  }
  return 'YZ-' + todayISO().replace(/-/g, '') + '-' + rand(6);
}

function rand(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map(x => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

/* 機械からの送信に返す、それらしい番号（実際には何も受け付けていない） */
function fakeCode() {
  return 'YZ-' + todayISO().replace(/-/g, '') + '-' + rand(4);
}

/* ---------------- 連投よけ ---------------- */

/** IP そのものは残さない。塩を混ぜた指紋にしてから数える */
async function fingerprint(request, env, url) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const salt = env.RL_SALT || url.hostname;
  return (await sha256(ip + '|' + salt)).slice(0, 24);
}

async function rateLimited(env, fp) {
  const now = Math.floor(Date.now() / 1000);
  for (const r of RATE) {
    const bucket = Math.floor(now / r.windowSec);
    const key = 'rl:' + r.key + ':' + bucket + ':' + fp;
    const n = num(await env.ORDERS.get(key, 'text').catch(() => null), 0);
    if (n >= r.max) return true;
    // 数えるだけなので、窓が過ぎたら自然に消えるようにする
    await env.ORDERS.put(key, String(n + 1), { expirationTtl: r.windowSec + 60 }).catch(() => {});
  }
  return false;
}

/* ---------------- 人かどうかの確認（Turnstile） ---------------- */

async function verifyTurnstile(env, token, request) {
  if (!token || typeof token !== 'string' || token.length > 4096) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(8000)
    });
    const out = await res.json();
    return !!(out && out.success);
  } catch (e) {
    // 確認そのものにつながらないとき、正しいお客様を締め出さない
    return true;
  }
}

/* ---------------- メールで知らせる ---------------- */

function mailText(o) {
  return [
    '発注フォームから、新しい発注が届きました。',
    '',
    '受付番号　　' + o.id,
    '受付日時　　' + jst(o.at),
    '',
    '発注社名　　' + o.company,
    '担当者　　　' + (o.person || '（未記入）'),
    '連絡先　　　' + o.email,
    'サービス　　' + o.serviceLabel,
    '希望納期　　' + o.deadline,
    '納品形式　　' + o.formatLabel,
    '',
    'ご要望',
    // ご要望の中の改行も、メールの決まりに合わせて \r\n にそろえる
    o.note ? o.note.replace(/\n/g, '\r\n') : '（なし）',
    '',
    '----',
    'このメールにそのまま返信すると、お客様（' + o.email + '）宛になります。',
    '発注社名の照合は、アプリの「発注」から行ってください。',
    ''
  ].join('\r\n');
}

async function sendMail(env, o) {
  const to = env.MAIL_TO || 'keisuke@yuadezabin.com';
  const from = env.MAIL_FROM || ('order@' + to.split('@')[1]);
  const subject = '【発注】' + o.company + '／' + o.serviceLabel + '（' + o.id + '）';
  const text = mailText(o);

  if (env.MAIL) {
    const raw = mime({ from, to, replyTo: o.email, subject, text, id: o.id });
    await env.MAIL.send(new EmailMessage(from, to, raw));
    return;
  }

  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: '発注フォーム <' + from + '>', to: [to], reply_to: o.email, subject, text }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error('resend ' + res.status);
    return;
  }

  throw new Error('no mail binding');
}

/**
 * メールの元の形（RFC 5322）を組み立てる。
 * 見出しは ASCII しか置けないので、日本語は =?UTF-8?B?…?= にして渡す。
 */
function mime(m) {
  const lines = [
    'From: ' + encHeader('発注フォーム') + ' <' + m.from + '>',
    'To: <' + m.to + '>',
    'Reply-To: <' + m.replyTo + '>',
    'Subject: ' + encHeader(m.subject),
    'Message-ID: <' + m.id.toLowerCase() + '.' + Date.now().toString(36) + '@' + m.from.split('@')[1] + '>',
    'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(m.text).replace(/(.{76})/g, '$1\r\n')
  ];
  return lines.join('\r\n');
}

function encHeader(s) {
  // ASCII だけならそのまま。日本語が混じるときだけ包む
  if (!/[^\x20-\x7E]/.test(s)) return s.replace(/[<>]/g, '');
  return '=?UTF-8?B?' + b64(s) + '?=';
}

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function jst(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate())
    + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + '（日本時間）';
}

/* ---------------- アプリへ届ける ---------------- */

/**
 * 同期サーバーの受け口へ預ける。アプリはそこを見て「発注」に出す。
 * 合鍵はこの Worker だけが持ち、発注ページのブラウザには一切渡さない。
 */
async function forward(env, o) {
  if (!env.SYNC_URL || !env.SYNC_TOKEN) throw new Error('sync not set');
  const res = await fetch(String(env.SYNC_URL).replace(/\/+$/, '') + '/v1/inbox/order', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.SYNC_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(o),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('sync ' + res.status);
}

/* ---------------- 小物 ---------------- */

/** 本文を読む。長すぎるものは途中で打ち切って null を返す */
async function readCapped(request, max) {
  const buf = await request.arrayBuffer();
  if (buf.byteLength > max) return null;
  return new TextDecoder().decode(buf);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    }
  });
}
