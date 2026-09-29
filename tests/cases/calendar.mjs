/**
 * カレンダーの見た目。
 *
 * 試しに入れ替えたので、いちばん大事なのは「戻せること」。
 * 新しい見た目は body.cal-new が付いているあいだだけ効くようにしてある。
 * 設定で「前のまま」を選ぶとクラスが外れ、元の決まりだけが残る。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 今日のマスの見え方を、いくつかの値で取る */
const todayLook = (page) => page.evaluate(() => {
  const cell = document.querySelector('.cal-cell.today');
  if (!cell) return null;
  const n = cell.querySelector('.cal-n');
  const cs = getComputedStyle(cell);
  const ns = getComputedStyle(n);
  const chip = getComputedStyle(n, '::before');
  const band = getComputedStyle(cell, '::before');   // 上辺の帯は疑似要素に付く
  return {
    マスの囲い: cs.borderTopWidth,
    上辺の帯: band.content === 'none' ? '0px' : band.borderTopWidth,
    日付の色: ns.color,
    札の傾き: chip.transform,
    札の背景: chip.backgroundColor
  };
});

export default {
  name: 'カレンダーの見た目',
  async run({ base }) {
    const s = sheet('カレンダーの見た目');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      // 今日が入っている月を開く
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-grid');

      s.yes('はじめは新しい見た目', await page.evaluate(() => document.body.classList.contains('cal-new')));
      s.ok('今日のマスがある', await page.locator('.cal-cell.today').count(), 1);

      const now = await todayLook(page);
      s.note('今日のマス: ' + JSON.stringify(now));
      s.yes('日付が傾いた札に乗っている', now && now.札の傾き !== 'none');
      s.yes('札に色が付いている', now && now.札の背景 !== 'rgba(0, 0, 0, 0)');
      s.yes('マスの上辺に太い帯が乗る（3px）', now && parseFloat(now.上辺の帯) >= 3);

      /* 今日の曜日の見出しにも印が付く */
      s.ok('今日の曜日の見出しが1つだけ光る',
        await page.locator('.cal-hd.is-today').count(), 1);

      /* 動きは必ず終わる（v208 の電池の決まり） */
      const anims = await page.evaluate(() => window.document.getAnimations()
        .filter((a) => /^cal-today/.test(a.animationName || ''))
        .map((a) => ({ n: a.animationName, c: a.effect.getTiming().iterations })));
      s.note('今日のマスの動き: ' + anims.map((a) => a.n + '×' + a.c).join(' / '));
      s.ok('終わらない動きが無い', anims.filter((a) => a.c === Infinity).map((a) => a.n), []);
      s.yes('動きが付いている', anims.length > 0);

      /* 「動き：控える」では動かない */
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: true }); window.DL.app.render(); });
      await page.waitForTimeout(300);
      s.ok('「動き：控える」では、今日のマスも動かない',
        await page.evaluate(() => window.document.getAnimations()
          .filter((a) => a.playState === 'running' && /^cal-today/.test(a.animationName || '')).length), 0);
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: false }); window.DL.app.render(); });
      await page.waitForTimeout(200);

      /* 下地に色が付いている日（締切など）は、その上に青を重ねない。
         重ねると濁って、赤とも青ともつかない色になる */
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        const pr = S.createProject({ name: '入稿するもの', category: 'manga', qty: 4,
          deadline: T, status: 'active' });
        const t = S.addTask(pr.id, { name: '入稿', unit: 'page', qty: 4 });
        S.updateTask(pr.id, t.id, { start: U.addDays(T, -2), end: T });
      });
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-cell.today');
      const due = await page.evaluate(() => {
        const c = document.querySelector('.cal-cell.today');
        const bf = getComputedStyle(c, '::before');
        return {
          締切あり: c.classList.contains('has-due'),
          かぶせの塗り: bf.backgroundColor,
          かぶせの動き: bf.animationName,
          帯の太さ: bf.borderTopWidth
        };
      });
      s.note('今日＋締切: ' + JSON.stringify(due));
      s.yes('今日に締切が重なっている', due.締切あり);
      s.ok('青の塗りを重ねない', due.かぶせの塗り, 'rgba(0, 0, 0, 0)');
      s.ok('息づかいも止める（点滅と重なって濁るため）', due.かぶせの動き, 'none');
      s.ok('そのぶん上辺の帯を太くする', due.帯の太さ, '4px');

      /* ここが肝心。「前のまま」で、元の見た目に戻ること */
      await page.evaluate(() => { window.DL.store.updateSettings({ calSkin: 'classic' }); window.DL.app.render(); });
      await page.waitForTimeout(300);
      s.yes('「前のまま」でクラスが外れる',
        !(await page.evaluate(() => document.body.classList.contains('cal-new'))));
      const old = await todayLook(page);
      s.note('戻したあと: ' + JSON.stringify(old));
      s.ok('札の傾きが無くなる', old && old.札の傾き, 'none');
      s.yes('元どおり、今日は囲い線で示される', old && parseFloat(old.マスの囲い) <= 1.5);
      s.ok('上辺の帯も消える', old && old.上辺の帯, '0px');
      s.ok('曜日の見出しの印も消える（元の組みには無い飾り）',
        await page.evaluate(() => getComputedStyle(document.querySelector('.cal-hd.is-today')).borderBottomWidth), '0px');

      /* 戻す */
      await page.evaluate(() => { window.DL.store.updateSettings({ calSkin: 'new' }); window.DL.app.render(); });
      await page.waitForTimeout(200);
      s.yes('また新しい見た目に戻せる',
        await page.evaluate(() => document.body.classList.contains('cal-new')));

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
