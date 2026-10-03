/**
 * イベント当日用サイト（だてメテオ）の受け口。
 *
 * 画面は使わず、sync/worker.js をそのまま読み込んで確かめる。
 *
 * ここで守りたいのは2つ。
 *  ・会場の端末には、券と頒布物を読むことと在庫を預けることしかさせない
 *  ・本物の合鍵でしか触れないところに、この合鍵では手が届かない
 */
import { sheet } from '../lib/harness.mjs';
import worker from '../../sync/worker.js';

const TOKEN = 'test-token-0123456789abcdefghij';

/** KV の代わり。文字でも JSON でも返せるようにしておく */
function memKV() {
  const box = new Map();
  return {
    box,
    get: async (k, how) => {
      if (!box.has(k)) return null;
      const v = box.get(k);
      return how === 'json' ? JSON.parse(v) : v;
    },
    put: async (k, v) => { box.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    delete: async (k) => { box.delete(k); },
    list: async () => ({ keys: [], list_complete: true })
  };
}

/* 持ち主の控え。即売会の券が1枚と、頒布物が3つ */
const STATE = {
  settings: {
    tickets: [
      { id: 't1', kind: 'event', name: '冬の即売会', date: '2026-12-30',
        venue: '東京ビッグサイト', space: '東4 あ-12a', logo: 'img:' + 'a'.repeat(16),
        stock: [
          { id: 'r1', itemId: 'i1', bring: 50, back: null },
          { id: 'r2', itemId: 'i2', bring: 20, back: null }
        ] },
      // 仕事の券は、イベント用サイトには出さない
      { id: 't2', kind: 'work', name: 'B社の表紙', date: '2026-11-10', stock: [] }
    ],
    items: [
      { id: 'i1', title: '新刊', kind: 'book', price: 800, cover: 'img:' + 'b'.repeat(16) },
      { id: 'i2', title: '既刊', kind: 'book', price: 600, cover: '' },
      { id: 'i3', title: 'アクリルキーホルダー', kind: 'goods', price: 500, cover: '' },
      { id: 'i4', title: '完売した本', kind: 'book', price: 500, cover: '', archived: true }
    ],
    // ここには手が届かないこと（合鍵で state が漏れない）を見るための目印
    sync: { token: 'ひみつ' }
  },
  projects: [{ id: 'p1', title: 'ひみつの案件' }]
};

async function hit(env, path, opts = {}) {
  const res = await worker.fetch(new Request('https://x.test' + path, {
    method: opts.method || 'GET',
    headers: Object.assign(
      opts.token ? { authorization: 'Bearer ' + opts.token } : {},
      opts.body ? { 'content-type': 'application/json' } : {}
    ),
    body: opts.body || null
  }), env);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = { raw: text.slice(0, 80) }; }
  return { status: res.status, body };
}

