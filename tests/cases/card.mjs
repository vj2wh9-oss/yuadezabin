/**
 * カードの決済通知。
 *
 * 1. 同じ決済（日付・時刻・支払先・金額 の4つが揃うもの）は、
 *    先に受け取ったほうだけを残して、あとから来たぶんは入れない。
 * 2. 捨てたぶんは、共有ファイルの「AMEX_OLD」フォルダへ
 *    1件1枚のテキストとして預け、あとから戻せる。
 *
 * 置き場所（R2）は、ここでは手元の覚え書きで代わりをする。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

const KEY = 'test-token-0123456789abcdefghij';   // 24文字以上あればよい

/** 共有ファイルの置き場の代わり。route で受けて、ここに溜める */
function fakeFiles() {
  const box = new Map();
  return {
    box,
    /** その page のファイル通信を、この覚え書きにつなぐ */
    async attach(page) {
      // 預かりの問い合わせ（/v1/inbox/...）は、空の返事でいなす
      await page.route(/\/v1\/(inbox|meta|state)\b/, (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: '{"items":[]}'
      }));
      await page.route(/\/v1\/files(\/|$)/, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const rest = url.pathname.replace(/^.*\/v1\/files\/?/, '');
        const head = (k) => req.headers()[k] || '';
        const ok = (b) => route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify(b)
        });

        if (!rest && req.method() === 'GET') {
          const files = [...box.values()].map((f) => ({
            id: f.id, name: f.name, folder: f.folder, size: f.body.length,
            type: 'text/plain', uploadedAt: f.uploadedAt, projectId: '', by: 'test'
          }));
          return ok({ files, total: files.length });
        }
        if (req.method() === 'PUT') {
          box.set(rest, {
            id: rest,
            name: decodeURIComponent(head('x-file-name') || rest),
            folder: decodeURIComponent(head('x-file-folder') || ''),
            body: req.postData() || '',
            uploadedAt: new Date().toISOString()
          });
          return ok({ ok: true, id: rest, size: (req.postData() || '').length });
        }
        if (req.method() === 'GET') {
          const f = box.get(rest);
          if (!f) return route.fulfill({ status: 404, body: '{"error":"not_found"}' });
          return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: f.body });
        }
        if (req.method() === 'DELETE') { box.delete(rest); return ok({ ok: true }); }
        return ok({ ok: true });
      });
    }
  };
}

/** 決済通知を1件、取り込んだことにする */
const take = (page, x) => page.evaluate((o) => window.DL.store.addCardItem(o), x);

/** いま預かっているぶん */
const inbox = (page) => page.evaluate(() => window.DL.store.cardInbox()
  .map((x) => [x.date, x.time, x.store, x.amount].join('|')));

export default {
  name: 'カードの取り込み',
  async run({ base }) {
    const s = sheet('カードの取り込み');
    const files = fakeFiles();

    await withPage(base, IPHONE, async (page, errors) => {
      await files.attach(page);
      await open(page, base);
      await page.evaluate((c) => window.DL.store.updateSync(
        { url: c.url, token: c.token, id: 'test', enabled: true }), { url: base, token: KEY });

      /* ---- 1. 同じ決済は、先に受け取ったほうだけ ---- */
      const one = { date: '2026-10-01', time: '12:34', store: 'AMAZON', amount: 3280, raw: 'ご利用' };
      s.yes('はじめの1件は入る', await take(page, one));
      s.yes('4つとも同じものは、入らない（先のぶんを残す）',
        !(await take(page, Object.assign({}, one, { raw: 'あとから来たほう' }))));
      s.ok('預かりは1件のまま', (await inbox(page)).length, 1);

      s.yes('時刻だけ違えば、別の決済として入る',
        await take(page, Object.assign({}, one, { time: '12:35' })));
      s.yes('金額だけ違えば、別の決済として入る',
        await take(page, Object.assign({}, one, { amount: 3281 })));
      s.yes('支払先だけ違えば、別の決済として入る',
        await take(page, Object.assign({}, one, { store: 'RAKUTEN' })));
      s.yes('日付だけ違えば、別の決済として入る',
        await take(page, Object.assign({}, one, { date: '2026-10-02' })));
      s.ok('ぜんぶで5件', (await inbox(page)).length, 5);

      /* ---- 2. 捨てたぶんを AMEX_OLD に預ける ---- */
      s.yes('控えの置き場が使える', await page.evaluate(() => window.DL.card.oldReady()));
      await page.evaluate(() => {
        const S = window.DL.store, C = window.DL.card;
        const x = S.cardInbox().filter((o) => o.store === 'RAKUTEN')[0];
        return C.oldSave(x).then(function () { S.removeCardItem(x.id); });
      });
      await page.waitForTimeout(200);
      s.ok('預かりから下りる', (await inbox(page)).length, 4);

      const saved = [...files.box.values()];
      s.note('預けた紙: ' + JSON.stringify(saved.map((f) => f.folder + '/' + f.name)));
      s.ok('AMEX_OLD に1枚だけ預かっている',
        saved.filter((f) => f.folder === 'AMEX_OLD').length, 1);
      const paper = saved[0];
      s.note('紙の中身:\n' + paper.body);
      s.yes('名前から日付・支払先・金額が読める',
        /^20261001_1234_RAKUTEN_3280円\.txt$/.test(paper.name));
      s.yes('中身に4つとも書いてある',
        /日付: 2026-10-01/.test(paper.body) && /時刻: 12:34/.test(paper.body)
        && /支払先: RAKUTEN/.test(paper.body) && /金額: 3280/.test(paper.body));

      /* 捨てたものは、もう一度届いても入らない */
      s.yes('捨てた決済は、また届いても入らない',
        !(await take(page, Object.assign({}, one, { store: 'RAKUTEN' }))));

      /* ---- 3. 戻す ---- */
      const back = await page.evaluate(() => window.DL.card.oldList()
        .then((l) => window.DL.card.oldRestore(l[0])));
      s.note('戻したもの: ' + JSON.stringify(back));
      s.ok('4つとも元どおり戻ってくる',
        [back.date, back.time, back.store, back.amount].join('|'),
        '2026-10-01|12:34|RAKUTEN|3280');
      const now = await inbox(page);
      s.note('戻したあとの預かり: ' + JSON.stringify(now));
      s.yes('預かりに入り直す', now.indexOf('2026-10-01|12:34|RAKUTEN|3280') >= 0);
      s.ok('預かりは5件に戻る', now.length, 5);
      s.ok('戻したら、紙のほうは片づける（2か所に残さない）',
        [...files.box.values()].filter((f) => f.folder === 'AMEX_OLD').length, 0);

      /* ---- 4. 画面から ---- */
      await open(page, base, '#/books');
      await page.waitForSelector('.docs-entry:has-text("カードの決済通知")');
      await page.click('.docs-entry:has-text("カードの決済通知")');
      await page.waitForSelector('.sheet-body');
      s.yes('「捨てたぶん」の入口がある',
        (await page.locator('.sheet-body button:has-text("捨てたぶん")').count()) === 1);
      await page.click('.sheet-body button:has-text("捨てたぶん")');
      await page.waitForSelector('.sheet-title:has-text("捨てたぶん")');
      await page.waitForTimeout(400);
      s.yes('いまは捨てたぶんが無いので、そう出る',
        /捨てたぶんはありません/.test(await page.locator('.sheet-body').last().innerText()));

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
