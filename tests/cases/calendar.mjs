/**
 * カレンダーの見た目。
 *
 * 試しに入れ替えたので、いちばん大事なのは「戻せること」。
 * 新しい見た目は body.cal-new が付いているあいだだけ効くようにしてある。
 * 設定で「前のまま」を選ぶとクラスが外れ、元の決まりだけが残る。
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 今日のマスの見え方を、いくつかの値で取る */
const todayLook = (page) => page.evaluate(() => {
  const cell = document.querySelector('.cal-cell.today');
  if (!cell) return null;
  const n = cell.querySelector('.cal-n');
  const cs = getComputedStyle(cell);
  const ns = getComputedStyle(n);
  const chip = getComputedStyle(n, '::before');
  const band = getComputedStyle(cell, '::before');   // 上辺の帯は疑似要素に付く
  const cr = cell.getBoundingClientRect();
  const nr = n.getBoundingClientRect();
  return {
    札の左: Math.round(nr.left - cr.left),
    マスの囲い: cs.borderTopWidth,
    上辺の帯: band.content === 'none' ? '0px' : band.borderTopWidth,
    日付の色: ns.color,
    札の傾き: chip.transform,
    札の背景: chip.backgroundColor
  };
});

export default {
  name: 'カレンダーの見た目',
  async run({ base }) {
    const s = sheet('カレンダーの見た目');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      // 今日が入っている月を開く
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-grid');

      s.yes('はじめは新しい見た目', await page.evaluate(() => document.body.classList.contains('cal-new')));
      s.ok('今日のマスがある', await page.locator('.cal-cell.today').count(), 1);

      const now = await todayLook(page);
      s.note('今日のマス: ' + JSON.stringify(now));
      s.ok('札は長方形（傾けない）', now && now.札の傾き, 'none');
      s.yes('札がマスの左端に付いている', now && now.札の左 <= 1);
      s.yes('札に色が付いている', now && now.札の背景 !== 'rgba(0, 0, 0, 0)');
      s.yes('マスの上辺に太い帯が乗る（3px）', now && parseFloat(now.上辺の帯) >= 3);

      /* 今日の曜日の見出しにも印が付く */
      s.ok('今日の曜日の見出しが1つだけ光る',
        await page.locator('.cal-hd.is-today').count(), 1);

      /* 動きは必ず終わる（v208 の電池の決まり） */
      const anims = await page.evaluate(() => window.document.getAnimations()
        .filter((a) => /^cal-today/.test(a.animationName || ''))
        .map((a) => ({ n: a.animationName, c: a.effect.getTiming().iterations })));
      s.note('今日のマスの動き: ' + anims.map((a) => a.n + '×' + a.c).join(' / '));
      s.ok('終わらない動きが無い', anims.filter((a) => a.c === Infinity).map((a) => a.n), []);
      s.yes('動きが付いている', anims.length > 0);

      /* 点滅の打ちかた。「泊まり勤務」と同系色なので、ゆっくり息をするだけでは
         見分けが付かなかった。パパッと二回 → ひと拍 → パパッと二回。
         1周ぶんを刻んで、明るいところのかたまりを数える */
      const beat = await page.evaluate(() => {
        const cell = document.querySelector('.cal-cell.today');
        const a = document.getAnimations()
          .filter((x) => /^cal-today-blink/.test(x.animationName || ''))[0];
        if (!a) return null;
        a.pause();
        const dur = a.effect.getComputedTiming().duration;
        const N = 200, hi = [];
        for (let i = 0; i <= N; i++) {
          a.currentTime = (dur * i) / N;
          const m = getComputedStyle(cell, '::before').backgroundColor.match(/[\d.]+/g) || [];
          // color-mix の透かしぶん。濃いほうが光っているところ
          hi.push(Number(m[3] === undefined ? 1 : m[3]) > 0.2);
        }
        a.currentTime = 0;
        a.play();
        // 明るいところのかたまり（＝光った回数）と、そのあいだの空き
        const runs = [], gaps = [];
        let i = 0;
        while (i <= N) {
          if (hi[i]) { const st = i; while (i <= N && hi[i]) i++; runs.push([st, i - 1]); }
          else i++;
        }
        for (let k = 1; k < runs.length; k++) gaps.push(runs[k][0] - runs[k - 1][1]);
        return { dur: Math.round(dur), blinks: runs.length, gaps: gaps };
      });
      s.note('点滅の打ちかた: ' + JSON.stringify(beat));
      s.ok('1周で4回光る（二回 → ひと拍 → 二回）', beat && beat.blinks, 4);
      s.yes('真ん中のひと拍が、となりの空きよりはっきり長い',
        beat && beat.gaps.length === 3
        && beat.gaps[1] > beat.gaps[0] * 2 && beat.gaps[1] > beat.gaps[2] * 2);
      s.yes('1周は2秒以内（パパッと感じる速さ）', beat && beat.dur <= 2000);

      /* 「動き：控える」では動かない */
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: true }); window.DL.app.render(); });
      await page.waitForTimeout(300);
      s.ok('「動き：控える」では、今日のマスも動かない',
        await page.evaluate(() => window.document.getAnimations()
          .filter((a) => a.playState === 'running' && /^cal-today/.test(a.animationName || '')).length), 0);
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: false }); window.DL.app.render(); });
      await page.waitForTimeout(200);

      /* 下地に色が付いている日（締切など）は、その上に青を重ねない。
         重ねると濁って、赤とも青ともつかない色になる */
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        const pr = S.createProject({ name: '入稿するもの', category: 'manga', qty: 4,
          deadline: T, status: 'active' });
        const t = S.addTask(pr.id, { name: '入稿', unit: 'page', qty: 4 });
        S.updateTask(pr.id, t.id, { start: U.addDays(T, -2), end: T });
      });
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-cell.today');
      const due = await page.evaluate(() => {
        const c = document.querySelector('.cal-cell.today');
        const bf = getComputedStyle(c, '::before');
        return {
          締切あり: c.classList.contains('has-due'),
          かぶせの塗り: bf.backgroundColor,
          かぶせの動き: bf.animationName,
          帯の太さ: bf.borderTopWidth
        };
      });
      s.note('今日＋締切: ' + JSON.stringify(due));
      s.yes('今日に締切が重なっている', due.締切あり);
      s.ok('青の塗りを重ねない', due.かぶせの塗り, 'rgba(0, 0, 0, 0)');
      s.ok('息づかいも止める（点滅と重なって濁るため）', due.かぶせの動き, 'none');
      s.ok('そのぶん上辺の帯を太くする', due.帯の太さ, '4px');

      /* ここが肝心。「前のまま」で、元の見た目に戻ること */
      await page.evaluate(() => { window.DL.store.updateSettings({ calSkin: 'classic' }); window.DL.app.render(); });
      await page.waitForTimeout(300);
      s.yes('「前のまま」でクラスが外れる',
        !(await page.evaluate(() => document.body.classList.contains('cal-new'))));
      const old = await todayLook(page);
      s.note('戻したあと: ' + JSON.stringify(old));
      s.yes('札の塗りが無くなる', old && old.札の背景 === 'rgba(0, 0, 0, 0)');
      s.yes('元どおり、今日は囲い線で示される', old && parseFloat(old.マスの囲い) <= 1.5);
      s.ok('上辺の帯も消える', old && old.上辺の帯, '0px');
      s.ok('曜日の見出しの印も消える（元の組みには無い飾り）',
        await page.evaluate(() => getComputedStyle(document.querySelector('.cal-hd.is-today')).borderBottomWidth), '0px');

      /* 戻す */
      await page.evaluate(() => { window.DL.store.updateSettings({ calSkin: 'new' }); window.DL.app.render(); });
      await page.waitForTimeout(200);
      s.yes('また新しい見た目に戻せる',
        await page.evaluate(() => document.body.classList.contains('cal-new')));

      s.ok('画面のエラー', errors, []);
    });

    /* 月名を押して、1つの券だけに絞る。
       カレンダーのタブを押すと、全部に戻る */
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        // 券が2つ。どちらも今月に締切がある
        S.createProject({
          kind: 'event', category: 'manga', title: '新刊',
          eventName: '冬の即売会', eventDate: U.addDays(T, 12),
          deadline: U.addDays(T, 4), startDate: T, qty: 8, status: 'active'
        });
        S.createProject({
          kind: 'work', category: 'illust', title: '表紙', client: 'B社',
          deadline: U.addDays(T, 6), startDate: T, qty: 4, status: 'active'
        });
      });
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-grid');

      /* マスに出るのは印の文字（入稿・納品・イベント名）。
         冬の即売会の券は「入稿」と「冬の即売会」、B社の券は「納品」 */
      const names = () => page.$$eval('.cal-grid .cal-line .nm', (ns) => ns.map((n) => n.textContent));
      const before = await names();
      s.note('絞る前: ' + Array.from(new Set(before)).join(' / '));
      s.yes('両方の券の予定が出ている',
        before.some((x) => /冬の即売会/.test(x)) && before.some((x) => /納品/.test(x)));

      /* 月名を押すと、券の一覧が出る */
      await page.click('.monthlabel');
      await page.waitForSelector('.sheet-title:has-text("カレンダーに出すもの")');
      s.yes('「すべての案件」が選ばれている',
        (await page.locator('.sheet-body .row.on:has-text("すべての案件")').count()) === 1);
      s.yes('券が2つ並ぶ', (await page.locator('.sheet-body .row').count()) === 3);

      await page.click('.sheet-body .row:has-text("冬の即売会")');
      await page.waitForTimeout(500);
      const after = await names();
      s.note('絞ったあと: ' + Array.from(new Set(after)).join(' / '));
      s.yes('選んだ券の予定だけになる',
        after.some((x) => /冬の即売会/.test(x)) && !after.some((x) => /納品/.test(x)));
      s.ok('絞っていることが画面に出る',
        await page.locator('.cal-focus').count(), 1);

      /* カレンダーのタブを押すと、全部に戻る */
      await page.click('.tab[data-tab="calendar"]');
      await page.waitForTimeout(500);
      const back = await names();
      s.note('タブを押したあと: ' + Array.from(new Set(back)).join(' / '));
      s.yes('全部の案件に戻る',
        back.some((x) => /冬の即売会/.test(x)) && back.some((x) => /納品/.test(x)));
      s.ok('絞りの帯も消える', await page.locator('.cal-focus').count(), 0);

      /* 絞りが無ければ、タブはこれまでどおり案件と日常を切り替える */
      await page.click('.tab[data-tab="calendar"]');
      await page.waitForTimeout(400);
      s.yes('絞りが無いときは、日常のカレンダーに切り替わる',
        await page.evaluate(() => window.DL.store.calMode() === 'life'));
      await page.click('.tab[data-tab="calendar"]');
      await page.waitForTimeout(400);
      s.yes('もう一度で案件に戻る',
        await page.evaluate(() => window.DL.store.calMode() !== 'life'));

      /* 絞ったまま券を消しても、画面が壊れない */
      await page.click('.monthlabel');
      await page.waitForSelector('.sheet-body .row:has-text("B社")');
      await page.click('.sheet-body .row:has-text("B社")');
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const S = window.DL.store;
        const t = S.tickets().filter((x) => x.name === 'B社')[0];
        if (t) S.removeTicket(t.id);
      });
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-grid');
      s.ok('消された券を指していたら、絞りは外れる',
        await page.locator('.cal-focus').count(), 0);

      s.ok('画面のエラー（絞り込み）', errors, []);
    });

    /* 日常のカレンダー。予定はひとつずつ四角で囲み、
       入りきらない名前はサイネージと同じように左へ流す */
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        S.addEvent({ date: T, title: '歯医者' });
        S.addEvent({ date: T, title: '合同誌の打ち合わせと原稿の受け渡し（渋谷）' });
        S.setCalMode('life');
      });
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-page.cal-life .cal-grid');

      const box = await page.evaluate(() => {
        const n = document.querySelector('.cal-page.cal-life .cal-cell.today .cal-line:not(.hol)');
        if (!n) return null;
        const cs = getComputedStyle(n);
        return {
          囲い: cs.borderTopWidth + ' / ' + cs.borderLeftWidth
            + ' / ' + cs.borderRightWidth + ' / ' + cs.borderBottomWidth,
          角: cs.borderTopLeftRadius,
          塗り: cs.backgroundColor
        };
      });
      s.note('予定の行: ' + JSON.stringify(box));
      s.yes('四面すべてに囲い線がある',
        box && box.囲い.split(' / ').every((w) => parseFloat(w) >= 1));
      s.yes('角は少し落ちている（四角の囲いに見える）', box && parseFloat(box.角) > 0);
      s.ok('中は塗らない（勤務の色をそのまま透かすため）', box && box.塗り, 'rgba(0, 0, 0, 0)');

      /* 長い名前だけが流れる。短い名前は動かさない */
      const pans = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.cal-page.cal-life .cal-cell.today .cal-line:not(.hol) .nmi')
          .forEach((n) => out.push({
            名: n.textContent,
            流す: n.classList.contains('pan'),
            送り: n.style.getPropertyValue('--pan'),
            動き: getComputedStyle(n).animationName,
            回数: getComputedStyle(n).animationIterationCount
          }));
        return out;
      });
      s.note('流しかた: ' + JSON.stringify(pans));
      s.yes('入りきらない名前は流す',
        pans.some((x) => /合同誌/.test(x.名) && x.流す && x.動き === 'calPan'));
      s.yes('流す量は、はみ出したぶんだけ左へ',
        pans.some((x) => /合同誌/.test(x.名) && parseFloat(x.送り) < -10));
      s.yes('収まっている名前は流さない',
        pans.some((x) => x.名 === '歯医者' && !x.流す));
      /* 端のぼかしも、はみ出している行だけ。収まっている名前までぼかすと
         囲いの中で切れたように見える */
      const blur = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.cal-page.cal-life .cal-cell.today .cal-line:not(.hol) .nm')
          .forEach((n) => out.push({
            名: n.textContent,
            ぼかし: getComputedStyle(n).maskImage !== 'none'
          }));
        return out;
      });
      s.note('端のぼかし: ' + JSON.stringify(blur));
      s.yes('はみ出す行だけ端をぼかす',
        blur.some((x) => /合同誌/.test(x.名) && x.ぼかし)
        && blur.some((x) => x.名 === '歯医者' && !x.ぼかし));
      s.ok('終わらない流しは無い（電池のため）',
        pans.filter((x) => x.流す && x.回数 === 'infinite').map((x) => x.名), []);

      /* 「動き：控える」では流さない */
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: true }); window.DL.app.render(); });
      await page.waitForTimeout(300);
      s.ok('「動き：控える」では流さない',
        await page.evaluate(() => window.document.getAnimations()
          .filter((a) => a.playState === 'running' && a.animationName === 'calPan').length), 0);
      await page.evaluate(() => {
        window.DL.store.updateSettings({ calm: false });
        window.DL.store.setCalMode('work');
      });

      s.ok('画面のエラー（日常のカレンダー）', errors, []);
    });
    return s;
  }
};
