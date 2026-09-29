/**
 * 下タブ。
 *
 * 7つとも絵が入っていること。選んだ札だけが動き、
 * その動きが必ず終わること（v208 の電池の決まり）。
 * 「動き：控える（電池優先）」では、はじめから動かないこと。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

const TABS = ['home', 'calendar', 'projects', 'sales', 'books', 'fit', 'files'];

export default {
  name: '下タブ',
  async run({ base }) {
    const s = sheet('下タブ');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      await page.waitForSelector('.tabbar .tab .tabicon svg');

      const info = await page.$$eval('.tabbar .tab', (ts) => ts.map((t) => ({
        tab: t.dataset.tab,
        icon: t.querySelector('.tabicon') && t.querySelector('.tabicon').dataset.icon,
        parts: t.querySelector('.tabicon svg') ? t.querySelector('.tabicon svg').children.length : 0
      })));
      s.ok('7つある', info.length, 7);
      s.ok('並びが変わっていない', info.map((x) => x.tab), TABS);
      s.ok('7つとも絵が入っている', info.filter((x) => x.parts > 0).length, 7);

      for (const tab of TABS) {
        await page.click('.tab[data-tab="' + tab + '"]');
        await page.waitForSelector('.tab[data-tab="' + tab + '"].on');
        await page.waitForTimeout(1200);
        const left = await page.evaluate(() => window.document.getAnimations()
          .filter((a) => a.playState === 'running' && a.effect && a.effect.target
            && a.effect.target.closest && a.effect.target.closest('.tabbar')).length);
        s.ok(tab + ' を選んだあと、1.2秒で動きが残らない', left, 0);
      }

      /* 「動き：控える」では、はじめから動かない */
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: true }); window.DL.app.render(); });
      await page.waitForTimeout(300);
      await page.click('.tab[data-tab="home"]');
      await page.click('.tab[data-tab="sales"]');
      await page.waitForTimeout(80);
      s.ok('「動き：控える」では、タブは動かない',
        await page.evaluate(() => window.document.getAnimations()
          .filter((a) => a.playState === 'running' && a.effect && a.effect.target
            && a.effect.target.closest && a.effect.target.closest('.tabbar')).length), 0);
      await page.evaluate(() => window.DL.store.updateSettings({ calm: false }));

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
