/**
 * 表紙の工程。
 *
 * 本文はページごとにマス目で追えるが、表紙は1枚なので同じ表に載らない。
 * そこで工程に重みを持たせて、終えたぶんの重みで進みぐあいを出す。
 *
 *   ラフ 10 → 下書き 20 → 線画 30 → 塗り 30 → 仕上げ 10
 *
 * 確かめたいのは4つ。
 *  ・重みを足した割合が出ること（順に押しても、飛ばして押しても）
 *  ・戻せること、終えた日が残ること
 *  ・工程の名前と重みを変えられること（消した工程の印は残さない）
 *  ・ページで数える工程が無い案件（表紙だけ）でも使えること
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 表紙つきの案件をひとつ作る */
const setup = (page) => page.evaluate(() => {
  const U = window.DL.util, S = window.DL.store;
  const pr = S.createProject({
    name: '冬の新刊', category: 'manga', qty: 20,
    deadline: U.addDays(U.today(), 30), status: 'active'
  });
  S.addTask(pr.id, { name: '下書き', unit: 'page', qty: 20 });
  S.setPageTotal(pr.id, 20);
  S.setCoverOn(pr.id, true);
  return pr.id;
});

const pace = (page, pid) => page.evaluate((id) => {
  const c = window.DL.schedule.coverPace(window.DL.store.getProject(id));
  return { pct: c.pct, done: c.doneCount, count: c.count,
    next: c.next ? c.next.label : null, finished: c.finished };
}, pid);

export default {
  name: '表紙の工程',
  async run({ base }) {
    const s = sheet('表紙の工程');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      const pid = await setup(page);
      const today = await page.evaluate(() => window.DL.util.today());

      /* ---- はじめの5工程 ---- */
      s.ok('ラフ・下書き・線画・塗り・仕上げ', await page.evaluate(
        (id) => window.DL.store.coverSteps(window.DL.store.getProject(id))
          .map((x) => x.label + x.weight),
        pid), ['ラフ10', '下書き20', '線画30', '塗り30', '仕上げ10']);
      s.ok('合わせて100', await page.evaluate(
        (id) => window.DL.store.coverSteps(window.DL.store.getProject(id))
          .reduce((n, x) => n + x.weight, 0), pid), 100);
      s.ok('はじめは0%', await pace(page, pid),
        { pct: 0, done: 0, count: 5, next: 'ラフ', finished: false });

      /* ---- 順に終える ---- */
      const mark = (k, on) => page.evaluate(
        (a) => window.DL.store.setCoverDone(a.id, a.k, a.on, a.d),
        { id: pid, k: k, on: on === undefined ? true : on, d: today });

      await mark('rough');
      s.ok('ラフで10%', (await pace(page, pid)).pct, 10);
      await mark('draft');
      s.ok('下書きまでで30%', (await pace(page, pid)).pct, 30);
      await mark('line');
      s.ok('線画まででちょうど60%', await pace(page, pid),
        { pct: 60, done: 3, count: 5, next: '塗り', finished: false });

      /* 飛ばして押しても、重みのぶんだけ進む（やる順は人それぞれなので） */
      await mark('finish');
      s.ok('仕上げを先に終えても足される', (await pace(page, pid)).pct, 70);
      await mark('color');
      s.ok('ぜんぶ終えて100%', await pace(page, pid),
        { pct: 100, done: 5, count: 5, next: null, finished: true });

      /* ---- 戻せる ---- */
      await mark('color', false);
      s.ok('戻すと、そのぶん減る', (await pace(page, pid)).pct, 70);
      s.yes('終えた日が残っている', await page.evaluate((a) => {
        const c = window.DL.store.getProject(a.id).pages.cover;
        return c.done.rough === a.d && c.done.color === undefined;
      }, { id: pid, d: today }));

      /* ---- 工程を変える ---- */
      s.ok('名前と重みを変えられる', await page.evaluate((id) => {
        const S = window.DL.store;
        S.setCoverSteps(id, [
          { key: 'rough', label: 'ラフ', weight: 20 },
          { key: 'line', label: 'ペン入れ', weight: 50 },
          { key: 'finish', label: '仕上げ', weight: 30 }
        ]);
        return S.coverSteps(S.getProject(id)).map((x) => x.label + x.weight);
      }, pid), ['ラフ20', 'ペン入れ50', '仕上げ30']);

      /* 消した工程（下書き・塗り）の印は残さない。残すと数が合わなくなる */
      s.ok('消した工程の印は落とす', await page.evaluate(
        (id) => Object.keys(window.DL.store.getProject(id).pages.cover.done).sort(), pid),
      ['finish', 'line', 'rough']);
      s.ok('変えたあとの割合', (await pace(page, pid)).pct, 100);

      s.ok('はじめの5つに戻せる', await page.evaluate((id) => {
        const S = window.DL.store;
        S.setCoverSteps(id, null);
        return S.coverSteps(S.getProject(id)).map((x) => x.label);
      }, pid), ['ラフ', '下書き', '線画', '塗り', '仕上げ']);

      /* ---- 画面 ---- */
      await page.evaluate(async (id) => {
        location.hash = '#/pages/' + id;
        await new Promise((r) => setTimeout(r, 500));
      }, pid);
      s.ok('表紙の札が5つ出る', await page.locator('.cv-step').count(), 5);
      s.yes('終えた工程は塗られている', (await page.locator('.cv-step.on').count()) >= 1);

      const before = (await pace(page, pid)).pct;
      await page.locator('.cv-step').nth(1).click();   // 下書き
      await page.waitForTimeout(400);
      s.ok('押すと進みぐあいが変わる',
        (await pace(page, pid)).pct, before + 20);
      s.yes('画面の割合も変わる',
        (await page.locator('.cv-pct').innerText()).indexOf(String(before + 20)) >= 0);

      /* 案件の詳細にも出る */
      await page.evaluate(async (id) => {
        location.hash = '#/project/' + id;
        await new Promise((r) => setTimeout(r, 500));
      }, pid);
      s.yes('案件の詳細に表紙の行が出る',
        (await page.locator('.view').innerText()).indexOf('表紙') >= 0);

      /* ---- ページで数える工程が無い案件でも使える ---- */
      const illust = await page.evaluate(() => {
        const U = window.DL.util, S = window.DL.store;
        const pr = S.createProject({
          name: '表紙だけのお仕事', category: 'illust', qty: 1,
          deadline: U.addDays(U.today(), 14), status: 'active'
        });
        S.setCoverOn(pr.id, true);
        S.setCoverDone(pr.id, 'rough', true);
        S.setCoverDone(pr.id, 'draft', true);
        return pr.id;
      });
      s.ok('ページの工程が無くても数えられる', (await pace(page, illust)).pct, 30);
      await page.evaluate(async (id) => {
        location.hash = '#/pages/' + id;
        await new Promise((r) => setTimeout(r, 500));
      }, illust);
      s.ok('その案件でも表紙の札は出る', await page.locator('.cv-step').count(), 5);

      /* ---- 出さないこともできる ---- */
      await page.evaluate((id) => window.DL.store.setCoverOn(id, false), illust);
      s.ok('下げると on が落ちる', (await page.evaluate(
        (id) => window.DL.schedule.coverPace(window.DL.store.getProject(id)).on, illust)), false);
      await page.evaluate(async (id) => {
        location.hash = '#/project/' + id;
        await new Promise((r) => setTimeout(r, 500));
      }, illust);
      s.ok('詳細にも出さない',
        await page.locator('a[href="#/pages/' + illust + '"]').count(), 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
