/**
 * ひと月の区切り（締め日）。
 *
 * クレジットカードの請求が6日締めなので、7日から翌月6日までをひと月として
 * 数える。カレンダーの月で数えると、締め日をまたいだ支払いが別の月に落ちて、
 * 請求額と家計簿が合わなくなる。
 *
 * 確かめたいのは5つ。
 *  ・どの日がどの会計月に入るか（境目の6日・7日）
 *  ・1日の予算が、会計月の日数と「何日目か」で割られていること
 *  ・固定費・節約実績・月ごとのグラフも、同じ区切りで数えること
 *  ・貯金（残高の控え）も同じ区切りで見ること
 *  ・締め日を 0 にすれば、これまでどおりカレンダーの月に戻ること
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

const setClose = (page, n) => page.evaluate(
  (v) => { window.DL.store.updateSettings({ closeDay: v }); }, n);

const cyc = (page, d) => page.evaluate((x) => window.DL.expenses.cycleOf(x), d);

export default {
  name: 'ひと月の区切り',
  async run({ base }) {
    const s = sheet('ひと月の区切り');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      /* ---- 既定は6日締め ---- */
      s.ok('はじめから6日締め', await page.evaluate(() => window.DL.expenses.closeDay()), 6);

      /* ---- 境目 ---- */
      s.ok('6日までは前の月ぶん', await cyc(page, '2026-11-06'), '2026-10');
      s.ok('7日から今月ぶん', await cyc(page, '2026-11-07'), '2026-11');
      s.ok('月末も今月ぶん', await cyc(page, '2026-11-30'), '2026-11');
      s.ok('1日は前の月ぶん', await cyc(page, '2026-11-01'), '2026-10');
      s.ok('年をまたぐところ', await cyc(page, '2027-01-05'), '2026-12');

      s.ok('はじまりと終わり', await page.evaluate(() => {
        const E = window.DL.expenses;
        return [E.cycleStart('2026-10'), E.cycleEnd('2026-10'), E.cycleDays('2026-10')];
      }), ['2026-10-07', '2026-11-06', 31]);
      s.ok('2月をまたぐ月は短い', await page.evaluate(
        () => window.DL.expenses.cycleDays('2027-01')), 31);
      s.ok('何日目か', await page.evaluate(() => {
        const E = window.DL.expenses;
        return [E.cycleIndex('2026-10-07'), E.cycleIndex('2026-10-31'), E.cycleIndex('2026-11-06')];
      }), [1, 25, 31]);
      s.ok('言いかた', await page.evaluate(
        () => window.DL.expenses.cycleLabel('2026-10')), '10/7〜11/6');

      /* ---- 1日の予算 ---- */
      await page.evaluate(() => {
        const S = window.DL.store;
        S.updateSettings({ lifeBudget: 93000 });
        // 10月ぶん（10/7〜11/6）に3件。11/6 はぎりぎり10月ぶん、11/7 は11月ぶん
        S.addExpense({ book: 'life', date: '2026-10-08', amount: 1000, category: '食費' });
        S.addExpense({ book: 'life', date: '2026-11-06', amount: 2000, category: '食費' });
        S.addExpense({ book: 'life', date: '2026-11-07', amount: 5000, category: '食費' });
      });

      const b = await page.evaluate(() => {
        const x = window.DL.expenses.dailyBudget('2026-11-06');
        return { days: x.days, day: x.day, spent: x.spent, perDay: x.perDay };
      });
      s.ok('日数は会計月のぶん（31日）', b.days, 31);
      s.ok('11/6 は31日目', b.day, 31);
      s.ok('締め日までの支出だけ数える', b.spent, 3000);
      s.ok('1日の予算は、会計月の日数で割る', b.perDay, Math.round(93000 / 31));

      s.ok('締め日の翌日からは、次の月ぶん', await page.evaluate(() => {
        const x = window.DL.expenses.dailyBudget('2026-11-07');
        return [x.day, x.spent];
      }), [1, 5000]);

      /* ---- 節約実績も同じ区切り ---- */
      s.ok('節約実績は、会計月のはじめから数える', await page.evaluate(() => {
        const r = window.DL.expenses.savingRecord('2026-11-06');
        return [r.rows.length, r.rows[0].date, r.rows[r.rows.length - 1].date];
      }), [31, '2026-10-07', '2026-11-06']);

      /* ---- 月ごとのグラフ ---- */
      s.ok('月ごとも、会計月でまとまる', await page.evaluate(() => {
        const E = window.DL.expenses, S = window.DL.store;
        const rows = S.expenses({ from: E.cycleStart('2026-01'), to: E.cycleEnd('2026-12') });
        const by = E.byMonth(rows, 2026);
        return by.filter((m) => m.amount).map((m) => m.ym + ':' + m.amount);
      }), ['2026-10:3000', '2026-11:5000']);

      /* ---- 固定費 ---- */
      await page.evaluate(() => {
        const S = window.DL.store;
        // 27日に出る家賃と、3日に出る通信費
        S.addRecurring({ book: 'life', name: '家賃', amount: 60000,
          category: '住居', day: 27, startYm: '2026-10' });
        S.addRecurring({ book: 'life', name: '通信費', amount: 5000,
          category: '通信費', day: 3, startYm: '2026-10' });
      });
      s.ok('その月に出る固定費が、両方とも入る', await page.evaluate(
        () => window.DL.expenses.fixedOfMonth('2026-10')), 65000);

      /* 10/27 と 11/3 の支払いは、どちらも「10月ぶん」 */
      s.ok('締め日またぎの固定費も、同じ月に数える', await page.evaluate(() => {
        const E = window.DL.expenses;
        return [E.cycleOf('2026-10-27'), E.cycleOf('2026-11-03')];
      }), ['2026-10', '2026-10']);

      /* ---- 貯金 ---- */
      s.ok('貯金の増えぶんも、会計月で見る', await page.evaluate(() => {
        const S = window.DL.store;
        S.setSavingsGoal ? null : null;
        S.mergeSavingsHistory({
          '2026-10-06': 300000,   // 9月ぶん
          '2026-10-20': 320000,   // 10月ぶん
          '2026-11-05': 340000    // まだ10月ぶん
        });
        return window.DL.bank.gainOfMonth('2026-10');
      }), 40000);

      /* ---- 前からあるものの整理 ----
         固定費は「毎月何日」と、どこまで記録したかの覚え書き（月の名前）を持つ。
         締め日より前に出るもの（1〜6日）は、これまで「11月ぶん」と呼んでいた
         11月3日の支払いが、これからは「10月ぶん」になる。覚え書きだけずらす */
      s.ok('締め日より前に出る固定費は、覚え書きを1つ前へずらす', await page.evaluate(() => {
        const S = window.DL.store;
        const before = {
          schema: 1, projects: [],
          settings: {
            closeDay: 6,
            recurring: [
              { id: 'r1', book: 'life', name: '通信費', amount: 5000, category: '通信費',
                day: 3, startYm: '2026-04', lastYm: '2026-11', skipYm: ['2026-08'] },
              { id: 'r2', book: 'life', name: '家賃', amount: 60000, category: '住居',
                day: 27, startYm: '2026-04', lastYm: '2026-10', skipYm: ['2026-08'] }
            ]
          }
        };
        S.importJSON(JSON.stringify(before));
        return S.recurring().map((r) => r.name + ':' + r.startYm + '/' + r.lastYm
          + '/' + (r.skipYm || []).join(','));
      }), ['通信費:2026-03/2026-10/2026-07', '家賃:2026-04/2026-10/2026-08']);

      s.ok('2度目の読み込みでは、もうずらさない', await page.evaluate(() => {
        const S = window.DL.store;
        const again = JSON.parse(JSON.stringify({
          schema: 1, projects: [], settings: S.settings
        }));
        S.importJSON(JSON.stringify(again));
        return S.recurring().map((r) => r.name + ':' + r.lastYm);
      }), ['通信費:2026-10', '家賃:2026-10']);

      /* 整理したあとのデータで、また組み立て直す */
      await page.evaluate(() => {
        const S = window.DL.store;
        S.clearAll(true);
        S.updateSettings({ lifeBudget: 93000, closeDay: 6 });
        S.addExpense({ book: 'life', date: '2026-10-08', amount: 1000, category: '食費' });
        S.addExpense({ book: 'life', date: '2026-11-06', amount: 2000, category: '食費' });
        S.addExpense({ book: 'life', date: '2026-11-07', amount: 5000, category: '食費' });
      });

      /* ---- カレンダーどおりに戻せる ---- */
      await setClose(page, 0);
      s.ok('0 にすると、カレンダーの月に戻る', await cyc(page, '2026-11-06'), '2026-11');
      s.ok('日数も暦どおり', await page.evaluate(
        () => window.DL.expenses.cycleDays('2026-11')), 30);
      s.ok('区切りの言いかたは出さない', await page.evaluate(
        () => window.DL.expenses.cycleLabel('2026-11')), '');
      s.ok('1日の予算も暦どおり', await page.evaluate(() => {
        const x = window.DL.expenses.dailyBudget('2026-11-06');
        return [x.days, x.day, x.spent];
      }), [30, 6, 7000]);

      await setClose(page, 6);

      /* ---- 画面 ---- */
      await page.evaluate(async () => {
        location.hash = '#/books';
        await new Promise((r) => setTimeout(r, 500));
      });
      const text = await page.locator('.view').innerText();
      s.yes('経理に区切りが出る', /\d+\/\d+〜\d+\/\d+/.test(text));
      s.yes('「◯月ぶんの予算」と書く', text.indexOf('月ぶんの予算') >= 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
