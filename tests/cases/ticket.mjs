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

    /* 右上のサイネージ。出すのは券そのものの期限で、
       中の制作物の締切や入稿日は見ない */
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        /* 即売会は30日後。中の制作物の締切は5日後、入稿は3日後。
           これまでは「入稿 3日」が出ていた。これからは「即売会 30日」 */
        const pr = S.createProject({
          kind: 'event', category: 'manga', title: '新刊',
          eventName: '秋の即売会', eventDate: U.addDays(T, 30),
          deadline: U.addDays(T, 5), startDate: T, qty: 8, status: 'active'
        });
        S.updateProject(pr.id, { printings: [
          { label: '入稿', due: U.addDays(T, 3), primary: true }
        ] });
      });
      await open(page, base, '#/home');
      await page.waitForSelector('#dueTick .due-face');
      /* 入稿が近いときだけ割り込む。並びは日の近い順なので、
         3日後の入稿が先、30日後の券があと */
      const all = await page.evaluate(() => {
        const o = [];
        const t = document.getElementById('dueTick');
        return new Promise((res) => {
          // 流れているものを、ひと回りぶん拾う
          const seen = {};
          const tick = () => {
            const s = t.innerText.replace(/\s+/g, ' ').trim();
            if (s && !seen[s]) { seen[s] = 1; o.push(s); }
            if (o.length >= 2) return res(o);
            setTimeout(tick, 300);
          };
          tick();
          setTimeout(() => res(o), 12000);
        });
      });
      s.note('ひと回り: ' + JSON.stringify(all));
      s.yes('入稿が近いときは割り込んでくる', all.some((x) => /入稿/.test(x) && /3日/.test(x)));
      s.yes('券の名前と期限（30日）も出る',
        all.some((x) => /秋の即売会/.test(x) && /30日/.test(x)));
      s.yes('中の締切（5日）は出ない', !all.some((x) => / 5日/.test(x)));
      s.yes('近いほう（入稿）が先に出る', /入稿/.test(all[0]));

      /* 入稿が遠ければ、割り込まない */
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util;
        const p = S.projects()[0];
        S.updateProject(p.id, { printings: [
          { label: '入稿', due: U.addDays(U.today(), 20), primary: true }
        ] });
      });
      await open(page, base, '#/home');
      await page.waitForSelector('#dueTick .due-face');
      await page.waitForTimeout(600);
      const only = await page.$eval('#dueTick', (n) => n.innerText.replace(/\s+/g, ' ').trim());
      const href = await page.$eval('#dueTick', (n) => n.getAttribute('href'));
      s.note('入稿が遠いとき: ' + only + '  → ' + href);
      s.yes('20日先の入稿は割り込まない', !/入稿/.test(only));
      s.yes('券だけになり、押すとその券へ行く', (href || '').indexOf('#/ticket/') === 0);

      /* 券の半券に出ている残り日数と、同じ数であること */
      const same = await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util;
        const t = S.tickets()[0];
        return U.diffDays(U.today(), S.ticketDate(t));
      });
      s.yes('半券の残り日数と同じ数になる（' + same + '日）', new RegExp(same + '日').test(only));

      s.ok('画面のエラー（サイネージ）', errors, []);
    });
    return s;
  }
};
