/**
 * 終えた案件の、過ぎた日のぶん。
 *
 * これまでは案件を完了にした途端、カレンダーの過去も真っ白になっていた。
 * いつ何をやったのかが分からなくなるので、過ぎた日のぶんは残す。
 * これから先の日には出さない（もう作業が無いので、予定として立つと邪魔になる）。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 昨日・今日・明日にノルマが入っている「下書き」を1つ作る */
const setup = (page) => page.evaluate(() => {
  const U = window.DL.util, S = window.DL.store;
  const today = U.today();
  const y = U.addDays(today, -1), tm = U.addDays(today, 1);
  const pr = S.createProject({
    name: '記録の残りぐあい', category: 'manga', qty: 9,
    deadline: U.addDays(today, 5), status: 'active'
  });
  const t = S.addTask(pr.id, { name: 'ペン入れ', unit: 'page', qty: 9 });
  S.updateTask(pr.id, t.id, {
    start: y, end: tm, planOverride: { [y]: 3, [today]: 3, [tm]: 3 }
  });
  return { pid: pr.id, tid: t.id, today, y, tm };
});

/** その日にノルマとして出てくる工程の名前 */
const namesOn = (page, date) => page.evaluate(
  (d) => window.DL.schedule.loadOfDay(d).entries.map((e) => e.task.name), date);

/** カレンダーのそのマスに並ぶ行 */
const cellLines = (page, date) => page.evaluate((d) => {
  const cell = document.querySelector('.cal-cell[href="#/day/' + d + '"]');
  if (!cell) return null;
  return Array.prototype.map.call(cell.querySelectorAll('.cal-line'), (n) => ({
    文: n.textContent, 済み: n.classList.contains('done')
  }));
}, date);

export default {
  name: '終えた案件の過去',
  async run({ base }) {
    const s = sheet('終えた案件の過去');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      const at = await setup(page);

      /* まだ進行中。昨日も明日もノルマが立っている */
      s.ok('はじめは昨日にノルマがある', await namesOn(page, at.y), ['ペン入れ']);
      s.ok('はじめは明日にもノルマがある', await namesOn(page, at.tm), ['ペン入れ']);

      /* 完了にする */
      await page.evaluate((a) => window.DL.store.updateProject(a.pid, { status: 'done' }), at);

      s.ok('完了にしても、昨日のぶんは残る', await namesOn(page, at.y), ['ペン入れ']);
      s.ok('これから先の日には出さない', await namesOn(page, at.tm), []);
      s.ok('今日のぶんも、やることとしては出さない', await namesOn(page, at.today), []);

      /* カレンダーのマスでも、昨日の行が残っていること */
      await open(page, base, '#/calendar/' + at.y.slice(0, 7));
      await page.waitForSelector('.cal-grid');
      const y = await cellLines(page, at.y);
      const tm = await cellLines(page, at.tm);
      s.note('昨日のマス: ' + JSON.stringify(y));
      s.note('明日のマス: ' + JSON.stringify(tm));
      s.yes('昨日のマスに、やったぶんが残っている',
        y && y.some((x) => /ペン入れ/.test(x.文)));
      s.yes('終えた案件のぶんは、済んだ見た目で出す',
        y && y.some((x) => /ペン入れ/.test(x.文))
        && y.filter((x) => /ペン入れ/.test(x.文)).every((x) => x.済み));
      s.yes('明日のマスには出ない',
        tm && !tm.some((x) => /ペン入れ/.test(x.文)));

      /* 日別の画面でも、昨日のぶんは読める */
      await open(page, base, '#/day/' + at.y);
      await page.waitForSelector('.page');
      s.yes('昨日の画面にも、ノルマとして残っている',
        /ペン入れ/.test(await page.$eval('.page', (n) => n.innerText)));

      /* 保管（アーカイブ）にしたら、過去も出さない。
         こちらは「見えないところへしまう」ための状態なので、残さない */
      await page.evaluate((a) => window.DL.store.updateProject(a.pid, { status: 'archived' }), at);
      s.ok('保管にしたら、過去のぶんも出さない', await namesOn(page, at.y), []);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
