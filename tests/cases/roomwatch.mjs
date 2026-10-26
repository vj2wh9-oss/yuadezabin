/**
 * ROOM RESERVE の1時間ごとの見張り。
 *
 * 向こうは人と共有の予定表なので、こちらが見ていないうちに動く。
 * アプリは閉じているあいだ動けないので、見に行くのは同期サーバーの役目。
 *
 * 画面は使わず、sync/worker.js をそのまま読み込み、
 * 向こうへの問い合わせとメールの送り口を横取りして中を見る。
 * ※ここで本物のメールは1通も出さない（fetch を差し替えてある）。
 *
 * 見るのは6つ。
 *  ・はじめの1回は「いまの姿」を控えるだけで、知らせないこと
 *  ・足された・変わった・取り消されたを見分けること
 *  ・1時間に1回しか見に行かないこと
 *  ・変わったときだけメールを出すこと（宛先が無ければ出さないこと）
 *  ・溜まったものをアプリが取ってこられること、片づけられること
 *  ・メールの出し口が無くても、ホームに出すぶんは溜まること
 */
import { sheet } from '../lib/harness.mjs';
import worker from '../../sync/worker.js';

const KEY = 'test-token-0123456789abcdefghij';
const ROOM = 'https://room-test.vercel.app/c/abc123';

/** KV の代わり。頭が同じキーを並べられるようにしておく（Cron が使う） */
function memKV() {
  const box = new Map();
  return {
    get: async (k, t) => {
      const v = box.get(k);
      if (v === undefined) return null;
      return t === 'json' ? JSON.parse(v) : v;
    },
    put: async (k, v) => { box.set(k, String(v)); },
    delete: async (k) => { box.delete(k); },
    list: async ({ prefix } = {}) => ({
      keys: [...box.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort()
        .map((name) => ({ name })),
      list_complete: true
    })
  };
}

/** 向こうの予定表と、メールの送り口を横取りする */
function stub(state) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String((input && input.url) || input);
    if (url.includes('/api/rooms/')) {
      state.hits++;
      if (state.down) return { ok: false, status: 503, text: async () => 'down' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ events: state.events }) };
    }
    if (url.includes('api.resend.com')) {
      state.mails.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, text: async () => '{}' };
    }
    throw new Error('外へ出ようとしました: ' + url);
  };
  return () => { globalThis.fetch = real; };
}

const call = (env, path, opts = {}) => worker.fetch(new Request(
  'https://x.test' + path,
  {
    method: opts.method || 'GET',
    headers: Object.assign({ authorization: 'Bearer ' + KEY },
      opts.body ? { 'content-type': 'application/json' } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }
), env, { waitUntil() {} }).then(async (r) => ({ status: r.status, body: await r.json() }));

const cron = (env) => {
  const waits = [];
  return worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() }, env,
    { waitUntil: (p) => waits.push(p) }).then(() => Promise.all(waits));
};

/** 向こうの予定1件 */
const ev = (id, date, start, min, extra = {}) =>
  Object.assign({ id, kind: 'normal', date, startTime: start, durationMin: min }, extra);

