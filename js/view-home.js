/* ホーム（ダッシュボード） */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  function render(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });

    /* 今日。案件のノルマと日常の予定を、どちらもここに出す */
    var load = sc.loadOfDay(today);
    // チェックを付けたものはホームから消す（カレンダーには残る）
    var plans = DL.events.ofDay(today).filter(function (o) { return !DL.events.isDone(o); });
    var todo = load.entries.length + plans.length;
    wrap.appendChild(el('div', { class: 'today-head' }, [ui.dateHead(today), weatherChip(today)]));

    // iCloud への書き出しは Cloudflare 同期の予備なので、ホームでは案内しない。
    // 使うときは 設定 →「iCloud への書き出し」から。

    /* 今日が即売会なら、いちばん上に当日モードの入口を置く */
    var onsite = S.projects().filter(function (p) {
      return p.kind === 'event' && p.status !== 'archived' && p.eventDate === today;
    })[0];
    if (onsite) {
      wrap.appendChild(el('a', { class: 'row onsite-entry', href: '#/onsite/' + onsite.id }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            ui.icon('sales', 17),
            el('span', { text: '当日モードを開く' })
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip(onsite.eventName || onsite.title, 'soft'),
            onsite.space ? ui.chip(onsite.space, 'ghosty') : null
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
    }

    /* 警告。「重要」にした日常の予定は、その日いちばん上に出す */
    var al = sc.alerts(today);
    var urgent = plans.filter(function (o) { return o.ev.important; });
    if (al.length || urgent.length) {
      var box = el('div', { class: 'alerts' });
      urgent.forEach(function (o) { box.appendChild(planAlert(o)); });
      al.slice(0, 5).forEach(function (a) {
        var href = a.href || (a.project ? '#/project/' + a.project.id : a.date ? '#/day/' + a.date : '#/settings');
        box.appendChild(el('a', { class: 'alert ' + a.level + (a.overdue ? ' overdue' : ''), href: href }, [
          el('span', { class: 'alert-icon' }, ui.icon(a.level === 'info' ? 'info' : 'alert', 17)),
          el('span', {}, [
            a.project ? el('b', { text: a.project.title }) : null,
            el('span', { text: (a.project ? '　' : '') + a.text })
          ])
        ]));
      });
      if (al.length > 5) box.appendChild(el('div', { class: 'muted small pad', text: 'ほか ' + (al.length - 5) + '件' }));
      wrap.appendChild(box);
    }

    /* 今日のノルマと、日常の予定 */
    wrap.appendChild(ui.section('今日やること'));
    if (!todo) {
      wrap.appendChild(ui.empty('今日やることはありません。', ui.btn('案件を追加', 'primary', function () { DL.forms.projectForm(); })));
    } else {
      var list = el('div', { class: 'list' });
      load.entries.forEach(function (e) { list.appendChild(quotaRow(e, today)); });
      // 日常の予定は案件のノルマのあとに続ける。
      // カレンダーの切り替えとは関わりなく、ホームには両方を出す
      plans.forEach(function (o) { list.appendChild(planRow(o)); });
      wrap.appendChild(list);
    }

    /* 今週のノルマ */
    wrap.appendChild(ui.section('これから7日間'));
    wrap.appendChild(weekStrip(today));
    wrap.appendChild(stats(today, load));

    /* 売上（書類があるときだけ） */
    var sales = DL.views.sales && DL.views.sales.homeCard();
    if (sales) {
      wrap.appendChild(ui.section('売上', el('a', { class: 'link', href: '#/sales', text: '内訳' })));
      wrap.appendChild(sales);
    }

    /* 直近の締切 */
    var tl = sc.timeline(today, 180);
    wrap.appendChild(ui.section('近い締切', el('a', { class: 'link', href: '#/projects', text: '一覧' })));
    if (!tl.length) {
      wrap.appendChild(ui.empty('予定されている締切はありません。'));
    } else {
      var dl = el('div', { class: 'list' });
      tl.slice(0, 8).forEach(function (item) { dl.appendChild(deadlineRow(item, today)); });
      wrap.appendChild(dl);
    }

    /* 進行中の案件 */
    var actives = S.activeProjects();
    if (actives.length) {
      wrap.appendChild(ui.section('進行中の案件'));
      var pl = el('div', { class: 'list' });
      actives.sort(function (a, b) { return U.cmp(a.deadline || '9999', b.deadline || '9999'); })
        .forEach(function (p) { pl.appendChild(projectRow(p, today)); });
      wrap.appendChild(pl);
    }

    root.appendChild(wrap);
  }

  /* ノルマ1行 */
  function quotaRow(e, date) {
    var p = e.project, t = e.task;
    var unit = sc.unit(t);
    var pace = sc.taskPace(p, t, date);
    var doneAll = sc.taskIsComplete(t);
    var pct = e.qty ? Math.min(100, Math.round(e.done / e.qty * 100)) : (e.done ? 100 : 0);

    var range = sc.rangeText(t, e.from, e.to);
    var row = el('div', { class: 'row quota' + (doneAll ? ' is-done' : '') }, [
      el('div', { class: 'row-bar', style: { background: p.color } }),
      el('div', { class: 'row-main', onclick: function () { DL.forms.progressSheet(p.id, t.id, date); } }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: t.name }),
          range ? el('span', { class: 'range', text: range }) : null,
          el('span', { class: 'muted small', text: '　' + p.title })
        ]),
        el('div', { class: 'row-sub' }, [
          (t.unit === 'none' || !e.qty)
            ? ui.chip('作業日', 'soft')
            : ui.chip(e.done + ' / ' + e.qty + unit, e.done >= e.qty ? 'ok' : 'soft'),
          pace.behind > 0 ? ui.chip('遅れ ' + pace.behind + unit, 'danger') : null,
          e.isLast ? ui.chip('最終日', 'warn') : null,
          t.unit !== 'none' ? ui.chip('残' + pace.remaining + unit, 'ghosty') : null
        ]),
        e.qty ? ui.progress(pct, p.color) : null
      ]),
      el('button', {
        class: 'checkbtn' + ((e.qty ? e.done >= e.qty : e.done > 0 || t.done) ? ' on' : ''), 'aria-label': '完了',
        onclick: function () {
          if (t.unit === 'none') { S.updateTask(p.id, t.id, { done: !t.done }); return; }
          // ノルマ0の日は「1つ進めた」記録として扱う
          var target = e.qty || 1;
          S.setProgress(p.id, t.id, date, e.done >= target ? 0 : target);
        }
      }, ui.icon('check', 17))
    ]);
    return row;
  }

  /* ---------------- 天気（日付の右） ---------------- */

  var pending = false;    // いま取りに行っている最中か
  var lastTry = 0;        // 前に取りに行った時刻（つながらないとき叩き続けないため）

  function weatherChip(today) {
    var W = DL.weather;
    if (!W.place()) {
      // まだ地点を決めていないときは、設定への入口だけ小さく出す
      return el('a', { class: 'wx wx-none', href: '#/settings', 'aria-label': '天気の地点を設定' }, [
        ui.icon('wUnknown', 20), el('span', { class: 'wx-set', text: '天気' })
      ]);
    }

    var c = W.cache();
    // 古くなっていたら取りに行き、新しい値が届いたときだけ描き直す
    var old = !c || (Date.now() - new Date(c.at).getTime()) / 60000 >= W.FRESH_MIN;
    if (old && !pending && Date.now() - lastTry > 120000) {
      pending = true;
      lastTry = Date.now();
      W.load().then(function (r) {
        pending = false;
        if (r && (!c || r.at !== c.at)) DL.app.render();
      });
    }

    var d = W.dayOf(today);
    if (!d) {
      return el('button', { class: 'wx wx-none', onclick: function () { sheet(); } }, [
        ui.icon('wUnknown', 20), el('span', { class: 'wx-set', text: '取得中' })
      ]);
    }
    var info = W.codeInfo(d.code);
    var temp = (c.now && c.now.temp !== null && c.now.temp !== undefined) ? c.now.temp : d.max;
    return el('button', {
      class: 'wx', 'aria-label': (c.name || '天気') + '　' + info.label, onclick: function () { sheet(); }
    }, [
      ui.icon(info.icon, 26),
      el('span', { class: 'wx-t' }, [
        el('b', { text: temp === null ? '—' : temp + '°' }),
        el('span', { class: 'wx-hl', text: (d.max === null ? '—' : d.max) + '/' + (d.min === null ? '—' : d.min) })
      ])
    ]);
  }

  /* 押したときの3日ぶんの予報 */
  function sheet() {
    var W = DL.weather;
    var c = W.cache();
    var list = el('div', { class: 'list' });

    function draw() {
      U.clear(list);
      c = W.cache();
      if (!c) {
        list.appendChild(ui.empty('まだ取れていません。'));
        return;
      }
      c.days.forEach(function (d) {
        var info = W.codeInfo(d.code);
        list.appendChild(el('div', { class: 'row wx-row' }, [
          el('span', { class: 'wx-day', text: U.fmtMDW(d.date) }),
          ui.icon(info.icon, 24),
          el('span', { class: 'wx-label', text: info.label }),
          // 低い確率まで出すと天気の呼び名を押し出してしまうので、30%からにする
          d.pop >= 30 ? ui.chip(d.pop + '%', d.pop >= 50 ? 'soft' : 'ghosty') : null,
          el('span', { class: 'wx-temp' }, [
            el('b', { text: (d.max === null ? '—' : d.max) + '°' }),
            el('span', { class: 'muted', text: ' / ' + (d.min === null ? '—' : d.min) + '°' })
          ])
        ]));
      });
    }
    draw();

    var body = el('div', { class: 'form' }, [
      list,
      el('p', { class: 'muted small', text: c
        ? (c.name || '登録した地点') + '　' + U.fmtMD(U.toISO(new Date(c.at))) + ' ' + hhmm(c.at) + ' 時点'
        : '' }),
      ui.btn('取り直す', 'ghost full', function () {
        ui.toast('取りに行きます…');
        W.load({ force: true }).then(function () { draw(); DL.app.render(); });
      }, 'refresh'),
      ui.btn('地点を変える', 'ghost full', function () { close(); location.hash = '#/settings'; }, 'settings')
    ]);

    var close = ui.sheet({
      title: '天気', body: body,
      actions: [ui.btn('閉じる', 'ghost', function () { close(); })]
    });
  }

  function hhmm(iso) {
    var d = new Date(iso);
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  /**
   * 「重要」にした日常の予定を、締切の警告と同じ形でいちばん上に出す。
   * チェックは下の一覧と同じ印を使うので、どちらで押しても両方から消える。
   */
  function planAlert(o) {
    var ev = o.ev, E = DL.events;
    return el('div', { class: 'alert warn plan-alert' }, [
      el('button', {
        class: 'alert-main', 'aria-label': ev.title + ' を開く',
        onclick: function () { DL.views.events.form(ev, { occurrence: o }); }
      }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', {}, [
          el('b', { text: ev.title }),
          el('span', { text: '　' + E.whenText(o) })
        ])
      ]),
      el('button', {
        class: 'checkbtn small', 'aria-label': 'やった（ホームから消す）',
        onclick: function () {
          S.setEventDone(ev.id, o.date, true);
          ui.toast('「' + ev.title + '」をホームから消しました（カレンダーには残ります）');
        }
      }, ui.icon('check', 15))
    ]);
  }

  /* 日常の予定1行。中身を押すと直せる。チェックを押すとホームから消える。
     ボタンの中にボタンは置けないので、案件のノルマと同じ組み立てにする */
  function planRow(o) {
    var ev = o.ev, E = DL.events;
    return el('div', { class: 'row home-plan' }, [
      el('div', { class: 'row-bar', style: { background: ev.color } }),
      el('div', { class: 'row-main', onclick: function () { DL.views.events.form(ev, { occurrence: o }); } }, [
        el('div', { class: 'row-title', text: ev.title }),
        el('div', { class: 'row-sub' }, [
          ui.chip('日常', 'ghosty'),
          ev.important ? ui.iconChip('alert', '重要', 'warn') : null,
          ui.chip(E.whenText(o), 'soft'),
          ev.repeat ? ui.iconChip('refresh', E.repeatLabel(ev.repeat), 'ghosty') : null
        ]),
        ev.memo ? el('p', { class: 'muted small ev-memo', text: ev.memo }) : null
      ]),
      el('button', {
        class: 'checkbtn', 'aria-label': 'やった（今日やることから消す）',
        onclick: function () {
          S.setEventDone(ev.id, o.date, true);
          ui.toast('「' + ev.title + '」を今日やることから消しました（カレンダーには残ります）');
        }
      }, ui.icon('check', 17))
    ]);
  }

  /* 7日間のノルマ */
  function weekStrip(today) {
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = U.addDays(today, i);
      var l = sc.loadOfDay(d);
      days.push({ date: d, qty: l.qty, count: l.entries.length, marks: sc.dayMarks(d) });
    }
    var maxQ = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.qty; })));
    var strip = el('div', { class: 'week' });
    days.forEach(function (d) {
      var h = Math.round(d.qty / maxQ * 46) + 4;
      strip.appendChild(el('a', {
        class: 'weekday' + (d.date === today ? ' today' : '') + (U.dow(d.date) === 0 ? ' sun' : U.dow(d.date) === 6 ? ' sat' : ''),
        href: '#/day/' + d.date
      }, [
        el('span', { class: 'wd', text: U.wdName(U.dow(d.date)) }),
        el('span', { class: 'wn', text: String(+d.date.slice(8)) }),
        el('span', { class: 'wbar', style: { height: h + 'px', opacity: d.qty ? 1 : .25 } }),
        el('span', { class: 'wq', text: d.qty ? String(d.qty) : (d.count ? '・' : '') }),
        d.marks.length ? el('span', { class: 'wmark' }) : null
      ]));
    });
    return strip;
  }

  /* ひと目でわかる集計 */
  function stats(today, todayLoad) {
    var planned = 0, done = 0;
    for (var i = 1; i <= 7; i++) {
      var l = sc.loadOfDay(U.addDays(today, -i));
      planned += l.qty; done += l.done;
    }
    var rate = planned ? Math.round(done / planned * 100) : 100;
    var pace = sc.actualPace(60, today);
    var limit = U.num(S.settings.dailyLimit, 0);
    var over = limit > 0 && todayLoad.qty > limit;
    return el('div', { class: 'quota-row four' }, [
      el('div', { class: 'quota-box' }, [el('span', { text: '進行中の案件' }), el('b', { text: String(S.activeProjects().length) })]),
      el('div', { class: 'quota-box' + (over ? ' over' : '') }, [
        el('span', { text: '今日のノルマ' + (limit ? '（上限' + limit + '）' : '') }),
        el('b', { text: todayLoad.done + '/' + todayLoad.qty })
      ]),
      el('div', { class: 'quota-box' }, [el('span', { text: '直近7日の達成' }), el('b', { text: rate + '%' })]),
      el('div', { class: 'quota-box' }, [
        el('span', { text: '実績ペース(60日)' }),
        el('b', { text: pace.activeDays ? pace.perActiveDay + '/日' : '—' })
      ])
    ]);
  }

  /* 締切1行 */
  function deadlineRow(item, today) {
    var p = item.project;
    var left = U.diffDays(today, item.date);
    var cls = left < 0 ? 'danger' : left <= 3 ? 'urgent' : left <= (S.settings.warnDays || 14) ? 'soon' : '';
    var iconName = item.type === 'event' ? 'event' : item.type === 'printing' ? 'printer' : 'deadline';
    var prog = sc.projectProgress(p);
    return el('a', { class: 'row deadline ' + cls, href: '#/project/' + p.id }, [
      el('div', { class: 'row-bar', style: { background: p.color } }),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon(iconName, 16),
          el('span', { text: p.title }),
          el('span', { class: 'muted small', text: item.label })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(U.fmtMDW(item.date), 'soft'),
          ui.chip(U.untilLabel(item.date, today), cls || 'ghosty'),
          ui.chip('進捗 ' + prog.pct + '%', 'ghosty')
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* 案件1行 */
  function projectRow(p, today) {
    var prog = sc.projectProgress(p);
    return el('a', { class: 'row proj', href: '#/project/' + p.id }, [
      el('div', { class: 'row-bar', style: { background: p.color } }),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: p.title })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.kindChip(p), ui.catChip(p),
          ui.iconChip('deadline', U.fmtMD(p.deadline) + '　' + U.untilLabel(p.deadline, today), 'ghosty')
        ]),
        ui.progress(prog.pct, p.color)
      ]),
      el('span', { class: 'pct', text: prog.pct + '%' })
    ]);
  }

  DL.views = DL.views || {};
  DL.views.home = { render: render, quotaRow: quotaRow, projectRow: projectRow, deadlineRow: deadlineRow };
})(window.DL);
