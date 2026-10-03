/**
 * 今日の予定の円グラフ。
 *
 * 円の下は空いているので、その両隅に前後の日へのボタンを置いた。
 * 指で左右になぞっても移れるが、それと分かる掴みどころが要る。
 *
 * 見るのは3つ。
 *  ・左下と右下にあり、押すと前の日・次の日へ移ること
 *  ・いま見ている画面のまま移ること（日別なら日別、予定なら予定）
 *  ・まわりに並ぶ予定の名前と重ならないこと
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 1時間おきに、びっしり予定を入れる（名前がいちばん多く出る形） */
const seed = (page, n) => page.evaluate((cnt) => {
  const S = window.DL.store, U = window.DL.util, t = U.today();
  for (let h = 0; h < cnt; h++) {
    S.putTimeblock(t, { label: 'よてい' + h, start: h * 60, end: h * 60 + 55 });
  }
  return t;
}, n);

/** ボタンの置き場所。枠の左下・右下からの距離で見る */
const hops = (page) => page.evaluate(() => {
  const wrap = document.querySelector('.tp-pie-wrap');
  if (!wrap) return null;
  const w = wrap.getBoundingClientRect();
  return [...wrap.querySelectorAll('.tp-hop')].map((n) => {
    const r = n.getBoundingClientRect();
    return {
      どちら: n.classList.contains('prev') ? '前' : '次',
      行き先: n.getAttribute('href'),
      読み: n.getAttribute('aria-label'),
      左から: Math.round(r.left - w.left),
      右から: Math.round(w.right - r.right),
      下から: Math.round(w.bottom - r.bottom),
      押せる幅: Math.round(r.width),
      押せる高さ: Math.round(r.height)
    };
  });
});

export default {
  name: '円グラフの日めくり',
  async run({ base }) {
    const s = sheet('円グラフの日めくり');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      const T = await seed(page, 24);
      const YDAY = await page.evaluate((t) => window.DL.util.addDays(t, -1), T);
      const TMRW = await page.evaluate((t) => window.DL.util.addDays(t, 1), T);

      /* ---- 今日の予定の画面 ---- */
      await open(page, base, '#/time/' + T);
      await page.waitForSelector('.tp-pie-wrap');
      const h = await hops(page);
      s.note('ボタン: ' + JSON.stringify(h));
      s.ok('2つある', h && h.length, 2);
      s.ok('左下と右下', h && h.map((x) => x.どちら), ['前', '次']);
      s.yes('どちらも下に付いている', h.every((x) => x.下から <= 1));
      s.ok('左のは左端', h[0].左から, 10);
      s.ok('右のは右端', h[1].右から, 10);
      s.yes('指で押せる大きさがある（36px 以上）',
        h.every((x) => x.押せる幅 >= 36 && x.押せる高さ >= 36));
      s.ok('前の日へ行く', h[0].行き先, '#/time/' + YDAY);
      s.ok('次の日へ行く', h[1].行き先, '#/time/' + TMRW);
      s.yes('読み上げに、どの日かが入っている', /前の日/.test(h[0].読み) && /次の日/.test(h[1].読み));

      /* まわりに並ぶ名前と重ならないこと（24件でもぶつからない） */
      const lap = await page.evaluate(() => {
        const hit = (a, b) => !(a.right <= b.left || b.right <= a.left
          || a.bottom <= b.top || b.bottom <= a.top);
        const hs = [...document.querySelectorAll('.tp-hop')].map((n) => n.getBoundingClientRect());
        const ts = [...document.querySelectorAll('.tp-tag rect, .tp-tag text')]
          .map((n) => n.getBoundingClientRect());
        return { 札: ts.length, かぶり: hs.reduce((n, x) => n + ts.filter((t) => hit(x, t)).length, 0) };
      });
      s.note('名前との重なり: ' + JSON.stringify(lap));
      s.yes('名前がたくさん出ている（重なりを見るに足りる）', lap.札 > 10);
      s.ok('名前と重ならない', lap.かぶり, 0);

      /* 押すと、ほんとうに日が移る */
      await page.click('.tp-hop.next');
      await page.waitForTimeout(400);
      s.ok('次の日へ移った', await page.evaluate(() => location.hash), '#/time/' + TMRW);
      await page.goBack();
      await page.waitForSelector('.tp-pie-wrap');
      await page.click('.tp-hop.prev');
      await page.waitForTimeout(400);
      s.ok('前の日へも移れる', await page.evaluate(() => location.hash), '#/time/' + YDAY);

      /* ---- カレンダーの日別画面。こちらは日別のまま移る ---- */
      await open(page, base, '#/day/' + T);
      await page.waitForSelector('.tp-pie-wrap');
      const d = await hops(page);
      s.note('日別のボタン: ' + JSON.stringify(d && d.map((x) => x.行き先)));
      s.ok('日別の画面では、日別のまま移る',
        d.map((x) => x.行き先), ['#/day/' + YDAY, '#/day/' + TMRW]);
      await page.click('.tp-hop.next');
      await page.waitForTimeout(400);
      s.ok('日別のまま次の日へ', await page.evaluate(() => location.hash), '#/day/' + TMRW);

      /* ---- 予定が無い日。円が出ないので、ボタンも出ない ---- */
      s.ok('予定の無い日には、円もボタンも出ない',
        await page.locator('.tp-pie-wrap').count(), 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
