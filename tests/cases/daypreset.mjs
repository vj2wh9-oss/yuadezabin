/**
 * 1日の予定のプリセット。
 *
 * 出社・リモート・泊まり勤務の3本は、これまでコードに直書きだった。
 * 起きる時刻も仕事の終わりも変わるものなので、アプリの中で直せるようにした。
 *
 * 見るのは5つ。
 *  ・はじめの3本が入っていて、勤務に結びついていること
 *  ・設定で直せること・作れること・消せること
 *  ・直したぶんが、その日に入る中身に効くこと
 *  ・勤務の結びつきは1本まで（2本に当てると、前のぶんが外れる）
 *  ・仕事の終わりを動かすと、「勤務実績を入れて」とうながす時刻もついてくること
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 設定を開いて、プリセットの入っているところを広げる。
    開いた・閉じたは端末に覚えるので、閉じているときだけ押す */
const openSettings = async (page) => {
  await page.evaluate(async () => {
    location.hash = '#/settings';
    await new Promise((r) => setTimeout(r, 600));
  });
  const head = page.locator('.sg-head', { hasText: '作業と表示' });
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await page.waitForTimeout(300);
};

export default {
  name: '1日の予定のプリセット',
  async run({ base }) {
    const s = sheet('1日の予定のプリセット');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      /* ---- はじめの3本 ---- */
      s.ok('出社・リモート・泊まりの3本が入っている', await page.evaluate(
        () => window.DL.store.dayPresets().map((p) => p.name + '/' + p.duty)),
      ['出社の日/office', 'リモートの日/remote', '泊まり勤務の日/stay']);
      s.ok('出社の日の中身', await page.evaluate(
        () => window.DL.timeblocks.presetTextOf('dp-office')),
      '睡眠 0:00〜5:55　通勤 6:30〜8:00　仕事 8:00〜16:30　通勤 16:30〜17:45');
      s.ok('泊まりは翌日までまたぐ', await page.evaluate(
        () => window.DL.timeblocks.presetTextOf('dp-stay').indexOf('翌8:30') >= 0), true);
      s.ok('勤務から引ける', await page.evaluate(
        () => window.DL.store.dayPresetFor('remote').name), 'リモートの日');

      /* ---- 設定で直す ---- */
      await openSettings(page);
      s.ok('設定に3本並ぶ',
        await page.locator('.tpl-summary:has-text("の日")').count(), 3);

      await page.locator('.tpl-summary:has-text("リモートの日")').click();
      await page.waitForSelector('.sheet-title:has-text("プリセットを直す")');
      s.ok('帯が2つ出る', await page.locator('.sheet-body .tpl-row').count(), 2);
      // 仕事の終わりを 16:30 → 18:00 にする
      const workRow = page.locator('.sheet-body .tpl-row').nth(1);
      await workRow.locator('input').nth(2).fill('18:00');
      await workRow.locator('input').nth(2).blur();
      await page.locator('.sheet-foot .btn:has-text("保存")').click();
      await page.waitForTimeout(500);

      s.ok('直したぶんが残る', await page.evaluate(
        () => window.DL.timeblocks.presetTextOf('dp-remote')),
      '睡眠 0:00〜7:30　仕事 8:00〜18:00');
      /* ひな型だけ直して、うながす時刻が前のままだと噛み合わない。
         仕事の終わりを動かしたら、知らせもついてくること */
      s.ok('うながす時刻もついてくる', await page.evaluate(
        () => window.DL.timeblocks.remindMin('remote')), 1080);
      s.ok('ほかの勤務は動かさない', await page.evaluate(
        () => window.DL.timeblocks.remindMin('office')), 990);

      /* ---- その日に入れる ---- */
      const today = await page.evaluate(() => window.DL.util.today());
      s.ok('直したあとの中身が、その日に入る', await page.evaluate((d) => {
        window.DL.timeblocks.applyPresetId(d, 'dp-remote', true);
        return window.DL.store.timeblocks(d)
          .map((b) => b.label + window.DL.timeblocks.fmt(b.start) + '-'
            + window.DL.timeblocks.fmt(b.end));
      }, today), ['睡眠0:00-7:30', '仕事8:00-18:00']);
      s.yes('色も名前から付く', await page.evaluate((d) =>
        window.DL.store.timeblocks(d).every((b) => /^#[0-9a-f]{6}$/i.test(b.color)), today));

      /* ---- 作る ---- */
      await openSettings(page);
      await page.locator('.btn:has-text("プリセットを作る")').click();
      await page.waitForSelector('.sheet-title:has-text("プリセットを作る")');
      await page.locator('.sheet-body .field:has-text("名前") input').fill('原稿だけの日');
      await page.locator('.sheet-body .btn:has-text("時間を足す")').click();
      await page.waitForTimeout(200);
      const row = page.locator('.sheet-body .tpl-row').first();
      await row.locator('input').nth(0).fill('作業・制作');
      await row.locator('input').nth(1).fill('10:00');
      await row.locator('input').nth(1).blur();
      await row.locator('input').nth(2).fill('26:00');       // 翌2:00 まで
      await row.locator('input').nth(2).blur();
      await page.locator('.sheet-foot .btn:has-text("保存")').click();
      await page.waitForTimeout(500);

      const made = await page.evaluate(() => {
        const list = window.DL.store.dayPresets();
        const p = list[list.length - 1];
        return { n: list.length, name: p.name, duty: p.duty,
          text: window.DL.timeblocks.presetTextOf(p.id) };
      });
      s.note('作ったもの: ' + JSON.stringify(made));
      s.ok('4本になった', made.n, 4);
      s.ok('名前が付いている', made.name, '原稿だけの日');
      s.ok('勤務には結びつけていない', made.duty, '');
      s.ok('24時をまたぐ時刻も書ける', made.text, '作業・制作 10:00〜翌2:00');

      /* ---- 勤務の結びつきは1本まで ---- */
      s.ok('同じ勤務に当てると、前のぶんが外れる', await page.evaluate(() => {
        const S = window.DL.store;
        const list = S.dayPresets();
        const mine = list[list.length - 1];
        S.putDayPreset(Object.assign({}, mine, { duty: 'remote' }));
        return S.dayPresets().map((p) => p.name + '/' + p.duty);
      }), ['出社の日/office', 'リモートの日/', '泊まり勤務の日/stay', '原稿だけの日/remote']);
      s.ok('引けるのは、あとから当てたほう', await page.evaluate(
        () => window.DL.store.dayPresetFor('remote').name), '原稿だけの日');

      /* ---- 日別の画面から選べる ---- */
      await page.evaluate(async (d) => {
        window.DL.store.setTimeblocks(d, []);
        location.hash = '#/time/' + d;
        await new Promise((r) => setTimeout(r, 600));
      }, today);
      await page.locator('.btn:has-text("プリセット")').first().click();
      await page.waitForSelector('.sheet-title:has-text("プリセットを入れる")');
      s.ok('4本とも並ぶ', await page.locator('.sheet-body .card .row').count(), 4);
      await page.locator('.sheet-body .row:has-text("出社の日")').click();
      await page.waitForTimeout(500);
      s.ok('押したぶんが入る', await page.evaluate(
        (d) => window.DL.store.timeblocks(d).map((b) => b.label), today),
      ['睡眠', '通勤', '仕事', '通勤']);

      /* ---- 消す ---- */
      await openSettings(page);
      await page.locator('.tpl-summary:has-text("原稿だけの日")').click();
      await page.waitForSelector('.sheet-title:has-text("プリセットを直す")');
      await page.locator('.sheet-foot .btn:has-text("削除")').click();
      await page.locator('.sheet-foot .btn:has-text("削除")').last().click();
      await page.waitForTimeout(500);
      s.ok('消すと並びから抜ける', await page.evaluate(
        () => window.DL.store.dayPresets().map((p) => p.name)),
      ['出社の日', 'リモートの日', '泊まり勤務の日']);
      s.ok('入れてある日の予定はそのまま', await page.evaluate(
        (d) => window.DL.store.timeblocks(d).length, today), 4);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
