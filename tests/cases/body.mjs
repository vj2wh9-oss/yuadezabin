/**
 * からだの台帳（通院・服薬・健診）。
 *
 * 確かめたいのは4つ。
 *
 *   ・その日に飲むものを、朝・昼・夜・寝る前の順に正しく出せる
 *     （曜日ぎめ、いつからいつまで、やめたもの）
 *   ・飲んだ印は日ごとに持ち、さかのぼって付けられる
 *   ・通院に入れた金額が、経費（日常・医療・健康）にも入り、
 *     医療費を二重に数えない
 *   ・健診の数値が、基準の内か外かで言い分けられる
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

const addMed = (page, d) => page.evaluate((x) => window.DL.store.addMed(x).id, d);

const dose = (page, date) => page.evaluate(
  (d) => window.DL.body.dose(d).map((r) => r.label + ':' + r.med.name), date);

export default {
  name: 'からだの台帳',
  async run({ base }) {
    const s = sheet('からだの台帳');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      const today = await page.evaluate(() => window.DL.util.today());
      /* 曜日に左右されない日を選ぶ。2026-04-13 は月曜 */
      const MON = '2026-04-13', TUE = '2026-04-14';

      /* ---- いつ飲むか ---- */
      const asa = await addMed(page, { name: 'ビタミンD', dose: '1錠', times: ['morning'] });
      await addMed(page, { name: '胃薬', dose: '1包', times: ['morning', 'night'] });
      await addMed(page, { name: '睡眠導入剤', times: ['bed'] });
      // 月曜だけ
      await addMed(page, { name: '週1の薬', times: ['noon'], weekdays: [1] });
      // もうやめたもの
      await addMed(page, { name: 'やめた薬', times: ['morning'], active: false });
      // 期間の切れたもの
      await addMed(page, { name: '抗生剤', times: ['morning'], until: '2026-04-10' });

      s.ok('朝・昼・夜・寝る前の順に並ぶ', await dose(page, MON), [
        '朝:ビタミンD', '朝:胃薬', '昼:週1の薬', '夜:胃薬', '寝る前:睡眠導入剤'
      ]);
      s.ok('曜日を決めたものは、その曜日だけ', await dose(page, TUE), [
        '朝:ビタミンD', '朝:胃薬', '夜:胃薬', '寝る前:睡眠導入剤'
      ]);
      s.yes('やめた薬は出さない',
        !(await dose(page, MON)).some((t) => t.indexOf('やめた薬') > 0));
      s.yes('期間の切れた薬も出さない',
        !(await dose(page, MON)).some((t) => t.indexOf('抗生剤') > 0));

      /* ---- 飲んだ印 ---- */
      s.ok('はじめは誰も飲んでいない',
        await page.evaluate((d) => window.DL.body.progress(d), MON),
        { all: 5, done: 0, left: 5, pct: 0 });

      await page.evaluate((a) => window.DL.body.take(a.date, a.id, 'morning', true),
        { date: MON, id: asa });
      s.ok('1回ぶん飲んだ',
        await page.evaluate((d) => window.DL.body.progress(d).done, MON), 1);
      s.ok('ほかの日には効かない',
        await page.evaluate((d) => window.DL.body.progress(d).done, TUE), 0);
      s.yes('同じくすりの別の回は、まだ飲んでいない扱い',
        !(await page.evaluate((a) => window.DL.body.isTaken(a.date, a.id, 'night'),
          { date: MON, id: asa })));

      s.ok('印は外せる', await page.evaluate((a) => {
        window.DL.body.take(a.date, a.id, 'morning', false);
        return window.DL.body.progress(a.date).done;
      }, { date: MON, id: asa }), 0);

      /* ---- 続きぐあい ----
         今日入れたばかりのくすりを「2週間さぼった」とは言わない */
      s.ok('飲みはじめる前は、飲み忘れに数えない',
        await page.evaluate(() => window.DL.body.keep(window.DL.util.today(), 14).all), 0);
      s.ok('飲みはじめた日から数える', await page.evaluate(() => {
        const U = window.DL.util, S = window.DL.store, B = window.DL.body;
        const id = S.addMed({ name: '前からの薬', times: ['morning'],
          from: U.addDays(U.today(), -5) }).id;
        B.take(U.addDays(U.today(), -1), id, 'morning', true);
        const k = B.keep(U.today(), 14);
        return [k.all, k.done, k.missed.length];
      }), [5, 1, 4]);

      /* ---- 通院と医療費 ---- */
      const y = today.slice(0, 4);
      await page.evaluate((a) => {
        const S = window.DL.store;
        const ex = S.addExpense({ book: 'life', date: a.today, amount: 1200,
          category: '医療・健康', vendor: 'さくら内科', memo: '診察' });
        S.addVisit({ date: a.today, place: 'さくら内科', dept: '内科', reason: '風邪',
          cost: 1200, expenseId: ex.id, next: a.next, nextTime: '10:30' });
        // 経費に入れていないぶん（領収書だけ手元にある、など）
        S.addVisit({ date: a.today, place: 'みどり歯科', dept: '歯科', cost: 3300 });
      }, { today: today, next: await page.evaluate(() => window.DL.util.addDays(window.DL.util.today(), 3)) });

      const c = await page.evaluate((yy) => window.DL.body.cost(yy), y);
      s.ok('経費に入れたぶんは、経費のほうで数える', c.byExpense, 1200);
      s.ok('経費に入れていないぶんは、通院のほうで数える', c.byVisit, 3300);
      s.ok('合計は二重にならない', c.total, 4500);
      s.ok('10万円までの残り', c.left, 100000 - 4500);
      s.ok('控除の対象は、まだ0円', c.over, 0);

      s.ok('次の予約が出る',
        await page.evaluate(() => {
          const n = window.DL.body.nextVisit();
          return n ? n.place : null;
        }), 'さくら内科');
      s.yes('予約が近ければ知らせる',
        (await page.evaluate(() => window.DL.body.alerts().map((a) => a.text)))
          .some((t) => t.indexOf('さくら内科') === 0));

      /* ---- 健診 ---- */
      await page.evaluate(() => {
        const S = window.DL.store;
        S.addCheckup({ date: '2025-05-20', name: '健診',
          values: { bmi: 23.4, bpHigh: 124, hba1c: 5.4, ggt: 38, ldl: 118 } });
        S.addCheckup({ date: '2026-05-18', name: '健診',
          values: { bmi: 25.8, bpHigh: 138, hba1c: 5.9, ggt: 44, ldl: 112 } });
      });

      s.ok('基準の内か外か',
        await page.evaluate(() => ['bmi', 'bpHigh', 'hba1c', 'ggt', 'ldl']
          .map((k) => k + ':' + window.DL.body.judge(k, { bmi: 25.8, bpHigh: 138, hba1c: 5.9, ggt: 44, ldl: 112 }[k]).how)),
        ['bmi:high', 'bpHigh:high', 'hba1c:high', 'ggt:ok', 'ldl:ok']);
      s.ok('低いほうにも外れる',
        await page.evaluate(() => window.DL.body.judge('hdl', 32).how), 'low');
      s.ok('基準の無い数値は、何も言わない',
        await page.evaluate(() => window.DL.body.judge('weight', 70)), null);

      s.ok('いちばん新しい回で、外れているものを拾う',
        await page.evaluate(() => window.DL.body.outliers().map((o) => o.label)),
        ['BMI', '血圧（上）', 'HbA1c']);
      s.ok('推移は古い順',
        await page.evaluate(() => window.DL.body.series('bmi').map((r) => r.value)),
        [23.4, 25.8]);
      s.ok('基準の言いかた',
        await page.evaluate(() => ['bmi', 'ggt', 'hdl', 'weight'].map((k) => window.DL.body.rangeLabel(k))),
        ['18.5〜25', '50 まで', '40 以上', '']);

      /* ---- 画面 ---- */
      await page.evaluate(() => { location.hash = '#/body'; });
      await page.waitForTimeout(500);
      const text = await page.locator('.view').innerText();
      s.yes('今日のくすりが出る', text.indexOf('今日のくすり') >= 0);
      s.yes('次の予約が出る', text.indexOf('次の予約') >= 0);
      s.yes('医療費が出る', text.indexOf('医療費控除') >= 0);
      s.yes('健診の数値が並ぶ', (await page.locator('.bd-vital').count()) >= 5);

      /* 今日ぶんのくすりがあれば、ホームにも並ぶ */
      await page.evaluate(() => { location.hash = '#/home'; });
      await page.waitForTimeout(500);
      s.yes('ホームの「今日やること」にくすりが出る',
        (await page.locator('.home-med').count()) === 1);
      s.yes('ホームから、からだの台帳へ行ける',
        (await page.locator('a[href="#/body"]').count()) >= 1);

      /* ホームで押しても、行はその場に残る（押した手応えが消えないように） */
      const n0 = await page.locator('.home-med .bd-pill').count();
      await page.locator('.home-med .bd-pill input').first().check();
      await page.waitForTimeout(300);
      s.ok('押しても、行はその場に残る',
        await page.locator('.home-med .bd-pill').count(), n0);
      s.ok('押したものに線が引かれる',
        await page.locator('.home-med .bd-pill.on').count(), 1);
      s.yes('残りの数が減る',
        (await page.locator('.home-med .row-title').innerText())
          .indexOf('あと ' + (n0 - 1) + '回') >= 0);
      s.yes('飲んだ印が残っている',
        await page.evaluate(() => window.DL.body.progress().done) === 1);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
