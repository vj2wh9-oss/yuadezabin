/**
 * 家事タブ（カレンダー・冷蔵庫・ゴミの日）。
 *
 * 確かめたいのは5つ。
 *
 *   ・下タブの組み替え（ファイルはホームの入口へ、家事タブが経理の右、トレーニングが右端）
 *   ・冷蔵庫は、置き場ごとに並び、期限の近い順に出る
 *   ・期限が切れたものは「捨てる」として今日やることに出る
 *   ・ゴミの日は曜日（と第何週）で回り、前の晩に知らせる
 *   ・家事タブのカレンダーに、ゴミ・家事・献立が出て、日を押すとその日へ行ける
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

export default {
  name: '家事タブ',
  async run({ base }) {
    const s = sheet('家事タブ');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      const today = await page.evaluate(() => window.DL.util.today());
      const d = (n) => page.evaluate((k) => window.DL.util.addDays(window.DL.util.today(), k), n);

      /* ---- 下タブ ---- */
      s.ok('ファイルは下タブから外れた',
        await page.locator('.tab[data-tab="files"]').count(), 0);
      s.ok('ホームのいちばん下から開ける',
        await page.locator('a[href="#/files"]').count(), 1);
      s.ok('ファイルの画面は、これまでどおり開く', await page.evaluate(async () => {
        location.hash = '#/files';
        await new Promise((r) => setTimeout(r, 500));
        return document.querySelector('.view').className.indexOf('view-files') >= 0;
      }), true);
      s.ok('ファイルを開いているあいだは、ホームの札が点く',
        await page.locator('.tab[data-tab="home"].on').count(), 1);

      /* ---- 冷蔵庫 ---- */
      await page.evaluate(async (a) => {
        const S = window.DL.store;
        S.addFridge({ name: 'ウィンナー', qty: '1', unit: '袋', where: 'fridge',
          until: a.p2, openedAt: a.today });
        S.addFridge({ name: '鶏むね肉', qty: '300', unit: 'g', where: 'freezer', until: a.p30 });
        S.addFridge({ name: '卵', qty: '6', unit: '個', where: 'fridge', until: a.p10 });
        S.addFridge({ name: '切れた牛乳', qty: '1', unit: '本', where: 'fridge', until: a.m2 });
        S.addLeftover({ name: 'ひじきの煮物', qty: '1', unit: 'パック',
          where: 'fridge', until: a.p1, kept: true });
        S.addPantry({ name: 'しょうゆ', where: 'room' });
        location.hash = '#/fridge';
        await new Promise((r) => setTimeout(r, 400));
      }, { today, p1: await d(1), p2: await d(2), p10: await d(10), p30: await d(30), m2: await d(-2) });

      s.ok('置き場ごとに分かれる', await page.evaluate(() => {
        const m = window.DL.fridge.byWhere();
        return { 冷蔵: m.fridge.length, 冷凍: m.freezer.length, 常温: m.room.length };
      }), { 冷蔵: 4, 冷凍: 1, 常温: 1 });

      s.ok('期限の近い順に並ぶ', await page.evaluate(
        () => window.DL.fridge.all().map((r) => r.name)),
      ['切れた牛乳', 'ひじきの煮物', 'ウィンナー', '卵', '鶏むね肉', 'しょうゆ']);

      s.ok('早く食べるものを拾う', await page.evaluate(
        () => window.DL.fridge.watch().map((r) => r.name + ':' + r.left)),
      ['切れた牛乳:-2', 'ひじきの煮物:1', 'ウィンナー:2']);

      s.ok('札が棚に並ぶ', await page.locator('.fr-tile').count(), 6);
      s.ok('期限切れの札は赤い', await page.locator('.fr-tile.over').count(), 1);
      s.ok('もうすぐの札は黄色い', await page.locator('.fr-tile.soon').count(), 2);

      s.yes('もうすぐ切れるものは知らせる',
        (await page.evaluate(() => window.DL.fridge.alerts().map((a) => a.text)))
          .some((t) => t.indexOf('冷蔵庫：') === 0 && t.indexOf('ひじきの煮物') > 0));
      s.yes('切れたものは、ここでは言わない（捨てるほうに出るので）',
        !(await page.evaluate(() => window.DL.fridge.alerts().map((a) => a.text)))
          .some((t) => t.indexOf('切れた牛乳') > 0));

      s.yes('切れたものは「捨てる」として今日やることに出る',
        (await page.evaluate(() => window.DL.store.expiredFood().map((x) => x.kind + ':' + x.item.name)))
          .indexOf('fridge:切れた牛乳') >= 0);

      /* 献立の「使いたい食材」に回すのは、切れそうな食材だけ。
         まだ先の卵も、作り置きのひじきも入れない */
      s.ok('献立に回せる食材を出す',
        await page.evaluate(() => window.DL.fridge.useSoon()), ['ウィンナー']);
      s.ok('期限を延ばせば、そちらも回せる', await page.evaluate(() => {
        const U = window.DL.util, S = window.DL.store;
        const egg = S.fridge().filter((x) => x.name === '卵')[0];
        S.updateFridge(egg.id, { until: U.addDays(U.today(), 4) });
        return window.DL.fridge.useSoon();
      }), ['ウィンナー', '卵']);

      /* ---- ゴミの日 ---- */
      await page.evaluate(() => {
        const S = window.DL.store;
        // 毎週 火・金
        S.addTrash({ name: '燃えるゴミ', color: '#d9534f', weekdays: [2, 5] });
        // 第2・第4 月曜
        S.addTrash({ name: '燃えないゴミ', color: '#7a8aa0', weekdays: [1], weeks: [2, 4] });
      });

      s.ok('毎週のものは、その曜日に出る', await page.evaluate(() => {
        const U = window.DL.util, T = window.DL.trash;
        const t = window.DL.store.trash()[0];
        // 2026-10-06(火) と 2026-10-09(金)、2026-10-07(水) は出ない
        return ['2026-10-06', '2026-10-07', '2026-10-09'].map((d) => T.onDay(t, d));
      }), [true, false, true]);

      s.ok('第n週のものは、その週だけ', await page.evaluate(() => {
        const T = window.DL.trash;
        const t = window.DL.store.trash()[1];
        // 2026年10月の月曜：5日(第1)、12日(第2)、19日(第3)、26日(第4)
        return ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map((d) => T.onDay(t, d));
      }), [false, true, false, true]);

      s.ok('次に出す日が分かる', await page.evaluate(() => {
        const n = window.DL.trash.next('2026-10-07');
        return n ? [n.date, n.rows.map((t) => t.name)] : null;
      }), ['2026-10-09', ['燃えるゴミ']]);

      /* ホームに出すのは今日ぶんだけ。明日ぶんは通知のほうに任せる
         （ホームに毎日2行並ぶとうるさいので） */
      s.ok('明日のぶんは、ホームには出さない', await page.evaluate(() => {
        // 2026-10-08(木) の晩。明日(金)は燃えるゴミだが、ここでは言わない
        return window.DL.trash.alerts('2026-10-08').map((a) => a.text);
      }), []);
      s.ok('今日ぶんは出す', await page.evaluate(() => {
        return window.DL.trash.alerts('2026-10-09').map((a) => a.text);
      }), ['今日は 燃えるゴミ の日です']);

      s.ok('出した印を付けたら、もう言わない', await page.evaluate(() => {
        const T = window.DL.trash, S = window.DL.store;
        const id = S.trash()[0].id;
        const before = T.alerts('2026-10-09').length;
        T.setDone('2026-10-09', id, true);
        return [before, T.alerts('2026-10-09').filter((a) => a.text.indexOf('今日は') === 0).length];
      }), [1, 0]);

      /* ---- 家事タブのカレンダー ---- */
      await page.evaluate(async (a) => {
        const S = window.DL.store;
        S.addChore({ name: '風呂の排水口', every: 7, lastAt: a.m9, place: '風呂' });
        location.hash = '#/chores';
        await new Promise((r) => setTimeout(r, 500));
      }, { m9: await d(-9) });

      s.yes('家事タブにカレンダーが出る', (await page.locator('.cc-cell').count()) >= 28);
      s.yes('ゴミの日に色の帯が出る', (await page.locator('.cc-tr').count()) >= 4);
      s.yes('家事の予定もマスに出る', (await page.locator('.cc-ch').count()) >= 1);
      s.ok('下に家のことの入口が並ぶ', await page.evaluate(() => ['#/fridge', '#/trash', '#/choreplan', '#/supply']
        .map((h) => document.querySelectorAll('a[href="' + h + '"]').length > 0)),
      [true, true, true, true]);

      /* 日を押すと、その日の画面へ */
      await page.evaluate(async (dt) => {
        location.hash = '#/chores/' + dt;
        await new Promise((r) => setTimeout(r, 500));
      }, today);
      const dayText = await page.locator('.view').innerText();
      s.yes('その日の画面に献立が出る', dayText.indexOf('献立') >= 0);
      s.yes('その日の家事が出る', dayText.indexOf('この日の家事') >= 0);
      s.yes('早く食べるものも出る', dayText.indexOf('早く食べるもの') >= 0);

      /* ---- 献立から、そのまま冷蔵庫へ ----
         「作った日」がその日から来ていることを見たいので、今日ではない日で試す
         （今日だと、入力欄の初期値（今日）と見分けが付かない） */
      const cooked = await d(-1);
      await page.evaluate(async (dt) => {
        window.DL.store.setMenu(dt, {
          meals: [{ slot: 'dinner', name: '晩ごはん', dishes: [
            { name: '鶏の照り焼き', role: '主菜' },
            { name: 'かぼちゃの煮物', role: '副菜' }
          ] }],
          shopping: [], total: 0, servings: 1
        });
        location.hash = '#/chores/' + dt;
        await new Promise((r) => setTimeout(r, 500));
      }, cooked);

      s.yes('料理名が、押せる形で並ぶ',
        (await page.locator('.view').innerText()).indexOf('作ったものを冷蔵庫へ') >= 0);
      const dishBtns = page.locator('.card .btn').filter({ hasText: '鶏の照り焼き' });
      s.ok('その料理のボタンがある', await dishBtns.count(), 1);

      /* 押すと、名前と作った日が入った状態で開く。
         同期の接続先が無いので、日もちは「見当」で入る */
      await dishBtns.first().click();
      await page.waitForSelector('.sheet');
      await page.waitForTimeout(600);
      s.ok('料理名が入っている',
        await page.locator('.sheet .input').first().inputValue(), '鶏の照り焼き');
      s.ok('作り置きとして開く',
        (await page.locator('.sheet-title').innerText()).indexOf('作り置き') >= 0, true);
      s.ok('日もちから期限が入る', await page.evaluate(() => {
        const ins = [...document.querySelectorAll('.sheet .input')];
        const until = ins.filter((n) => n.type === 'date')[1];
        return !!(until && until.value);
      }), true);

      await page.locator('.sheet-foot .btn.primary').click();
      await page.waitForTimeout(400);
      s.yes('冷蔵庫に入る', (await page.evaluate(
        () => window.DL.store.leftovers().map((x) => x.name))).indexOf('鶏の照り焼き') >= 0);
      s.ok('作った日と置き場も入る', await page.evaluate(() => {
        const x = window.DL.store.leftovers()
          .filter((o) => o.name === '鶏の照り焼き')[0] || {};
        return [x.from, x.where, x.kept];
      }), [cooked, 'fridge', true]);

      /* もう入れたものは、そう出す */
      await page.evaluate(async (dt) => {
        location.hash = '#/home';
        await new Promise((r) => setTimeout(r, 200));
        location.hash = '#/chores/' + dt;
        await new Promise((r) => setTimeout(r, 500));
      }, cooked);
      s.ok('二度入れないよう、印が変わる', await page.evaluate(() => {
        const b = [...document.querySelectorAll('.card .btn')]
          .filter((n) => n.textContent.indexOf('鶏の照り焼き') >= 0)[0];
        return b ? b.querySelector('svg').getAttribute('class') : '';
      }), 'icon');

      /* ---- 周期表は、別の画面として残っている ---- */
      await page.evaluate(async () => {
        location.hash = '#/choreplan';
        await new Promise((r) => setTimeout(r, 400));
      });
      s.yes('周期表はそのまま使える',
        (await page.locator('.view').innerText()).indexOf('いまやるもの') >= 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
