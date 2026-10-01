/**
 * 前に作った料理の選び方。
 *
 * これまでは献立まるごとしか選べず、主菜と副菜が必ずセットで付いてきた。
 * 「主菜はこの日の、副菜は別の日の」と組めるようにする。
 *
 * 一品ぶんの食材は分けて控えていないので、買うものはもとの日のぶんから
 * 選んでもらう。そこも含めて見る。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 前に作った献立を2日ぶん置く。主菜と副菜が別の日に入っている */
const seed = (page) => page.evaluate(() => {
  const S = window.DL.store, U = window.DL.util, T = U.today();
  // 献立の一枚は、予算か献立が無いと出ない。予算を入れておく
  S.updateSettings({ lifeBudget: 60000 });
  const a = U.addDays(T, -3), b = U.addDays(T, -2);
  S.setMenu(a, {
    servings: 1,
    meals: [{ slot: 'dinner', name: '生姜焼き定食', dishes: [
      { role: '主菜', name: '豚の生姜焼き', seasonings: [{ name: 'しょうゆ', qty: '大さじ1' }], steps: ['焼く'] },
      { role: '副菜', name: 'キャベツの千切り', seasonings: [], steps: ['切る'] }
    ] }],
    shopping: [
      { name: '豚ロース', qty: '200g', price: 400 },
      { name: 'キャベツ', qty: '1/4玉', price: 120 }
    ]
  });
  S.setMenu(b, {
    servings: 1,
    meals: [{ slot: 'dinner', name: '鮭の塩焼き', dishes: [
      { role: '主菜', name: '鮭の塩焼き', seasonings: [{ name: '塩', qty: '少々' }], steps: ['焼く'] },
      { role: '副菜', name: 'ほうれん草のおひたし', seasonings: [], steps: ['ゆでる'] }
    ] }],
    shopping: [
      { name: '鮭', qty: '2切', price: 380 },
      { name: 'ほうれん草', qty: '1束', price: 160 }
    ]
  });
  return { a: a, b: b };
});

const menuNow = (page) => page.evaluate(() => {
  const m = window.DL.store.getMenu(window.DL.util.today());
  if (!m) return null;
  return {
    一品: (m.meals || []).reduce((a, x) => a.concat((x.dishes || []).map((d) => (d.role || '—') + ':' + d.name)), []),
    買うもの: (m.shopping || []).map((s) => s.name)
  };
});

/* 献立の一枚は、カレンダーの日別画面にある。そこを開いてから触る */
async function openDay(page, base) {
  const today = await page.evaluate(() => window.DL.util.today());
  await open(page, base, '#/day/' + today);
  await page.waitForSelector('.mn-card');
}

/* 「前に作ったものから選ぶ」を開く。入口はその日の様子で名前が変わる */
async function openPast(page) {
  const star = page.locator('[aria-label="前に作った献立から選ぶ"]');
  if (await star.count()) await star.first().click();
  else await page.locator('button:has-text("前のから選ぶ")').first().click();
  await page.waitForSelector('.sheet-title:has-text("前に作ったものから選ぶ")');
}

export default {
  name: '前に作った料理を一品ずつ',
  async run({ base }) {
    const s = sheet('前に作った料理を一品ずつ');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      await seed(page);

      /* 店の仕組み（store）の側。献立からばらして取り出せること */
      const dishes = await page.evaluate(() =>
        window.DL.store.pastDishes({ before: window.DL.util.today() })
          .map((r) => (r.role || '—') + ':' + r.name));
      s.note('前に作った一品: ' + dishes.join(' / '));
      s.ok('4品ばらして取り出せる', dishes.length, 4);
      s.yes('主菜だけ絞れる',
        (await page.evaluate(() => window.DL.store.pastDishes({
          before: window.DL.util.today(), role: '主菜'
        }).map((r) => r.name))).join(',') === '鮭の塩焼き,豚の生姜焼き');

      /* 画面の側。「一品ずつ」に切り替えて、主菜を1つ入れる */
      await openDay(page, base);
      await openPast(page);
      await page.click('.sheet-body button:has-text("一品ずつ")');
      await page.waitForTimeout(250);
      const heads = await page.$$eval('.sheet-body .section-title, .sheet-body .section',
        (ns) => ns.map((n) => n.textContent.trim()).filter(Boolean));
      s.note('並び: ' + JSON.stringify(heads));
      s.yes('役どころごとに分かれている', heads.some((h) => h.indexOf('主菜') >= 0));

      await page.click('.sheet-body .pm-row:has-text("鮭の塩焼き")');
      await page.waitForSelector('.sheet-title:has-text("鮭の塩焼き")');
      s.yes('買うものがその日のぶんから並ぶ',
        (await page.locator('.sheet-body .mn-buy').count()) === 2);
      // 「ほうれん草」は、この一品には要らないので外す
      await page.click('.sheet-body .mn-buy:has-text("ほうれん草") input');
      await page.click('.sheet-foot button:has-text("この一品を入れる")');
      await page.waitForTimeout(500);

      let now = await menuNow(page);
      s.note('入れたあと: ' + JSON.stringify(now));
      s.ok('主菜だけ入った', now.一品, ['主菜:鮭の塩焼き']);
      s.ok('選んだ買うものだけ足される', now.買うもの, ['鮭']);

      /* 別の日の副菜を足す。主菜はそのまま残ること */
      await openDay(page, base);
      await openPast(page);
      await page.click('.sheet-body button:has-text("一品ずつ")');
      await page.waitForTimeout(250);
      await page.click('.sheet-body .pm-row:has-text("キャベツの千切り")');
      await page.waitForSelector('.sheet-title:has-text("キャベツの千切り")');
      await page.click('.sheet-foot button:has-text("この一品を入れる")');
      await page.waitForTimeout(500);

      now = await menuNow(page);
      s.note('副菜を足したあと: ' + JSON.stringify(now));
      s.ok('主菜はそのままで、副菜が足される',
        now.一品, ['主菜:鮭の塩焼き', '副菜:キャベツの千切り']);

      /* 同じ役どころを入れると、入れ替わる（2つに増えない） */
      await openDay(page, base);
      await openPast(page);
      await page.click('.sheet-body button:has-text("一品ずつ")');
      await page.waitForTimeout(250);
      await page.click('.sheet-body .pm-row:has-text("豚の生姜焼き")');
      await page.waitForSelector('.sheet-title:has-text("豚の生姜焼き")');
      // シートは重なるので、いちばん上（最後）のものを見る
      s.yes('入れ替わることを先に伝えている',
        /「鮭の塩焼き」と入れ替わります/.test(
          await page.locator('.sheet-body').last().innerText()));
      await page.click('.sheet-foot button:has-text("この一品を入れる")');
      await page.waitForTimeout(500);

      now = await menuNow(page);
      s.note('主菜を入れ替えたあと: ' + JSON.stringify(now));
      s.ok('主菜が入れ替わり、2つに増えない',
        now.一品, ['主菜:豚の生姜焼き', '副菜:キャベツの千切り']);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
