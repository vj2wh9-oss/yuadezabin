/**
 * ROOM RESERVE の取り込み。
 *
 * これまでは「こちらに無いものを足す」だけだったので、向こうで
 * 時間を変えても、在宅の可否を変えても、予定を取り消しても気づけなかった。
 *
 * 取り込むたびに向こうのいまの姿へ合わせ直すこと、
 * そのとき手で入れた予定には触らないことを見る。
 *
 * 向こう（と、取り次ぐ Worker）は route で代わりをする。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

const KEY = 'test-token-0123456789abcdefghij';
/* 向こうの id は6文字以上（store が短すぎる id を控えないため）。
   本物も十分に長いので、同じくらいの長さで試す */
const ROOM = 'https://heya.vercel.app/c/abcdef12';

/** 向こうの予定表。test の中から中身を差し替える */
function fakeRoom() {
  let events = [];
  return {
    set(list) { events = list; },
    async attach(page) {
      await page.route(/\/v1\/roomreserve/, (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, events, extra: {}, keys: ['events'], tried: [] })
      }));
      // 預かりの問い合わせは、空の返事でいなす
      await page.route(/\/v1\/(inbox|meta|state|files)\b/, (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: '{"items":[]}'
      }));
    }
  };
}

/** 取り込んだ結果の要約 */
const run = (page) => page.evaluate(() => window.DL.roomreserve.pull().then((r) => ({
  足した: r.added.length, 直した: r.changed.length, 下ろした: r.removed.length,
  そのまま: r.skipped, ひとこと: window.DL.roomreserve.pullText(r)
})));

/** こちらのカレンダーに入っている予定 */
const mine = (page) => page.evaluate(() => window.DL.store.events()
  .map((e) => [e.title, e.date, e.start + (e.end ? '-' + e.end : ''), e.memo || '-'].join(' / '))
  .sort());

