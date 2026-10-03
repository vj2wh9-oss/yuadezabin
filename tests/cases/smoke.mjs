/**
 * 全画面を一周。
 *
 * 中身の正しさまでは見ない。開いてエラーが出ないことだけを見る。
 * 直したところと関係ない画面を壊していないか、これで気づけるようにする。
 *
 * iPhone SE（狭い）・iPhone 13・PC の3つで回す。
 * 「動き：控える（電池優先）」でももう一周する。
 */
import { sheet, withPage, open, IPHONE, IPHONE13, PC } from '../lib/harness.mjs';

/** 一周ぶんの種をまく。案件・チケット・予定をひと通り */
const seed = (page) => page.evaluate(() => {
  const S = window.DL.store, U = window.DL.util, T = U.today();
  const pr = S.createProject({
    kind: 'event', category: 'manga', title: '新刊', eventName: '夏コミ',
    eventDate: U.addDays(T, 20), venue: '会場', space: 'あ-01',
    deadline: U.addDays(T, 8), startDate: T, qty: 16
  });
  pr.tasks = S.templateTasks('manga', 16);
  S.createProject({
    kind: 'work', category: 'illust', title: '表紙', client: 'A社',
    deadline: U.addDays(T, 6), startDate: T, qty: 1, fee: 30000
  });
  S.putTimeblock(T, { start: 540, end: 720, label: '原稿' });
  S.save();
  return {
    today: T,
    tid: (S.tickets()[0] || {}).id || '',
    pid: (S.projects()[0] || {}).id || ''
  };
});

function routesFor(at) {
  return [
    '#/home', '#/calendar', '#/projects',
    at.tid ? '#/ticket/' + at.tid : null,
    at.pid ? '#/p/' + at.pid : null,
    at.pid ? '#/project/' + at.pid : null,
    at.pid ? '#/pages/' + at.pid : null,
    '#/sales', '#/books', '#/outgo', '#/body', '#/supply', '#/chores', '#/files', '#/stock', '#/settings', '#/search',
    '#/day/' + at.today, '#/time/' + at.today,
    '#/logs', '#/ideas', '#/orders', '#/crm', '#/docs', '#/fit', '#/lock', '#/home'
  ].filter(Boolean);
}

export default {
  name: '全画面を一周',
  async run({ base }) {
    const s = sheet('全画面を一周');

    for (const [label, device] of [['iPhone SE', IPHONE], ['iPhone 13', IPHONE13], ['PC', PC]]) {
      await withPage(base, device, async (page, errors) => {
        /* 読み込めなかったファイルは、ここでは数えない
           （偽の外部サービスを立てていないため） */
        const real = () => errors.filter((e) => !/Failed to load resource/.test(e));

        await open(page, base);
        const at = await seed(page);
        const routes = routesFor(at);

        for (const hash of routes) {
          await page.goto(base + '/' + hash, { waitUntil: 'load' });
          await page.waitForTimeout(160);
        }
        s.ok(label + '（' + routes.length + '画面）', real(), []);

        /* 「動き：控える」でももう一周 */
        await page.evaluate(() => window.DL.store.updateSettings({ calm: true }));
        for (const hash of routes) {
          await page.goto(base + '/' + hash, { waitUntil: 'load' });
          await page.waitForTimeout(120);
        }
        s.ok(label + '・動きを控える', real(), []);
      });
    }
    return s;
  }
};
