/**
 * PC と iPhone の同期。
 *
 * 本番と同じ sync/worker.js を手元で動かして（run.mjs が立てる）、
 * 2つのブラウザを別々の端末に見立てて確かめる。
 *
 * ここで守りたいのは2つ。
 *  ・片方で足したものが、もう片方に届くこと
 *  ・絵の無い控えで動いている端末が、相手の絵を消してしまわないこと
 */
import { sheet, withPage, open, IPHONE, PC } from '../lib/harness.mjs';

const KEY = 'test-token-0123456789abcdefghij';   // 24文字以上あればよい

/** その端末を、手元の同期サーバーにつなぐ */
const connect = (page, url) => page.evaluate((c) => {
  window.DL.store.updateSync({ url: c.url, token: c.token, id: 'test', enabled: true });
  return window.DL.sync.active();
}, { url, token: KEY });

/* 送る／受け取る。DL.sync の窓口は run() ひとつなので、
   どちらを採るかを resolve で指しておく（ふだんは画面で選ばせるところ） */
const push = (page) => page.evaluate(() => window.DL.sync.run({ silent: true, resolve: 'local' }));
const pull = (page) => page.evaluate(() => window.DL.sync.run({ silent: true, resolve: 'remote' }));

export default {
  name: 'PC と iPhone の同期',
  needsSync: true,
  async run({ base, syncBase }) {
    const s = sheet('PC と iPhone の同期');

    await withPage(base, PC, async (pc, pcErrors, { browser }) => {
      const phoneCtx = await browser.newContext(IPHONE);
      const phone = await phoneCtx.newPage();
      const phoneErrors = [];
      phone.on('pageerror', (e) => phoneErrors.push('画面のエラー: ' + e.message));

      await open(pc, base);
      await open(phone, base);

      s.yes('PC がつながる', await connect(pc, syncBase));
      s.yes('iPhone がつながる', await connect(phone, syncBase));

      /* PC で案件を1つ作って送る */
      await pc.evaluate(() => window.DL.store.createProject({
        name: '同期の検証', category: 'manga', qty: 8,
        deadline: window.DL.util.addDays(window.DL.util.today(), 20), status: 'active'
      }));
      await push(pc);
      await pull(phone);
      s.yes('PC で作った案件が、iPhone に届く',
        await phone.evaluate(() => window.DL.store.projects().some((p) => p.name === '同期の検証')));

      /* iPhone 側で直したものが、PC に戻る */
      await phone.evaluate(() => {
        const p = window.DL.store.projects().filter((x) => x.name === '同期の検証')[0];
        window.DL.store.updateProject(p.id, { name: '同期の検証（直した）' });
      });
      await push(phone);
      await pull(pc);
      s.yes('iPhone で直したものが、PC に戻る',
        await pc.evaluate(() => window.DL.store.projects().some((p) => p.name === '同期の検証（直した）')));

      /* 絵の無い控えで動いているときは、送らない。
         これを許すと、相手の端末から絵が黙って消える */
      const refused = await pc.evaluate(async () => {
        const S = window.DL.store;
        const before = S.imagesLost;
        S.imagesLost = () => true;          // 絵を見失っている端末のふり
        try {
          // 送るしかない形にして（こちらを採る）、それでも止まるかを見る
          S.createProject({ name: '送ってはいけないもの', category: 'manga', qty: 1,
            deadline: window.DL.util.addDays(window.DL.util.today(), 3), status: 'active' });
          const r = await window.DL.sync.run({ silent: true, resolve: 'local' });
          return r.status === 'error' ? 'ことわった' : 'そのまま送ってしまった（' + r.status + '）';
        } finally {
          S.imagesLost = before;
        }
      });
      s.ok('絵を見失っているときは、送らずにことわる', refused, 'ことわった');

      await phoneCtx.close();
      s.ok('画面のエラー（PC）', pcErrors, []);
      s.ok('画面のエラー（iPhone）', phoneErrors, []);
    });
    return s;
  }
};
