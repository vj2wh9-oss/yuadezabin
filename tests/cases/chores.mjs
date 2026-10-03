/**
 * 家事の周期表。
 *
 * 繰り返しの予定（events）との違いが、この機能の肝。
 * あちらは決めた日に出るので、さぼった日はただ流れていき、
 * 次の回がまた同じ間隔でやってくる。
 * こちらは「最後にやった日＋周期」なので、さぼってもずれない。
 *
 * 確かめたいのは4つ。
 *   ・次の日は、いつも「最後にやった日＋周期」
 *   ・さぼっても間隔は縮まないし、早めにやれば次も早くなる
 *   ・遅れているものから順に出す（毎日のものと半年のものを同じ物差しで）
 *   ・押し間違えたら、ひとつ前に戻せる
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

const add = (page, d) => page.evaluate((x) => window.DL.store.addChore(x).id, d);

const st = (page, id, date) => page.evaluate((a) => {
  const c = window.DL.store.getChore(a.id);
  const s = window.DL.chores.state(c, a.date);
  return { on: s.on, left: s.left, late: s.late, due: s.due, over: s.over, never: s.never };
}, { id, date });

export default {
  name: '家事の周期表',
  async run({ base }) {
    const s = sheet('家事の周期表');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      const today = await page.evaluate(() => window.DL.util.today());
      const d = (n) => page.evaluate((k) => window.DL.util.addDays(window.DL.util.today(), k), n);

      /* ---- 次の日は「最後にやった日＋周期」 ---- */
      const sheets = await add(page, { name: 'シーツを替える', every: 14, lastAt: await d(-10) });
      s.ok('最後にやった日から14日後', (await st(page, sheets, today)).on, await d(4));
      s.ok('あと4日', (await st(page, sheets, today)).left, 4);
      s.ok('まだ出さない', (await st(page, sheets, today)).due, false);

      /* ---- さぼってもずれない ---- */
      const drain = await add(page, { name: '排水口', every: 7, lastAt: await d(-20) });
      const s1 = await st(page, drain, today);
      s.ok('13日 過ぎている', s1.late, 13);
      s.ok('過ぎているものは出す', [s1.due, s1.over], [true, true]);
      s.ok('次の日は、いつも最後にやった日＋7日（進まない）', s1.on, await d(-13));

      /* やれば、そこから数えなおす */
      await page.evaluate((id) => window.DL.chores.done(id), drain);
      s.ok('やった日から7日後', (await st(page, drain, today)).on, await d(7));
      s.ok('遅れが消える', (await st(page, drain, today)).late, 0);

      /* 早めにやれば、次も早くなる（繰り返しの予定との違い） */
      await page.evaluate((a) => window.DL.chores.done(a.id, a.on), { id: drain, on: await d(2) });
      s.ok('早めにやれば、次も早くなる', (await st(page, drain, today)).on, await d(9));

      /* ---- まだ一度もやっていないもの ---- */
      const wax = await add(page, { name: '床のワックス', every: 180, from: await d(-3) });
      const s2 = await st(page, wax, today);
      s.ok('始める日が次の日になる', [s2.on, s2.never], [await d(-3), true]);
      s.yes('始める日を過ぎていれば出す', s2.due && s2.over);

      /* ---- 遅れている順。周期に対する割合で見る ---- */
      await page.evaluate((a) => {
        const S = window.DL.store;
        // 毎日のものが2日遅れ（割合 2.0）
        S.addChore({ name: '皿を洗う', every: 1, lastAt: a.m3 });
        // 半年のものが2日遅れ（割合 0.011）
        S.addChore({ name: '窓を拭く', every: 180, lastAt: a.m182 });
      }, { m3: await d(-3), m182: await d(-182) });

      s.ok('毎日のものの2日遅れが、半年のものの2日遅れより先',
        (await page.evaluate(() => window.DL.chores.due().map((o) => o.c.name)))
          .filter((n) => n === '皿を洗う' || n === '窓を拭く'),
        ['皿を洗う', '窓を拭く']);

      /* ---- 先回り ---- */
      // 周期30日・最後が28日前 → あと2日。30×0.15=4.5→5日前から出す
      const filt = await add(page, { name: 'フィルター', every: 30, lastAt: await d(-28) });
      s.yes('そろそろのものは、少し前から出す', (await st(page, filt, today)).due);
      s.yes('まだ過ぎてはいない', !(await st(page, filt, today)).over);

      /* ---- 取り消し ---- */
      s.ok('やったのを取り消すと、ひとつ前に戻る', await page.evaluate((id) => {
        window.DL.chores.undo(id);
        return window.DL.store.getChore(id).lastAt;
      }, drain), today);

      /* ---- 続きぐあい ---- */
      s.ok('間のならしを出す', await page.evaluate(() => {
        const U = window.DL.util, S = window.DL.store, C = window.DL.chores;
        const id = S.addChore({ name: 'ゴミ出し', every: 7 }).id;
        [-21, -13, -6, 0].forEach((n) => C.done(id, U.addDays(U.today(), n)));
        const k = C.keep(S.getChore(id));
        return [k.times, k.avg, k.slip];
      }), [4, 7, 0]);

      /* ---- 知らせ ---- */
      s.yes('だいぶ遅れているものだけ知らせる',
        (await page.evaluate(() => window.DL.chores.alerts().map((a) => a.text)))
          .some((t) => t.indexOf('家事が') === 0));

      /* ---- 画面 ---- */
      await page.evaluate(() => { location.hash = '#/chores'; });
      await page.waitForTimeout(500);
      s.yes('周期表が出る',
        (await page.locator('.view').innerText()).indexOf('いまやるもの') >= 0);
      s.yes('遅れているものに印が付く', (await page.locator('.ch-row.late').count()) >= 1);

      /* やったボタンで、次の日が動く */
      const before = (await st(page, wax, today)).on;
      await page.locator('.ch-row').filter({ hasText: '床のワックス' })
        .locator('.checkbtn').click();
      await page.waitForTimeout(400);
      s.yes('画面から「やった」が押せる', (await st(page, wax, today)).on !== before);
      s.ok('次は180日後', (await st(page, wax, today)).on, await d(180));

      /* ---- ホーム ---- */
      await page.evaluate(() => { location.hash = '#/home'; });
      await page.waitForTimeout(500);
      s.yes('遅れている家事がホームに出る',
        (await page.locator('.home-chore').count()) === 1);
      s.yes('ホームから周期表へ行ける',
        (await page.locator('a[href="#/chores"]').count()) >= 1);

      const n0 = await page.locator('.home-chore .bd-pill').count();
      await page.locator('.home-chore .bd-pill').first().click();
      await page.waitForTimeout(300);
      s.ok('押しても、札はその場に残る',
        await page.locator('.home-chore .bd-pill').count(), n0);
      s.ok('押した札に線が引かれる',
        await page.locator('.home-chore .bd-pill.on').count(), 1);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
