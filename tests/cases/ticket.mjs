/**
 * チケットの出し入れ。
 *
 * 即売会は、中の制作物が仕上がっても当日までは消えない。
 * 頒布物・準備・当日モードが、その日まで要るため。
 * 仕事と支援サイトは、これまでどおり中身が終われば終わり。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** その名前の券が、いまの一覧（進行中）に出ているか */
const shown = (page, name) => page.evaluate((n) =>
  Array.from(document.querySelectorAll('.tk-card-name')).some((e) => e.textContent === n), name);

export default {
  name: 'チケットの出し入れ',
  async run({ base }) {
    const s = sheet('チケットの出し入れ');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      /* 即売会の券。券は案件から自動でできる（名前も日付も案件から取る）ので、
         実際と同じように、案件のほうを作って券を引き当てる。
         中の制作物は、この1つだけ */
      const at = await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        const pr = S.createProject({
          kind: 'event', category: 'manga', title: '新刊',
          eventName: '冬の即売会', eventDate: U.addDays(T, 20),
          deadline: U.addDays(T, 10), startDate: T, qty: 8, status: 'active'
        });
        const wp = S.createProject({
          kind: 'work', category: 'illust', title: '表紙', client: 'A社',
          deadline: U.addDays(T, 10), startDate: T, qty: 1, status: 'active'
        });
        return { tid: pr.ticketId, pid: pr.id, wid: wp.ticketId, wpid: wp.id };
      });
      s.yes('即売会の券ができている', !!at.tid);
      s.yes('仕事の券もできている', !!at.wid);

      await open(page, base, '#/projects');
      await page.waitForSelector('.tk-card-name');
      s.yes('即売会の券が出ている', await shown(page, '冬の即売会'));
      s.yes('仕事の券も出ている', await shown(page, 'A社'));

      /* 中の制作物を完了にする。ここが直したところ */
      await page.evaluate((x) => {
        window.DL.store.updateProject(x.pid, { status: 'done' });
        window.DL.store.updateProject(x.wpid, { status: 'done' });
      }, at);
      await open(page, base, '#/projects');
      await page.waitForTimeout(300);
      s.yes('制作物を完了にしても、即売会の券は残る', await shown(page, '冬の即売会'));
      s.yes('仕事の券は、これまでどおり一覧から外れる',
        !(await shown(page, 'A社')));

      /* 当日を過ぎたら、ようやく終わり */
      await page.evaluate((x) => {
        const U = window.DL.util;
        window.DL.store.updateTicket(x.tid, { date: U.addDays(U.today(), -1) });
      }, at);
      await open(page, base, '#/projects');
      await page.waitForTimeout(300);
      s.yes('当日を過ぎたら、即売会の券も一覧から外れる',
        !(await shown(page, '冬の即売会')));

      /* 日付の無い即売会は、自分からは終わりにしない */
      await page.evaluate((x) => window.DL.store.updateTicket(x.tid, { date: '' }), at);
      await open(page, base, '#/projects');
      await page.waitForTimeout(300);
      s.yes('日付の無い即売会は、残り続ける（勝手に消さない）',
        await shown(page, '冬の即売会'));

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
