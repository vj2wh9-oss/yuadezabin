/**
 * Worker が OpenAI へ出す頼みかた。
 *
 * 画面は使わず、sync/worker.js をそのまま読み込んで、
 * OpenAI への問い合わせを横取りして中身を見る。
 *
 * ここで守りたいのは3つ。
 *  ・「作りたいもの」が、味つけの参考ではなく料理そのものとして伝わること
 *  ・その料理だけに要る調味料（カレールウなど）は買い物に入れると伝えること
 *  ・そのぶんなら予算を超えてよいと伝えること
 */
import { sheet } from '../lib/harness.mjs';
import worker from '../../sync/worker.js';

const KEY = 'test-token-0123456789abcdefghij';

/** KV の代わり。献立の頼みでは読み書きしないので、形だけ合わせる */
function memKV() {
  const box = new Map();
  return {
    get: async (k) => (box.has(k) ? box.get(k) : null),
    put: async (k, v) => { box.set(k, v); },
    delete: async (k) => { box.delete(k); },
    list: async () => ({ keys: [], list_complete: true })
  };
}

/** OpenAI の返りの代わり。worker は text() で受けて中を取り出す */
function fakeOpenAI(body) {
  const envelope = JSON.stringify({
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(body) }] }],
    model: 'test', usage: {}
  });
  return { ok: true, status: 200, text: async () => envelope, json: async () => JSON.parse(envelope) };
}

const MENU_BODY = {
  meals: [{ slot: 'dinner', name: 'チキンカレー', minutes: 30, dishes: [
    { role: '主菜', name: 'チキンカレー', items: [{ name: '鶏もも肉', qty: '300g' }],
      seasonings: [{ name: 'カレールウ', qty: '1/2箱' }], steps: ['煮る'] }
  ] }],
  shopping: [{ name: '鶏もも肉', qty: '300g', price: 450 }],
  total: 450, note: ''
};

/**
 * Worker に1回頼んで、OpenAI へ渡した文を返す。
 * 呼び方の突き合わせ（askMatch）も走るので、頼んだ文はぜんぶ集める。
 */
async function ask(path, payload) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse((opts && opts.body) || '{}');
    const text = ((((b.input || [])[0] || {}).content || [])[0] || {}).text || '';
    sent.push(text);
    return fakeOpenAI(sent.length === 1 ? MENU_BODY : { pairs: [] });
  };
  try {
    const res = await worker.fetch(
      new Request('https://x.test' + path, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      // KV は使わないが、つながっていないと手前で断られる
      { SYNC_TOKEN: KEY, OPENAI_API_KEY: 'sk-test', SYNC: memKV() }
    );
    return { status: res.status, prompt: sent[0] || '', all: sent };
  } finally {
    globalThis.fetch = real;
  }
}