export default {
  name: 'イベント当日用サイトの受け口',
  async run() {
    const s = sheet('イベント当日用サイトの受け口');
    const SYNC = memKV();
    const env = { SYNC_TOKEN: TOKEN, SYNC };

    // 持ち主の控えを置く（アプリが同期した状態）
    const id = (await hit(env, '/v1/meta', { token: TOKEN })).status === 200
      ? [...SYNC.box.keys()] : [];
    await hit(env, '/v1/state', {
      token: TOKEN, method: 'PUT', body: JSON.stringify({ rev: 0, data: STATE })
    });
    s.yes('持ち主の控えが置けた',
      [...SYNC.box.keys()].some((k) => k.indexOf('state:') === 0));

    /* ---- 合鍵 ---- */
    const made = await hit(env, '/v1/event/key', { token: TOKEN, method: 'POST' });
    s.ok('合鍵が作れる', made.status, 200);
    const k = made.body.key;
    s.yes('32桁の合鍵', /^[0-9a-f]{32}$/.test(String(k)));
    s.ok('作った合鍵は読み返せる',
      (await hit(env, '/v1/event/key', { token: TOKEN })).body.key, k);

    /* ---- 券の一覧 ---- */
    const list = await hit(env, '/v1/event/list?k=' + k);
    s.ok('合鍵だけで一覧が読める', list.status, 200);
    s.ok('出るのは即売会の券だけ',
      (list.body.events || []).map((x) => x.name), ['冬の即売会']);
    const one0 = (list.body.events || [])[0] || {};
    s.ok('会場で要るものが入っている',
      [one0.id, one0.date, one0.venue, one0.space],
      ['t1', '2026-12-30', '東京ビッグサイト', '東4 あ-12a']);
    s.yes('ロゴの指し先も渡す（画像付きで出せる）', /^img:/.test(one0.logo));

    /* ---- その券の頒布物 ---- */
    const one = await hit(env, '/v1/event/one?k=' + k + '&id=t1');
    s.ok('券の中身が読める', one.status, 200);
    s.ok('持っていく頒布物が並ぶ',
      (one.body.lines || []).map((x) => x.title + ':' + x.bring), ['新刊:50', '既刊:20']);
    s.yes('値段と表紙も渡す',
      (one.body.lines || []).some((x) => x.price === 800 && /^img:/.test(x.cover)));
    s.ok('券に入っていない頒布物は、足せるぶんとして渡す',
      (one.body.more || []).map((x) => x.title), ['アクリルキーホルダー']);
    s.yes('しまったもの（完売）は出さない',
      !(one.body.more || []).some((x) => x.title === '完売した本'));
    s.ok('無い券は 404',
      (await hit(env, '/v1/event/one?k=' + k + '&id=t9')).status, 404);
    s.ok('仕事の券は、この合鍵からは見えない',
      (await hit(env, '/v1/event/one?k=' + k + '&id=t2')).status, 404);

    /* ---- 持ちものが漏れていないこと ---- */
    const dump = JSON.stringify(list.body) + JSON.stringify(one.body);
    s.yes('合鍵も案件も混ざっていない',
      dump.indexOf('ひみつ') < 0 && dump.indexOf('projects') < 0);

    /* ---- 在庫を預ける ---- */
    const sent = await hit(env, '/v1/event/close?k=' + k, {
      method: 'POST',
      body: JSON.stringify({
        ticketId: 't1', ticketName: '冬の即売会',
        lines: [
          { itemId: 'i1', title: '新刊', bring: 50, back: 12 },
          { itemId: 'i3', title: 'アクリルキーホルダー', bring: 30, back: 5 }
        ]
      })
    });
    s.ok('在庫が預けられる', sent.status, 200);

    const box = await hit(env, '/v1/inbox/events', { token: TOKEN });
    s.ok('持ち主が取りに行ける', box.status, 200);
    s.ok('1件 預かっている', (box.body.items || []).length, 1);
    const got = (box.body.items || [])[0] || {};
    s.ok('どの券のぶんか分かる', got.ticketId, 't1');
    s.ok('数えたぶんがそのまま入っている',
      (got.lines || []).map((x) => x.itemId + ':' + x.bring + '/' + x.back),
      ['i1:50/12', 'i3:30/5']);

    s.ok('取り込んだら片づけられる',
      (await hit(env, '/v1/inbox/events', {
        token: TOKEN, method: 'DELETE', body: JSON.stringify({ ids: [got.id] })
      })).body.left, 0);

    /* ---- できないこと ---- */
    s.ok('合鍵では、持ちものぜんぶは読めない',
      (await hit(env, '/v1/state?k=' + k)).status, 401);
    s.ok('合鍵では、預かり箱も読めない',
      (await hit(env, '/v1/inbox/events?k=' + k)).status, 401);
    s.ok('合鍵では、合鍵そのものも作り直せない',
      (await hit(env, '/v1/event/key?k=' + k, { method: 'POST' })).status, 401);
    s.ok('違う合鍵は断る',
      (await hit(env, '/v1/event/list?k=' + 'f'.repeat(32))).status, 401);
    s.ok('合鍵が無ければ断る', (await hit(env, '/v1/event/list')).status, 401);

    /* ---- 捨てる ---- */
    s.ok('合鍵が捨てられる',
      (await hit(env, '/v1/event/key', { token: TOKEN, method: 'DELETE' })).body.key, null);
    s.ok('捨てた合鍵は、もう通らない',
      (await hit(env, '/v1/event/list?k=' + k)).status, 401);

    return s;
  }
};
