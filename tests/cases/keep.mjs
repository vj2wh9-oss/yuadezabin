/**
 * 作り置きの日もちを見てもらう受け口（/v1/keep）。
 *
 * 画面は使わず、sync/worker.js をそのまま読み込んで確かめる。
 *
 * 食べものの話なので、守りたいのは2つ。
 *  ・迷ったら短いほうへ、と頼んでいること（腹をこわすより早く食べるほうがいい）
 *  ・返ってきた日数が、そのまま使える形に整っていること
 */
import { sheet } from '../lib/harness.mjs';
import worker from '../../sync/worker.js';

const KEY = 'test-token-0123456789abcdefghij';

function memKV() {
  const box = new Map();
  return {
    get: async (k) => (box.has(k) ? box.get(k) : null),
    put: async (k, v) => { box.set(k, v); },
    delete: async (k) => { box.delete(k); },
    list: async () => ({ keys: [], list_complete: true })
  };
}

function fakeOpenAI(body) {
  const envelope = JSON.stringify({
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(body) }] }],
    model: 'test', usage: {}
  });
  return { ok: true, status: 200, text: async () => envelope, json: async () => JSON.parse(envelope) };
}

/** 1回頼んで、OpenAI へ渡した文と、返ってきた中身を見る */
async function ask(payload, reply) {
  let prompt = '';
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse((opts && opts.body) || '{}');
    prompt = ((((b.input || [])[0] || {}).content || [])[0] || {}).text || '';
    return fakeOpenAI(reply || { days: 3, note: '取り分けて小分けに' });
  };
  try {
    const res = await worker.fetch(
      new Request('https://x.test/v1/keep', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      { SYNC_TOKEN: KEY, OPENAI_API_KEY: 'sk-test', SYNC: memKV() }
    );
    const body = await res.json().catch(() => ({}));
    return { status: res.status, prompt, body };
  } finally {
    globalThis.fetch = real;
  }
}

export default {
  name: '作り置きの日もち',
  async run() {
    const s = sheet('作り置きの日もち');

    /* ---- 頼みかた ---- */
    const r = await ask({ name: 'ポテトサラダ', where: 'fridge', memo: 'ゆで卵入り' });
    s.ok('頼みが通る', r.status, 200);
    const p = r.prompt;
    s.yes('料理名が入っている', /ポテトサラダ/.test(p));
    s.yes('置き場が伝わっている', /冷蔵庫/.test(p));
    s.yes('メモも渡している', /ゆで卵入り/.test(p));
    s.yes('作った日は数えない、と断っている', /作った日は数えない/.test(p));
    s.yes('迷ったら短いほうへ、と頼んでいる', /迷ったら短いほう/.test(p));
    s.yes('傷みやすいものの例を挙げている', /芋のサラダ/.test(p) && /和え物/.test(p));
    s.yes('前置きを書かせない', /言い訳や前置きは書かないでください/.test(p));

    /* ---- 置き場で言い分ける ---- */
    s.yes('冷凍なら、そう伝える',
      /冷凍庫/.test((await ask({ name: 'ハンバーグ', where: 'freezer' })).prompt));
    s.yes('常温なら、そう伝える',
      /常温/.test((await ask({ name: 'おにぎり', where: 'room' })).prompt));
    s.yes('知らない置き場は冷蔵として扱う',
      /冷蔵庫/.test((await ask({ name: 'おでん', where: 'ふろしき' })).prompt));

    /* ---- 返ってきたものの整えかた ---- */
    s.ok('日数と、ひとことが返る',
      (await ask({ name: '筑前煮' }, { days: 4, note: 'よく火を通してから' })).body.data,
      { days: 4, note: 'よく火を通してから' });
    s.ok('小数は丸める',
      (await ask({ name: '煮物' }, { days: 3.6, note: '' })).body.data.days, 4);
    s.ok('0日は1日まで上げる（0日は使えない）',
      (await ask({ name: '刺身' }, { days: 0, note: '' })).body.data.days, 1);
    s.ok('長すぎるものは1年で止める',
      (await ask({ name: '氷' }, { days: 9999, note: '' })).body.data.days, 365);

    /* ---- 買ってきた食材 ----
       作り置きだけでなく、食材の日もちも見てもらう。
       食材は「封を開けたか」で持ちがまるで変わる */
    const f = await ask({ name: 'ウィンナー', kind: 'food', where: 'fridge', opened: true });
    s.yes('食材として聞いている', /買ってきた食材の日もち/.test(f.prompt));
    s.yes('食材の名前が入っている', /ウィンナー/.test(f.prompt));
    s.yes('開けてあることが伝わる', /封は開けてあります/.test(f.prompt));
    s.yes('開けたものは短く、と頼んでいる', /未開封よりずっと短く/.test(f.prompt));
    s.yes('しまった日は数えない', /しまった日は数えない/.test(f.prompt));
    s.yes('傷みやすい食材の例を挙げている', /ひき肉/.test(f.prompt) && /もやし/.test(f.prompt));

    const g = await ask({ name: '鶏むね肉', kind: 'food', where: 'freezer' });
    s.yes('未開封なら、そう伝える', /封は開けていません/.test(g.prompt));
    s.yes('冷凍なら、そう伝える', /冷凍庫/.test(g.prompt));

    s.yes('作り置きのほうは、これまでどおり',
      /家庭で作った料理の日もち/.test((await ask({ name: '肉じゃが' })).prompt));
    s.yes('知らない種別は、作り置きとして扱う',
      /家庭で作った料理の日もち/.test((await ask({ name: '肉じゃが', kind: 'たべもの' })).prompt));

    /* ---- 断るところ ---- */
    s.ok('料理名が無ければ断る', (await ask({ name: '   ' })).status, 400);
    s.ok('GET では受けない', await (async () => {
      const res = await worker.fetch(
        new Request('https://x.test/v1/keep', {
          headers: { authorization: 'Bearer ' + KEY }
        }), { SYNC_TOKEN: KEY, OPENAI_API_KEY: 'sk-test', SYNC: memKV() });
      return res.status;
    })(), 404);
    s.ok('鍵が無ければ、そう言う', await (async () => {
      const res = await worker.fetch(
        new Request('https://x.test/v1/keep', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'カレー' })
        }), { SYNC_TOKEN: KEY, SYNC: memKV() });
      return res.status;
    })(), 503);

    return s;
  }
};
