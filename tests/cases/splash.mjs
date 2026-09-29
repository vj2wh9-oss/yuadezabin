/**
 * 起動の一枚。
 *
 * ・ロゴ（METEO / CORE SYSTEM / 365）が3つとも出ること
 * ・はじめは METEO と 365 が合わさっていて、あとから開くこと
 * ・動きがすべて「1回で終わる」こと（v208 の電池の決まり）
 * ・幕がちゃんと片づくこと
 *
 * 「合わさってから開く」は、時計で待って測ると遅いマシンで取りこぼす。
 * 動きを止めて、こちらで時刻を指して測る。
 */
import { sheet, withPage, openRaw, IPHONE } from '../lib/harness.mjs';

/** 開く動きを止めて、その時刻での隙間を測る */
const gapAt = (page, ms) => page.evaluate((t) => {
  const open = window.document.getAnimations()
    .filter((a) => a.animationName === 'sp-open-up' || a.animationName === 'sp-open-down');
  if (open.length !== 2) return null;
  open.forEach((a) => { a.pause(); a.currentTime = t; });
  const m = document.querySelector('#splash .sp-meteo').getBoundingClientRect();
  const n = document.querySelector('#splash .sp-365').getBoundingClientRect();
  return Math.round(n.top - m.bottom);
}, ms);

export default {
  name: '起動の一枚',
  async run({ base }) {
    const s = sheet('起動の一枚');
    await withPage(base, IPHONE, async (page, errors) => {
      await openRaw(page, base);
      await page.waitForSelector('#splash .sp-meteo');

      const marks = await page.evaluate(() =>
        ['.sp-meteo', '.sp-core', '.sp-365'].map((q) => !!document.querySelector('#splash ' + q)));
      s.ok('ロゴが3つとも出ている', marks, [true, true, true]);

      /* 終わらない動きが1つでもあると、開いているあいだ電池を食い続ける */
      const anims = await page.evaluate(() => window.document.getAnimations().map((a) => ({
        name: a.animationName || '?',
        count: a.effect ? a.effect.getTiming().iterations : 1
      })));
      s.note('動き: ' + anims.map((a) => a.name + '×' + a.count).join(' / '));
      s.ok('終わらない動きが無い', anims.filter((a) => a.count === Infinity).map((a) => a.name), []);

      /* 合わさったまま留まり、そのあと開く。
         留まるのは 42%（1.16秒 の 0.49秒）まで */
      s.ok('出たては合わさっている（0.20秒）', await gapAt(page, 200), 0);
      s.ok('まだ合わさっている（0.45秒）', await gapAt(page, 450), 0);
      const open = await gapAt(page, 1160);
      s.yes('開ききると隙間ができる（' + open + 'px）', open > 20);
      s.yes('隙間は CORE SYSTEM の一行ぶんに合っている',
        Math.abs(open - (await page.evaluate(() =>
          Math.round(document.querySelector('#splash .sp-core').getBoundingClientRect().height
            + parseFloat(getComputedStyle(document.querySelector('#splash .sp-core')).marginTop) * 2)))) <= 2);

      /* 何があっても幕は開く。止めた動きを戻してから見る */
      await page.reload({ waitUntil: 'commit' });
      await page.waitForSelector('#splash');
      await page.waitForTimeout(4800);
      s.ok('幕が片づいている', await page.locator('#splash').count(), 0);
      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