export default {
  name: 'OpenAI への頼みかた',
  async run() {
    const s = sheet('OpenAI への頼みかた');

    /* ---- 作りたいもの ---- */
    const r = await ask('/v1/menu', {
      budget: 1200, slots: ['dinner'], servings: 1,
      want: [{ name: 'カレー', role: '主菜' }],
      // 最近「チキンカレー」を出していても、避ける側に入れてはいけない
      avoid: ['チキンカレー', '豚の生姜焼き']
    });
    s.ok('頼みが通る', r.status, 200);
    const p = r.prompt;
    s.yes('作りたい料理として伝わっている', /カレー/.test(p) && /作りたい料理/.test(p));
    s.yes('「料理そのものを作る」と言っている', /その料理そのものを作ってください/.test(p));
    s.yes('味つけの参考ではない、と断っている',
      /味つけの参考/.test(p) && /風味づけ/.test(p));
    s.yes('取り違えの例を見せている',
      /カレー風味の竜田揚げ/.test(p) || /さばのカレー風味竜田揚げ焼き/.test(p));
    s.yes('名前の付けかたまで言っている', /チキンカレー」は可/.test(p));
    s.yes('幅を広げる決まりは当てはめない、と言っている',
      /幅を広げる[^。]*当てはめないでください/.test(p));
    /* 「カレー」と字が重なる献立は、避ける側から外しておく。
       残しておくと、そこを避けようとして別の料理になる */
    s.yes('字が重なる献立は、避ける側から外す', !/チキンカレー(?!」)/.test(
      (p.split('最近出したので')[1] || '').split('\n')[0] || ''));
    s.yes('重ならない献立は、避ける側に残る', /豚の生姜焼き/.test(p));

    /* ---- その料理だけに要る調味料 ---- */
    s.yes('買い物に入れる調味料として、ルウを名指ししている',
      /カレールウ/.test(p) && /必ず買い物（shopping）に入れて/.test(p));
    s.yes('家にあるもの扱いにしない、と言っている',
      /「家にあるもの」として省いてはいけません/.test(p));
    s.yes('そのぶんなら予算を超えてよい、と言っている',
      /予算を超えてしまうときは[\s\S]*超えて構いません/.test(p));

    /* ---- 一品だけ出し直すときも、同じことを言う ---- */
    const d = await ask('/v1/menu/dish', {
      budget: 1200, slot: 'dinner', role: '主菜', old: 'さばの竜田揚げ',
      want: [{ name: 'カレー', role: '主菜' }], servings: 1
    });
    s.ok('一品の出し直しも通る', d.status, 200);
    s.yes('出し直しでも「料理そのもの」と言っている',
      /その料理そのものを作ってください/.test(d.prompt));
    s.yes('出し直しでは「違う料理に」と言わない',
      !/これとは違う料理にしてください/.test(d.prompt));
    s.yes('出し直しでも調味料のことを言っている', /カレールウ/.test(d.prompt));

    /* ---- 食材を数え直すときも、その調味料を入れてもらう ---- */
    const it = await ask('/v1/menu/items', {
      dishes: [{ name: 'チキンカレー', role: '主菜',
        seasonings: [{ name: 'カレールウ', qty: '1/2箱' }], steps: ['煮る'] }],
      servings: 1
    });
    s.ok('数え直しも通る', it.status, 200);
    s.yes('数え直しでも、その料理だけに要る調味料を入れてもらう',
      /カレールウ/.test(it.prompt) && /必ず items に入れてください/.test(it.prompt));

    /* ---- 冷蔵庫の食材は渡し、作り置きは渡さない ---- */
    const h = await ask('/v1/menu', {
      budget: 1200, slots: ['dinner'], servings: 1,
      have: [
        { name: 'ウィンナー', qty: '1袋', until: '2026-10-10' },
        { name: 'にんじん', qty: '2本' }
      ]
    });
    s.yes('冷蔵庫の食材として伝わっている',
      /冷蔵庫に次の食材があります/.test(h.prompt));
    s.yes('名前と量と期限が入っている',
      /ウィンナー（1袋）\s*2026-10-10まで/.test(h.prompt));
    s.yes('家にあるぶんは買わせない',
      /家にある食材で足りるところは、新しく買わないでください/.test(h.prompt));
    s.yes('「残り物」とは言わなくなった', !/残り物/.test(h.prompt));
    s.yes('作り置きの断り書きも出さない', !/作り置き。そのまま出せます/.test(h.prompt));

    /* 古いアプリから来た leftovers も、同じものとして読む */
    s.yes('前の呼び名でも読める', /冷蔵庫に次の食材があります/.test((await ask('/v1/menu', {
      budget: 1200, slots: ['dinner'], servings: 1,
      leftovers: [{ name: 'ひじきの煮物', qty: '1パック' }]
    })).prompt));

    /* ---- 残る一品で使っている食材は、差し替える一品に使わせない ---- */
    const k = await ask('/v1/menu/dish', {
      budget: 1200, slot: 'dinner', role: '副菜', old: 'ほうれん草のおひたし',
      keep: [{ role: '主菜', name: '鶏の照り焼き' }],
      keepItems: ['鶏もも肉', '長ねぎ'],
      servings: 1
    });
    s.ok('一品の出し直しが通る', k.status, 200);
    s.yes('残る一品の食材を挙げている',
      /残る一品で次の食材を使っています/.test(k.prompt)
        && /鶏もも肉、長ねぎ/.test(k.prompt));
    s.yes('この一品には使わせない', /この一品には使わないでください/.test(k.prompt));
    s.yes('主役は別のものに、と言っている',
      /主役になる食材は必ず別のものにしてください/.test(k.prompt));
    s.yes('調味料が重なるのは構わない、と断っている',
      /味つけ（調味料）が重なるのは構いません/.test(k.prompt));

    s.yes('食材を渡していなければ、その話はしない',
      !/残る一品で次の食材を使っています/.test((await ask('/v1/menu/dish', {
        budget: 1200, slot: 'dinner', role: '副菜', old: 'おひたし',
        keep: [{ role: '主菜', name: '鶏の照り焼き' }], servings: 1
      })).prompt));

    return s;
  }
};
