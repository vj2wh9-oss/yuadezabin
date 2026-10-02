/**
 * 動きの設定（この端末だけ）。
 *
 * ふつう … 飾りは何周かしたら自分から止まる（v208 の電池の決まり）
 * 止めない … その上限を外して、開いているあいだ回し続ける
 * 控える … はじめから動かさない
 *
 * 「止めない」を入れた人まで勝手に止めない、入れていない人のところでは
 * 止まる、という両側を見る。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** その画面で動いているもののうち、終わらないものと終わるもの */
const counts = (page) => page.evaluate(() => {
  const all = window.document.getAnimations();
  const n = (f) => all.filter((a) => {
    const it = a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : 1;
    return f(it);
  }).length;
  return { 全部: all.length, 終わらない: n((i) => i === Infinity), 終わる: n((i) => i !== Infinity) };
});

/** 飾りの代表を、ひとつずつ見る */
const look = (page) => page.evaluate(() => {
  const out = {};
  const put = (名, sel, pseudo) => {
    const n = document.querySelector(sel);
    if (!n) return;
    const cs = getComputedStyle(n, pseudo || undefined);
    if (cs.animationName === 'none') return;
    out[名] = cs.animationIterationCount;
  };
  put('今日の枠', '.cal-cell.today', '::before');
  put('締切のマス', '.cal-cell.has-due');
  put('予定の流れ', '.cal-page.cal-life .cal-line .nmi.pan');
  return out;
});

/* 飾りは画面ごとに散らばっているので、案件と日常の両方を見てまとめる */
async function lookBoth(page, base) {
  await page.evaluate(() => { window.DL.store.setCalMode('work'); });
  await open(page, base, '#/calendar');
  await page.waitForSelector('.cal-grid');
  const a = await look(page);
  await page.evaluate(() => { window.DL.store.setCalMode('life'); });
  await open(page, base, '#/calendar');
  await page.waitForSelector('.cal-page.cal-life .cal-grid');
  return Object.assign(a, await look(page));
}

/** 動きの設定を切り替える */
const setMode = (page, mode) => page.evaluate((m) => {
  window.DL.store.updateSettings({ calm: m === 'calm', loopFx: m === 'loop' });
  window.DL.app.render();
}, mode);

export default {
  name: '動きの設定',
  async run({ base }) {
    const s = sheet('動きの設定');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        S.addEvent({ date: T, title: '合同誌の打ち合わせと原稿の受け渡し（渋谷）' });
        const pr = S.createProject({ name: '入稿するもの', category: 'manga', qty: 4,
          deadline: T, status: 'active' });
        const t = S.addTask(pr.id, { name: '入稿', unit: 'page', qty: 4 });
        S.updateTask(pr.id, t.id, { start: U.addDays(T, -2), end: T });
        S.setCalMode('life');
      });

      /* はじめは「ふつう」 */
      s.yes('はじめは「ふつう」',
        await page.evaluate(() => {
          const s2 = window.DL.store.settings;
          return !s2.calm && !s2.loopFx;
        }));

      const 普通 = await lookBoth(page, base);
      s.note('ふつう: ' + JSON.stringify(普通));
      s.yes('見るものが揃っている', Object.keys(普通).length >= 3);
      s.ok('ふつうは、どれも何周かで止まる',
        Object.keys(普通).filter((k) => 普通[k] === 'infinite'), []);
      s.ok('画面ぜんたいでも、終わらない動きは無い',
        (await counts(page)).終わらない, 0);

      /* 「止めない」 */
      await setMode(page, 'loop');
      const 無限 = await lookBoth(page, base);
      s.yes('body に印が付く',
        await page.evaluate(() => document.body.classList.contains('loopfx')));
      s.note('止めない: ' + JSON.stringify(無限));
      s.ok('同じものを見ている', Object.keys(無限).sort(), Object.keys(普通).sort());
      s.ok('「止めない」では、どれも止まらない',
        Object.keys(無限).filter((k) => 無限[k] !== 'infinite'), []);

      /* 「控える」が、いちばん強い。両方入っても控えるほうを取る */
      await setMode(page, 'calm');
      await page.waitForTimeout(300);
      s.yes('「控える」では loopfx の印は付かない',
        !(await page.evaluate(() => document.body.classList.contains('loopfx'))));
      await page.evaluate(() => {
        // 手で両方立ててみる（取り込んだデータが古い、などの事故に備えて）
        window.DL.store.updateSettings({ calm: true, loopFx: true });
        window.DL.app.render();
      });
      await page.waitForTimeout(300);
      s.yes('両方入っていても、控えるほうを取る',
        !(await page.evaluate(() => document.body.classList.contains('loopfx'))));
      s.ok('控えるときは、動いているものが無い',
        await page.evaluate(() => window.document.getAnimations()
          .filter((a) => a.playState === 'running').length), 0);

      /* 設定の画面から選べること */
      await setMode(page, 'on');
      await open(page, base, '#/settings');
      await page.waitForSelector('.settings-page');
      // ジャンルはたたんであるので、まず開く
      await page.click('.sg-head:has-text("作業と表示")');
      await page.waitForTimeout(300);
      const seg = await page.$$eval('.segmented .seg',
        (ns) => ns.map((n) => n.textContent.trim()));
      s.note('段のボタン: ' + JSON.stringify(seg.filter((x) => /ふつう|止めない|控える/.test(x))));
      s.yes('設定に「止めない」がある', seg.indexOf('止めない') >= 0);
      await page.click('.seg:has-text("止めない")');
      await page.waitForTimeout(400);
      s.yes('押すと設定に入る',
        await page.evaluate(() => window.DL.store.settings.loopFx === true));
      await page.click('.seg:has-text("ふつう")');
      await page.waitForTimeout(400);
      s.yes('「ふつう」に戻せる', await page.evaluate(() => {
        const s2 = window.DL.store.settings;
        return s2.loopFx === false && s2.calm === false;
      }));

      /* この端末だけのもの。同期では持ち出さない */
      await setMode(page, 'loop');
      s.yes('同期には持ち出さない（端末ごとの設定）',
        await page.evaluate(() =>
          window.DL.store.syncPayload().settings.loopFx === undefined));
      await setMode(page, 'on');

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
