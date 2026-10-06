/**
 * 出ていくお金の年表。
 *
 * 固定費（毎月）とちがって、年払い・住民税の4期・数年に一度の更新料を持つ。
 * ここで確かめたいのは4つ。
 *
 *   ・いつ出ていくかを、正しく並べられる（周期・年の決まった日・一度きり）
 *   ・毎月いくら取りのければ足りるかを、正しく出せる
 *   ・その取りのけを、1日の予算から先に引いている
 *   ・払ったら次の回へ送り、同じものを二度催促しない
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/* 日付を散らかさないよう、基準日を決めて組み立てる */
const BASE = '2026-04-10';

/** 年表を1件入れる */
const add = (page, data) => page.evaluate(
  (d) => window.DL.store.addOutgo(d).id, data);

const dates = (page, id, from, to) => page.evaluate((a) => {
  const x = window.DL.store.getOutgo(a.id);
  return window.DL.outgo.occurrencesOf(x, a.from, a.to).map((o) => o.date);
}, { id, from, to });

/** その月に出ていくものを「名前×回数」で */
const month = (page, ym) => page.evaluate((m) => {
  const by = {};
  window.DL.outgo.ofMonth(m, { includePaid: true })
    .forEach((o) => { by[o.name] = (by[o.name] || 0) + 1; });
  return by;
}, ym);

