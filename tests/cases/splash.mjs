/**
 * 起動の一枚。
 *
 * ・ロゴ（METEO / CORE SYSTEM / 365）が3つとも出ること
 * ・はじめは METEO と 365 が合わさっていて、あとから開くこと
 * ・動きがすべて「1回で終わる」こと（v208 の電池の決まり）
 * ・幕がちゃんと片づくこと
 */
import { sheet, withPage, openRaw, IPHONE } from '../lib/harness.mjs';

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

      /* はじめは合わさっていて、あとから開く */
      const gap = () => page.evaluate(() => {
        const m = document.querySelector('#splash .sp-meteo');
        const n = document.querySelector('#splash .sp-365');
        if (!m || !n) return null;
        return Math.round(n.getBoundingClientRect().top - m.getBoundingClientRect().bottom);
      });
      const early = await page.evaluate(() => new Promise((r) => {
        // 出てすぐの隙間を、画面の中で測る（外から撮ると、その時間ぶんずれる）
        setTimeout(() => {
          const m = document.querySelector('#splash .sp-meteo');
          const n = document.querySelector('#splash .sp-365');
          r(m && n ? Math.round(n.getBoundingClientRect().top - m.getBoundingClientRect().bottom) : null);
        }, 200);
      }));
      s.ok('出たては METEO と 365 が合わさっている', early, 0);
      await page.waitForTimeout(1000);
      const late = await gap();
      s.yes('しばらくすると開く（いまの隙間 ' + late + 'px）', late > 20);

      /* 何があっても幕は開く */
      await page.waitForTimeout(4200);
      s.ok('幕が片づいている', await page.locator('#splash').count(), 0);
      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
