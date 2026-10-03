/**
 * 備えの棚（備蓄と消耗品）。
 *
 * 確かめたいのは4つ。
 *
 *   ・備蓄は期限ごとの束で持ち、古いものから使う（ローリングストック）
 *   ・期限の切れたものは「あっても無い」ものとして数え、買うものに出す
 *   ・消耗品は、使うペースから次に買う日を読む
 *   ・買うものは買い物リストへ自分から積み、二度は積まない
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

const add = (page, d) => page.evaluate((x) => window.DL.store.addSupply(x).id, d);

const names = (page, date) => page.evaluate(
  (d) => window.DL.supply.dueBuy(d).map((o) => o.x.name + '×' + o.qty), date);

const shop = (page) => page.evaluate(
  () => window.DL.store.shopItems().map((o) => o.name));

export default {
  name: '備えの棚',
  async run({ base }) {
    const s = sheet('備えの棚');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      const today = await page.evaluate(() => window.DL.util.today());
      const d = (n) => page.evaluate((k) => window.DL.util.addDays(window.DL.util.today(), k), n);

      /* ---- 備蓄：期限ごとの束 ---- */
      const mizu = await add(page, {
        name: '水（2L）', kind: 'stock', unit: '本', need: 18,
        lots: [
          { until: await d(400), qty: 12 },
          { until: await d(30), qty: 6 }
        ]
      });
      s.ok('束を足して数える', await page.evaluate(
        (id) => window.DL.supply.have(window.DL.store.getSupply(id)), mizu), 18);
      s.ok('目標に届いていれば、買うものに出さない', await names(page, today), []);

      s.ok('期限の近い束が先に並ぶ', await page.evaluate(
        (id) => window.DL.supply.lots(window.DL.store.getSupply(id)).map((l) => l.qty), mizu),
      [6, 12]);

      /* 古いものから使う */
      await page.evaluate((id) => window.DL.supply.spend(id), mizu);
      s.ok('使うと、期限の近い束から減る', await page.evaluate(
        (id) => window.DL.supply.lots(window.DL.store.getSupply(id)).map((l) => l.qty), mizu),
      [5, 12]);
      s.ok('減ったぶんが、買うものに出る', await names(page, today), ['水（2L）×1']);

      /* ---- 期限が切れたら、あっても数えない ---- */
      const kan = await add(page, {
        name: '缶詰', kind: 'stock', unit: '缶', need: 9,
        lots: [{ until: await d(-10), qty: 9 }]
      });
      s.ok('手元にはある', await page.evaluate(
        (id) => window.DL.supply.have(window.DL.store.getSupply(id)), kan), 9);
      s.yes('でも、まるごと買うものに出る',
        (await names(page, today)).indexOf('缶詰×9') >= 0);
      s.ok('でも、使えるぶんは0', await page.evaluate(
        (id) => window.DL.supply.usable(window.DL.store.getSupply(id)), kan), 0);
      s.ok('期限が切れてしまったぶんは、別に数える', await page.evaluate(
        (id) => window.DL.supply.dead(window.DL.store.getSupply(id)), kan), 9);
      s.yes('期限切れとして知らせる',
        (await page.evaluate(() => window.DL.supply.alerts().map((a) => a.text)))
          .some((t) => t.indexOf('缶詰の期限が切れています') === 0));

      /* ---- 消耗品：使うペースから読む ---- */
      // 30日もつものを、20日前に開けた。予備は1つ。届くまで3日
      const lens = await add(page, {
        name: 'コンタクトレンズ', kind: 'use', unit: '箱', days: 30,
        have: 1, lastAt: await d(-20), lead: 3
      });
      s.ok('切れるのは、いま開けているぶん＋予備のぶん',
        await page.evaluate((id) => window.DL.supply.runOutOn(window.DL.store.getSupply(id)), lens),
        await d(40));
      s.ok('買うのは、その3日前',
        await page.evaluate((id) => window.DL.supply.buyOn(window.DL.store.getSupply(id)), lens),
        await d(37));
      s.yes('まだ買うものには出ない',
        (await names(page, today)).indexOf('コンタクトレンズ×1') < 0);
      s.yes('買う日が来たら出る',
        (await names(page, await d(37))).indexOf('コンタクトレンズ×1') >= 0);

      /* 予備が無くなれば、もっと早く出る */
      await page.evaluate((id) => window.DL.supply.spend(id), lens);
      s.ok('開けると、そこから数えなおす', await page.evaluate(
        (id) => {
          const x = window.DL.store.getSupply(id);
          return [x.have, x.lastAt];
        }, lens), [0, today]);
      s.ok('次に切れるのは30日後',
        await page.evaluate((id) => window.DL.supply.runOutOn(window.DL.store.getSupply(id)), lens),
        await d(30));

      /* ---- 買い物リストへ積む ---- */
      s.ok('はじめは空', await shop(page), []);
      const r1 = await page.evaluate(() => window.DL.supply.sync());
      s.ok('買うものが積まれる', r1.added.sort(), ['水（2L）', '缶詰']);
      s.ok('買い物リストに入っている', (await shop(page)).sort(), ['水（2L）', '缶詰']);

      s.ok('もう一度やっても、二度は積まない',
        (await page.evaluate(() => window.DL.supply.sync())).added, []);
      s.ok('増えていない', (await shop(page)).length, 2);

      /* 買って足りたら、印が外れる（次に足りなくなればまた積まれる） */
      await page.evaluate((a) => window.DL.supply.restock(a.id, 1, ''), { id: mizu });
      s.ok('買い足すと、積んだ印が外れる',
        await page.evaluate((id) => window.DL.store.getSupply(id).queuedAt, mizu), '');
      s.ok('買うものからも消える',
        (await names(page, today)).indexOf('水（2L）×1'), -1);

      /* ---- 画面 ---- */
      await page.evaluate(() => { location.hash = '#/supply'; });
      await page.waitForTimeout(500);
      const text = await page.locator('.view').innerText();
      s.yes('買うものが出る', text.indexOf('買うもの') >= 0);
      s.yes('期限が出る', text.indexOf('期限') >= 0);
      s.yes('備蓄と消耗品が分かれて出る',
        text.indexOf('備蓄') >= 0 && text.indexOf('消耗品') >= 0);

      await page.evaluate(() => { location.hash = '#/home'; });
      await page.waitForTimeout(500);
      s.yes('ホームから備えの棚へ行ける',
        (await page.locator('a[href="#/supply"]').count()) >= 1);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
