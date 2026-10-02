/**
 * 下タブ。
 *
 * 7つとも絵が入っていること。選んだ札だけが動き、
 * その動きが必ず終わること（v208 の電池の決まり）。
 * 「動き：控える（電池優先）」では、はじめから動かないこと。
 *
 * トレーニングのタブは、押した絵が跳ね終わってから黒い幕が降りること。
 * 先に幕を降ろすと、押した手ごたえが幕の裏で終わってしまう。
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
      await page.waitForTimeout(200);

      /* 名前。「トレーニング」は6字あるので、狭い端末で札からはみ出さないこと */
      s.ok('トレーニングのタブは、その名前で出ている',
        await page.$eval('.tab[data-tab="fit"] span:last-child', (n) => n.textContent),
        'トレーニング');
      const over = await page.$$eval('.tabbar .tab > span:last-child',
        (ns) => ns.filter((n) => n.scrollWidth - n.clientWidth > 0).map((n) => n.textContent));
      s.ok('どの名前も札に収まっている（切れていない）', over, []);

      /* 幕は、タブの絵が跳ね終わってから降りる。
         先に降ろすと、押した手ごたえが幕の裏で終わってしまう。
         押してから幕が出るまでを、画面の中で数える */
      await page.click('.tab[data-tab="home"]');
      await page.waitForTimeout(900);
      const when = await page.evaluate(() => new Promise((res) => {
        const t0 = performance.now();
        document.querySelector('.tab[data-tab="fit"]').click();
        const tick = () => {
          if (document.getElementById('fitIntro')) return res(Math.round(performance.now() - t0));
          if (performance.now() - t0 > 2500) return res(-1);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }));
      s.note('押してから幕が出るまで: ' + when + 'ms');
      s.yes('幕はすぐには降りない（絵が跳ねるぶんを待つ）', when >= 380);
      s.yes('待ちすぎない（1秒以内には降りる）', when > 0 && when <= 1000);
      await page.waitForSelector('.view-fit', { timeout: 6000 });
      s.yes('幕が明けたら、トレーニングの画面になっている',
        await page.evaluate(() => document.body.classList.contains('fit-theme')));

      /* 「動き：控える」では絵が跳ねないので、待たずに降ろす */
      await page.click('.tab[data-tab="home"]');
      await page.waitForTimeout(900);
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: true }); window.DL.app.render(); });
      await page.waitForTimeout(200);
      const calmWhen = await page.evaluate(() => new Promise((res) => {
        const t0 = performance.now();
        document.querySelector('.tab[data-tab="fit"]').click();
        const tick = () => {
          if (document.getElementById('fitIntro')) return res(Math.round(performance.now() - t0));
          if (performance.now() - t0 > 1200) return res(-1);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }));
      s.note('「動き：控える」のとき: ' + calmWhen + 'ms');
      s.yes('「動き：控える」では待たない（そもそも絵が動かない）',
        calmWhen === -1 || calmWhen < 200);
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: false }); });

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