export default {
  name: 'ROOM RESERVE の見張り',
  async run() {
    const s = sheet('ROOM RESERVE の見張り');
    const state = {
      hits: 0, mails: [], down: false,
      events: [ev('a1', '2026-11-02', '13:00', 120), ev('a2', '2026-11-03', '09:00', 0)]
    };
    const undo = stub(state);
    try {
      /* メールの出し口がある形（Resend）で始める。
         本物の API には出ない——上で fetch を横取りしてある */
      const env = { SYNC: memKV(), RESEND_KEY: 'test-key', MAIL_FROM: 'bot@example.com' };

      /* ---- 登録 ---- */
      const bad = await call(env, '/v1/roomwatch', {
        method: 'PUT', body: { base: 'https://evil.example.com', room: 'abc123' }
      });
      s.ok('よその置き場には見に行かない', bad.body.error, 'base_not_allowed');
      const badMail = await call(env, '/v1/roomwatch', {
        method: 'PUT', body: { base: 'https://room-test.vercel.app', room: 'abc123', email: 'ほげ' }
      });
      s.ok('形になっていない宛先は断る', badMail.body.error, 'bad_email');

      const put = await call(env, '/v1/roomwatch', {
        method: 'PUT',
        body: {
          base: 'https://room-test.vercel.app', room: 'abc123',
          email: 'watcher@example.com', enabled: true
        }
      });
      s.ok('登録できる', put.body.ok, true);
      s.ok('メールの出し口はある', put.body.mailReady, true);

      const got0 = await call(env, '/v1/roomwatch');
      s.ok('宛先そのものは返さない', got0.body.email, undefined);
      s.ok('控えてあることだけ分かる', got0.body.mail, true);

      /* ---- はじめの1回は、控えるだけ ---- */
      let r = await call(env, '/v1/roomwatch/run', { method: 'POST' });
      s.ok('1回目は「はじめて」', r.body.first, true);
      s.ok('そのときは知らせない', r.body.changed, 0);
      s.ok('いまの姿は控える', r.body.total, 2);
      s.ok('メールは出していない', state.mails.length, 0);

      /* ---- 変わっていなければ、何も起きない ---- */
      r = await call(env, '/v1/roomwatch/run', { method: 'POST' });
      s.ok('同じなら変更なし', r.body.changed, 0);
      s.ok('ここでもメールは出さない', state.mails.length, 0);

      /* ---- 足された・変わった・取り消された ---- */
      state.events = [
        ev('a1', '2026-11-02', '15:00', 120),                       // 時刻が動いた
        ev('a3', '2026-11-05', '10:00', 60, { homeStatus: 'ng' })   // 足された
        // a2 は向こうから消えた
      ];
      r = await call(env, '/v1/roomwatch/run', { method: 'POST' });
      s.ok('3つとも拾う', r.body.changed, 3);
      s.note('拾ったもの: ' + r.body.lines.join(' ／ '));
      s.yes('時刻が動いたことが書いてある',
        r.body.lines.some((x) => x.startsWith('変更') && x.includes('13:00') && x.includes('15:00')));
      s.yes('足されたぶんが書いてある',
        r.body.lines.some((x) => x.startsWith('追加') && x.includes('2026-11-05') && x.includes('在宅不可')));
      s.yes('取り消されたぶんが書いてある',
        r.body.lines.some((x) => x.startsWith('取消') && x.includes('2026-11-03')));

      /* ---- メール ---- */
      s.ok('メールを1通出した', state.mails.length, 1);
      const mail = state.mails[0];
      s.ok('宛先は登録したところ', mail.to, ['watcher@example.com']);
      s.yes('題に件数が入っている', /ROOM RESERVE の予定が変わりました（3件）/.test(mail.subject));
      s.yes('本文に中身が並ぶ', mail.text.includes('2026-11-05') && mail.text.includes('取消'));
      s.yes('取り込みのしかたも書いてある', mail.text.includes('取り込む'));

      /* ---- アプリが取ってくる・片づける ---- */
      let got = await call(env, '/v1/roomwatch');
      s.ok('溜まっている数', got.body.changes.length, 3);
      s.yes('いつ変わったかも分かる', !!got.body.changedAt && !!got.body.mailedAt);
      await call(env, '/v1/roomwatch/seen', { method: 'POST' });
      got = await call(env, '/v1/roomwatch');
      s.ok('読んだことにすると空になる', got.body.changes.length, 0);
      s.yes('控えた姿までは消さない', got.body.count === 2);

      /* ---- 1時間に1回 ---- */
      const before = state.hits;
      await cron(env);
      s.ok('Cron で1回だけ見に行く', state.hits, before + 1);
      await cron(env);
      await cron(env);
      s.ok('同じ時間のうちは、もう見に行かない', state.hits, before + 1);

      /* ---- 見に行けなかったとき ---- */
      state.down = true;
      r = await call(env, '/v1/roomwatch/run', { method: 'POST' });
      s.ok('つながらなければ、そう残す', r.body.ok, false);
      got = await call(env, '/v1/roomwatch');
      s.yes('わけも残る', !got.body.lastOk && got.body.why.includes('503'));
      state.down = false;
      /* つながらなかったからといって、控えてある姿を捨てない
         （捨てると、次につながったとき「はじめて」に戻り、
           そのあと全部がもう一度「追加」として知らされてしまう） */
      r = await call(env, '/v1/roomwatch/run', { method: 'POST' });
      s.ok('戻っても「はじめて」には戻らない', r.body.first, false);
      s.ok('全部が「追加」にはならない', r.body.changed, 0);

      /* ---- 切ってあるときは動かない ---- */
      await call(env, '/v1/roomwatch', { method: 'PUT', body: { enabled: false } });
      const off = state.hits;
      r = await call(env, '/v1/roomwatch/run', { method: 'POST' });
      s.ok('切ってあれば見に行かない', state.hits, off);
      s.ok('そう返す', r.body.why, 'off');

      /* ---- 宛先が無くても、ホームに出すぶんは溜まる ---- */
      const env2 = { SYNC: memKV() };     // メールの出し口そのものが無い
      await call(env2, '/v1/roomwatch', {
        method: 'PUT',
        body: { base: 'https://room-test.vercel.app', room: 'abc123', enabled: true }
      });
      const chk = await call(env2, '/v1/roomwatch');
      s.ok('出し口が無いことが分かる', chk.body.mailReady, false);
      await call(env2, '/v1/roomwatch/run', { method: 'POST' });   // はじめの控え
      state.events = state.events.concat([ev('a9', '2026-11-09', '20:00', 30)]);
      const mailsBefore = state.mails.length;
      r = await call(env2, '/v1/roomwatch/run', { method: 'POST' });
      s.ok('変更はちゃんと拾う', r.body.changed, 1);
      s.ok('メールは出さない', r.body.mailed, false);
      s.ok('本当に1通も増えていない', state.mails.length, mailsBefore);
      const got2 = await call(env2, '/v1/roomwatch');
      s.ok('ホームに出すぶんは溜まっている', got2.body.changes.length, 1);

      /* ---- /health にも出す ---- */
      const h = await (await worker.fetch(new Request('https://x.test/health'), env,
        { waitUntil() {} })).json();
      s.ok('メールの支度があるかを出す', h.bindings.mail, true);
      s.yes('受け口の一覧にも載せる', h.endpoints.includes('/v1/roomwatch'));
    } finally {
      undo();
    }
    return s;
  }
};
