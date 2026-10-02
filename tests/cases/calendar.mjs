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
  const top = cell.querySelector('.cal-top');
  const cs = getComputedStyle(cell);
  const ns = getComputedStyle(n);
  // 日付の帯は .cal-top の疑似要素、マスの枠は .cal-cell の疑似要素
  const chip = getComputedStyle(top, '::before');
  const band = getComputedStyle(cell, '::before');
  const cr = cell.getBoundingClientRect();
  const tr = top.getBoundingClientRect();
  return {
    帯の左: Math.round(tr.left - cr.left),
    帯の右: Math.round(cr.right - tr.right),
    マスの囲い: cs.borderTopWidth,
    今日の枠: band.content === 'none' ? '0px' : band.borderTopWidth,
    枠の四面: band.content === 'none' ? '0px' : [band.borderTopWidth, band.borderRightWidth,
      band.borderBottomWidth, band.borderLeftWidth].join('/'),
    日付の色: ns.color,
    帯の傾き: chip.transform,
    帯の背景: chip.content === 'none' ? 'rgba(0, 0, 0, 0)' : chip.backgroundColor
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

      // 出てくるときのひと跳ね（cal-today-pop）が終わってから測る
      await page.waitForTimeout(600);
      const now = await todayLook(page);
      s.note('今日のマス: ' + JSON.stringify(now));
      s.ok('帯は長方形（傾けない）', now && now.帯の傾き, 'none');
      s.yes('帯がマスの左端に付いている', now && now.帯の左 <= 1);
      s.yes('帯がマスの右端まで伸びている', now && now.帯の右 <= 1);
      s.yes('帯に色が付いている', now && now.帯の背景 !== 'rgba(0, 0, 0, 0)');
      s.yes('マスを太い枠で囲う（3px）', now && parseFloat(now.今日の枠) >= 3);
      s.ok('枠は四方すべてに付く', now && now.枠の四面, '3px/3px/3px/3px');

      /* 日付の右に、その日の働きかたを小さく添える。
         決めていない日は「休日」。今日の帯の中にも入る */
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        S.setDuty(U.addDays(T, 1), 'office');
        S.setDuty(U.addDays(T, 2), 'remote');
        S.setDuty(U.addDays(T, 3), 'stay');
      });
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-grid');
      const duties = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('.cal-cell').forEach((c) => {
          const n = c.querySelector('.cal-n'), d = c.querySelector('.cal-duty');
          if (n && d) out[c.getAttribute('href')] = d.textContent;
        });
        const T = window.DL.util.today(), A = window.DL.util.addDays;
        return {
          出社: out['#/day/' + A(T, 1)], リモート: out['#/day/' + A(T, 2)],
          宿直: out['#/day/' + A(T, 3)], 指定なし: out['#/day/' + A(T, 4)],
          数: Object.keys(out).length,
          マスの数: document.querySelectorAll('.cal-cell').length
        };
      });
      s.note('働きかた: ' + JSON.stringify(duties));
      s.ok('出社は「出社」', duties.出社, '出社');
      s.ok('リモートワークは「リモート」', duties.リモート, 'リモート');
      s.ok('泊まり勤務は「宿直」', duties.宿直, '宿直');
      s.ok('指定なしは「休日」', duties.指定なし, '休日');
      s.ok('どのマスにも出る', duties.数, duties.マスの数);
      s.yes('決めていない日は、そのぶん薄くする（目立たせない）',
        await page.evaluate(() => {
          const f = document.querySelector('.cal-duty.free');
          const o = document.querySelector('.cal-duty:not(.free)');
          return !!f && !!o
            && parseFloat(getComputedStyle(f).opacity) < parseFloat(getComputedStyle(o).opacity);
        }));
      s.yes('今日の帯の中にも入っている',
        await page.evaluate(() => !!document.querySelector('.cal-cell.today .cal-top .cal-duty')));

      /* 上の「案件 / 日常」の切り替えボタンは置かない（下のタブで入れ替わる） */
      s.ok('上に切り替えのボタンは無い', await page.locator('.modebtn').count(), 0);
      s.ok('月ナビに＋は置かない', await page.locator('.monthnav .iconbtn[aria-label="予定を追加"]').count(), 0);

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

      /* 点滅するのは塗りではなく「枠」。細かく明滅させると泊まり勤務の
         色と紛れたので、太い枠がゆっくり濃くなったり薄くなったりする形にした。
         1周ぶんを刻んで、枠と塗りの濃さを見る */
      const beat = await page.evaluate(() => {
        const cell = document.querySelector('.cal-cell.today');
        const a = document.getAnimations()
          .filter((x) => /^cal-today-blink/.test(x.animationName || ''))[0];
        if (!a) return null;
        const alpha = (col) => {
          const m = String(col).match(/[\d.]+/g) || [];
          return Number(m[3] === undefined ? 1 : m[3]);
        };
        a.pause();
        const dur = a.effect.getComputedTiming().duration;
        const N = 40, frame = [], fill = [];
        for (let i = 0; i <= N; i++) {
          a.currentTime = (dur * i) / N;
          const cs = getComputedStyle(cell, '::before');
          frame.push(alpha(cs.borderTopColor));
          fill.push(alpha(cs.backgroundColor));
        }
        a.currentTime = 0;
        a.play();
        return {
          dur: Math.round(dur),
          枠の濃淡: [Math.min.apply(null, frame), Math.max.apply(null, frame)],
          塗りの振れ: Math.max.apply(null, fill) - Math.min.apply(null, fill)
        };
      });
      s.note('点滅の打ちかた: ' + JSON.stringify(beat));
      s.yes('点滅するのは枠（濃いところと薄いところの差が大きい）',
        beat && (beat.枠の濃淡[1] - beat.枠の濃淡[0]) > 0.5);
      s.yes('いちばん濃いところでは、枠がはっきり出ている', beat && beat.枠の濃淡[1] > 0.9);
      s.yes('塗りのほうは動かさない（泊まり勤務の色と濁るため）',
        beat && beat.塗りの振れ < 0.02);
      s.yes('1周はゆっくり（2秒以上）', beat && beat.dur >= 2000);

      /* 「動き：控える」では動かない */
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: true }); window.DL.app.render(); });
      await page.waitForTimeout(300);
      s.ok('「動き：控える」では、今日のマスも動かない',
        await page.evaluate(() => window.document.getAnimations()
          .filter((a) => a.playState === 'running' && /^cal-today/.test(a.animationName || '')).length), 0);
      await page.evaluate(() => { window.DL.store.updateSettings({ calm: false }); window.DL.app.render(); });
      await page.waitForTimeout(200);

      /* 下地に色が付いている日（締切など）は、その上に青の塗りを重ねない。
         重ねると濁って、赤とも青ともつかない色になる。
         枠の点滅は色を重ねないので、そのまま続ける */
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
          枠の太さ: bf.borderTopWidth
        };
      });
      s.note('今日＋締切: ' + JSON.stringify(due));
      s.yes('今日に締切が重なっている', due.締切あり);
      s.ok('青の塗りを重ねない', due.かぶせの塗り, 'rgba(0, 0, 0, 0)');
      s.ok('枠の点滅はそのまま続く（色を重ねないので濁らない）',
        due.かぶせの動き, 'cal-today-blink');
      s.ok('そのぶん枠を太くする', due.枠の太さ, '4px');

      /* ここが肝心。「前のまま」で、元の見た目に戻ること */
      await page.evaluate(() => { window.DL.store.updateSettings({ calSkin: 'classic' }); window.DL.app.render(); });
      await page.waitForTimeout(300);
      s.yes('「前のまま」でクラスが外れる',
        !(await page.evaluate(() => document.body.classList.contains('cal-new'))));
      const old = await todayLook(page);
      s.note('戻したあと: ' + JSON.stringify(old));
      s.yes('帯の塗りが無くなる', old && old.帯の背景 === 'rgba(0, 0, 0, 0)');
      s.yes('元どおり、今日は囲い線で示される', old && parseFloat(old.マスの囲い) <= 1.5);
      s.ok('今日の枠も消える', old && old.今日の枠, '0px');
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

    /* 日常のカレンダー。予定はひとつずつ四角で囲んで、その色で塗る。
       入りきらない名前は左へ流し、抜けきったら右端から入り直す */
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      await page.evaluate(() => {
        const S = window.DL.store, U = window.DL.util, T = U.today();
        // 色を決め打ちにして、塗りと字の色を確かめられるようにする
        S.addEvent({ date: T, title: '歯医者', color: '#111827' });          // 暗い色
        S.addEvent({ date: T, title: '合同誌の打ち合わせと原稿の受け渡し（渋谷）',
          color: '#fde047' });                                               // 明るい色
        S.setCalMode('life');
      });
      await open(page, base, '#/calendar');
      await page.waitForSelector('.cal-page.cal-life .cal-grid');

      const boxes = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.cal-page.cal-life .cal-cell.today .cal-line:not(.hol)')
          .forEach((n) => {
            const cs = getComputedStyle(n);
            const bar = n.querySelector(':scope > i');
            out.push({
              名: n.textContent,
              囲い: [cs.borderTopWidth, cs.borderRightWidth,
                cs.borderBottomWidth, cs.borderLeftWidth].join('/'),
              角: cs.borderTopLeftRadius,
              塗り: cs.backgroundColor,
              縦線: bar ? getComputedStyle(bar).backgroundColor : ''
            });
          });
        return out;
      });
      s.note('予定の行: ' + JSON.stringify(boxes));
      s.yes('四面すべてに細い囲い線がある',
        boxes.length === 2
        && boxes.every((x) => x.囲い.split('/').every((w) => parseFloat(w) >= 1)));
      s.yes('角は少し落ちている（四角の囲いに見える）',
        boxes.every((x) => parseFloat(x.角) > 0));
      s.ok('中は塗らない（勤務の色をそのまま透かすため）',
        boxes.map((x) => x.塗り), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
      s.yes('色は左端の縦線が受け持つ',
        boxes.some((x) => x.縦線 === 'rgb(17, 24, 39)')
        && boxes.some((x) => x.縦線 === 'rgb(253, 224, 71)'));

      /* 長い名前だけが流れる。短い名前は動かさない */
      const pans = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.cal-page.cal-life .cal-cell.today .cal-line:not(.hol) .nmi')
          .forEach((n) => out.push({
            名: n.textContent,
            流す: n.classList.contains('pan'),
            抜け: n.style.getPropertyValue('--pan-out'),
            入り: n.style.getPropertyValue('--pan-in'),
            幅: n.scrollWidth,
            動き: getComputedStyle(n).animationName,
            回数: getComputedStyle(n).animationIterationCount
          }));
        return out;
      });
      s.note('流しかた: ' + JSON.stringify(pans));
      s.yes('入りきらない名前は流す',
        pans.some((x) => /合同誌/.test(x.名) && x.流す && x.動き === 'calPan'));
      /* 左へ少し送るのではなく、字の幅ぶんそっくり送って抜けきらせる。
         そのあと右端の外（＋のほう）から入り直す */
      const 長 = pans.filter((x) => /合同誌/.test(x.名))[0];
      s.yes('左へ抜けきるまで送る（字の幅ぶん）',
        長 && parseFloat(長.抜け) <= -長.幅);
      s.yes('入り直すのは右端の外から（右へ戻るのではない）',
        長 && parseFloat(長.入り) > 0);

      /* 実際の動きも追う。左へ抜けきったあと、右（＋）へ回り込んで
         頭に戻ること。左へ行って左から右へ戻るのでは駄目 */
      const path = await page.evaluate(() => {
        const n = document.querySelector('.cal-line .nmi.pan');
        const a = document.getAnimations().filter((x) => x.animationName === 'calPan')[0];
        if (!n || !a) return null;
        const t = a.effect.getComputedTiming();
        a.pause();
        const xs = [];
        for (let p = 0; p <= 100; p += 2) {
          a.currentTime = (t.delay || 0) + t.duration * (p / 100);
          const m = getComputedStyle(n).transform;
          xs.push(m === 'none' ? 0 : Math.round(Number(m.match(/matrix\(([^)]*)\)/)[1].split(',')[4])));
        }
        a.currentTime = 0;
        a.play();
        const lo = Math.min.apply(null, xs);
        const at = xs.indexOf(lo);
        return { 幅: n.scrollWidth, いちばん左: lo, その後: xs.slice(at + 1) };
      });
      s.note('流れの道すじ: ' + JSON.stringify(path && {
        幅: path.幅, いちばん左: path.いちばん左, その後: path.その後.slice(0, 6)
      }));
      s.yes('いちど左へ抜けきる（字の幅ぶん送る）',
        path && path.いちばん左 <= -path.幅);
      s.yes('抜けきったら、右の外から入り直す',
        path && path.その後.some((x) => x > 0));
      s.yes('最後は頭（0）に戻って次の周へ',
        path && path.その後.length && path.その後[path.その後.length - 1] === 0);
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
