/**
 * 準備のプリセット。
 *
 * 設定でしまい、チケットの「準備」から呼び出す。
 * 逆に、チケットで組んだ並びを「プリセット保存」でしまえる。
 * 二重に足さないこと、保存を押すまで控えのほうを動かすことを見る。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

export default {
  name: '準備のプリセット',
  async run({ base }) {
    const s = sheet('準備のプリセット');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      /* 初めて開いた端末には「即売会」が1つ入っている */
      const first = await page.evaluate(() =>
        window.DL.store.prepSets().map((x) => x.name + '(' + x.items.length + ')'));
      s.ok('初めからプリセットが1つ入っている', first.length, 1);
      s.note('入っているもの: ' + first.join(' / '));

      const tid = await page.evaluate(() => window.DL.store.createTicket({
        kind: 'event', name: 'テスト即売会', date: window.DL.util.addDays(window.DL.util.today(), 60)
      }).id);
      await open(page, base, '#/ticket/' + tid);

      /* 呼び出す */
      await page.click('button:has-text("プリセットから")');
      await page.waitForSelector('.sheet-title:has-text("準備のプリセット")');
      await page.click('.sheet-body .row');
      await page.waitForTimeout(400);
      const n1 = await page.evaluate((id) => window.DL.store.getTicket(id).prep.length, tid);
      s.yes('呼び出すと、まとめて足される', n1 > 0);

      /* もう一度押しても二重にならない */
      await page.click('button:has-text("プリセットから")');
      await page.waitForSelector('.sheet-body .row');
      await page.click('.sheet-body .row');
      await page.waitForTimeout(400);
      s.ok('もう一度押しても、二重に増えない',
        await page.evaluate((id) => window.DL.store.getTicket(id).prep.length, tid), n1);

      /* チケットの並びを、そのままプリセットへ */
      await page.evaluate((id) => {
        window.DL.store.putTicketPrep(id, { name: 'テスト用の持ち物' });
        // 済みの印は持っていかないことを見るため、1つ消し込んでおく
        const t = window.DL.store.getTicket(id);
        window.DL.store.toggleTicketPrep(id, t.prep[0].id);
      }, tid);
      await open(page, base, '#/ticket/' + tid);
      await page.click('button:has-text("プリセット保存")');
      await page.waitForSelector('.sheet-title:has-text("プリセット保存")');
      s.ok('名前にはチケット名が入っている',
        await page.inputValue('.sheet-body .field .input'), 'テスト即売会');
      await page.click('.sheet-foot button:has-text("保存")');
      await page.waitForTimeout(400);
      const saved = await page.evaluate(() =>
        window.DL.store.prepSets().filter((x) => x.name === 'テスト即売会')[0]);
      s.yes('プリセットとしてしまわれた', !!saved);
      s.ok('しまった中身は、チケットの並びと同じ数', saved.items.length, n1 + 1);
      s.yes('しまった中身に、あとから足したものが入っている',
        saved.items.indexOf('テスト用の持ち物') >= 0);

      /* 同じ名前でもう一度 → 聞いてから差し替え。増やさない */
      await page.click('button:has-text("プリセット保存")');
      await page.waitForSelector('.sheet-title:has-text("プリセット保存")');
      await page.click('.sheet-foot button:has-text("保存")');
      await page.waitForTimeout(300);
      s.yes('同じ名前のときは、差し替えるか聞いてくる',
        (await page.locator('text=中身を差し替えますか').count()) > 0);
      await page.click('button:has-text("差し替える")');
      await page.waitForTimeout(400);
      s.ok('差し替えても、同じ名前が2つに増えない',
        await page.evaluate(() => window.DL.store.prepSets().filter((x) => x.name === 'テスト即売会').length), 1);

      /* 設定で直す。保存を押すまでは控えのほうを動かす */
      await open(page, base, '#/settings');
      await page.click('text=作業と表示');
      await page.waitForSelector('.tpl-summary:has-text("テスト即売会")');
      const before = await page.evaluate(() =>
        window.DL.store.prepSets().filter((x) => x.name === 'テスト即売会')[0].items.slice(0, 2));
      await page.click('.tpl-summary:has-text("テスト即売会")');
      await page.waitForSelector('.sheet-title:has-text("プリセットを直す")');
      await page.click('.sheet-body .tk-prep-row:nth-child(2) button[aria-label$="を上へ"]');
      await page.click('.sheet-foot button:has-text("キャンセル")');
      await page.waitForTimeout(300);
      s.ok('キャンセルすれば、並べ替えは残らない',
        await page.evaluate(() =>
          window.DL.store.prepSets().filter((x) => x.name === 'テスト即売会')[0].items.slice(0, 2)), before);

      /* 打ちかけで「足す」を押していないぶんも、保存で拾う */
      await page.click('button:has-text("プリセットを追加")');
      await page.waitForSelector('.sheet-title:has-text("プリセットを追加")');
      await page.fill('.sheet-body .field .input', '通販の発送');
      await page.fill('.sheet-body .tk-prep-add .input', '封筒');
      await page.click('.sheet-body .tk-prep-add button:has-text("足す")');
      await page.fill('.sheet-body .tk-prep-add .input', '宛名シール');   // 足すを押さない
      await page.click('.sheet-foot button:has-text("保存")');
      await page.waitForTimeout(400);
      const made = await page.evaluate(() =>
        window.DL.store.prepSets().filter((x) => x.name === '通販の発送')[0]);
      s.ok('打ちかけのぶんも、保存で拾う', made.items, ['封筒', '宛名シール']);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
