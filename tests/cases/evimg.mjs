/**
 * 日常の予定に貼る絵。
 *
 * 案内のはがき・会場の地図・チケットの写真は、文字に書き写すより
 * 1枚あったほうが早い。貼り付け（⌘V）・ドラッグ・ファイル選びの
 * どれでも入るようにしてある。
 *
 * 見るのは5つ。
 *  ・貼り付けた絵が、その予定に残ること
 *  ・写真は小さくしてから預かること（そのまま抱えると同期が重くなる）
 *  ・一覧の行にも小さく出て、押すと大きく見えること
 *  ・外せること
 *  ・枚数の上限を超えないこと、絵でないものは拾わないこと
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 指定の大きさの PNG を1枚こしらえて、貼り付け（または選択）に流す */
const PASTE = `(async (w, h, how) => {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  // のっぺりした一色だと JPEG が効きすぎるので、細かい模様を描く
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = 'rgb(' + ((x * 7) % 255) + ',' + ((y * 11) % 255) + ',' + ((x + y) % 255) + ')';
      g.fillRect(x, y, 4, 4);
    }
  }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const file = new File([blob], 'test.png', { type: 'image/png' });
  if (how === 'file') {
    const input = document.querySelector('.ev-drop input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const dt = new DataTransfer();
    dt.items.add(file);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
})`;

export default {
  name: '予定に貼る絵',
  async run({ base }) {
    const s = sheet('予定に貼る絵');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      const today = await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util;
        S.setCalMode('life');
        S.addEvent({ date: U.today(), title: '合同誌の打ち合わせ' });
        return U.today();
      });

      /* ---- 貼り付けで入る ---- */
      await open(page, base, '#/day/' + today);
      await page.locator('.ev-row .row-main').click();
      await page.waitForSelector('.sheet-title:has-text("日常の予定")');
      s.ok('はじめは1枚も無い', await page.locator('.ev-img').count(), 0);
      s.yes('貼り付けられると書いてある',
        (await page.locator('.ev-drop').innerText()).indexOf('貼り付け') >= 0);

      await page.evaluate(`${PASTE}(900, 600, 'paste')`);
      await page.waitForTimeout(700);
      s.ok('貼り付けた絵が1枚出る', await page.locator('.ev-img').count(), 1);

      /* ---- ファイル選びでも入る ---- */
      await page.evaluate(`${PASTE}(400, 400, 'file')`);
      await page.waitForTimeout(700);
      s.ok('ファイルからも入る', await page.locator('.ev-img').count(), 2);

      await page.locator('.sheet-foot .btn:has-text("保存")').click();
      await page.waitForTimeout(600);

      const saved = await page.evaluate(() => {
        const ev = window.DL.store.events()[0];
        return {
          枚数: (ev.images || []).length,
          形: (ev.images || []).map((r) => (r.indexOf('img:') === 0 ? '鍵' : r.slice(0, 15))),
          長さ: (ev.images || []).map((r) => r.length)
        };
      });
      s.note('しまったもの: ' + JSON.stringify(saved));
      s.ok('2枚とも残る', saved.枚数, 2);
      /* 同期をつないでいない端末では、絵そのものが入る。
         そのときも store が切り落とす 400000 字より手前に収まっていること */
      s.yes('写真は小さくしてから預かる', saved.長さ.every((n) => n > 0 && n < 380000));
      s.yes('JPEG に直してある',
        saved.形.every((f) => f === '鍵' || f.indexOf('data:image/jpeg') === 0));

      /* ---- 一覧の行にも出る ---- */
      await open(page, base, '#/day/' + today);
      s.ok('行に小さく2枚並ぶ', await page.locator('.ev-row .ev-thumb').count(), 2);
      await page.locator('.ev-row .ev-thumb').first().click();
      await page.waitForSelector('.sheet-title:has-text("画像")');
      s.ok('大きく見える', await page.locator('.ev-view img').count(), 1);
      s.yes('何枚目かが出る',
        (await page.locator('.ev-view-nav').innerText()).indexOf('1 / 2') >= 0);
      await page.locator('.ev-view-nav .btn:has-text("次")').click();
      await page.waitForTimeout(300);
      s.yes('めくれる',
        (await page.locator('.ev-view-nav').innerText()).indexOf('2 / 2') >= 0);
      await page.locator('.sheet-foot .btn:has-text("閉じる")').click();
      await page.waitForTimeout(400);
      s.yes('押しても、予定の入力までは開かない',
        (await page.locator('.sheet-title').count()) === 0);

      /* ---- 外せる ---- */
      await page.locator('.ev-row .row-main').click();
      await page.waitForSelector('.sheet-title:has-text("日常の予定")');
      await page.locator('.ev-img-x').first().click();
      await page.waitForTimeout(300);
      s.ok('その場で1枚減る', await page.locator('.ev-img').count(), 1);
      await page.locator('.sheet-foot .btn:has-text("保存")').click();
      await page.waitForTimeout(600);
      s.ok('保存しても1枚', await page.evaluate(
        () => window.DL.store.events()[0].images.length), 1);

      /* ---- 入らないもの・入れすぎ ---- */
      s.ok('絵でないものは拾わない', await page.evaluate(() => {
        const S = window.DL.store;
        const ev = S.events()[0];
        S.updateEvent(ev.id, { images: ev.images.concat(['ただの文字', '', null, 'img:xx']) });
        return S.events()[0].images.length;
      }), 1);
      s.ok('8枚で打ち止め', await page.evaluate(() => {
        const S = window.DL.store;
        const ev = S.events()[0];
        const many = [];
        for (let i = 0; i < 20; i++) many.push('img:' + String(i).padStart(32, '0'));
        S.updateEvent(ev.id, { images: many });
        return S.events()[0].images.length;
      }), 8);

      /* ---- 絵を付けていない予定は、これまでどおり ---- */
      await page.evaluate((d) => window.DL.store.addEvent({ date: d, title: '歯医者' }), today);
      await open(page, base, '#/day/' + today);
      s.ok('絵の無い予定には、並びを出さない',
        await page.locator('.ev-row:has-text("歯医者") .ev-thumbs').count(), 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
