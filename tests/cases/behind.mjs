/**
 * 遅れの計算。
 *
 * v215 で直したところ。遅れは「昨日までに終えているべき量」と
 * 「昨日までに積んだ量」を比べるもの。ここに今日やったぶんを
 * 入れてしまうと、今日の手が過去の遅れを消してしまい、
 * 今日のノルマを丸ごと取りこぼす。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 昨日ノルマ2・今日ノルマ4・明日ノルマ4 の「下書き」を1つ作る */
async function setup(page) {
  return page.evaluate(() => {
    const U = window.DL.util, S = window.DL.store;
    const today = U.today();
    const y = U.addDays(today, -1), tm = U.addDays(today, 1);
    const pr = S.createProject({
      name: '遅れの検証', category: 'manga', qty: 10,
      deadline: U.addDays(today, 10), status: 'active'
    });
    const t = S.addTask(pr.id, { name: '下書き', unit: 'page', qty: 10 });
    S.updateTask(pr.id, t.id, {
      start: y, end: tm,
      planOverride: { [y]: 2, [today]: 4, [tm]: 4 }
    });
    S.setPageTotal(pr.id, 10);
    return { pid: pr.id, tid: t.id, today, y, tm };
  });
}

const pace = (page, at) => page.evaluate((s) => {
  const S = window.DL.store, sc = window.DL.schedule;
  const q = sc.taskPace(S.getProject(s.pid), S.getTask(s.pid, s.tid), s.today);
  return {
    ノルマ: q.plan.byDate, 昨日までに必要: q.shouldBeDone,
    積んだ合計: q.done, 昨日までに積んだ: q.doneBefore,
    残り: q.remaining, 遅れ: q.behind
  };
}, at);

const behindAlerts = (page, at) => page.evaluate(
  (s) => window.DL.schedule.alerts(s.today).filter((a) => a.behind).map((a) => a.text), at);

export default {
  name: '遅れの計算',
  async run({ base }) {
    const s = sheet('遅れの計算');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      const at = await setup(page);

      const p0 = await pace(page, at);
      s.note('ノルマ ' + JSON.stringify(p0.ノルマ));
      s.ok('昨日までに終えているべき数', p0.昨日までに必要, 2);

      /* まだ何も積んでいない。ここは前から正しかった */
      s.ok('実績0のとき、遅れは2', p0.遅れ, 2);
      s.ok('実績0のとき、ホームに警告が出る', await behindAlerts(page, at), ['下書き が 2P 遅れています']);

      /* 今日の実績を入れても、過去の遅れは消えない（v215 で直したところ） */
      await page.evaluate((x) => window.DL.store.setProgress(x.pid, x.tid, x.today, 2), at);
      const p1 = await pace(page, at);
      s.ok('今日2Pを入れると、積んだ合計は2', p1.積んだ合計, 2);
      s.ok('今日2Pは「昨日までに積んだ」に入らない', p1.昨日までに積んだ, 0);
      s.ok('今日2Pを入れても、遅れは2のまま', p1.遅れ, 2);
      s.ok('今日2Pを入れても、ホームの警告は消えない',
        await behindAlerts(page, at), ['下書き が 2P 遅れています']);

      /* 昨日ぶんとして入れ直せば、これまでどおり消える */
      await page.evaluate((x) => {
        window.DL.store.setProgress(x.pid, x.tid, x.today, 0);
        window.DL.store.setProgress(x.pid, x.tid, x.y, 2);
      }, at);
      s.ok('昨日2Pを入れると、遅れは0', (await pace(page, at)).遅れ, 0);
      s.ok('昨日2Pを入れると、ホームの警告も消える', await behindAlerts(page, at), []);

      /* 残っている量より大きな遅れにはしない */
      await page.evaluate((x) => {
        window.DL.store.setProgress(x.pid, x.tid, x.y, 0);
        window.DL.store.setProgress(x.pid, x.tid, x.today, 9);
      }, at);
      const p2 = await pace(page, at);
      s.ok('総10Pのうち9Pやったら、残りは1', p2.残り, 1);
      s.ok('遅れは残りで頭打ちになる', p2.遅れ, 1);

      /* 原稿管理ページも、印の数で同じ見方をしている */
      await page.evaluate((x) => {
        window.DL.store.setProgress(x.pid, x.tid, x.today, 0);
        window.DL.store.markPages(x.pid, x.tid, [1, 2], true);   // 今日ぶんの印
      }, at);
      await open(page, base, '#/pages/' + at.pid);
      await page.waitForSelector('.pg-sum-row');
      const row = await page.$eval('.pg-sum-row', (n) => n.innerText.replace(/\n+/g, ' | '));
      s.note('まとめ行: ' + row);
      s.yes('今日の印だけでは、原稿管理ページの遅れも消えない', /遅れ2/.test(row));

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
