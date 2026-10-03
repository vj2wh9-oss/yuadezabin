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
      { role: '主菜', name: '豚の生姜焼き', items: [{ name: '豚ロース', qty: '200g' }],
        seasonings: [{ name: 'しょうゆ', qty: '大さじ1' }], steps: ['焼く'] },
      { role: '副菜', name: 'キャベツの千切り', items: [{ name: 'キャベツ', qty: '1/4玉' }],
        seasonings: [], steps: ['切る'] }
    ] }],
    shopping: [
      { name: '豚ロース', qty: '200g', price: 400 },
      { name: 'キャベツ', qty: '1/4玉', price: 120 }
    ]
  });
  S.setMenu(b, {
    servings: 1,
    meals: [{ slot: 'dinner', name: '鮭の塩焼き', dishes: [
      { role: '主菜', name: '鮭の塩焼き', items: [{ name: '鮭', qty: '2切' }],
        seasonings: [{ name: '塩', qty: '少々' }], steps: ['焼く'] },
      { role: '副菜', name: 'ほうれん草のおひたし', items: [{ name: 'ほうれん草', qty: '1束' }],
        seasonings: [], steps: ['ゆでる'] }
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

/* 「前に作ったものから選ぶ」を開く。入口はどの様子でも★の絵だけ */
async function openPast(page) {
  await page.locator('[aria-label="前に作った献立から選ぶ"]').first().click();
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
      /* 一品ごとの食材が分かっているので、その一品に使うものだけ
         はじめから印が付く（ほうれん草は副菜のものなので付かない） */
      const marks = await page.$$eval('.sheet-body .mn-buy', (ns) => ns.map((n) =>
        n.innerText.replace(/\s+/g, ' ').trim() + '=' + (n.querySelector('input').checked ? 'on' : 'off')));
      s.note('はじめの印: ' + marks.join(' / '));
      s.yes('その一品に使うものだけ印が付く',
        marks.some((x) => /^鮭 /.test(x) && /=on$/.test(x))
        && marks.some((x) => /ほうれん草/.test(x) && /=off$/.test(x)));
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
      s.ok('買うものも、その一品ぶんだけ足される', now.買うもの, ['鮭', 'キャベツ']);

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
      s.ok('買うものも入れ替わる（鮭が下りて豚ロースが入る）',
        now.買うもの, ['キャベツ', '豚ロース']);



      /* 買い物リストに出るのは、献立に要るものと手で足したものだけ */
      const T = await page.evaluate(() => window.DL.util.today());
      await open(page, base, '#/home');
      await page.waitForSelector('.mn-card .mn-buy');
      const shown = await page.$$eval('.mn-card .mn-buy .mn-item-n', (ns) => ns.map((n) => n.textContent));
      s.note('買い物リスト: ' + shown.join(' / '));
      s.yes('献立に居ない一品のぶんは出ていない', shown.indexOf('鮭') < 0);

      /* 手で足したぶんは、ちゃんと出る */
      await page.evaluate(() => window.DL.store.addShopItem({ name: 'ラップ', price: 200 }));
      await open(page, base, '#/home');
      await page.waitForSelector('.mn-card .mn-buy');
      s.yes('手で足したものは出る',
        (await page.$$eval('.mn-card .mn-buy .mn-item-n', (ns) => ns.map((n) => n.textContent)))
          .indexOf('ラップ') >= 0);

      /* 2つの一品で使うものは、片方が入れ替わっても下りない */
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        const m = S.getMenu(T);
        m.meals[0].dishes.forEach((d) => { d.items = (d.items || []).concat([{ name: '玉ねぎ', qty: '1/2個' }]); });
        m.shopping = (m.shopping || []).concat([{ name: '玉ねぎ', qty: '1個', price: 80 }]);
        S.setMenu(T, m);
      });
      const both = await page.evaluate((d) =>
        (window.DL.store.getMenu(d).shopping || []).map((x) => x.name + '→' + (x.for || '—')), T);
      s.note('名札: ' + both.join(' / '));
      s.yes('2つの一品で使うものにも名札が付く', both.some((x) => /^玉ねぎ→/.test(x)));
      await page.evaluate(() => {
        // 主菜だけ外してみる。玉ねぎは副菜も使うので残るはず
        const S = window.DL.store, U = window.DL.util, T = U.today();
        const m = S.getMenu(T);
        m.meals[0].dishes = m.meals[0].dishes.filter((d) => d.role !== '主菜');
        S.setMenu(T, m);
      });
      s.yes('主菜を外しても、副菜も使う玉ねぎは残る', await page.evaluate((d) =>
        (window.DL.store.getMenu(d).shopping || []).some((x) => x.name === '玉ねぎ'), T));
      s.yes('主菜だけが使う豚ロースは下りる', !(await page.evaluate((d) =>
        (window.DL.store.getMenu(d).shopping || []).some((x) => x.name === '豚ロース'), T)));

      /* 要らないものは、1行だけ手で外せる */
      await open(page, base, '#/home');
      await page.waitForSelector('.mn-card .mn-buy');
      await page.click('[aria-label="キャベツを買い物から外す"]');
      await page.waitForTimeout(400);
      s.yes('1行だけ外せる', !(await page.evaluate((d) =>
        (window.DL.store.getMenu(d).shopping || []).some((x) => x.name === 'キャベツ'), T)));
      s.yes('外しても、献立の一品は残る', (await page.evaluate((d) =>
        (window.DL.store.getMenu(d).meals || []).reduce((a, x) => a + (x.dishes || []).length, 0), T)) === 1);

      s.ok('画面のエラー', errors, []);
    });

    /* 献立の選ぶところと「作りたいもの」 */
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      await page.evaluate(() => {
        window.DL.store.updateSettings({ lifeBudget: 60000 });
        // 「作ってもらう」の口が出るように、同期をつないだことにする
        window.DL.store.updateSync({
          url: location.origin, token: 'test-token-0123456789abcdefghij', id: 't', enabled: true
        });
      });
      // 預かりの問い合わせは、空の返事でいなす
      await page.route(/\/v1\/(inbox|meta|state|files)\b/, (r) => r.fulfill({
        status: 200, contentType: 'application/json', body: '{"items":[]}'
      }));
      await openDay(page, base);
      await page.waitForSelector('.mn-serv');

      /* 人数はプルダウン1つ。その右に系統を1行で並べる */
      const row = await page.evaluate(() => {
        const r = document.querySelector('.mn-serv');
        const sel = r.querySelector('select.mn-serv-sel');
        const gs = [...r.querySelectorAll('.mn-g')];
        return {
          人数: sel ? [...sel.options].map((o) => o.text) : null,
          系統: gs.map((n) => n.textContent),
          一行: new Set([sel].concat(gs).map((n) => Math.round(n.getBoundingClientRect().top))).size,
          はみ出し: Math.round(r.scrollWidth - r.clientWidth),
          切れ: [sel].concat(gs).filter((n) => n.scrollWidth - n.clientWidth > 1).length
        };
      });
      s.note('人数と系統の行: ' + JSON.stringify(row));
      s.ok('人数はプルダウン', row.人数, ['1人分', '2人分']);
      s.ok('系統は4つ', row.系統, ['指定なし', '和食', '洋食', '中華']);
      s.ok('ぜんぶ1行に入る', row.一行, 1);
      s.ok('横にはみ出さない', row.はみ出し, 0);
      s.ok('字が切れない', row.切れ, 0);

      /* 人数はプルダウンで選べる */
      await page.selectOption('select.mn-serv-sel', '2');
      await page.waitForTimeout(300);
      s.ok('選ぶと2人分になる',
        await page.evaluate(() => document.querySelector('select.mn-serv-sel').value), '2');

      /* 作りたいもの。入れると札になり、役どころを回せる */
      const add = async (name) => {
        await page.fill('[aria-label="作りたいものを足す"]', name);
        await page.locator('.mn-use:has([aria-label="作りたいものを足す"]) button:has-text("足す")').click();
        await page.waitForTimeout(250);
      };
      await add('麻婆豆腐');
      await add('ポテトサラダ');
      const tags = () => page.$$eval('.mn-want-tag',
        (ns) => ns.map((n) => n.innerText.replace(/\s+/g, ' ').trim()));
      s.note('作りたいもの: ' + JSON.stringify(await tags()));
      s.ok('2つ並ぶ', (await tags()).length, 2);
      s.yes('はじめは役どころを決めていない',
        (await tags()).every((t) => /おまかせ/.test(t)));

      // 札の左を押すと おまかせ → 主菜 → 副菜 と回る
      await page.locator('.mn-want-role').first().click();
      await page.waitForTimeout(250);
      s.yes('1回で主菜', /主菜 麻婆豆腐/.test((await tags())[0]));
      await page.locator('.mn-want-role').first().click();
      await page.waitForTimeout(250);
      s.yes('もう1回で副菜', /副菜 麻婆豆腐/.test((await tags())[0]));
      await page.locator('.mn-want-role').first().click();
      await page.waitForTimeout(250);
      s.yes('もう1回でおまかせに戻る', /おまかせ 麻婆豆腐/.test((await tags())[0]));
      await page.locator('.mn-want-role').first().click();   // 主菜に戻しておく
      await page.waitForTimeout(250);

      /* 頼みに乗ること。主菜だけ指して、副菜は向こうに任せられる */
      let sent = null;
      await page.route(/\/v1\/menu$/, (r) => {
        sent = JSON.parse(r.request().postData() || '{}');
        return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stop"}' });
      });
      await page.locator('.mn-acts button:has-text("通常出力")').click();
      await page.waitForTimeout(600);
      s.note('送った中身: ' + JSON.stringify(sent && { want: sent.want, servings: sent.servings }));
      s.ok('作りたいものが頼みに乗る',
        sent && sent.want, [{ name: '麻婆豆腐', role: '主菜' }, { name: 'ポテトサラダ', role: '' }]);
      s.ok('人数も乗る', sent && sent.servings, 2);
      s.yes('主菜だけ指して、副菜は向こうに任せられる',
        sent.want.filter((w) => w.role === '主菜').length === 1
        && sent.want.filter((w) => w.role === '副菜').length === 0);

      /* ×で外せる */
      await page.locator('.mn-want-x').first().click();
      await page.waitForTimeout(250);
      s.ok('×で1つ外れる', (await tags()).length, 1);

      /* 説明の文は置かない */
      s.ok('作りたいもののまわりに説明文を置かない',
        await page.evaluate(() => {
          const box = document.querySelector('.mn-use:has([aria-label="作りたいものを足す"])');
          return box ? box.querySelectorAll('p').length : -1;
        }), 0);

      /* わざと 500 を返して頼みの中身だけ見たので、そのぶんは数えない */
      s.ok('画面のエラー（作りたいもの）',
        errors.filter((e) => !/500/.test(e)), []);
    });
    return s;
  }
};
