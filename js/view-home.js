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
    // 期限の切れた調味料と残り物。捨てるものとして、ここにだけ出す
    var toss = S.expiredFood(today);
    var todo = load.entries.length + plans.length + toss.length;
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
    // 更新の近い固定費も、切るかどうかを決める日があるのでここに混ぜる
    var al = sc.alerts(today).concat(DL.expenses.renewAlerts(today));
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
    wrap.appendChild(ui.section('今日の時間'));
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
      toss.forEach(function (t) { list.appendChild(tossRow(t)); });
      wrap.appendChild(list);
    }

    /* お金。今日いくら使えるか・貯金・節約目標を1枚にまとめる
       （日常の予算を決めているときだけ） */
    var bg = budgetCard(today);
    if (bg) {
      wrap.appendChild(ui.section('お金'));
      wrap.appendChild(bg);

      /* その予算で作れる献立 */
      var mn = menuCard(today);
      if (mn) {
        wrap.appendChild(ui.section('今日の献立'));
        wrap.appendChild(mn);
      }
    }

    /* プロット相談。中身はシートで開く（ホームは入口だけ） */
    var pl = DL.views.plot && DL.views.plot.row();
    if (pl) wrap.appendChild(pl);

    // 「いまの様子」「売上」「1日の記録」は、それぞれのタブと重なるのでホームには出さない。
    // 「近い締切」「進行中の案件」も同じ理由で出さない

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
    // 降りそうなときは確率も出す。記号だけだと「降るのか」が読み取れない
    var pop = U.num(cur.pop, 0);
    return el('button', {
      class: 'wx', 'aria-label': (c.name || '天気') + '　' + info.label
        + (pop >= W.WET_POP ? '　降水確率' + pop + '%' : ''),
      onclick: function () { sheet(); }
    }, [
      ui.icon(info.icon, 36),
      el('span', { class: 'wx-t' }, [
        el('b', { text: temp === null ? '—' : temp + '°' }),
        pop >= W.WET_POP
          ? el('span', { class: 'wx-pop', text: pop + '%' })
          : el('span', { class: 'wx-hl', text: (d.max === null ? '—' : d.max) + '/' + (d.min === null ? '—' : d.min) })
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
  /* ---------------- 今日の予算 ----------------

     月の予算を日数で割ったものが「今日の予算」。
     使いすぎていると、それを守っても月末には収まらないので、
     残り日数で割り直した「立て直しの予算」を下に添える。 */

  function budgetCard(today) {
    var b = DL.expenses.dailyBudget(today);
    if (!b) return null;
    var yen = DL.docs.yen;

    var card = el('div', { class: 'card bg-day' });

    /* いちばん知りたいのは「今日いくら使えるか」なので、頭に大きく出す。
       ペースが崩れているときは、立て直しの予算から引いた額を出す
       （ふだんの1日予算から引くと、守っても月末に足りなくなる） */
    var sv = savingLeft(today, b);
    card.appendChild(el('div', { class: 'bg-rest' + (b.todayOver ? ' over' : '') }, [
      el('div', { class: 'bg-rest-c' }, [
        el('span', { class: 'bg-rest-l', text: '本日使える金額' }),
        el('b', { text: yen(b.todayLeft) }),
        b.todayOver ? el('span', { class: 'bg-rest-s', text: yen(b.todayOver) + ' 使いすぎ' }) : null
      ]),
      sv ? el('div', { class: 'bg-rest-c save' + (sv.left <= 0 ? ' zero' : '') }, [
        el('span', { class: 'bg-rest-l', text: '貯金するなら' }),
        el('b', { text: yen(Math.max(0, sv.left)) })
      ]) : null
    ]));

    /* 棒は1本だけ。ペースが崩れている月は、割り直したほうだけを出す。
       ふだんの予算と立て直しの予算を並べても、どちらを守ればよいのか迷うだけ */
    if (b.behind) {
      card.appendChild(bgLine('今日の予算', b.restPerDay, b.today, b.restPct, false, '予算調整済み'));
    } else {
      card.appendChild(bgLine('今日の予算', b.perDay, b.today, b.todayPct, false));
    }

    if (b.noRoom) {
      // 使いすぎではなく、そもそも固定費で予算が埋まっている
      card.appendChild(el('div', { class: 'bg-day-note danger' }, [
        ui.icon('alert', 15),
        el('span', { text: '固定費 ' + yen(b.fixed) + ' だけで、今月の予算 '
          + yen(b.month) + ' を使い切っています' })
      ]));
    } else if (b.overspent) {
      card.appendChild(el('div', { class: 'bg-day-note danger' }, [
        ui.icon('alert', 15),
        el('span', { text: '今月の予算はもう使い切っています（残り' + b.rest + '日）' })
      ]));
    } else if (b.behind) {
      card.appendChild(el('div', { class: 'bg-day-note warn' }, [
        ui.icon('alert', 15),
        el('span', { text: '支出ペースが予算超過' })
      ]));
    }

    /* 貯金と節約目標も、お金の話としてこの1枚にまとめる。
       中身（進み具合・アドバイス）は経理と節約目標で見る */
    var line;
    if ((line = savingsLine())) card.appendChild(line);
    if ((line = planLine(today))) card.appendChild(line);

    card.appendChild(el('div', { class: 'bg-foot' }, [
      el('span', { class: 'muted small',
        text: '今月 ' + yen(b.spent) + ' / ' + yen(b.budget)
          + (b.left < 0 ? '（' + yen(-b.left) + ' 超過）' : '（残り ' + yen(b.left) + '）') }),
      el('a', { class: 'link small', href: '#/books', text: '経理' })
    ]));

    return card;
  }

  /* 貯金。残高と、目標までの残り。押すと経理へ */
  function savingsLine() {
    var sv = S.savings();
    if (!sv.total && !sv.goal) return null;
    var yen = DL.docs.yen;
    var out = DL.bank.outlook();
    return el('a', { class: 'mo-line', href: '#/books' }, [
      el('span', { class: 'mo-k', text: '貯金' }),
      el('b', { text: yen(sv.total) }),
      out ? el('span', { class: 'mo-s' + (out.done ? ' ok' : ''),
        text: out.done ? '目標達成' : '目標まで ' + yen(out.left) }) : null,
      el('span', { class: 'chev' }, ui.icon('chevronRight', 15))
    ]);
  }

  /* 節約目標。毎日いくら貯めるか。押すと経理と同じ画面が開く */
  function planLine(today) {
    var pl = DL.bank.plan(today);
    if (!pl || pl.done) return null;
    var yen = DL.docs.yen;
    var open = DL.views.books && DL.views.books.planSheet;
    return el(open ? 'button' : 'div', {
      type: open ? 'button' : null, class: 'mo-line',
      onclick: open ? function () { open(); } : null
    }, [
      el('span', { class: 'mo-k', text: '節約目標' }),
      el('b', { class: 'save', text: yen(pl.perDay) }),
      el('span', { class: 'mo-u', text: '/日' }),
      el('span', { class: 'mo-s', text: pl.over ? '期日超過' : 'あと' + pl.days + '日' }),
      open ? el('span', { class: 'chev' }, ui.icon('chevronRight', 15)) : null
    ]);
  }

  /* ---------------- 今日の献立 ----------------

     今日あと使える金額から、自炊の献立を考えてもらう。
     考えるのは向こう（OpenAI）で、鍵は Worker が持っている。
     採用したものはその日にぶら下がり、日別画面にも出る。 */

  var mSlots = ['dinner'];   // 選んだ食事。画面を描き直しても覚えておく
  var mServ = 1;             // 何人分
  var mDraft = null;         // まだ採用していない献立
  var mBusy = false;
  var mFrom = '';            // どの献立に合わせて mSlots をそろえたか
  var mAmount = 0;           // 金額指定で入れた額。次に開いたときの初期値にする
  var mBudget = 0;           // いまの下書きを出したときの額（0 は今日あと使える額）

  function menuCard(today) {
    var M = DL.menu;
    var b = DL.expenses.dailyBudget(today);
    if (!b) return null;
    var yen = DL.docs.yen;
    var saved = S.getMenu(today);

    var card = el('div', { class: 'card mn-card' });

    // すでに採用してあるなら、それを出す（考え直したものがあれば、そちらを先に見せる）
    if (saved && !mDraft) {
      /* 採用したあとでも食事は選び直せる。朝食を足して考え直す、ができるように。
         いま採用しているぶんに合わせておいて、押されたらそれを覚える */
      var slots = (saved.meals || []).map(function (m) { return m.slot; });
      var from = today + ':' + slots.join(',');
      if (mFrom !== from) {
        if (slots.length) mSlots = slots;
        mFrom = from;
      }

      card.appendChild(menuBody(saved, today));
      if (M.ready()) card.appendChild(slotPick());
      card.appendChild(el('div', { class: 'row-wrap mn-acts' }, [
        ui.btn(mBusy ? '考えています…' : '再考案', 'ghost', function () {
          mDraft = null;
          run(today, b, M.namesOf(saved));
        }, 'refresh'),
        kitchenBtn(),
        onlyIcon('trash', '献立を外す', 'ghost', function () {
          ui.confirm('今日の献立を外します。', { okText: '外す' }).then(function (ok) {
            if (!ok) return;
            S.removeMenu(today);
            ui.toast('外しました');
          });
        })
      ]));
      return card;
    }

    if (!M.ready()) {
      card.appendChild(el('p', { class: 'muted small', text: '同期を設定すると使えます' }));
      return card;
    }

    /* 選ぶところ。見出しは付けない（朝食・1人分と書いてあれば分かる） */
    card.appendChild(slotPick());
    card.appendChild(el('div', { class: 'mn-serv' }, ui.segmented(
      [{ value: 1, label: '1人分' }, { value: 2, label: '2人分' }],
      mServ, function (v) { mServ = U.num(v, 1); DL.app.render(); })));

    // まだ出していないとき
    if (!mDraft) {
      var sv = savingLeft(today, b);
      /* 通常出力＝今日あと使える金額いっぱい、金額指定＝入れた額、
         貯金予算＝貯金ぶんを引いた額。並ぶので、この列は文字だけにする */
      card.appendChild(el('div', { class: 'row-wrap mn-acts' }, [
        ui.btn(mBusy ? '考え中…' : '通常出力',
          'primary grow', function () { run(today, b, []); }),
        ui.btn('金額指定', 'ghost grow', function () { amountSheet(today, b); }),
        sv ? ui.btn('貯金予算', 'ghost grow', function () {
          if (sv.left <= 0) {
            ui.toast('貯金ぶんを引くと、今日の食費が残りません（'
              + yen(-sv.left) + ' 足りません）', 'danger');
            return;
          }
          run(today, b, [], sv.left);
        }) : null,
        kitchenBtn()
      ]));
      return card;
    }

    card.appendChild(menuBody(mDraft, today));
    card.appendChild(el('div', { class: 'row-wrap mn-acts' }, [
      ui.btn('これにする', 'primary', function () {
        // setMenu で描き直しが走るので、先に下書きを片づけてから保存する
        var m = mDraft;
        mDraft = null;
        S.setMenu(today, m);
        ui.toast('今日の献立にしました');
      }, 'check'),
      ui.btn(mBusy ? '考えています…' : '再考案', 'ghost', function () {
        // 金額指定・貯金予算で出したものは、同じ額のまま考え直す
        run(today, b, DL.menu.namesOf(mDraft), mBudget);
      }, 'refresh'),
      // 採用してあるものから考え直したときは、元に戻れるように
      saved ? onlyIcon('close', 'やめる', 'ghost', function () {
        mDraft = null;
        DL.app.render();
      }) : null,
      kitchenBtn()
    ]));
    return card;

    /* 金額を決めて考えてもらう。今日あと使える額とは切り離して入れられる */
    function amountSheet(date, bd) {
      var amount = ui.input({
        type: 'number', inputmode: 'numeric', min: 1, step: 100,
        value: mAmount || bd.todayLeft
      });
      var close = ui.sheet({
        title: '金額指定',
        body: el('div', { class: 'form' }, [ui.field('金額（円）', amount)]),
        actions: [
          ui.btn('キャンセル', 'ghost', function () { close(); }),
          ui.btn('確定', 'primary', function () {
            var v = Math.round(U.num(amount.value, 0));
            if (v <= 0) { ui.toast('金額を入れてください', 'warn'); return; }
            mAmount = v;
            close();
            run(date, bd, [], v);
          })
        ]
      });
      setTimeout(function () { amount.focus(); amount.select(); }, 120);
    }

    /* @param {number} [budget] 金額指定・貯金予算のときに渡す */
    function run(date, bd, avoid, budget) {
      if (mBusy) return;
      mBusy = true;
      mBudget = budget || 0;      // 「再考案」でも同じ額のままにする
      DL.app.render();
      DL.menu.suggest({
        budget: budget || bd.todayLeft, slots: mSlots.slice(), servings: mServ,
        avoid: avoid, date: date
      }).then(function (m) {
        mBusy = false;
        mDraft = m;
        DL.app.render();
        // 頼んだ食事が返ってこなかったら、たいてい Worker が古い
        if (m.missingSlots && m.missingSlots.length) {
          ui.toast(DL.menu.slotsJa(m.missingSlots)
            + ' が出せませんでした。Cloudflare の Worker を deploy し直してください', 'warn');
        }
      }).catch(function (e) {
        mBusy = false;
        DL.app.render();
        ui.toast(e.message, 'danger');
      });
    }
  }

  /* どの食事にするか。押すと入る・外れる（全部外すことはできない） */
  function slotPick() {
    return el('div', { class: 'mn-pick' },
      DL.menu.SLOTS.map(function (s) {
        var on = mSlots.indexOf(s.value) >= 0;
        return ui.btn(s.label, 'ghost' + (on ? ' on' : ''), function () {
          var i = mSlots.indexOf(s.value);
          if (i >= 0) mSlots.splice(i, 1);
          else mSlots.push(s.value);
          if (!mSlots.length) mSlots.push(s.value);
          DL.app.render();
        });
      }));
  }

  /* 期限の切れたもの。押すと「捨てた」ことにして一覧から消す。
     献立の設定に置いたものなので、出すのはホームだけ */
  function tossRow(t) {
    var x = t.item;
    var what = t.kind === 'pantry' ? '調味料' : (x.kept ? '保存あり' : '残り物');
    return el('button', { class: 'row toss-row', onclick: function () {
      ui.confirm(x.name + 'を捨てましたか？　一覧からも消します。',
        { okText: '捨てた', danger: true }).then(function (ok) {
        if (!ok) return;
        if (t.kind === 'pantry') S.removePantry(x.id);
        else S.removeLeftover(x.id);
        ui.toast('消しました');
      });
    } }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('trash', 16),
          el('span', { text: x.name + 'を捨てる' })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(what, 'ghosty'),
          ui.chip(U.fmtMD(x.until) + 'まで', 'danger'),
          S.foodQty(x) ? ui.chip(S.foodQty(x), 'ghosty') : null
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* 絵だけのボタン。読み上げのために名前は付けておく */
  function onlyIcon(name, label, cls, onclick) {
    return el('button', {
      type: 'button', class: 'btn only ' + (cls || 'ghost'),
      'aria-label': label, title: label, onclick: onclick
    }, ui.icon(name, 16));
  }

  /* 家にある調味料と残り物の設定 */
  function kitchenBtn() {
    return onlyIcon('settings', '家にあるものの設定', 'ghost', function () {
      DL.kitchen.open(function () { DL.app.render(); });
    });
  }

  /* 一品ぶん。主菜・副菜の別と、使う調味料の分量と、その一品の手順 */
  function dishBox(d, date, find) {
    var box = el('div', { class: 'mn-dish' });
    box.appendChild(el('div', { class: 'mn-dish-h' }, [
      d.role ? ui.chip(d.role, 'soft') : null,
      el('b', { text: d.name })
    ]));
    if ((d.seasonings || []).length) {
      // 家に無いもの・期限の切れたものは、その場で分かるようにする
      var vals = el('span', { class: 'mn-seas-v' });
      d.seasonings.forEach(function (s, i) {
        var st = DL.menu.seasoningState(s.name, date, find);
        if (i) vals.appendChild(el('span', { text: '・' }));
        vals.appendChild(el('span', {
          class: st === 'ok' ? '' : 'mn-s-bad',
          text: s.name + (s.qty ? ' ' + s.qty : '')
        }));
        // 家に無いものは点線だけ（買うものの並びに出る）。
        // 期限切れは、その場で気づけるように印を付ける
        if (st === 'expired') vals.appendChild(ui.chip('期限切れ', 'danger'));
      });
      box.appendChild(el('div', { class: 'mn-seas' }, [
        el('span', { class: 'mn-seas-l', text: '調味料' }), vals
      ]));
    }
    if ((d.steps || []).length) {
      box.appendChild(el('ol', { class: 'mn-steps' }, d.steps.map(function (s) {
        return el('li', { text: s });
      })));
    }
    return box;
  }

  /* 献立の中身。ホームでも日別画面でも同じものを出す */
  function menuBody(m, date) {
    var yen = DL.docs.yen;
    var box = el('div', { class: 'mn-body' });
    // 献立を作ったときに突き合わせた呼び方（しょうが(チューブ)＝おろししょうが）で当てる
    var find = DL.menu.matcher(m);
    // 家に無い調味料と、期限の切れた調味料。予算には数えず、買うものへ足す
    var extras = DL.menu.extras(m, date);

    (m.meals || []).forEach(function (x) {
      var open = el('details', { class: 'mn-meal' });
      open.appendChild(el('summary', {}, [
        ui.chip(DL.menu.SLOT_LABEL[x.slot] || '', 'soft'),
        el('b', { class: 'mn-name', text: x.name }),
        x.minutes ? el('span', { class: 'muted small', text: x.minutes + '分' }) : null
      ]));
      if (x.dishes.length) {
        open.appendChild(el('div', { class: 'mn-dishes' }, x.dishes.map(function (d) {
          return dishBox(d, date, find);
        })));
      }
      // 前に採ってあった献立は、手順が一品ごとではなく献立ぜんぶで1つ
      if (x.steps.length) {
        open.appendChild(el('ol', { class: 'mn-steps' }, x.steps.map(function (s) {
          return el('li', { text: s });
        })));
      }
      box.appendChild(open);
    });

    if ((m.shopping || []).length || extras.length) {
      var sh = el('details', { class: 'mn-shop' });
      sh.appendChild(el('summary', {}, [
        el('b', { text: '買うもの' }),
        ui.chip((m.shopping || []).length + '点', 'ghosty'),
        extras.length ? ui.chip('調味料' + extras.length + '点', 'ghosty') : null,
        el('span', { class: 'mn-total', text: yen(m.total) })
      ]));
      var ul = el('div', { class: 'mn-list' });
      (m.shopping || []).forEach(function (s) {
        ul.appendChild(el('div', { class: 'mn-item' }, [
          el('span', { class: 'mn-item-n', text: s.name }),
          el('span', { class: 'muted small', text: s.qty }),
          el('b', { text: yen(s.price) })
        ]));
      });
      extras.forEach(function (x) {
        ul.appendChild(el('div', { class: 'mn-item extra' }, [
          el('span', { class: 'mn-item-n', text: x.name }),
          x.qty ? el('span', { class: 'muted small', text: x.qty }) : null,
          ui.chip(x.tag, x.state === 'expired' ? 'danger' : 'warn')
        ]));
      });
      if (extras.length) {
        ul.appendChild(el('p', { class: 'muted small mn-extra-note',
          text: '調味料 ' + extras.length + '点は、予算には数えていません。' }));
      }
      sh.appendChild(ul);
      box.appendChild(sh);
    }

    // 予算に対してどうか。超えていれば、そこは分かるようにする
    var over = m.budget && m.total > m.budget;
    box.appendChild(el('p', { class: 'muted small mn-foot' + (over ? ' over' : ''), text:
      (m.servings === 2 ? '2人分' : '1人分')
      + '　買い物 ' + yen(m.total)
      + (m.budget ? '（予算 ' + yen(m.budget) + (over ? '・超えています' : '・残り '
        + yen(m.budget - m.total) + '）') : '') }));
    // 期限の切れた調味料は、献立のところでも断っておく
    var bad = extras.filter(function (x) { return x.state === 'expired'; });
    if (bad.length) {
      box.appendChild(el('p', { class: 'mn-warn small' }, [
        ui.icon('alert', 14),
        el('span', { text: bad.map(function (x) { return x.name; }).join('・')
          + ' は消費期限が切れています。買うものに入れました。' })
      ]));
    }
    if (m.note) box.appendChild(el('p', { class: 'muted small', text: m.note }));
    return box;
  }

  /**
   * 貯金の目標を守るなら、今日あといくら使えるか。
   * （1日の予算 − 貯金の1日ぶん）− 今日すでに使った額。
   * 使いすぎている月は、立て直しの予算を超えないところで止める。
   * @returns {object|null} 目標と期日を決めていなければ null
   */
  function savingLeft(date, b) {
    var pl = DL.bank.plan(date);
    if (!pl || pl.done) return null;
    var left = pl.spendable - b.today;
    return { perDay: pl.perDay, left: Math.min(left, b.todayLeft) };
  }

  /**
   * 1行ぶん。予算・使った額・％・棒
   * @param {string} [tag] 見出しの横に付ける小さな印（「予算調整済み」など）
   */
  function bgLine(label, limit, used, pct, sub, tag) {
    var yen = DL.docs.yen;
    // 予算が0なのに使っていれば、100%ちょうどでも超えている
    var over = pct > 100 || (limit <= 0 && used > 0);
    return el('div', { class: 'bg-day-line' + (sub ? ' sub' : '') }, [
      el('div', { class: 'bg-head' }, [
        el('span', { class: 'bg-head-l' }, [
          el('span', { text: label }),
          tag ? ui.chip(tag, 'warn') : null
        ]),
        el('b', { class: over ? 'over' : '', text: yen(limit) })
      ]),
      el('div', { class: 'bg-bar' + (over ? ' over' : '') },
        el('i', { style: { width: Math.min(100, pct) + '%' } })),
      el('div', { class: 'bg-day-used' }, [
        el('span', { class: 'muted small', text: '支出：' + yen(used) }),
        el('b', { class: over ? 'over' : '', text: pct + '%' })
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
  DL.views.home = {
    render: render, quotaRow: quotaRow, deadlineRow: deadlineRow,
    menuBody: menuBody      // 日別画面でも同じ中身を出す
  };
})(window.DL);
