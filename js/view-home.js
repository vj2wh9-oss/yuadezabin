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

    /* 勤務実績の入力。仕事が終わる頃に、いちばん上でうながす */
    workLogAlerts(wrap);

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

    /* 発注フォームから届いた発注。照合を待たせないよう、警告より先に出す */
    var newOrders = DL.orders.list()
      .filter(function (o) { return o.status === 'new'; })
      .sort(function (a, b) { return U.cmp(b.at || '', a.at || ''); });
    if (newOrders.length) {
      wrap.appendChild(el('a', { class: 'row order-notice', href: '#/orders' }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            ui.icon('client', 17),
            el('span', { text: '未確認の発注が ' + newOrders.length + '件' })
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip('発注社名の照合待ち', 'warn'),
            ui.chip(newOrders[0].company, 'ghosty')
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
        var pulse = a.overdue ? ' overdue' : a.behind ? ' behind' : '';
        box.appendChild(el('a', { class: 'alert ' + a.level + pulse, href: href }, [
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

    /* 今日の時間の振り分け。横長の帯で、いまがどこかも出す */
    wrap.appendChild(ui.section('今日の時間',
      el('a', { class: 'link', href: '#/time/' + today, text: '書く' })));
    wrap.appendChild(DL.views.time.homeCard(today));

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

    // 「近い締切」「進行中の案件」は案件タブと重なるので、ホームには出さない

    /* 1日の記録。今日ぶんへの入り口をいちばん下に置く */
    wrap.appendChild(ui.section('1日の記録', el('a', { class: 'link', href: '#/logs', text: '一覧' })));
    wrap.appendChild(logCard(today));

    root.appendChild(wrap);
  }

  /* 今日の記録への入り口。書いてあれば頭のところを、無ければ誘い文句を出す */
  function logCard(date) {
    var log = S.getLog(date);
    var txt = (log && log.text) || '';
    return el('a', { class: 'row log-link' + (txt ? ' has-note' : ''), href: '#/log/' + date }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('edit', 16),
          el('span', { text: txt ? '今日のこと' : '今日のことを書く' }),
          log && log.mood ? el('span', { class: 'mood-dot m' + log.mood, title: (S.MOODS[log.mood - 1] || {}).label }) : null
        ]),
        txt ? el('p', { class: 'log-excerpt', text: txt })
          : el('div', { class: 'row-sub' }, el('span', { class: 'muted small', text: '進めたことや使ったお金も、まとめて残ります' }))
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
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
        ui.icon('wUnknown', 24), el('span', { class: 'wx-set', text: '天気' })
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
        ui.icon('wUnknown', 24), el('span', { class: 'wx-set', text: '取得中' })
      ]);
    }
    // その日の代表ではなく、いまの時刻にいちばん近い天気を出す
    var cur = W.current() || { code: d.code, temp: d.max, night: false };
    var info = W.codeInfo(cur.code, cur.night);
    var temp = (cur.temp === null || cur.temp === undefined) ? d.max : cur.temp;
    return el('button', {
      class: 'wx', 'aria-label': (c.name || '天気') + '　' + info.label, onclick: function () { sheet(); }
    }, [
      ui.icon(info.icon, 36),
      el('span', { class: 'wx-t' }, [
        el('b', { text: temp === null ? '—' : temp + '°' }),
        el('span', { class: 'wx-hl', text: (d.max === null ? '—' : d.max) + '/' + (d.min === null ? '—' : d.min) })
      ])
    ]);
  }

  /* 押したとき：いまの様子と、これからの見通しだけを出す */
  function sheet() {
    var W = DL.weather;
    var body = el('div', { class: 'form wx-sheet' });

    function draw() {
      U.clear(body);
      var c = W.cache();
      if (!c) { body.appendChild(ui.empty('まだ取れていません。')); return; }
      var n = c.now || {};
      var today = W.dayOf(U.today()) || c.days[0] || {};
      var cur = W.current() || { code: today.code, temp: n.temp, night: n.night };
      var info = W.codeInfo(cur.code, cur.night);

      /* いまの様子 */
      body.appendChild(el('div', { class: 'wx-now' }, [
        ui.icon(info.icon, 46),
        el('div', { class: 'wx-now-main' }, [
          el('div', { class: 'wx-now-temp' }, [
            el('b', { text: cur.temp === null || cur.temp === undefined ? '—' : cur.temp + '°' }),
            el('span', { class: 'wx-now-label', text: info.label })
          ]),
          el('div', { class: 'muted small', text: [
            (c.name || '登録した地点'),
            (n.feels !== null && n.feels !== undefined) ? '体感 ' + n.feels + '°' : '',
            (today.max !== null && today.min !== null) ? '最高 ' + today.max + '° / 最低 ' + today.min + '°' : ''
          ].filter(Boolean).join('　') })
        ])
      ]));

      /* いまの数字 */
      var facts = [];
      if (n.humidity >= 0) facts.push(['湿度', n.humidity + '%']);
      if (n.wind !== null && n.wind !== undefined) facts.push(['風', (n.dir || '') + ' ' + n.wind + 'm/s']);
      if (n.rain !== null && n.rain !== undefined) facts.push(['降水', n.rain + 'mm']);
      if (today.pop !== undefined) facts.push(['降水確率', today.pop + '%']);
      if (today.uv !== null && today.uv !== undefined) facts.push(['紫外線', String(today.uv)]);
      if (today.sunrise) facts.push(['日の出', today.sunrise]);
      if (today.sunset) facts.push(['日の入り', today.sunset]);
      if (facts.length) {
        body.appendChild(el('div', { class: 'wx-facts' }, facts.map(function (f) {
          return el('div', { class: 'wx-fact' }, [
            el('span', { text: f[0] }), el('b', { text: f[1] })
          ]);
        })));
      }

      /* これから12時間 */
      var hours = (c.hours || []).filter(function (h) {
        return W.stamp(h.time) >= Date.now() - 3600000;
      });
      if (hours.length) {
        body.appendChild(ui.section('これから'));
        var strip = el('div', { class: 'wx-hours' });
        hours.slice(0, 12).forEach(function (h) {
          var hi = W.codeInfo(h.code, W.isNight(h.time));
          strip.appendChild(el('div', { class: 'wx-hour' }, [
            el('span', { class: 'wx-h-time', text: (h.time.slice(11, 13) | 0) + '時' }),
            ui.icon(hi.icon, 20),
            el('b', { text: h.temp === null ? '—' : h.temp + '°' }),
            el('span', { class: 'wx-h-pop' + (h.pop >= 50 ? ' on' : ''), text: h.pop + '%' })
          ]));
        });
        body.appendChild(strip);
      }

      /* 3日ぶん。押すとその日の細かいところが開く */
      body.appendChild(ui.section('3日間', el('span', { class: 'muted small', text: '押すと詳しく' })));
      var list = el('div', { class: 'list' });
      // どの日も畳んでおく（「これから」がすぐ上にあるので、まずは一覧として読めるように）
      c.days.forEach(function (d) { list.appendChild(dayRow(d, false)); });
      body.appendChild(list);

      body.appendChild(el('p', { class: 'muted small',
        text: U.fmtMD(U.toISO(new Date(c.at))) + ' ' + hhmm(c.at) + ' 時点（Open-Meteo）' }));
    }
    draw();

    var close = ui.sheet({
      title: '天気', body: body,
      actions: [
        ui.btn('取り直す', 'ghost', function () {
          ui.toast('取りに行きます…');
          W.load({ force: true }).then(function () { draw(); DL.app.render(); });
        }, 'refresh'),
        ui.btn('閉じる', 'primary', function () { close(); })
      ]
    });
  }

  /**
   * 3日間の1日ぶん。押すとその日の細かいところが開く。
   * @param {object} d weather.cache().days の1つ
   * @param {boolean} open はじめから開いておくか（今日はそうする）
   */
  function dayRow(d, open) {
    var W = DL.weather;
    var di = W.codeInfo(d.code);
    var detail = el('div', { class: 'wx-detail', hidden: !open });
    var head = el('button', {
      class: 'wx-row-head', 'aria-expanded': open ? 'true' : 'false',
      onclick: function () {
        detail.hidden = !detail.hidden;
        head.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true');
        head.classList.toggle('open', !detail.hidden);
      }
    }, [
      el('span', { class: 'wx-day', text: U.fmtMDW(d.date) }),
      ui.icon(di.icon, 24),
      el('span', { class: 'wx-label', text: di.label }),
      d.pop >= 30 ? ui.chip(d.pop + '%', d.pop >= 50 ? 'soft' : 'ghosty') : null,
      el('span', { class: 'wx-temp' }, [
        el('b', { text: (d.max === null ? '—' : d.max) + '°' }),
        el('span', { class: 'muted', text: ' / ' + (d.min === null ? '—' : d.min) + '°' })
      ]),
      el('span', { class: 'wx-caret' }, ui.icon('chevronDown', 15))
    ]);
    if (open) head.classList.add('open');

    /* その日の数字 */
    var facts = [];
    if (d.pop !== undefined && d.pop !== null) facts.push(['降水確率', d.pop + '%']);
    if (d.rain !== null && d.rain !== undefined) facts.push(['雨量', d.rain + 'mm']);
    if (d.uv !== null && d.uv !== undefined) facts.push(['紫外線', String(d.uv)]);
    if (d.wind !== null && d.wind !== undefined) facts.push(['最大風速', d.wind + 'm/s']);
    if (d.sunrise) facts.push(['日の出', d.sunrise]);
    if (d.sunset) facts.push(['日の入り', d.sunset]);
    if (facts.length) {
      detail.appendChild(el('div', { class: 'wx-facts' }, facts.map(function (f) {
        return el('div', { class: 'wx-fact' }, [el('span', { text: f[0] }), el('b', { text: f[1] })]);
      })));
    }

    /* その日の移り変わり（3時間おき） */
    var hours = W.hoursOf(d.date).filter(function (h) {
      return (h.time.slice(11, 13) | 0) % 3 === 0;
    });
    if (hours.length) {
      var strip = el('div', { class: 'wx-hours' });
      hours.forEach(function (h) {
        var hi = W.codeInfo(h.code, W.isNight(h.time));
        strip.appendChild(el('div', { class: 'wx-hour' }, [
          el('span', { class: 'wx-h-time', text: (h.time.slice(11, 13) | 0) + '時' }),
          ui.icon(hi.icon, 20),
          el('b', { text: h.temp === null ? '—' : h.temp + '°' }),
          el('span', { class: 'wx-h-pop' + (h.pop >= 50 ? ' on' : ''), text: h.pop + '%' })
        ]));
      });
      detail.appendChild(strip);
    } else {
      detail.appendChild(el('p', { class: 'muted small', text: 'この日の時刻ごとの予報は取れていません。' }));
    }

    return el('div', { class: 'row wx-row' }, [head, detail]);
  }

  function hhmm(iso) {
    var d = new Date(iso);
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  /**
   * 「重要」にした日常の予定を、締切の警告と同じ形でいちばん上に出す。
   * チェックは下の一覧と同じ印を使うので、どちらで押しても両方から消える。
   */
  /* ---------------- 勤務実績の入力 ----------------

     勤務を選んである日は、仕事が終わる頃にここでうながす。
     リモート・出社はその日の16:30、泊まり勤務は翌日の8:30。
     押すとその日の「1日の時間」へ。チェックで消える。 */

  function workLogAlerts(wrap) {
    var due = DL.timeblocks.dueWorkLogs();
    if (!due.length) return;

    var box = el('div', { class: 'alerts worklog-alerts' });
    due.slice(0, 3).forEach(function (d) { box.appendChild(workLogAlert(d)); });
    if (due.length > 3) {
      box.appendChild(el('div', { class: 'muted small pad', text: 'ほか ' + (due.length - 3) + '日ぶん' }));
    }
    wrap.appendChild(box);
  }

  function workLogAlert(d) {
    var today = U.today();
    // 泊まり勤務は翌日に出るので、いつぶんなのかを必ず添える
    var when = d.date === today ? '今日' : U.fmtMDW(d.date);
    return el('div', { class: 'alert warn plan-alert worklog-alert' }, [
      el('a', {
        class: 'alert-main', href: '#/time/' + d.date,
        'aria-label': when + ' の勤務実績を入力する'
      }, [
        el('span', { class: 'alert-icon' }, ui.icon('clock', 17)),
        el('span', {}, [
          el('b', { text: '勤務実績入力' }),
          el('span', { text: '　' + when + '　' + d.label })
        ])
      ]),
      el('button', {
        class: 'checkbtn small', 'aria-label': when + ' の勤務実績を入力した',
        onclick: function () {
          S.setDutyLogDone(d.date, true);
          ui.toast(when + 'の勤務実績を入れ終えました');
        }
      }, ui.icon('check', 15))
    ]);
  }

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

  DL.views = DL.views || {};
  DL.views.home = { render: render, quotaRow: quotaRow, deadlineRow: deadlineRow };
})(window.DL);