export default {
  name: 'ROOM RESERVE の取り込み',
  async run({ base }) {
    const s = sheet('ROOM RESERVE の取り込み');
    const room = fakeRoom();

    await withPage(base, IPHONE, async (page, errors) => {
      await room.attach(page);
      await open(page, base);
      await page.evaluate((c) => {
        window.DL.store.updateSync({ url: c.url, token: c.token, id: 'test', enabled: true });
        window.DL.store.updateRoomReserve({ url: c.room });
      }, { url: base, token: KEY, room: ROOM });
      s.yes('取り込める状態になっている',
        await page.evaluate(() => window.DL.roomreserve.ready()));

      const T = await page.evaluate(() => window.DL.util.today());
      const D1 = await page.evaluate((t) => window.DL.util.addDays(t, 3), T);
      const D2 = await page.evaluate((t) => window.DL.util.addDays(t, 5), T);
      const PAST = await page.evaluate((t) => window.DL.util.addDays(t, -4), T);

      /* ---- はじめの取り込み ---- */
      room.set([
        { id: 'room-0001', kind: 'normal', date: D1, startTime: '13:00', durationMin: 120, homeStatus: 'ok' },
        { id: 'room-0002', kind: 'normal', date: D2, startTime: '09:30', durationMin: 60, homeStatus: 'ng' },
        { id: 'room-0003', kind: 'normal', date: PAST, startTime: '20:00', durationMin: 60 }
      ]);
      let r = await run(page);
      s.note('1回目: ' + JSON.stringify(r));
      s.ok('3件そのまま入る', r.足した, 3);
      s.note('こちらの予定: ' + JSON.stringify(await mine(page)));

      /* ---- 時間が変わった ---- */
      room.set([
        { id: 'room-0001', kind: 'normal', date: D1, startTime: '15:00', durationMin: 120, homeStatus: 'ok' },
        { id: 'room-0002', kind: 'normal', date: D2, startTime: '09:30', durationMin: 60, homeStatus: 'ng' },
        { id: 'room-0003', kind: 'normal', date: PAST, startTime: '20:00', durationMin: 60 }
      ]);
      r = await run(page);
      s.note('2回目（時間を変えた）: ' + JSON.stringify(r));
      s.ok('増やさずに直す', r.足した, 0);
      s.ok('直したのは1件', r.直した, 1);
      let now = await mine(page);
      s.note('こちらの予定: ' + JSON.stringify(now));
      s.ok('ぜんぶで3件のまま', now.length, 3);
      s.yes('新しい時間になっている',
        now.some((x) => x.indexOf('15:00-17:00') >= 0));
      s.yes('前の時間は残っていない',
        !now.some((x) => x.indexOf('13:00-15:00') >= 0));

      /* ---- 在宅の可否が変わった ---- */
      room.set([
        { id: 'room-0001', kind: 'normal', date: D1, startTime: '15:00', durationMin: 120, homeStatus: 'ng' },
        { id: 'room-0002', kind: 'normal', date: D2, startTime: '09:30', durationMin: 60, homeStatus: 'ng' },
        { id: 'room-0003', kind: 'normal', date: PAST, startTime: '20:00', durationMin: 60 }
      ]);
      r = await run(page);
      s.note('3回目（在宅の可否を変えた）: ' + JSON.stringify(r));
      s.ok('ここも直す', r.直した, 1);
      now = await mine(page);
      s.yes('在宅不可に変わる',
        now.some((x) => x.indexOf('15:00-17:00') >= 0 && x.indexOf('在宅不可') >= 0));

      /* ---- 向こうで取り消された ---- */
      room.set([
        { id: 'room-0002', kind: 'normal', date: D2, startTime: '09:30', durationMin: 60, homeStatus: 'ng' },
        { id: 'room-0003', kind: 'normal', date: PAST, startTime: '20:00', durationMin: 60 }
      ]);
      r = await run(page);
      s.note('4回目（1件 取り消した）: ' + JSON.stringify(r));
      s.ok('取り消されたぶんを下ろす', r.下ろした, 1);
      now = await mine(page);
      s.note('こちらの予定: ' + JSON.stringify(now));
      s.ok('2件になる', now.length, 2);
      s.yes('下りたのは、取り消されたほう',
        !now.some((x) => x.indexOf('15:00-17:00') >= 0));

      /* ---- 過ぎた日は、向こうから消えても残す ---- */
      room.set([
        { id: 'room-0002', kind: 'normal', date: D2, startTime: '09:30', durationMin: 60, homeStatus: 'ng' }
      ]);
      r = await run(page);
      s.note('5回目（過ぎた日を消した）: ' + JSON.stringify(r));
      s.ok('過ぎた日は下ろさない', r.下ろした, 0);
      now = await mine(page);
      s.yes('過ぎた予定はそのまま残っている',
        now.some((x) => x.indexOf(PAST) >= 0));

      /* ---- 手で入れた予定には触らない ---- */
      const D3 = await page.evaluate((t) => window.DL.util.addDays(t, 8), T);
      await page.evaluate((d) => window.DL.store.addEvent({
        date: d, title: '歯医者', start: '11:00', end: '12:00'
      }), D3);
      room.set([
        { id: 'room-0002', kind: 'normal', date: D2, startTime: '09:30', durationMin: 60, homeStatus: 'ng' },
        { id: 'room-0009', kind: 'normal', date: D3, startTime: '11:00', durationMin: 60 }
      ]);
      r = await run(page);
      s.note('6回目（手で入れた予定と重なる）: ' + JSON.stringify(r));
      s.ok('重ねて入れない', r.足した, 0);
      s.ok('手で入れたぶんは直さない', r.直した, 0);
      s.yes('名前も変えない',
        (await mine(page)).some((x) => x.indexOf('歯医者') >= 0));

      // その予定が向こうから消えても、手で入れたものは下ろさない
      room.set([
        { id: 'room-0002', kind: 'normal', date: D2, startTime: '09:30', durationMin: 60, homeStatus: 'ng' }
      ]);
      r = await run(page);
      s.note('7回目（重なっていた向こうのぶんが消えた）: ' + JSON.stringify(r));
      s.ok('手で入れた予定は下ろさない', r.下ろした, 0);
      s.yes('歯医者は残っている',
        (await mine(page)).some((x) => x.indexOf('歯医者') >= 0));

      /* ---- 締切・イベントは、はじめから入れない ---- */
      room.set([
        { id: 'room-0002', kind: 'normal', date: D2, startTime: '09:30', durationMin: 60, homeStatus: 'ng' },
        { id: 'room-000x', kind: 'deadline', date: D3, startTime: '18:00', durationMin: 30 }
      ]);
      r = await run(page);
      s.ok('締切は入れない', r.足した, 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