export default {
  name: '出ていくお金の年表',
  async run({ base }) {
    const s = sheet('出ていくお金の年表');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      /* ---- 何ヶ月ごと ---- */
      const hoken = await add(page, {
        name: '火災保険', amount: 24000, book: 'life', category: '保険',
        kind: 'cycle', months: 12, next: '2026-07-01'
      });
      s.ok('毎年のものが、1年ごとに並ぶ',
        await dates(page, hoken, BASE, '2029-01-01'),
        ['2026-07-01', '2027-07-01', '2028-07-01']);

      const shaken = await add(page, {
        name: '車検', amount: 90000, book: 'life', category: 'その他',
        kind: 'cycle', months: 24, next: '2026-05-20'
      });
      s.ok('2年ごとのものは、2年あく',
        await dates(page, shaken, BASE, '2030-12-31'),
        ['2026-05-20', '2028-05-20', '2030-05-20']);

      /* ---- 年の決まった日（住民税の4期） ---- */
      const zei = await add(page, {
        name: '住民税', amount: 45000, book: 'life', category: '税金',
        kind: 'dates', dates: ['06-30', '08-31', '10-31', '01-31'],
        // 年の決まった日は「入れた日より前の回」を数えない。
        // 去年ぶんを催促しないための決まりなので、入れた日も決めておく
        at: '2026-01-05T00:00:00.000Z'
      });
      /* 1月ぶんは払ってある。払っていなければ、過ぎた回は催促される */
      s.yes('払う前は、過ぎた回を催促する',
        (await page.evaluate((d) => window.DL.outgo.alerts(d).map((a) => a.text), '2026-05-15'))
          .some((t) => t.indexOf('住民税') === 0));
      await page.evaluate((id) => window.DL.outgo.markPaid(id, '2026-01-31'), zei);

      s.ok('4期は、その年の決まった日に並ぶ',
        await dates(page, zei, BASE, '2027-02-01'),
        ['2026-06-30', '2026-08-31', '2026-10-31', '2027-01-31']);

      /* ---- 一度きり ---- */
      const hikkoshi = await add(page, {
        name: '引っ越し', amount: 150000, book: 'life', category: 'その他',
        kind: 'once', next: '2026-09-01'
      });
      s.ok('一度きりのものは、1回だけ',
        await dates(page, hikkoshi, BASE, '2030-12-31'), ['2026-09-01']);

      /* ---- 毎月いくら取りのけるか ---- */
      const per = await page.evaluate((d) => {
        const p = window.DL.outgo.perMonth(d);
        const by = {};
        p.rows.forEach((r) => { by[r.x.name] = r.per; });
        return { total: p.total, by: by };
      }, BASE);
      s.ok('毎年24000円は、月2000円', per.by['火災保険'], 2000);
      s.ok('2年ごとの90000円は、月3750円', per.by['車検'], 3750);
      s.ok('年4回45000円は、月15000円', per.by['住民税'], 15000);
      /* 一度きりは、残りの月数で割る。
         月は会計月（6日締め＝7日〜翌月6日）なので、9/1 の支払いは「8月ぶん」。
         4月ぶんから8月ぶんまで、今月を入れて5ヶ月 → 30000。
         暦の月で数えると6ヶ月に見えるが、それだと9/1 に間に合わない */
      s.ok('一度きりは、残りの月数で割る', per.by['引っ越し'], 30000);
      s.ok('合計', per.total, 2000 + 3750 + 15000 + 30000);

      /* ---- 取りのけないことにしたら、数えない ---- */
      await page.evaluate((id) => window.DL.store.updateOutgo(id, { saveUp: false }), hikkoshi);
      s.ok('取りのけないものは、毎月のぶんに入らない',
        await page.evaluate((d) => window.DL.outgo.perMonth(d).total, BASE),
        2000 + 3750 + 15000);

      /* ---- 1日の予算から先に引く ---- */
      const budget = await page.evaluate((d) => {
        const S = window.DL.store;
        S.updateSettings({ lifeBudget: 300000 });
        const before = window.DL.expenses.dailyBudget(d);
        return { month: before.month, fixed: before.fixed,
          reserve: before.reserve, budget: before.budget };
      }, BASE);
      s.ok('予算から、取りのけが引かれている',
        budget.budget, budget.month - budget.fixed - budget.reserve);
      s.ok('引いた額は、毎月の取りのけと同じ', budget.reserve, 2000 + 3750 + 15000);

      /* ---- 月ごとの山。同じものを二度数えない ----
         払い残しを拾う仕掛けが月ごとの集計にも効いていて、
         先の月ほど金額がふくらんでいく不具合があった */
      s.ok('その月に出ていくものだけを数える',
        await month(page, '2027-07'), { 火災保険: 1 });
      s.ok('何も無い月は、空のまま', await month(page, '2027-09'), {});
      s.ok('同じ月に2回あるものは、2回と数える',
        await month(page, '2026-06'), { 住民税: 1 });

      /* ---- 近いものは知らせる ---- */
      const al = await page.evaluate((d) => window.DL.outgo.alerts(d).map((a) => a.text), '2026-05-15');
      s.yes('近い支払いが警告に出る', al.some((t) => t.indexOf('車検') === 0));
      s.yes('まだ遠いものは出さない', !al.some((t) => t.indexOf('住民税') === 0));

      /* ---- 払ったら、次の回へ送る ---- */
      const after = await page.evaluate((a) => {
        window.DL.outgo.pay(a.id, '2026-05-20', { amount: 92000, on: '2026-05-20' });
        const x = window.DL.store.getOutgo(a.id);
        const ex = (window.DL.store.settings.expenses || [])
          .filter((e) => e.memo && e.memo.indexOf('車検') === 0)[0] || {};
        return { next: x.next,
          paid: window.DL.outgo.isPaid(x, '2026-05-20'),
          amount: ex.amount, book: ex.book, category: ex.category, date: ex.date };
      }, { id: shaken });
      s.ok('次の回へ送られる', after.next, '2028-05-20');
      s.ok('払った印が付く', after.paid, true);
      s.ok('経費にも、払った額で入る',
        [after.amount, after.book, after.category, after.date],
        [92000, 'life', 'その他', '2026-05-20']);
      s.yes('払ったものは、もう催促しない',
        !(await page.evaluate((d) => window.DL.outgo.alerts(d).map((a) => a.text), '2026-05-21'))
          .some((t) => t.indexOf('車検') === 0));

      /* ---- 払い残しは、過ぎても出す ---- */
      s.yes('払っていない回は、日が過ぎても催促する',
        (await page.evaluate((d) => window.DL.outgo.alerts(d).map((a) => a.text), '2026-07-20'))
          .some((t) => t.indexOf('火災保険') === 0 && t.indexOf('超過') > 0));

      /* ---- 押し間違えたら戻せる ---- */
      s.ok('払った印を外すと、その回に戻る',
        await page.evaluate((a) => {
          window.DL.outgo.unmarkPaid(a.id, '2026-05-20');
          return window.DL.store.getOutgo(a.id).next;
        }, { id: shaken }),
        '2026-05-20');

      /* ---- 画面 ---- */
      await page.evaluate(() => { location.hash = '#/outgo'; });
      await page.waitForTimeout(400);
      s.yes('年表の画面が出る',
        (await page.locator('.view').innerText()).indexOf('毎月の取りのけ') >= 0);
      s.yes('これから出ていくものが並ぶ',
        (await page.locator('.og-row').count()) >= 3);
      s.ok('月ごとの山が12ヶ月ぶん並ぶ', await page.locator('.og-bar').count(), 12);

      /* 経理の画面にも入口がある */
      await page.evaluate(() => { location.hash = '#/books'; });
      await page.waitForTimeout(400);
      s.yes('経理から年表へ行ける',
        (await page.locator('.view').innerText()).indexOf('出ていくお金') >= 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
