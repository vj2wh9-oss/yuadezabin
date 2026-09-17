/* 筋トレ。今日やること・体重・続きぐあいを1画面に。

   計画を考えるのは OpenAI。次に持つ重さを決めるのはこちら（fit.js）。
   この画面は、その2つを出して、やったことを書き留めるところ。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, F = DL.fit, el = U.el;

  var WDAY = ['日', '月', '火', '水', '木', '金', '土'];
  var DONE_LABEL = { full: 'やった', part: '途中まで', skip: 'できなかった' };
  /* その日を、どこで・何でやるか */
  var KIND_LABEL = { gym: 'ジムの器具', home: '自重', run: '有酸素', rest: '休み' };

  /* カレンダーで見ている月。画面を描き直しても覚えておく */
  var calMonth = '';

  function render(root, params) {
    /* ショートカットが預けてくれた体重を、開いた拍子に入れる。
       届いていれば描き直す（何も無ければ黙って終わる） */
    F.autoPull().then(function (r) { if (r && r.added) DL.app.render(); });

    if (U.isISO(params && params.date)) dayPage(root, params.date);
    else homePage(root);
  }

  /* ---------------- ホーム ---------------- */

  function homePage(root) {
    var wrap = el('div', { class: 'page fit-page' });
    var today = U.today();

    wrap.appendChild(monthCal());
    wrap.appendChild(nextCard(today));

    wrap.appendChild(ui.section('体重', el('span', { class: 'muted small', text: bodyLine() })));
    wrap.appendChild(weightCard());

    wrap.appendChild(ui.section('続きぐあい', el('span', { class: 'muted small', text: 'ここ4週' })));
    wrap.appendChild(keepCard());

    wrap.appendChild(ui.section('これまで', el('span', { class: 'muted small', text: '記録した ぶんの合計' })));
    wrap.appendChild(totalCard());

    wrap.appendChild(el('div', { class: 'actions' }, [
      ui.btn('計画自動作成', 'primary', function () { planSheet(today); }, 'idea'),
      ui.btn('記録の一覧', 'ghost', function () { historySheet(); }, 'task'),
      ui.btn('設定', 'ghost', function () { settingsSheet(); }, 'settings')
    ]));

    root.appendChild(wrap);
  }

  /* ---------------- その日の中身 ---------------- */

  function dayPage(root, date) {
    var wrap = el('div', { class: 'page fit-page' });
    wrap.appendChild(todayCard(date));
    wrap.appendChild(weekStrip(date));
    wrap.appendChild(el('div', { class: 'actions' }, [
      ui.btn('筋トレのホームへ', 'ghost', function () { location.hash = '#/fit'; }, 'home')
    ]));
    root.appendChild(wrap);
  }

  /* ---------------- 筋トレのカレンダー ----------------

     ふだんのカレンダーとは別もの。ここには筋トレの予定と記録だけを出す。
     マスを押すと、その日の中身（#/fit/日付）へ行く */

  function monthCal() {
    var today = U.today();
    if (!U.isISO(calMonth)) calMonth = U.monthStart(today);
    var first = U.monthStart(calMonth);
    var last = U.monthEnd(calMonth);
    var box = el('div', { class: 'fit-cal' });

    box.appendChild(el('div', { class: 'monthnav' }, [
      el('button', { class: 'iconbtn', 'aria-label': '前の月',
        onclick: function () { calMonth = U.addMonths(first, -1); DL.app.render(); }
      }, ui.icon('chevronLeft', 20)),
      el('span', { class: 'fc-title', text: first.slice(0, 4) + '年' + (+first.slice(5, 7)) + '月' }),
      el('button', { class: 'iconbtn', 'aria-label': '次の月',
        onclick: function () { calMonth = U.addMonths(first, 1); DL.app.render(); }
      }, ui.icon('chevronRight', 20)),
      ui.btn('今月', 'tiny ghost', function () { calMonth = U.monthStart(today); DL.app.render(); })
    ]));

    var head = el('div', { class: 'cal-head' });
    for (var i = 0; i < 7; i++) {
      head.appendChild(el('div', {
        class: 'cal-hd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), text: U.wdName(i)
      }));
    }
    box.appendChild(head);

    var lead = U.dow(first);
    var from = U.addDays(first, -lead);
    var rows = Math.ceil((lead + U.diffDays(first, last) + 1) / 7);
    var grid = el('div', { class: 'fc-grid' });
    for (var c = 0; c < rows * 7; c++) grid.appendChild(calCell(U.addDays(from, c), first, today));
    box.appendChild(grid);

    box.appendChild(el('div', { class: 'fc-legend' }, [
      el('span', { class: 'fc-key done' }, el('i', {})), el('span', { text: 'できた' }),
      el('span', { class: 'fc-key miss' }, el('i', {})), el('span', { text: 'できなかった' }),
      el('span', { class: 'fc-key plan' }, el('i', {})), el('span', { text: '予定' })
    ]));
    return box;
  }

  function calCell(d, first, today) {
    var p = S.fitPlan(d), l = S.fitLog(d);
    var duty = F.dutyOf(d);
    var cls = 'fc-cell';
    if (d.slice(0, 7) !== first.slice(0, 7)) cls += ' out';
    if (d === today) cls += ' today';
    if (U.dow(d) === 0) cls += ' sun';
    if (U.dow(d) === 6) cls += ' sat';
    if (l && l.done !== 'skip') cls += ' done';
    else if (l) cls += ' miss';
    else if (p && p.kind !== 'rest') cls += ' plan';
    // 計画がまだ無い先の日でも、その日の担当が分かるように薄く出す
    if (!p && !l && (duty.kind === 'gym' || duty.kind === 'home')) cls += ' duty';
    // 器具を使わない日は、輪郭だけで見分けられるようにする
    if ((p && p.kind === 'home') || (!p && !l && duty.kind === 'home')) cls += ' home';

    var label = p ? shortTitle(p) : (duty.kind === 'gym' ? duty.part.slice(0, 4) : '');
    return el('button', {
      class: cls,
      'aria-label': U.fmtMDW(d) + '　'
        + ((p && p.title) || (duty.kind === 'free' ? '休み' : duty.part))
        + '　' + (p ? (KIND_LABEL[p.kind] || '')
          : duty.kind === 'free' ? '' : KIND_LABEL[duty.kind]),
      onclick: function () { location.hash = '#/fit/' + d; }
    }, [
      el('span', { class: 'fc-n', text: String(U.num(d.slice(8, 10), 0)) }),
      el('span', { class: 'fc-t', text: label }),
      p && p.abs && p.abs.length ? el('span', { class: 'fc-abs', text: '腹' }) : null
    ]);
  }

  /* 今日（か、いちばん近い先の予定）を、ひとこと出す */
  function nextCard(today) {
    var d = today;
    for (var i = 0; i < 14; i++) {
      var p = S.fitPlan(d);
      if (p && p.kind !== 'rest') break;
      d = U.addDays(d, 1);
    }
    var plan = S.fitPlan(d);
    var log = S.fitLog(d);
    if (!plan) {
      return el('div', { class: 'card' }, [
        el('div', { class: 'row-title', text: 'まだ計画がありません' }),
        el('p', { class: 'muted small',
          text: '「計画自動作成」を押すと、いまの体重と直近の記録から、'
            + '部位を分けて何日かぶんをまとめて組んでもらえます。' })
      ]);
    }
    return el('button', {
      class: 'card fit-next', onclick: function () { location.hash = '#/fit/' + d; }
    }, [
      el('div', { class: 'fit-head-l' }, [
        el('span', { class: 'cd-label',
          text: U.fmtYMDW(d) + (d === today ? '　今日' : '　つぎ') }),
        el('b', { text: plan.title })
      ]),
      el('div', { class: 'row-sub' }, [
        ui.chip(KIND_LABEL[plan.kind] || plan.kind, plan.kind === 'home' ? 'ghosty' : 'soft'),
        plan.minutes ? ui.chip(plan.minutes + '分', 'soft') : null,
        plan.items.length ? ui.chip(plan.items.length + '種目', 'ghosty') : null,
        plan.abs.length ? ui.chip('腹筋メニュー', 'ghosty') : null,
        plan.cardio ? ui.chip('有酸素', 'ghosty') : null,
        log ? ui.chip(DONE_LABEL[log.done], log.done === 'skip' ? 'danger' : 'ok') : null
      ]),
      plan.focus ? el('p', { class: 'muted small', text: plan.focus }) : null
    ]);
  }

  /* これまでの合計 */
  function totalCard() {
    var t = F.totals();
    if (!t.days) {
      return el('div', { class: 'card' },
        ui.empty('まだ記録がありません。計画を作って、やったぶんを記録していくとここに出ます。'));
    }
    return el('div', { class: 'card' }, [
      el('div', { class: 'sum-grid' }, [
        el('div', { class: 'sum-box' }, [
          el('span', { text: 'こなした' }), el('b', { text: t.days + '日' })
        ]),
        el('div', { class: 'sum-box' }, [
          el('span', { text: 'ジム' }), el('b', { text: t.gym + '回' })
        ]),
        el('div', { class: 'sum-box' }, [
          el('span', { text: '走った' }), el('b', { text: t.km + 'km' })
        ]),
        el('div', { class: 'sum-box' }, [
          el('span', { text: '合計' }), el('b', { text: t.hours + '時間' })
        ])
      ]),
      t.since ? el('p', { class: 'muted small', text: U.fmtYMD(t.since) + ' から' }) : null
    ]);
  }

  /* ---------------- 設定（ふだんは触らないもの） ---------------- */

  function settingsSheet() {
    ui.sheet({
      title: '筋トレの設定',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'row-title', text: 'からだと目標' }),
          el('p', { class: 'muted small',
            text: '身長・目標・週に何回・行く曜日。行く曜日を変えると、部位の回し方も変わります。' }),
          ui.btn('からだと目標', 'ghost full', function () { profileSheet(); }, 'settings')
        ]),
        el('div', { class: 'card' }, [
          el('div', { class: 'row-title', text: '体重' }),
          el('p', { class: 'muted small',
            text: 'ショートカットが毎朝そっと入れてくれます。'
              + '手で入れたいときや、取り込み先を変えたいときだけ使ってください。' }),
          el('div', { class: 'row-wrap' }, [
            ui.btn('体重を入れる', 'ghost', function () { weightSheet(U.today()); }, 'plus'),
            ui.btn('体重計から取り込む', 'ghost', function () { importSheet(); }, 'cloud')
          ])
        ]),
        el('div', { class: 'card' }, [
          el('div', { class: 'row-title', text: '部位の回し方' }),
          splitList()
        ])
      ])
    });
  }

  /* いまの設定だと、どの順で部位が回るか */
  function splitList() {
    var wd = F.gymDays();
    var tbl = F.splitTable();
    return el('div', {}, [
      el('p', { class: 'muted small',
        text: 'トレーニングの日：' + nameDays(wd)
          + '　この順で回します（1日で全身はやりません）' }),
      el('p', { class: 'muted small', text: whereHint() }),
      el('ol', { class: 'fit-steps' }, tbl.map(function (s) {
        return el('li', { text: s.part + '（' + s.focus + '）' + (s.abs ? '　＋腹筋メニュー' : '') });
      }))
    ]);
  }

  /* 身長・BMI をひとことで */
  function bodyLine() {
    var p = S.fit().profile;
    var w = S.latestWeight();
    if (!w) return p.height ? p.height + 'cm' : '';
    var b = F.bmi(w.kg, p.height);
    return (p.height ? p.height + 'cm　' : '') + (b ? 'BMI ' + b : '');
  }

  /* ---------------- 今日 ---------------- */

  function todayCard(date) {
    var plan = S.fitPlan(date);
    var log = S.fitLog(date);
    var box = el('div', { class: 'card fit-today' });

    box.appendChild(el('div', { class: 'fit-head' }, [
      el('div', { class: 'fit-head-l' }, [
        el('span', { class: 'cd-label', text: U.fmtYMDW(date) + (date === U.today() ? '　今日' : '') }),
        el('b', { text: plan ? plan.title : 'まだ計画がありません' })
      ]),
      el('div', { class: 'row-sub' }, [
        plan ? ui.chip(KIND_LABEL[plan.kind] || plan.kind,
          plan.kind === 'home' ? 'ghosty' : plan.kind === 'rest' ? 'ghosty' : 'soft') : null,
        plan && plan.minutes ? ui.chip(plan.minutes + '分', 'soft') : null,
        log ? ui.chip(DONE_LABEL[log.done], log.done === 'skip' ? 'danger' : 'ok') : null
      ])
    ]));

    if (!plan) {
      box.appendChild(el('p', { class: 'muted small',
        text: '筋トレのホームの「計画自動作成」を押すと、いまの体重と直近の記録から、'
          + '部位を分けて何日かぶんをまとめて組んでもらえます。' }));
      return box;
    }

    if (plan.focus) box.appendChild(el('p', { class: 'fit-focus', text: plan.focus }));
    if (plan.warmup.length) box.appendChild(listLine('準備', plan.warmup));

    if (plan.items.length) {
      var list = el('div', { class: 'fit-items' });
      plan.items.forEach(function (i) {
        var doneItem = log && log.items.filter(function (x) { return x.name === i.name; })[0];
        list.appendChild(el('div', { class: 'fit-item' + (doneItem ? ' is-done' : '') }, [
          el('div', { class: 'fit-item-h' }, [
            el('b', { text: i.name }),
            i.gear ? ui.chip(i.gear, 'ghosty') : null
          ]),
          el('div', { class: 'fit-set' }, [
            el('span', { class: 'fit-w', text: i.weight ? i.weight + 'kg' : '自重' }),
            el('span', { text: '×' + i.reps + '回　' + i.sets + 'セット' }),
            i.rest ? el('span', { class: 'muted', text: '休み' + i.rest + '秒' }) : null
          ]),
          i.note ? el('p', { class: 'muted small', text: i.note }) : null,
          doneItem ? el('p', { class: 'fit-did',
            text: '記録：' + doneItem.sets.map(function (s) {
              return (s.weight ? s.weight + 'kg×' : '') + s.reps;
            }).join('　') }) : null
        ]));
      });
      box.appendChild(list);
    }

    /* 腹筋は専用のメニュー。器具の種目とは分けて出す */
    if (plan.abs.length) {
      var absBox = el('div', { class: 'fit-abs' }, [
        el('div', { class: 'row-title', text: '腹筋メニュー' })
      ]);
      plan.abs.forEach(function (a) {
        var didIt = log && log.items.filter(function (x) { return x.name === a.name; })[0];
        absBox.appendChild(el('div', { class: 'fit-abs-i' + (didIt ? ' is-done' : '') }, [
          el('b', { text: a.name }),
          el('span', { class: 'fit-set', text: a.reps + '　' + a.sets + 'セット' }),
          a.note ? el('span', { class: 'muted small', text: a.note }) : null
        ]));
      });
      box.appendChild(absBox);
    }

    if (plan.cardio) {
      box.appendChild(el('div', { class: 'fit-cardio' }, [
        ui.icon('wSun', 15),
        el('span', { text: plan.cardio.kind
          + (plan.cardio.distance ? '　' + plan.cardio.distance + 'km' : '')
          + (plan.cardio.minutes ? '　' + plan.cardio.minutes + '分' : '')
          + (plan.cardio.pace ? '　' + plan.cardio.pace : '') }),
        plan.cardio.note ? el('span', { class: 'muted small', text: plan.cardio.note }) : null
      ]));
    }

    if (plan.cooldown.length) box.appendChild(listLine('整理', plan.cooldown));
    if (plan.note) box.appendChild(el('p', { class: 'muted small', text: plan.note }));

    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn(log ? '記録を直す' : '記録する', log ? 'ghost' : 'primary', function () {
        logSheet(date);
      }, 'check'),
      ui.btn('計画を直す', 'ghost tiny', function () { planEditSheet(date); }),
      // ジムに行けない日でも、部位はそのままに自重へ切り替えられるようにする
      plan.kind === 'gym' || plan.kind === 'home'
        ? ui.btn(plan.kind === 'gym' ? '自重に変える' : 'ジムに変える', 'ghost tiny',
          function () { swapPlace(date); })
        : null,
      ui.btn('この日の計画を消す', 'ghost tiny', function () {
        ui.confirm(U.fmtMD(date) + ' の計画を消します。', { danger: true, okText: '消す' })
          .then(function (ok) { if (ok) { S.removeFitPlan(date); ui.toast('消しました'); } });
      })
    ]));
    return box;
  }

  function listLine(label, arr) {
    return el('p', { class: 'fit-line' }, [
      el('span', { class: 'fit-line-k', text: label }),
      el('span', { text: arr.join('／') })
    ]);
  }

  /* ---------------- 1週間の並び ---------------- */

  function weekStrip(date) {
    var today = U.today();
    var from = U.addDays(today, -1);
    var box = el('div', { class: 'fit-week' });
    U.rangeDays(from, U.addDays(from, 8)).forEach(function (d) {
      var p = S.fitPlan(d), l = S.fitLog(d);
      var cls = 'fit-day';
      if (d === date) cls += ' on';
      if (d === today) cls += ' today';
      if (l && l.done !== 'skip') cls += ' done';
      else if (l) cls += ' miss';
      if (p && p.kind === 'rest') cls += ' rest';
      box.appendChild(el('button', {
        class: cls, 'aria-label': U.fmtMDW(d) + '　' + ((p && p.title) || '計画なし'),
        onclick: function () { location.hash = '#/fit/' + d; }
      }, [
        el('span', { class: 'fd-w', text: WDAY[U.parse(d).getDay()] }),
        el('b', { text: String(U.num(d.slice(8, 10), 0)) }),
        el('span', { class: 'fd-t', text: p ? shortTitle(p) : '—' })
      ]));
    });
    return box;
  }

  function shortTitle(p) {
    if (p.kind === 'rest') return '休';
    if (p.kind === 'run') return 'ラン';
    return String(p.title || 'ジム').slice(0, 4);
  }

  /* その日をジム⇄自重で入れ替える。部位はそのまま、種目だけ差し替える */
  function swapPlace(date) {
    var plan = S.fitPlan(date);
    if (!plan) return;
    var toHome = plan.kind === 'gym';
    ui.confirm(U.fmtMD(date) + ' を「' + (toHome ? '自重' : 'ジムの器具') + '」に変えます。'
      + '部位はそのままで、種目を組み替えます。', { okText: '変える' }).then(function (ok) {
      if (!ok) return;
      if (toHome) {
        S.putFitPlan(date, Object.assign({}, plan, {
          kind: 'home',
          // 見出し（肩と腕）と部位（三角筋・上腕…）の両方から種目を選ぶ
          items: F.homeMenu(plan.title + ' ' + plan.focus),
          note: plan.note
        }));
        ui.toast('自重のメニューに変えました');
      } else {
        // ジムへ戻すときは、種目までは決められない。計画から組み直してもらう
        S.putFitPlan(date, Object.assign({}, plan, { kind: 'gym' }));
        ui.toast('ジムに戻しました。種目は「計画自動作成」で組み直せます');
      }
      DL.app.render();
    });
  }

  /* ---------------- 体重 ---------------- */

  function weightCard() {
    var box = el('div', { class: 'card' });
    var t = F.trend(28);
    var w = S.latestWeight();
    var pr = S.fit().profile;

    if (!w) {
      box.appendChild(ui.empty('体重をまだ入れていません。',
        ui.btn('体重を入れる', 'primary', function () { weightSheet(U.today()); })));
      return box;
    }

    var goal = pr.goalWeight;
    box.appendChild(el('div', { class: 'sum-grid' }, [
      el('div', { class: 'sum-box' }, [
        el('span', { text: U.fmtMD(w.date) }), el('b', { text: w.kg + 'kg' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: '4週で' }),
        el('b', { class: t && t.diff > 0 ? 'up' : t && t.diff < 0 ? 'down' : '',
          text: t ? (t.diff >= 0 ? '+' : '') + t.diff + 'kg' : '—' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: goal ? '目標まで' : '体脂肪' }),
        el('b', { text: goal ? Math.round((w.kg - goal) * 10) / 10 + 'kg'
          : (w.fat ? w.fat + '%' : '—') })
      ])
    ]));

    var chart = weightChart();
    if (chart) box.appendChild(chart);

    if (t && t.n >= 2) {
      box.appendChild(el('p', { class: 'muted small', text: paceLine(t, pr) }));
    }
    return box;
  }

  /* 増減の速さについて、ひとこと */
  function paceLine(t, pr) {
    var w = t.perWeek;
    if (pr.goal === 'cut') {
      if (w > 0) return '増えています。食べる量を少し見直してみてください。';
      if (w < -1) return '週 ' + (-w) + 'kg は落としすぎです。筋肉も落ちます。';
      return '週 ' + (-w) + 'kg。落とすならこのくらいがちょうどよい速さです。';
    }
    // 増やす方向。週 0.2〜0.5kg くらいが、脂肪をあまり付けずに増やせる目安
    if (w <= 0) return '増えていません。ガチムチを目指すなら、食べる量を少し増やしてください。';
    if (w > 0.6) return '週 +' + w + 'kg は速すぎます。脂肪が乗りやすいので、少し落としてください。';
    return '週 +' + w + 'kg。増やす速さとしてはちょうどよいところです。';
  }

  function weightChart() {
    var t = F.trend(56);
    if (!t || t.rows.length < 2) return null;
    var rows = t.rows;
    var pr = S.fit().profile;

    var vals = rows.map(function (r) { return r.kg; });
    if (pr.goalWeight) vals.push(pr.goalWeight);
    var lo = Math.floor(Math.min.apply(null, vals) - 1);
    var hi = Math.ceil(Math.max.apply(null, vals) + 1);
    if (hi - lo < 4) hi = lo + 4;

    var W = 320, H = 130, L = 34, R = 8, T = 10, B = 18;
    var iw = W - L - R, ih = H - T - B;
    var x = function (i) { return L + (rows.length === 1 ? iw / 2 : i * iw / (rows.length - 1)); };
    var y = function (v) { return T + ih - (v - lo) / (hi - lo) * ih; };

    var svg = svgEl('svg', {
      class: 'lchart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': '体重の推移'
    });
    for (var g = 0; g <= 2; g++) {
      var gv = lo + (hi - lo) / 2 * g;
      svg.appendChild(svgEl('line', { class: 'lc-grid', x1: L, x2: W - R, y1: y(gv), y2: y(gv) }));
      svg.appendChild(svgEl('text', {
        class: 'lc-ytick', x: L - 5, y: y(gv) + 3, 'text-anchor': 'end'
      }, String(Math.round(gv * 10) / 10)));
    }
    if (pr.goalWeight && pr.goalWeight >= lo && pr.goalWeight <= hi) {
      svg.appendChild(svgEl('line', {
        class: 'lc-goal', x1: L, x2: W - R, y1: y(pr.goalWeight), y2: y(pr.goalWeight)
      }));
    }
    svg.appendChild(svgEl('polyline', {
      class: 'lc-line is-used',
      points: rows.map(function (r, i) {
        return Math.round(x(i) * 10) / 10 + ',' + Math.round(y(r.kg) * 10) / 10;
      }).join(' ')
    }));
    // 端の日付だけ
    [0, rows.length - 1].forEach(function (i) {
      svg.appendChild(svgEl('text', {
        class: 'lc-xtick', x: x(i), y: H - 5,
        'text-anchor': i === 0 ? 'start' : 'end'
      }, U.fmtMD(rows[i].date)));
    });
    return el('div', { class: 'lchart-box' }, svg);
  }

  function svgEl(name, attrs, text) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------------- 続きぐあい ---------------- */

  function keepCard() {
    var r = F.recent(4);
    return el('div', { class: 'card sum-grid' }, [
      el('div', { class: 'sum-box' }, [
        el('span', { text: 'できた' }), el('b', { text: r.done + '/' + r.planned + '回' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: 'ジム' }), el('b', { text: r.gym + '回' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: '有酸素' }), el('b', { text: r.run + '回' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: '続けて' }), el('b', { text: r.streak + '回' })
      ])
    ]);
  }

  /* ---------------- 計画自動作成 ---------------- */

  function planSheet(date) {
    var pr = S.fit().profile;
    var daysSel = ui.select([
      { value: '7', label: '1週間ぶん' },
      { value: '14', label: '2週間ぶん' },
      { value: '3', label: '3日ぶん' }
    ], '7');
    var fromIn = ui.input({ type: 'date', value: U.today() });
    /* ふだんは曜日の決めごとに従うが、「今週はジムに行けない」ような
       ときのために、この場で全部を寄せられるようにしておく */
    var where = '';
    var whereBox = ui.segmented([
      { value: '', label: 'いつもどおり' },
      { value: 'gym', label: 'ジムだけ' },
      { value: 'home', label: '自重だけ' }
    ], '', function (v) { where = v; });
    var noteIn = ui.textarea({ rows: 2,
      placeholder: '例）今週は腰が張っているのでデッドは軽めに／出張で火曜は行けない' });
    var out = el('div', { class: 'fit-out' });
    var busy = false;

    var goBtn = ui.btn('考えてもらう', 'primary full', function () { run(); }, 'idea');

    var body = el('div', { class: 'form' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'row-sub' }, [
          ui.chip(S.FIT_GOALS.filter(function (g) { return g.value === pr.goal; })
            .map(function (g) { return g.label; })[0] || '', 'soft'),
          ui.chip('週' + pr.days + '回', 'ghosty'),
          ui.chip('1回' + pr.minutes + '分', 'ghosty'),
          S.latestWeight() ? ui.chip(S.latestWeight().kg + 'kg', 'ghosty') : null
        ]),
        el('p', { class: 'muted small',
          text: 'いまの体重・直近の記録・種目ごとの重さを渡して組んでもらいます。' })
      ]),
      ui.field('いつから', fromIn),
      ui.field('どのくらい', daysSel),
      ui.block('何でやる', whereBox, whereHint()),
      ui.field('足しておきたいこと', noteIn),
      goBtn,
      out
    ]);

    if (!F.ready()) {
      body.insertBefore(el('div', { class: 'alert warn' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: '同期の接続先がまだです。設定の「PC・iPhone の同期」からつないでください。' })
      ]), body.firstChild);
    }

    ui.sheet({ title: '計画自動作成', body: body });

    function run() {
      if (busy) return;
      busy = true;
      goBtn.disabled = true;
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: '組んでいます…（30秒ほどかかります）' }));
      F.plan({ from: fromIn.value, days: U.num(daysSel.value, 7),
        where: where, note: noteIn.value })
        .then(function (r) {
          busy = false;
          goBtn.disabled = false;
          goBtn.querySelector('span').textContent = 'もう一度考えてもらう';
          U.clear(out);
          out.appendChild(planPreview(r));
        }).catch(function (e) {
          busy = false;
          goBtn.disabled = false;
          U.clear(out);
          out.appendChild(el('p', { class: 'mn-warn small' }, [
            ui.icon('alert', 14), el('span', { text: e.message })
          ]));
        });
    }
  }

  /* 曜日の決めごとを、ひとことで */
  function whereHint() {
    var hd = F.homeDays();
    if (!hd.length) return 'いまは、トレーニングの日はすべてジムの器具を使う決めです';
    var wd = F.gymDays().filter(function (d) { return hd.indexOf(d) < 0; });
    return 'いまの決め：ジム＝' + (wd.length ? nameDays(wd) : 'なし')
      + '／自重＝' + nameDays(hd) + '（設定 → からだと目標で変えられます）';
  }

  function nameDays(list) {
    return list.map(function (i) { return U.wdName(i); }).join('・');
  }

  function planPreview(r) {
    var box = el('div', {});
    (r.plans || []).forEach(function (d) {
      box.appendChild(el('div', { class: 'card fit-prev' }, [
        el('div', { class: 'fit-item-h' }, [
          el('b', { text: U.fmtMDW(d.date) + '　' + d.title }),
          ui.chip(KIND_LABEL[d.kind] || d.kind, d.kind === 'home' ? 'ghosty' : 'soft'),
          d.minutes ? ui.chip(d.minutes + '分', 'ghosty') : null
        ]),
        d.focus ? el('p', { class: 'muted small', text: d.focus }) : null,
        (d.items || []).length ? el('ul', { class: 'fit-prev-l' }, d.items.map(function (i) {
          return el('li', { text: i.name + '　' + (i.weight ? i.weight + 'kg' : '自重')
            + '×' + i.reps + '　' + i.sets + 'セット' });
        })) : null,
        (d.abs || []).length ? el('p', { class: 'muted small',
          text: '腹筋メニュー：' + d.abs.map(function (a) {
            return a.name + ' ' + a.reps + '×' + a.sets;
          }).join('／') }) : null,
        d.cardio ? el('p', { class: 'muted small',
          text: d.cardio.kind + ' ' + (d.cardio.distance || 0) + 'km '
            + (d.cardio.minutes || 0) + '分' }) : null
      ]));
    });
    if (r.advice) {
      box.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'row-title', text: '食事と休養' }),
        el('p', { class: 'fit-advice', text: r.advice })
      ]));
    }
    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('この計画にする', 'primary', function () {
        var n = F.adopt(r.plans, { overwrite: false });
        ui.closeAllSheets();
        ui.toast(n + '日ぶん入れました');
      }, 'check'),
      ui.btn('前のぶんも置き換える', 'ghost', function () {
        var n = F.adopt(r.plans, { overwrite: true });
        ui.closeAllSheets();
        ui.toast(n + '日ぶん置き換えました');
      })
    ]));
    return box;
  }

  /* ---------------- 記録する ---------------- */

  function logSheet(date) {
    var plan = S.fitPlan(date);
    var prev = S.fitLog(date);
    var done = (prev && prev.done) || 'full';
    var items = [];

    var box = el('div', { class: 'form' });

    box.appendChild(ui.block('できたか', ui.segmented([
      { value: 'full', label: 'やった' },
      { value: 'part', label: '途中まで' },
      { value: 'skip', label: 'できなかった' }
    ], done, function (v) { done = v; })));

    // 種目ごとのセット。計画の回数と重さを最初から入れておく。
    // 腹筋メニューも同じ形で記録できるよう、うしろに続ける
    var planned = plan
      ? plan.items.concat(plan.abs.map(function (a) {
        return { name: a.name, gear: '自重', sets: a.sets, reps: a.reps, weight: 0 };
      }))
      : (prev ? prev.items : []);
    planned.forEach(function (pi) {
      var was = prev && prev.items.filter(function (x) { return x.name === pi.name; })[0];
      var nSets = Math.max(1, pi.sets || (was ? was.sets.length : 3));
      var rows = [];
      var wrapItem = el('div', { class: 'card fit-log-item' }, [
        el('div', { class: 'fit-item-h' }, [
          el('b', { text: pi.name }),
          pi.gear ? ui.chip(pi.gear, 'ghosty') : null
        ])
      ]);
      for (var i = 0; i < nSets; i++) {
        var w = was && was.sets[i] ? was.sets[i].weight : F.dec(pi.weight, 0);
        var rp = was && was.sets[i] ? was.sets[i].reps : F.repsGoal(pi.reps);
        var wIn = ui.input({ type: 'number', step: '0.5', min: 0, value: w, inputmode: 'decimal' });
        var rIn = ui.input({ type: 'number', min: 0, value: rp, inputmode: 'numeric' });
        rows.push({ w: wIn, r: rIn });
        wrapItem.appendChild(el('div', { class: 'fit-log-set' }, [
          el('span', { class: 'fit-log-n', text: (i + 1) + 'set' }),
          wIn, el('span', { class: 'muted', text: 'kg' }),
          rIn, el('span', { class: 'muted', text: '回' })
        ]));
      }
      items.push({ name: pi.name, rows: rows });
      box.appendChild(wrapItem);
    });

    // 有酸素
    var pc = (prev && prev.cardio) || (plan && plan.cardio) || null;
    var cKind = ui.select(F.CARDIO, (pc && pc.kind) || 'ラン');
    var cKm = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal',
      value: pc ? pc.distance : '' });
    var cMin = ui.input({ type: 'number', min: 0, inputmode: 'numeric',
      value: pc ? pc.minutes : '' });
    var cNote = ui.input({ maxlength: 60, value: pc ? pc.note : '',
      placeholder: '走った道（例）川沿い〜公園' });
    box.appendChild(ui.block('有酸素', el('div', { class: 'fit-cardio-in' }, [
      cKind,
      el('div', { class: 'grid2' }, [
        ui.field('距離(km)', cKm), ui.field('時間(分)', cMin)
      ]),
      cNote
    ])));

    var minIn = ui.input({ type: 'number', min: 0, inputmode: 'numeric',
      value: prev ? prev.minutes : (plan ? plan.minutes : 60) });
    var rpeIn = ui.input({ type: 'number', min: 0, max: 10, inputmode: 'numeric',
      value: prev ? prev.rpe : '' });
    box.appendChild(el('div', { class: 'grid2' }, [
      ui.field('かかった時間(分)', minIn),
      ui.field('きつさ(1〜10)', rpeIn)
    ]));

    var memoIn = ui.textarea({ rows: 2, value: prev ? prev.memo : '',
      placeholder: '例）ベンチ最後の1回が上がらなかった／腰に違和感' });
    box.appendChild(ui.field('メモ', memoIn));

    var close = ui.sheet({
      title: U.fmtMDW(date) + ' の記録',
      body: box,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () { save(); })
      ]
    });

    function save() {
      var km = F.dec(cKm.value, 0), cmin = U.num(cMin.value, 0);
      S.putFitLog(date, {
        date: date,
        done: done,
        minutes: U.num(minIn.value, 0),
        rpe: U.num(rpeIn.value, 0),
        memo: memoIn.value,
        items: items.map(function (it) {
          return {
            name: it.name,
            sets: it.rows.map(function (r) {
              return { weight: F.dec(r.w.value, 0), reps: U.num(r.r.value, 0) };
            }).filter(function (s) { return s.reps > 0; })
          };
        }).filter(function (i) { return i.sets.length; }),
        cardio: (km || cmin) ? { kind: cKind.value, distance: km, minutes: cmin, note: cNote.value } : null
      });
      var up = F.applyProgress(date);
      close();
      ui.toast(up.length
        ? '記録しました。' + up.length + '種目の重さを上げました'
        : '記録しました');
      if (up.length) upSheet(up);
    }
  }

  /* 上がった重さを見せる。次の計画からこの重さで組まれる */
  function upSheet(up) {
    ui.sheet({
      title: '次はこの重さで',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'list' }, up.map(function (u) {
          return el('div', { class: 'row' }, [
            el('div', { class: 'row-main' }, [
              el('div', { class: 'row-title', text: u.name }),
              el('div', { class: 'row-sub' }, [
                ui.chip((u.from || 0) + 'kg → ' + u.to + 'kg', 'ok'),
                el('span', { class: 'muted small', text: u.why })
              ])
            ])
          ]);
        })),
        el('p', { class: 'muted small',
          text: 'この重さは、次に計画を作るときの土台になります。' })
      ])
    });
  }

  /* ---------------- 計画を手で直す ---------------- */

  function planEditSheet(date) {
    var p = S.fitPlan(date) || { kind: 'gym', title: '', minutes: 60, items: [], warmup: [], cooldown: [] };
    var kind = p.kind;
    var titleIn = ui.input({ value: p.title || '', maxlength: 60 });
    var minIn = ui.input({ type: 'number', min: 0, inputmode: 'numeric', value: p.minutes });
    var noteIn = ui.textarea({ rows: 2, value: p.note || '' });

    var close = ui.sheet({
      title: U.fmtMDW(date) + ' の計画',
      body: el('div', { class: 'form' }, [
        ui.block('種類', ui.segmented([
          { value: 'gym', label: 'ジム' }, { value: 'run', label: 'ラン' }, { value: 'rest', label: '休み' }
        ], kind, function (v) { kind = v; })),
        ui.field('見出し', titleIn),
        ui.field('目安の時間(分)', minIn),
        ui.field('メモ', noteIn),
        el('p', { class: 'muted small',
          text: '種目の中身を大きく変えたいときは、「計画自動作成」から組み直すほうが早いです。' })
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.putFitPlan(date, Object.assign({}, p, {
            kind: kind, title: titleIn.value, minutes: U.num(minIn.value, 0), note: noteIn.value
          }));
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- 体重を入れる ---------------- */

  function weightSheet(date) {
    var w = S.weightOf(date);
    var last = S.latestWeight();
    var dateIn = ui.input({ type: 'date', value: date });
    var kgIn = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal',
      value: w ? w.kg : (last ? last.kg : '') });
    var fatIn = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal',
      value: w && w.fat ? w.fat : '' });
    var musIn = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal',
      value: w && w.muscle ? w.muscle : '' });

    var close = ui.sheet({
      title: '体重',
      body: el('div', { class: 'form' }, [
        ui.field('日付', dateIn),
        ui.field('体重(kg)', kgIn),
        el('div', { class: 'grid2' }, [
          ui.field('体脂肪(%)', fatIn), ui.field('筋肉量(kg)', musIn)
        ]),
        w ? ui.btn('この日の記録を消す', 'danger full mt', function () {
          S.removeWeight(w.date);
          close();
          ui.toast('消しました');
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var kg = F.dec(kgIn.value, 0);
          if (!(kg > 0)) { ui.toast('体重を入れてください', 'danger'); return; }
          S.putWeight({
            date: U.isISO(dateIn.value) ? dateIn.value : date,
            kg: kg,
            fat: fatIn.value === '' ? null : F.dec(fatIn.value, 0),
            muscle: musIn.value === '' ? null : F.dec(musIn.value, 0),
            from: 'manual'
          });
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- 体重計から取り込む ---------------- */

  function importSheet() {
    var out = el('div', {});
    var csv = ui.textarea({ rows: 4,
      placeholder: 'EufyLife アプリから書き出した CSV を、ここに貼り付け' });

    var body = el('div', { class: 'form' }, [
      shortcutCard(),
      el('div', { class: 'card' }, [
        el('div', { class: 'row-title', text: '預かっているぶんを取り込む' }),
        el('p', { class: 'muted small',
          text: 'ショートカットや体重計のスクリプトが預けてくれたぶんを入れます。'
            + 'この画面を開いたときにも、そっと取り込んでいます。' }),
        el('div', { class: 'row-wrap' }, [
          ui.btn('いま取り込む', 'primary', function () { pull(); }, 'cloud'),
          ui.btn('送り先を試す', 'ghost tiny', function () { check(); })
        ]),
        el('p', { class: 'muted small',
          text: 'ショートカットが通らないときは「送り先を試す」を押すと、'
            + 'どこで止まっているか分かります。押しても何も書き換えません。' })
      ]),
      out,
      fitbitCard(),
      ui.field('CSV を貼り付けて入れる', csv,
        'EufyLife アプリ →「データのエクスポート」で出した CSV が読めます'),
      ui.btn('CSV から入れる', 'ghost full', function () { fromCSV(); }, 'plus'),
      el('p', { class: 'muted small',
        text: 'PC やラズパイがあるなら、tools/eufy-weight.py で体重計から直に読むこともできます'
          + '（乗るだけで入ります。立て方は sync/README.md）。' })
    ]);

    ui.sheet({ title: '体重の取り込み', body: body });

    /* Fitbit から読む道。
       EufyLife → Fitbit までつないであれば、あとは Worker が読むだけ。

       ただし Fitbit 側の窓口は閉じつつある。開発者の新規登録は終わっていて、
       いまから鍵を作ることはできない。Web API そのものも 2026年9月で終わり、
       後継の Google Health API は審査が要るので、ひとりの持ち物には重すぎる。
       すでに鍵があるときだけ使える道として残しておく。 */
    var FB_OVER = 'Fitbit 側の新規登録は終了しました。いまから鍵を作ることはできません。'
      + 'Web API そのものも 2026年9月で終わります。'
      + '上の「ショートカット」の道を使ってください。';

    function fitbitCard() {
      var box = el('div', { class: 'card fb-card' }, [
        el('div', { class: 'row-title', text: 'Fitbit から読む（終了しました）' }),
        el('p', { class: 'muted small', text: '見に行っています…' })
      ]);
      F.fitbit.status().then(function (st) {
        U.clear(box);
        box.appendChild(el('div', { class: 'row-title' }, [
          el('span', { text: st.linked ? 'Fitbit から読む' : 'Fitbit から読む（終了しました）' }),
          st.linked ? ui.chip('つながっています', 'ok') : null
        ]));
        if (!st.ready) {
          box.appendChild(el('p', { class: 'mn-warn small' }, [
            ui.icon('alert', 14), el('span', { text: FB_OVER })
          ]));
          box.appendChild(el('p', { class: 'muted small',
            text: '（もし前に作った Fitbit の鍵が手元にあるなら、sync/setup.sh で '
              + 'FITBIT_CLIENT_ID と FITBIT_CLIENT_SECRET を入れれば、ここは使えるようになります。）' }));
          if (st.redirect) {
            box.appendChild(el('div', { class: 'fit-url', text: st.redirect }));
          }
          return;
        }
        if (!st.linked) {
          box.appendChild(el('p', { class: 'muted small',
            text: 'Fitbit の Web API は 2026年9月で終わります。それまでの間だけ使えます。' }));
        }
        box.appendChild(el('p', { class: 'muted small',
          text: st.linked
            ? 'この画面を開くたびに、Fitbit から新しいぶんを取り込みます。'
            : 'EufyLife アプリ → 設定 → Fitbit 連携をオンにしてから、下の「つなぐ」を押してください。' }));
        box.appendChild(el('div', { class: 'row-wrap' }, [
          st.linked ? ui.btn('Fitbit から取り込む', 'primary', function () { fbPull(); }, 'cloud')
            : ui.btn('Fitbit とつなぐ', 'primary', function () { fbLink(); }, 'cloud'),
          st.linked ? ui.btn('つなぎを外す', 'ghost tiny', function () {
            ui.confirm('Fitbit とのつなぎを外します。体重の記録はそのまま残ります。',
              { danger: true, okText: '外す' }).then(function (yes) {
              if (!yes) return;
              F.fitbit.unlink().then(function () {
                ui.toast('外しました');
                DL.app.render();
              }).catch(function (e) { ui.toast(e.message, 'danger'); });
            });
          }) : null
        ]));
      });
      return box;
    }

    function fbLink() {
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: '入口を用意しています…' }));
      F.fitbit.start().then(function (r) {
        U.clear(out);
        out.appendChild(el('p', { class: 'muted small',
          text: 'Fitbit の画面が開きます。許可したら、この画面に戻って'
            + '「Fitbit から取り込む」を押してください。' }));
        // 別のタブで開く（アプリの画面はそのまま残す）
        window.open(r.url, '_blank');
      }).catch(function (e) {
        U.clear(out);
        out.appendChild(el('p', { class: 'mn-warn small' }, [
          ui.icon('alert', 14), el('span', { text: e.message })
        ]));
      });
    }

    function fbPull() {
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: 'Fitbit に聞いています…' }));
      F.fitbit.pull(30).then(function (r) {
        U.clear(out);
        out.appendChild(el('p', { class: 'muted small',
          text: r.found
            ? r.found + '件のうち ' + r.added + '件を入れました'
            : 'Fitbit にまだ体重の記録がありませんでした' }));
        if (r.added) DL.app.render();
      }).catch(function (e) {
        U.clear(out);
        out.appendChild(el('p', { class: 'mn-warn small' }, [
          ui.icon('alert', 14), el('span', { text: e.message })
        ]));
      });
    }

    /* iPhone だけで完結する道。
       EufyLife → Apple のヘルスケア → ショートカット → この受け口。
       ブラウザからヘルスケアは読めないので、iPhone 側から送ってもらう */
    function shortcutCard() {
      /* ショートカット App に出てくる、いまの名前をそのまま書く。
         アクションは4つだけ。ヘッダを足す手間は、体重だけの合鍵で無くした */
      var steps = [
        'EufyLife アプリでヘルスケアへの同期をオンにして、一度 体重計に乗る。'
          + 'ヘルスケア App →「ブラウズ」→「身体測定値」→「体重」に数字が入ればOK',
        'ショートカット App →「ショートカット」タブ → 右上の「＋」',
        '検索欄に「ヘルスケア」と入れて【ヘルスケアサンプルを検索】を足す。'
          + '「フィルタを追加」→ 種類「が次と等しい」体重／'
          + '単位＝kg／グループ分け＝なし／並び順序＝開始日／順序＝新しい順／'
          + '制限＝オン（1件のヘルスケアサンプルを取得）',
        '検索欄に「ヘルスケア」と入れて【ヘルスケアサンプルの詳細を取得】を足す。'
          + '「詳細」を押して【値】を選ぶ（これで数字だけになります）',
        '検索欄に「テキスト」と入れて【テキスト】を足す。'
          + '中身は「下の送り先」を貼り付けてから、そのうしろに手順4の変数「値」。'
          + 'この順番です（値だけ、URL だけ、のどちらでもうまくいきません）。'
          + '★「&kg=」と変数の間に空白が入っていないかを必ず見てください。'
          + '空白があると、そこで URL が切れて数字が届きません',
        '検索欄に「URL」と入れて【URLの内容を取得】を足す。'
          + 'URL の欄には、手順5の変数「テキスト」だけを入れる。'
          + 'ここに URL を直に書かないでください（書くと数字が付きません）',
        '右上の「▶」で試す。{"ok":true,"added":1} が返れば通っています',
        '右上の「完了」で保存。名前は何でもかまいません',
        'ショートカット App →「オートメーション」タブ →「＋」→「時刻」→'
          + '毎日 7:00 →「新規の空のオートメーション」→【ショートカットを実行】で'
          + 'いま作ったものを選ぶ。「実行前に尋ねる」はオフ'
      ];
      var traps = [
        '{"error":"no_weight"} が返る … まず【テキスト】の「&kg=」と変数の間に'
          + '空白が入っていないかを見てください。貼り付けたうしろに変数を入れると、'
          + '半角スペースが1つ入ることがあります。URL に空白があると、'
          + 'ショートカットはそこで打ち切ってしまい、数字が届きません。'
          + '変数のすぐ左にカーソルを置いて backspace を1回',
        '組み立てた URL を見たい … 【テキスト】の下に【クイックルック】を足して ▶。'
          + '「&kg=83.8」と、すき間なく繋がっていれば正しい形です',
        '{"error":"no_weight"} で、空白も無い … ヘルスケアから体重が取れていません。'
          + '設定 App →「ヘルスケア」→「データアクセスとデバイス」→「ショートカット」で'
          + '体重の読み出しがオンか、ヘルスケアに体重が入っているかを見てください',
        'アクションが見つからない … ヘルスケア App を一度開いて、'
          + 'ショートカット App を開き直すと出てくることがあります',
        '{"error":"bad_key"} … 送り先の ?k= が古いか、欠けています。'
          + '下の「送り先を作り直す」でやり直してください',
        '404 が返る … Worker がまだ古いです。上の「送り先を試す」を押してください',
        '「81.2 kg」のような文が送られる … 手順4の「詳細」が【値】になっていません'
          + '（そのままでも通りますが、値にしておくのが確実です）'
      ];

      var box = el('div', { class: 'card sc-card' }, [
        el('p', { class: 'muted small', text: '送り先を見ています…' })
      ]);
      draw(null, true);
      F.weightKey.get().then(function (r) { draw(r.key, false); });
      return box;

      function draw(key, waiting) {
        U.clear(box);
        box.appendChild(el('div', { class: 'row-title',
          text: 'iPhone だけで自動にする（ショートカット）' }));
        box.appendChild(el('p', { class: 'muted small',
          text: 'EufyLife は Apple の「ヘルスケア」へ体重を送れます。ブラウザから'
            + 'ヘルスケアは読めないので、ショートカットに「ヘルスケアから読んで、'
            + 'ここへ送る」をやってもらいます。PC もラズパイも要りません。' }));

        if (!F.postUrl()) {
          box.appendChild(el('p', { class: 'mn-warn small' }, [
            ui.icon('alert', 14),
            el('span', { text: '先に 設定 → 同期 で接続先を入れてください。' })
          ]));
          return;
        }
        if (waiting) {
          box.appendChild(el('p', { class: 'muted small', text: '送り先を見ています…' }));
          return;
        }

        if (!key) {
          box.appendChild(el('p', { class: 'muted small',
            text: 'まず送り先を作ります。体重を書き足すことしかできない合鍵が入るので、'
              + 'ショートカット側で「ヘッダ」を足す必要がありません。' }));
          box.appendChild(ui.btn('ショートカット用の送り先を作る', 'primary full', function () {
            F.weightKey.create().then(function (r) {
              draw(r.key, false);
              ui.toast('作りました');
            }).catch(function (e) { ui.toast(e.message, 'danger'); });
          }, 'plus'));
          return;
        }

        var paste = F.easyUrl(key);
        box.appendChild(el('p', { class: 'muted small', text: '手順5で貼り付ける送り先：' }));
        box.appendChild(el('div', { class: 'fit-url', text: paste }));
        box.appendChild(el('div', { class: 'row-wrap' }, [
          ui.btn('送り先をコピー', 'primary', function () {
            U.copy(paste).then(function (ok) {
              ui.toast(ok ? 'コピーしました' : 'コピーできませんでした', ok ? '' : 'warn');
            });
          }, 'folder'),
          ui.btn('作り直す', 'ghost tiny', function () {
            ui.confirm('新しい送り先を作ります。いまショートカットに入っている'
              + '送り先は使えなくなります。', { okText: '作り直す' }).then(function (yes) {
              if (!yes) return;
              F.weightKey.create().then(function (r) {
                draw(r.key, false);
                ui.toast('作り直しました。ショートカットの送り先も貼り替えてください');
              }).catch(function (e) { ui.toast(e.message, 'danger'); });
            });
          }),
          ui.btn('使わない', 'ghost tiny', function () {
            ui.confirm('この送り先を捨てます。ショートカットは動かなくなります。',
              { danger: true, okText: '捨てる' }).then(function (yes) {
              if (!yes) return;
              F.weightKey.remove().then(function () {
                draw(null, false);
                ui.toast('捨てました');
              }).catch(function (e) { ui.toast(e.message, 'danger'); });
            });
          })
        ]));
        box.appendChild(el('ol', { class: 'fit-steps' },
          steps.map(function (t) { return el('li', { text: t }); })));
        box.appendChild(el('p', { class: 'muted small',
          text: '体脂肪も送るなら、うしろに &fat= と体脂肪の変数を足します。'
            + '日付は付けなければ、送った日（日本時間）のぶんになります。'
            + 'この送り先でできるのは体重を書き足すことだけで、'
            + 'ほかのデータは読めません。本物の合鍵は URL に入れないでください。' }));
        box.appendChild(el('div', { class: 'row-title', text: 'つまずきやすいところ' }));
        box.appendChild(el('ul', { class: 'fit-traps' },
          traps.map(function (t) { return el('li', { text: t }); })));
      }
    }

    /* 受け口が生きているかを見て、そのまま言葉で返す */
    function check() {
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: '送り先を見ています…' }));
      F.checkInbox().then(function (r) {
        U.clear(out);
        out.appendChild(r.ok
          ? el('p', { class: 'muted small' }, [ui.icon('check', 14), el('span', { text: ' ' + r.text })])
          : el('p', { class: 'mn-warn small' }, [ui.icon('alert', 14), el('span', { text: r.text })]));
      });
    }

    function pull() {
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: '取りに行っています…' }));
      F.pull().then(function (r) {
        U.clear(out);
        if (r.off) {
          out.appendChild(el('p', { class: 'mn-warn small' }, [
            ui.icon('alert', 14),
            el('span', { text: 'サーバー側が未対応です。Worker を新しくして deploy し直してください。' })
          ]));
          return;
        }
        out.appendChild(el('p', { class: 'muted small',
          text: r.added ? r.added + '件 入れました' : '新しいぶんはありませんでした' }));
        if (r.added) DL.app.render();
      }).catch(function (e) {
        U.clear(out);
        out.appendChild(el('p', { class: 'mn-warn small' }, [
          ui.icon('alert', 14), el('span', { text: e.message })
        ]));
      });
    }

    function fromCSV() {
      var rows = F.parseCSV(csv.value);
      if (!rows.length) { ui.toast('日付と体重の列が見つかりませんでした', 'danger'); return; }
      var n = 0;
      rows.forEach(function (r) {
        if (S.putWeight({ date: r.date, kg: r.kg, fat: r.fat, muscle: r.muscle, from: 'csv' })) n++;
      });
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small',
        text: rows.length + '件のうち ' + n + '件を入れました' }));
      DL.app.render();
    }
  }

  /* ---------------- からだと目標 ---------------- */

  function profileSheet() {
    var p = S.fit().profile;
    var hIn = ui.input({ type: 'number', min: 0, inputmode: 'numeric', value: p.height || '' });
    var aIn = ui.input({ type: 'number', min: 0, inputmode: 'numeric', value: p.age || '' });
    var gwIn = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal', value: p.goalWeight || '' });
    var goalSel = ui.select(S.FIT_GOALS, p.goal);
    var lvSel = ui.select(S.FIT_LEVELS, p.level);
    var daysIn = ui.input({ type: 'number', min: 1, max: 7, inputmode: 'numeric', value: p.days });
    var minIn = ui.input({ type: 'number', min: 15, max: 180, inputmode: 'numeric', value: p.minutes });
    var gymIn = ui.input({ value: p.gym, maxlength: 40 });
    var noteIn = ui.textarea({ rows: 2, value: p.note,
      placeholder: '例）右肩を痛めたことがある／腰は無理をしない' });

    var picked = p.weekdays.slice();
    var home = p.homedays.slice();
    var homeBtns = [];

    var wdBox = el('div', { class: 'fit-wd' }, WDAY.map(function (w, i) {
      var b = ui.btn(w, 'ghost' + (picked.indexOf(i) >= 0 ? ' on' : ''), function () {
        var at = picked.indexOf(i);
        if (at >= 0) picked.splice(at, 1); else picked.push(i);
        b.classList.toggle('on', picked.indexOf(i) >= 0);
        syncHome();
      });
      return b;
    }));

    /* トレーニングの日のうち、どれを自重にするか。
       トレーニングしない曜日は押せないようにしておく */
    var homeBox = el('div', { class: 'fit-wd' }, WDAY.map(function (w, i) {
      var b = ui.btn(w, 'ghost' + (home.indexOf(i) >= 0 ? ' on' : ''), function () {
        if (picked.indexOf(i) < 0) return;
        var at = home.indexOf(i);
        if (at >= 0) home.splice(at, 1); else home.push(i);
        b.classList.toggle('on', home.indexOf(i) >= 0);
      });
      homeBtns.push(b);
      return b;
    }));

    function syncHome() {
      homeBtns.forEach(function (b, i) {
        var on = picked.indexOf(i) >= 0;
        b.disabled = !on;
        if (!on && home.indexOf(i) >= 0) {
          home.splice(home.indexOf(i), 1);
          b.classList.remove('on');
        }
      });
    }
    syncHome();

    var close = ui.sheet({
      title: 'からだと目標',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'grid2' }, [
          ui.field('身長(cm)', hIn), ui.field('年齢', aIn)
        ]),
        ui.field('目指す体型', goalSel),
        ui.field('目標体重(kg)', gwIn, '決めていなければ空のままで大丈夫です'),
        ui.field('経験', lvSel),
        ui.field('通うジム', gymIn),
        el('div', { class: 'grid2' }, [
          ui.field('週に何回', daysIn), ui.field('1回の分数', minIn)
        ]),
        ui.block('トレーニングする曜日', wdBox, '決めておくと、その曜日に計画が入ります'),
        ui.block('そのうち自重でやる曜日', homeBox,
          '選んだ曜日は、器具を使わない自重だけで組みます。'
            + '選ばなければ、すべてジムの器具を使います'),
        ui.field('気をつけること', noteIn)
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.updateFitProfile({
            height: U.num(hIn.value, 0), age: U.num(aIn.value, 0),
            goalWeight: F.dec(gwIn.value, 0), goal: goalSel.value, level: lvSel.value,
            gym: gymIn.value, days: U.num(daysIn.value, 4), minutes: U.num(minIn.value, 60),
            weekdays: picked.slice().sort(), homedays: home.slice().sort(),
            note: noteIn.value
          });
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- 記録の一覧 ---------------- */

  function historySheet() {
    var logs = S.fitLogs();
    var dates = Object.keys(logs).sort().reverse().slice(0, 60);
    var body = el('div', { class: 'form' });
    if (!dates.length) {
      body.appendChild(ui.empty('まだ記録がありません。'));
    } else {
      body.appendChild(el('div', { class: 'list' }, dates.map(function (d) {
        var l = logs[d], p = S.fitPlan(d);
        return el('button', { class: 'row', onclick: function () {
          ui.closeAllSheets();
          location.hash = '#/fit/' + d;
        } }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title', text: U.fmtMDW(d) + '　' + ((p && p.title) || '') }),
            el('div', { class: 'row-sub' }, [
              ui.chip(DONE_LABEL[l.done], l.done === 'skip' ? 'danger' : 'ok'),
              l.minutes ? ui.chip(l.minutes + '分', 'ghosty') : null,
              l.items.length ? ui.chip(l.items.length + '種目', 'ghosty') : null,
              l.cardio ? ui.chip((l.cardio.distance || 0) + 'km', 'soft') : null,
              l.rpe ? ui.chip('きつさ' + l.rpe, 'ghosty') : null
            ])
          ]),
          el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
        ]);
      })));
    }
    ui.sheet({ title: '記録の一覧', body: body });
  }

  /* ---------------- 出入りの幕 ----------------

     筋トレのタブは黒、ほかのタブは明るい。そのまま切り替えると
     目に刺さるので、あいだに黒い幕をはさむ。

     入るとき … 上から黒い幕が降りてくる → 稲妻が 0 から 100 まで溜まる
                 → 溜まりきったら幕が開いて、中の画面が出る
     出るとき … 黒い幕を張ったところから始めて、下から上へ上げる

     どちらも幕は上端を軸にした縦の伸び縮み。降りるのも上がるのも
     同じ軸なので、行き来が一本の動きにつながって見える。

     溜めの数字・ゲージ・ダンベルの染まりは、同じ値から描く。
     CSS の時間任せにすると三つがずれるので、ここで毎フレーム進める。 */

  /* 幕の長さ。CSS には --fi-ms として渡すので、ここだけ直せばそろう */
  var CURTAIN_MS = 340;        // 幕が降りきるまで
  var LIFT_MS = 420;           // 幕が上がりきるまで
  var CHARGE_MS = 820;
  /* ダンベルの絵は 24 のマスの縦 7.5〜16.5 にしかない。
     枠の上下いっぱいで切ると、半分も溜まらないうちに染まりきってしまうので、
     絵のあるところだけを行き来させる。線の太さぶん、少し外まで取る */
  var CLIP_LO = 71.4, CLIP_HI = 28.4;
  var fxEl = null;
  var fxRaf = 0;
  var fxTimers = [];
  var fxParts = null;
  var curtainDown = false;

  function calmly() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* 幕を出してよいか。動きを控えめにしている人と、
     起動の幕がまだ出ているあいだは、何もしない */
  function mayPlay() {
    if (calmly()) return false;
    var splash = document.getElementById('splash');
    return !(splash && !splash.classList.contains('out'));
  }

  function later(fn, ms) { fxTimers.push(setTimeout(fn, ms)); }

  /* ---- 入るとき ----

     幕を降ろすのは、中身を入れ替える前。そうしないと明るい画面が
     一瞬で黒くなってしまい、幕が降りる意味がなくなる。
     降りきったら app.js に描き直してもらい、そこから溜め始める。 */

  /**
   * 黒い幕を降ろす。降りきったら again() を呼ぶ。
   * @returns {boolean} true なら、こちらで引き取ったので描き直しを待ってほしい
   */
  function dropCurtain(again) {
    if (!mayPlay() || curtainDown) return false;
    closeFx();
    build();
    curtainDown = true;
    fxEl.style.setProperty('--fi-ms', CURTAIN_MS + 'ms');
    document.body.appendChild(fxEl);
    later(again, CURTAIN_MS);
    return true;
  }

  function intro() {
    // 幕が降りきって描き直された、そのとき。降りていなければ何もしない
    if (!curtainDown || !fxEl) return;
    fxEl.classList.add('down');
    charge(fxParts.bar, fxParts.fill, fxParts.num, fxParts.bolt, fxParts.label);
  }

  function build() {
    var bar = el('i', { class: 'fi-bar-in' });
    var fill = ui.icon('dumbbell', 112, 'fi-dumb fi-dumb-on');
    var num = el('b', { class: 'fi-num', text: '0' });
    var bolt = ui.icon('bolt', 34, 'fi-bolt');
    var label = el('span', { class: 'fi-label', text: 'CHARGING' });

    fxEl = el('div', {
      id: 'fitIntro', class: 'fit-intro', 'aria-hidden': 'true'
    }, [
      el('div', { class: 'fi-curtain' }),
      el('div', { class: 'fi-body' }, [
        el('div', { class: 'fi-stage' }, [
          ui.icon('dumbbell', 112, 'fi-dumb fi-dumb-off'),
          fill,
          bolt
        ]),
        el('div', { class: 'fi-meter' }, [
          el('span', { class: 'fi-bar' }, bar),
          el('span', { class: 'fi-read' }, [num, el('span', { class: 'fi-pct', text: '%' })])
        ]),
        label
      ])
    ]);
    fxParts = { bar: bar, fill: fill, num: num, bolt: bolt, label: label };
  }

  function charge(bar, fill, num, bolt, label) {
    var t0 = 0;
    var step = function (now) {
      if (!fxEl) return;
      if (!t0) t0 = now;
      var t = Math.min(1, (now - t0) / CHARGE_MS);
      // 後半をゆるめて、溜まりきる手前で「ぐっ」とくるようにする
      var v = Math.round(100 * (1 - Math.pow(1 - t, 2.2)));
      num.textContent = String(v);
      bar.style.width = v + '%';
      // ダンベルは下から染まる
      fill.style.clipPath =
        'inset(' + (CLIP_LO - (CLIP_LO - CLIP_HI) * v / 100).toFixed(2) + '% 0 0 0)';
      bolt.style.opacity = String(0.25 + 0.75 * (v / 100));
      if (t < 1) { fxRaf = requestAnimationFrame(step); return; }
      // 溜まりきった。ひと光りさせてから幕を開ける
      label.textContent = 'READY';
      fxEl.classList.add('full');
      later(closeFx, 220);
    };
    fxRaf = requestAnimationFrame(step);
  }

  /* ---- 出るとき ---- */

  function outro() {
    if (!mayPlay()) return;
    closeFx();
    /* 幕はもう張ってある状態から始める。次の画面はその裏で描き終わっていて、
       幕が上がるにつれて下から出てくる */
    fxEl = el('div', { id: 'fitOutro', class: 'fit-outro', 'aria-hidden': 'true' });
    fxEl.style.setProperty('--fi-ms', LIFT_MS + 'ms');
    document.body.appendChild(fxEl);
    later(closeFx, LIFT_MS);
  }

  function closeFx() {
    if (fxRaf) { cancelAnimationFrame(fxRaf); fxRaf = 0; }
    fxTimers.forEach(clearTimeout);
    fxTimers = [];
    if (fxEl && fxEl.parentNode) fxEl.parentNode.removeChild(fxEl);
    fxEl = null;
    fxParts = null;
    curtainDown = false;
  }

  DL.views = DL.views || {};
  DL.views.fit = {
    render: render, logSheet: logSheet, weightSheet: weightSheet,
    dropCurtain: dropCurtain, intro: intro, outro: outro, closeFx: closeFx
  };
})(window.DL);
