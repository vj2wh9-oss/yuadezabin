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

    /* ショートカットから受け取ったカードの決済通知。
       経費に入れるか捨てるかを決めてもらうまで、ここに出しておく */
    var cn = cardNotice();
    if (cn) wrap.appendChild(cn);

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
    /* 月が変わったら、貯金額を入れてもらう。
       入れるまで節約ノルマが古いままになるので、予算を決めていなくても出す */
    var dueSv = DL.views.books && DL.views.books.monthlyDueCard
      ? DL.views.books.monthlyDueCard() : null;
    if (bg || dueSv) {
      wrap.appendChild(ui.section('お金'));
      if (dueSv) wrap.appendChild(dueSv);
      if (bg) wrap.appendChild(bg);
    }

    /* 買い物リスト。献立はカレンダーの日付ごとに作るものにして、
       ホームには「何を買うか」だけを出す（自分で足したぶんも一緒に） */
    var sp = shopCard(today);
    if (sp) {
      wrap.appendChild(ui.section('買い物リスト',
        ui.btn('品を足す', 'ghost tiny', function () { shopItemSheet(null); }, 'plus')));
      wrap.appendChild(sp);
    }

    /* ID とパスワードの金庫（METEO LOCK）。いちばん下に入口だけ置く。
       プロット相談はここから外した——案件の画面から開けるようになったので、
       ホームに二重に置いておく理由がなくなった */
    if (DL.views.lock) wrap.appendChild(DL.views.lock.entry());

    // 「いまの様子」「売上」「1日の記録」は、それぞれのタブと重なるのでホームには出さない。
    // 「近い締切」「進行中の案件」も同じ理由で出さない

    root.appendChild(wrap);
  }

  /* ショートカットから届いたカードの決済通知のお知らせ。
     受け取ったものはここに出しておき、押すと経理の一覧（経費へ／捨てる）が開く。
     預かりが空のときは何も出さない（普段のホームを賑やかにしない） */
  function cardNotice() {
    var C = DL.card;
    if (!C || !C.ready()) return null;
    var list = S.cardInbox();
    if (!list.length) return null;
    var yen = DL.docs.yen;
    var x = list[0];
    var when = x.date === U.today() ? (x.time || '') : U.fmtMD(x.date);

    return el('button', {
      type: 'button', class: 'row card-notice',
      onclick: function () {
        if (DL.views.books && DL.views.books.cardSheet) DL.views.books.cardSheet();
        else location.hash = '#/books';
      }
    }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('client', 17),
          el('span', { text: 'カードの決済通知を ' + list.length + '件 受け取りました' })
        ]),
        el('div', { class: 'row-sub' }, [
          // 名前は、覚えさせた言い換えを当ててから出す
          ui.chip((when ? when + '　' : '') + (C.nameOf(x) || '店名なし') + '　' + yen(x.amount), 'warn'),
          list.length > 1 ? ui.chip('ほか ' + (list.length - 1) + '件', 'ghosty') : null
        ])
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

    /* 日用品・消耗品は今日ぶんに数えていない。
       レシートを入れたのに支出が増えないと戸惑うので、そこは書いておく */
    if (b.todaySupply > 0) {
      card.appendChild(el('p', { class: 'muted small bg-supply', text:
        '日用品・消耗品 ' + yen(b.todaySupply) + ' は今日ぶんに数えていません（明日から効きます）' }));
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
    // 毎日の残りをためた「節約実績」。使いすぎた日はそのぶん引いてある
    if ((line = savedLine(today))) card.appendChild(line);
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

  /* ---------------- 今月の節約実績 ----------------

     「本日使える金額」の残りを、毎日ためていったもの。
     使いすぎた日はその日ぶんがマイナスになり、実績から引かれる。
     月が変われば0から数え直す（1日ぶんの予算も、その月のもので数える）。 */

  function savedLine(today) {
    var r = DL.expenses.savingRecord(today);
    if (!r) return null;
    var yen = DL.docs.yen;
    var minus = r.saved < 0;
    return el('button', {
      type: 'button', class: 'mo-line',
      onclick: function () { savedSheet(today); }
    }, [
      el('span', { class: 'mo-k', text: '今月の節約' }),
      el('b', { class: minus ? 'over' : 'save',
        text: (minus ? '-' : '+') + yen(Math.abs(r.saved)) }),
      el('span', { class: 'mo-s' + (r.today < 0 ? ' over' : ''),
        text: '今日 ' + (r.today < 0 ? '-' : '+') + yen(Math.abs(r.today)) }),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 15))
    ]);
  }

  /* 日ごとの積み上げ。どの日でためて、どの日で使いすぎたかを見る */
  function savedSheet(today) {
    var r = DL.expenses.savingRecord(today);
    if (!r) return;
    var yen = DL.docs.yen;
    var minus = r.saved < 0;

    var list = el('div', { class: 'sv-days' });
    r.rows.slice().reverse().forEach(function (x) {
      var neg = x.saved < 0;
      list.appendChild(el('div', { class: 'sv-day' + (neg ? ' over' : '') + (x.date === today ? ' now' : '') }, [
        el('span', { class: 'sv-day-d', text: U.fmtMD(x.date) + (x.date === today ? '（今日）' : '') }),
        el('span', { class: 'muted small', text: '支出 ' + yen(x.spent) }),
        el('b', { text: (neg ? '-' : '+') + yen(Math.abs(x.saved)) })
      ]));
    });

    var close = ui.sheet({
      title: '今月の節約実績',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'card sum-grid' }, [
          el('div', { class: 'sum-box big' + (minus ? ' warn' : ' ok') }, [
            el('span', { text: r.ym.replace('-', '年') + '月' }),
            el('b', { text: (minus ? '-' : '+') + yen(Math.abs(r.saved)) })
          ]),
          el('div', { class: 'sum-box' }, [el('span', { text: 'ためた日' }),
            el('b', { text: r.goodDays + '日' })]),
          el('div', { class: 'sum-box' }, [el('span', { text: '使いすぎた日' }),
            el('b', { text: r.badDays + '日' })])
        ]),
        el('p', { class: 'muted small', text:
          '1日の予算 ' + yen(r.perDay) + ' × ' + r.day + '日 − 使った額 ' + yen(r.spent)
          + '　＝　' + (minus ? '-' : '') + yen(Math.abs(r.saved)) }),
        el('p', { class: 'muted small', text:
          '毎日の「本日使える金額」の残りをためたものです。使いすぎた日はそのぶん引いています。'
          + '今日ぶん（' + (r.today < 0 ? '-' : '+') + yen(Math.abs(r.today)) + '）はまだ動きます。' }),
        ui.section('日ごと'),
        list,
        null
      ]),
      actions: [ui.btn('閉じる', 'ghost', function () { close(); })]
    });
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
  var mGenre = '';           // 和食・洋食・中華。空なら指定なし
  var mUse = [];             // 使いたい食材。入れておくと、必ずそれを使った献立になる
  var mDraft = null;         // まだ採用していない献立
  var mDate = '';            // その下書きは、どの日のぶんか
  var mBusy = '';            // いま考えている日（空なら考えていない）
  var mFrom = '';            // どの献立に合わせて mSlots をそろえたか
  var mAmount = 0;           // 金額指定で入れた額。次に開いたときの初期値にする
  var mBudget = 0;           // いまの下書きを出したときの額（0 は今日あと使える額）
  var mSend = false;         // Discord へ送っている最中か

  /* 献立を Discord のチャンネルへ送るボタン。採用の前でも押せる */
  function sendBtn(m, date) {
    return onlyIcon(mSend ? 'refresh' : 'send', 'Discordへ送る', 'ghost', function () {
      if (mSend) return;
      mSend = true;
      DL.app.render();
      DL.menu.send(m, date).then(function () {
        mSend = false;
        DL.app.render();
        ui.toast('送りました');
      }).catch(function (e) {
        mSend = false;
        DL.app.render();
        ui.toast(e.message, 'danger');
      });
    });
  }

  /**
   * 献立の一枚。ホームでは今日、カレンダーの日別画面ではその日。
   * どの日でも同じことができる（作る・考え直す・別の日へ送る・外す）。
   * @param {string} date
   */
  function menuCard(date) {
    var M = DL.menu;
    var b = DL.expenses.dailyBudget(date);
    var saved = S.getMenu(date);
    // 予算も献立も無ければ、出すものが無い
    if (!b && !saved) return null;
    var yen = DL.docs.yen;
    var today = date;
    // 下書きは日ごと。ほかの日の下書きは、この日には出さない
    var draft = (mDraft && mDate === date) ? mDraft : null;
    var busy = mBusy === date;

    var card = el('div', { class: 'card mn-card' });

    // すでに採用してあるなら、それを出す（考え直したものがあれば、そちらを先に見せる）
    if (saved && !draft) {
      /* 採用したあとでも食事は選び直せる。朝食を足して考え直す、ができるように。
         いま採用しているぶんに合わせておいて、押されたらそれを覚える */
      var slots = (saved.meals || []).map(function (m) { return m.slot; });
      var from = today + ':' + slots.join(',');
      if (mFrom !== from) {
        if (slots.length) mSlots = slots;
        mFrom = from;
      }

      card.appendChild(menuBody(saved, today));
      // 「再考案」でも食事・人数・系統を選び直せるようにしておく
      if (M.ready() && b) {
        card.appendChild(slotPick());
        card.appendChild(servRow());
        card.appendChild(usePick());
      }
      card.appendChild(el('div', { class: 'row-wrap mn-acts' }, [
        b ? ui.btn(busy ? '考えています…' : '再考案', 'ghost', function () {
          mDraft = null;
          run(today, b, M.namesOf(saved));
        }, 'refresh') : null,
        M.ready() ? sendBtn(saved, today) : null,
        // 別の日の「作るもの」として送る（コピーでも、移すのでも）
        onlyIcon('calendar', '別の日へ送る', 'ghost', function () { sendToDay(saved, today); }),
        // 前に作ったものから選び直す（作ってもらわなくても差し替えられる）
        onlyIcon('star', '前に作った献立から選ぶ', 'ghost', function () { pastMenuSheet(today); }),
        kitchenBtn(),
        onlyIcon('trash', '献立を外す', 'ghost', function () {
          ui.confirm(U.fmtMD(today) + ' の献立を外します。', { okText: '外す' }).then(function (ok) {
            if (!ok) return;
            S.removeMenu(today);
            ui.toast('外しました');
          });
        })
      ]));
      return card;
    }

    if (!M.ready()) {
      /* 作ってもらうには同期が要る。前に作ったものから選ぶだけなら、それも要らない */
      card.appendChild(el('p', { class: 'muted small',
        text: '同期を設定すると、献立を作ってもらえます' }));
      card.appendChild(el('div', { class: 'row-wrap mn-acts' }, [
        ui.btn('前のから選ぶ', 'ghost grow', function () { pastMenuSheet(today); }, 'star')
      ]));
      return card;
    }

    /* 選ぶところ。見出しは付けない（朝食・1人分と書いてあれば分かる） */
    card.appendChild(slotPick());
    card.appendChild(servRow());
    card.appendChild(usePick());

    // まだ出していないとき
    if (!draft) {
      var sv = savingLeft(today, b);
      /* 通常出力＝その日あと使える金額いっぱい、金額指定＝入れた額、
         貯金予算＝貯金ぶんを引いた額。並ぶので、この列は文字だけにする */
      card.appendChild(el('div', { class: 'row-wrap mn-acts' }, [
        ui.btn(busy ? '考え中…' : '通常出力',
          'primary grow', function () { run(today, b, []); }),
        ui.btn('金額指定', 'ghost grow', function () { amountSheet(today, b); }),
        sv ? ui.btn('貯金予算', 'ghost grow', function () {
          if (sv.left <= 0) {
            ui.toast('貯金ぶんを引くと、その日の食費が残りません（'
              + yen(-sv.left) + ' 足りません）', 'danger');
            return;
          }
          run(today, b, [], sv.left);
        }) : null,
        // 作ってもらわずに、前に作ったものから選ぶ
        ui.btn('前のから選ぶ', 'ghost grow', function () { pastMenuSheet(today); }),
        kitchenBtn()
      ]));
      return card;
    }

    card.appendChild(menuBody(draft, today, true));
    card.appendChild(el('div', { class: 'row-wrap mn-acts' }, [
      // 絵だけのボタンが並ぶので、この2つは文字だけにして幅を空ける
      ui.btn('これにする', 'primary', function () {
        // setMenu で描き直しが走るので、先に下書きを片づけてから保存する
        var m = draft;
        mDraft = null;
        S.setMenu(today, m);
        ui.toast(U.fmtMD(today) + ' の献立にしました');
      }),
      ui.btn(busy ? '考え中…' : '再考案', 'ghost', function () {
        // 金額指定・貯金予算で出したものは、同じ額のまま考え直す
        run(today, b, DL.menu.namesOf(draft), mBudget);
      }),
      // その日ではなく、別の日の献立にする
      ui.btn('別の日に', 'ghost', function () { sendToDay(draft, today, true); }),
      // 採用の前でも送れる（これで作る、と決める前に台所へ流したいので）
      sendBtn(draft, today),
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
      mBusy = date;               // どの日ぶんを考えているか
      mBudget = budget || 0;      // 「再考案」でも同じ額のままにする
      DL.app.render();
      DL.menu.suggest({
        budget: budget || (bd ? bd.todayLeft : 0), slots: mSlots.slice(), servings: mServ,
        genre: mGenre, use: mUse.slice(), avoid: avoid, date: date
      }).then(function (m) {
        mBusy = '';
        mDraft = m;
        mDate = date;             // その日の下書きとして持つ
        DL.app.render();
        // 頼んだ食事が返ってこなかったら、たいてい Worker が古い
        if (m.missingSlots && m.missingSlots.length) {
          ui.toast(DL.menu.slotsJa(m.missingSlots)
            + ' が出せませんでした。Cloudflare の Worker を deploy し直してください', 'warn');
        }
      }).catch(function (e) {
        mBusy = '';
        DL.app.render();
        ui.toast(e.message, 'danger');
      });
    }
  }

  /* ---------------- ホームの買い物リスト ----------------

     献立はカレンダーの日付ごとに作る。ホームに出すのは「何を買うか」だけ。
     これからの日の献立ぶんをまとめて出し、自分で足したものも同じ並びに置く。 */

  var SHOP_DAYS = 6;         // 何日先ぶんの献立まで見るか（今日を入れて7日）

  /** ホームに出す期間。まとめて作ってあれば、その終わりまで伸ばす */
  function shopRange(today) {
    var to = U.addDays(today, SHOP_DAYS);
    var plan = S.menuPlan();
    if (plan && U.cmp(plan.to, to) > 0) to = plan.to;
    return { from: today, to: to };
  }

  function shopCard(today) {
    var yen = DL.docs.yen;
    var r = shopRange(today);
    var menus = S.menusIn(r.from, r.to);
    var free = S.shopItems();
    if (!menus.length && !free.length) return null;

    var card = el('div', { class: 'card mn-card' });
    var items = mergedShop(menus);
    var all = items.length + free.length;
    var gotN = items.filter(function (x) { return x.got; }).length
      + free.filter(function (x) { return x.got; }).length;
    var total = items.reduce(function (n, x) { return n + x.price; }, 0)
      + free.reduce(function (n, x) { return n + U.num(x.price, 0); }, 0);

    card.appendChild(el('div', { class: 'mn-plan-head' }, [
      el('span', { class: 'muted small', text: menus.length
        ? U.fmtMD(r.from) + '〜' + U.fmtMD(r.to) + ' の献立 ' + menus.length + '日ぶん'
        : '自分で足したぶん' }),
      ui.chip(gotN + ' / ' + all + '点', gotN && gotN >= all ? 'ok' : 'ghosty'),
      el('b', { class: 'mn-plan-p', text: yen(total) })
    ]));

    var ul = el('div', { class: 'mn-list' });
    items.forEach(function (x) { ul.appendChild(planRowOf(x)); });
    free.forEach(function (x) { ul.appendChild(freeRow(x)); });
    card.appendChild(ul);

    card.appendChild(el('div', { class: 'row-wrap mn-acts' }, [
      ui.btn('品を足す', 'ghost', function () { shopItemSheet(null); }, 'plus'),
      menus.length ? ui.btn('献立ごとに見る', 'ghost', function () {
        planShopSheet(r.from, r.to);
      }, 'books') : null,
      /* 買い終わったものを消す口。献立があってもなくても、いつでも同じ場所に置く */
      ui.btn('買ったぶんを消す', 'ghost', function () { dropGotShop(r); }, 'trash')
    ]));
    return card;

    /* 献立から来た1行。印はその日の献立へ書き戻す */
    function planRowOf(x) {
      var box = el('label', { class: 'mn-item mn-buy' + (x.got ? ' got' : '') }, [
        el('input', {
          type: 'checkbox', class: 'mn-chk', checked: x.got,
          'aria-label': x.name + 'を買った',
          onchange: function (e) {
            var on = e.target.checked;
            x.at.forEach(function (a) { S.setShopGot(a.date, a.name, on); });
            // 描き直さずに印を付けるので、見た目もその場で合わせる
            x.got = on;
            box.classList.toggle('got', on);
          }
        }),
        el('span', { class: 'mn-item-n', text: x.name }),
        el('span', { class: 'muted small', text: qtyText(x) }),
        el('b', { class: 'mn-plan-p', text: yen(x.price) })
      ]);
      return box;
    }

    /* 自分で足した1行。押すと直せる */
    function freeRow(x) {
      var box = el('label', { class: 'mn-item mn-buy mine' + (x.got ? ' got' : '') }, [
        el('input', {
          type: 'checkbox', class: 'mn-chk', checked: x.got,
          'aria-label': x.name + 'を買った',
          onchange: function (e) {
            var on = e.target.checked;
            S.updateShopItem(x.id, { got: on });
            box.classList.toggle('got', on);
          }
        }),
        el('span', { class: 'mn-item-n', text: x.name }),
        x.qty ? el('span', { class: 'muted small', text: x.qty }) : null,
        el('button', {
          type: 'button', class: 'mn-price',
          'aria-label': x.name + 'を直す',
          onclick: function (e) { e.preventDefault(); shopItemSheet(x); }
        }, el('b', { text: x.price ? yen(x.price) : '—' }))
      ]);
      return box;
    }
  }

  /* 献立の買い物を、同じ品でまとめる（まとめ買いリストと同じまとめ方） */
  function mergedShop(list) {
    var map = {}, order = [];
    list.forEach(function (o) {
      (o.menu.shopping || []).forEach(function (s) {
        var k = S.priceKey(s.name);
        if (!map[k]) {
          map[k] = { name: s.name, qty: [], price: 0, n: 0, got: true, at: [] };
          order.push(k);
        }
        var it = map[k];
        it.qty.push(s.qty || '');
        it.price += U.num(s.price, 0);
        it.n += 1;
        it.at.push({ date: o.date, name: s.name });
        if (!s.got) it.got = false;
      });
    });
    return order.map(function (k) { return map[k]; });
  }

  /**
   * 買った印の付いたものを、買い物リストから消す。
   * 自分で足したぶんも、献立から来たぶんも同じように消える。
   * 消すのは買い物の行だけで、献立そのもの（一品と作り方）は残す。
   * 数は押した時点で数え直す。印は画面を描き直さずに付けられるので、
   * 出したときの数を当てにすると合わなくなる。
   * @param {object} r 出している期間 {from, to}
   */
  function dropGotShop(r) {
    var menus = S.menusIn(r.from, r.to);
    var gotN = mergedShop(menus).filter(function (x) { return x.got; }).length
      + S.shopItems().filter(function (x) { return x.got; }).length;
    if (!gotN) { ui.toast('買った印の付いたものがありません', 'warn'); return; }
    ui.confirm('買った印の付いた ' + gotN + '点を、買い物リストから消します。\n'
      + '献立から来たぶんも消えます（献立そのものは残ります）。',
      { okText: '消す', danger: true }).then(function (ok) {
      if (!ok) return;
      S.clearGotShopItems();
      menus.forEach(function (o) { S.removeGotShop(o.date); });
      DL.app.render();
      ui.toast(gotN + '点を消しました');
    });
  }

  /**
   * 自分で足す品の入力。
   * @param {object} [x] 直すとき
   */
  function shopItemSheet(x) {
    var nameIn = ui.input({ value: x ? x.name : '', maxlength: 60, placeholder: '例）ティッシュ' });
    var qtyIn = ui.input({ value: x ? x.qty : '', maxlength: 24, placeholder: '例）5箱' });
    var priceIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, step: 10,
      value: x && x.price ? x.price : '', placeholder: '任意' });
    var close = ui.sheet({
      title: x ? '買うものを直す' : '買うものを足す',
      body: el('div', { class: 'form' }, [
        ui.field('品名', nameIn),
        el('div', { class: 'grid2' }, [
          ui.field('いくつ', qtyIn),
          ui.field('値段（円）', priceIn)
        ]),
        x ? ui.btn('この品を消す', 'danger full mt', function () {
          S.removeShopItem(x.id);
          close();
          ui.toast('消しました');
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn(x ? '保存' : '足す', 'primary', function () {
          var name = nameIn.value.trim();
          if (!name) { ui.toast('品名を入れてください', 'warn'); return; }
          var data = { name: name, qty: qtyIn.value.trim(), price: U.num(priceIn.value, 0) };
          if (x) S.updateShopItem(x.id, data);
          else S.addShopItem(data);
          close();
          ui.toast(x ? '直しました' : '足しました');
        })
      ]
    });
    setTimeout(function () { nameIn.focus(); }, 120);
  }

  /* ---------------- 別の日へ送る ----------------

     作ったものを、その日だけのものにしない。
     「これは明日にしよう」と決めたら、そのまま明日の献立にできる。 */

  /**
   * @param {object} m 献立
   * @param {string} from いまぶら下がっている日
   * @param {boolean} draft まだ採っていない下書きか
   */
  function sendToDay(m, from, draft) {
    var dateIn = ui.input({ type: 'date', value: U.addDays(from, 1) });
    // 下書きは今日にぶら下がっていないので、動かすも何もない
    var move = el('input', { type: 'checkbox', class: 'check', checked: !draft });
    var moveRow = draft ? null : el('label', { class: 'row-check' }, [move,
      el('span', { text: U.fmtMD(from) + ' からは外す（移す）' })]);
    var warn = el('p', { class: 'muted small' });

    function refresh() {
      var to = dateIn.value;
      warn.textContent = !U.isISO(to) ? ''
        : (to === from ? '同じ日です。'
          : (S.getMenu(to) ? U.fmtMD(to) + ' にはすでに献立があります。置き替えます。' : ''));
    }
    dateIn.addEventListener('change', refresh);
    dateIn.addEventListener('input', refresh);
    refresh();

    var close = ui.sheet({
      title: '別の日へ送る',
      body: el('div', { class: 'form' }, [
        ui.field('いつの献立にするか', dateIn),
        moveRow, warn,
        null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('送る', 'primary', function () {
          var to = dateIn.value;
          if (!U.isISO(to)) { ui.toast('日付を入れてください', 'warn'); return; }
          if (to === from && !draft) { ui.toast('同じ日です', 'warn'); return; }
          var copy = U.clone(m);
          (copy.shopping || []).forEach(function (s) { s.got = false; });
          S.setMenu(to, copy);
          if (draft) mDraft = null;
          else if (move.checked && to !== from) S.removeMenu(from);
          close();
          DL.app.render();
          ui.toast(U.fmtMD(to) + ' の献立にしました');
        })
      ]
    });
  }

  /* ---------------- 何日かぶん、まとめて作る ----------------

     1日ずつ出していると、まとめ買いの計画が立たない。
     期間を決めて、その日ごとの予算で1日ぶんずつ作り、各日にぶら下げる。
     似たものが並ばないよう、前の日までに出たものを避けてもらう。 */

  var bFrom = '', bTo = '';     // 前に決めた期間（次に開いたときの初期値）
  var bMode = 'normal';         // normal＝通常予算 saving＝貯金予算 amount＝金額指定
  var bAmount = 0;
  var bSkip = true;             // すでに献立がある日は飛ばす
  var BATCH_MAX = 14;           // 一度に作れる日数（1日ずつ聞くので、あまり長くしない）

  /* 献立の見出しの右に置く入口 */
  function menuTools(today) {
    var box = el('div', { class: 'row-wrap' });
    if (DL.menu.ready()) {
      box.appendChild(ui.btn('まとめて作る', 'ghost tiny', function () { batchSheet(today); }, 'calendar'));
    }
    var plan = S.menuPlan();
    if (plan && U.cmp(plan.to, today) >= 0 && S.menusIn(plan.from, plan.to).length) {
      box.appendChild(ui.btn('まとめ買い', 'ghost tiny',
        function () { planShopSheet(plan.from, plan.to); }, 'sales'));
    }
    return box.childNodes.length ? box : null;
  }

  /** その日の予算。mode に合わせて出す。作れないときは0 */
  function budgetFor(date, mode, amount) {
    if (mode === 'amount') return Math.max(0, Math.round(U.num(amount, 0)));
    var b = DL.expenses.dailyBudget(date);
    if (!b) return 0;
    if (mode !== 'saving') return b.todayLeft;
    var sv = savingLeft(date, b);
    return sv ? Math.max(0, sv.left) : b.todayLeft;
  }

  function batchSheet(today) {
    var fromIn = ui.input({ type: 'date', value: bFrom || U.addDays(today, 1) });
    var toIn = ui.input({ type: 'date', value: bTo || U.addDays(today, 7) });
    var amountIn = ui.input({ type: 'number', inputmode: 'numeric', min: 1, step: 100,
      value: bAmount || budgetFor(today, 'normal') || 1000 });
    var skip = el('input', { type: 'checkbox', class: 'check', checked: bSkip });

    // 食事・人数・系統は、この場かぎりで選び直せるようにする（ホームのぶんは触らない）
    var slots = mSlots.slice(), serv = mServ, genre = mGenre, mode = bMode;

    var slotBox = el('div', { class: 'mn-pick' });
    function drawSlots() {
      U.clear(slotBox);
      DL.menu.SLOTS.forEach(function (s) {
        var on = slots.indexOf(s.value) >= 0;
        slotBox.appendChild(ui.btn(s.label, 'ghost' + (on ? ' on' : ''), function () {
          var i = slots.indexOf(s.value);
          if (i >= 0) slots.splice(i, 1);
          else slots.push(s.value);
          if (!slots.length) slots.push(s.value);
          drawSlots();
        }));
      });
    }
    drawSlots();

    var amountField = ui.field('1日あたりの金額（円）', amountIn);
    var note = el('p', { class: 'muted small mn-batch-note' });

    function days() {
      var out = [];
      var a = fromIn.value, b = toIn.value;
      if (!U.isISO(a) || !U.isISO(b) || U.cmp(a, b) > 0) return out;
      for (var d = a; U.cmp(d, b) <= 0 && out.length <= BATCH_MAX; d = U.addDays(d, 1)) out.push(d);
      return out;
    }

    function refresh() {
      amountField.hidden = mode !== 'amount';
      var list = days();
      if (!list.length) { note.textContent = '日付の順が逆になっています。'; return; }
      if (list.length > BATCH_MAX) {
        note.textContent = '一度に作れるのは ' + BATCH_MAX + '日ぶんまでです。';
        return;
      }
      var has = list.filter(function (d) { return S.getMenu(d); }).length;
      var make = skip.checked ? list.length - has : list.length;
      var sum = list.reduce(function (n, d) {
        return n + budgetFor(d, mode, amountIn.value);
      }, 0);
      note.textContent = list.length + '日ぶん'
        + (has ? '（うち ' + has + '日はもう献立があります）' : '') + '。'
        + make + '日ぶんを作ります。予算はあわせて ' + DL.docs.yen(sum) + ' ほど。'
        + '1日ずつ考えるので、' + Math.max(1, Math.round(make * 0.4)) + '分ほどかかります。';
    }
    [fromIn, toIn, amountIn].forEach(function (n) {
      n.addEventListener('change', refresh);
      n.addEventListener('input', refresh);
    });
    skip.addEventListener('change', refresh);

    var body = el('div', { class: 'form' }, [
      el('div', { class: 'grid2' }, [
        ui.field('はじめの日', fromIn),
        ui.field('終わりの日', toIn)
      ]),
      ui.field('予算のもと', ui.segmented([
        { value: 'normal', label: '通常予算' },
        { value: 'saving', label: '貯金予算' },
        { value: 'amount', label: '金額指定' }
      ], mode, function (v) { mode = v; refresh(); })),
      amountField,
      ui.field('どの食事', slotBox),
      ui.field('人数', ui.segmented([{ value: 1, label: '1人分' }, { value: 2, label: '2人分' }],
        serv, function (v) { serv = U.num(v, 1); })),
      ui.field('系統', ui.segmented([{ value: '', label: '指定なし' }].concat(
        DL.menu.GENRES.map(function (g) { return { value: g.value, label: g.label }; })
      ), genre, function (v) { genre = v; })),
      el('label', { class: 'row-check' }, [skip,
        el('span', { text: 'すでに献立がある日は飛ばす' })]),
      note,
      null
    ]);
    refresh();

    var close = ui.sheet({
      title: 'まとめて作る',
      body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('作りはじめる', 'primary', function () {
          var list = days();
          if (!list.length) { ui.toast('期間を確かめてください', 'warn'); return; }
          if (list.length > BATCH_MAX) {
            ui.toast('一度に作れるのは ' + BATCH_MAX + '日ぶんまでです', 'warn'); return;
          }
          if (mode === 'amount' && !(U.num(amountIn.value, 0) > 0)) {
            ui.toast('金額を入れてください', 'warn'); return;
          }
          bFrom = fromIn.value; bTo = toIn.value; bMode = mode; bSkip = skip.checked;
          bAmount = U.num(amountIn.value, 0);
          close();
          runBatch({
            from: fromIn.value, to: toIn.value, mode: mode,
            amount: U.num(amountIn.value, 0), skip: skip.checked,
            slots: slots.slice(), serv: serv, genre: genre
          });
        })
      ]
    });
  }

  /* 実際に1日ずつ作っていくところ。進み具合を出しながら、順に頼む */
  function runBatch(o) {
    var all = [], d;
    for (d = o.from; U.cmp(d, o.to) <= 0; d = U.addDays(d, 1)) all.push(d);
    var days = o.skip ? all.filter(function (x) { return !S.getMenu(x); }) : all;

    var made = [], failed = [], avoid = [], stop = false;
    var line = el('p', { class: 'mn-batch-l' });
    var bar = ui.progress(0);
    var log = el('div', { class: 'list mn-batch-log' });
    var stopBtn = ui.btn('やめる', 'ghost', function () {
      stop = true;
      line.textContent = 'この日ぶんが終わったら止めます…';
    });
    var shopBtn = ui.btn('まとめ買いリスト', 'ghost', function () {
      planShopSheet(o.from, o.to);
    }, 'sales');
    var closeBtn = ui.btn('閉じる', 'primary', function () { close(); });
    shopBtn.hidden = true;
    closeBtn.hidden = true;

    var close = ui.sheet({
      title: 'まとめて作る',
      body: el('div', { class: 'form' }, [line, bar, log]),
      actions: [stopBtn, shopBtn, closeBtn]
    });

    if (!days.length) {
      line.textContent = '作る日がありません（すでに献立がそろっています）。';
      stopBtn.hidden = true; closeBtn.hidden = false;
      return;
    }
    step(0);

    function setBar(t) {
      var i = bar.querySelector('i');
      if (i) i.style.width = Math.round(Math.max(0, Math.min(1, t)) * 100) + '%';
    }

    function addLog(date, text, ok) {
      log.appendChild(el('button', {
        class: 'row mn-batch-row' + (ok ? '' : ' bad'),
        onclick: function () { close(); location.hash = '#/day/' + date; }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            ui.chip(U.fmtMDW(date), ok ? 'soft' : 'ghosty'),
            el('span', { text: text })
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon(ok ? 'chevronRight' : 'alert', 16))
      ]));
      log.scrollTop = log.scrollHeight;
    }

    function step(i) {
      if (stop || i >= days.length) { done(); return; }
      var date = days[i];
      line.textContent = (i + 1) + ' / ' + days.length + '日目　'
        + U.fmtMDW(date) + ' を考えています…';
      setBar(i / days.length);

      var budget = budgetFor(date, o.mode, o.amount);
      if (!(budget > 0)) {
        failed.push(date);
        addLog(date, o.mode === 'saving' ? '貯金ぶんを引くと残りません' : '予算がありません', false);
        step(i + 1);
        return;
      }
      DL.menu.suggest({
        budget: budget, slots: o.slots, servings: o.serv, genre: o.genre,
        // 前の日までに出たものは避ける。似たものが並ばないように
        avoid: avoid.slice(0, 12), date: date, variety: true
      }).then(function (m) {
        S.setMenu(date, m);
        made.push(date);
        namesIn(m).forEach(function (n) {
          if (avoid.indexOf(n) < 0) avoid.unshift(n);
        });
        addLog(date, DL.menu.namesOf(m).join('・') + '　' + DL.docs.yen(m.total), true);
        step(i + 1);
      }).catch(function (e) {
        failed.push(date);
        addLog(date, e.message, false);
        step(i + 1);
      });
    }

    function done() {
      setBar(1);
      line.textContent = (stop ? 'やめました。' : '')
        + made.length + '日ぶん作りました。'
        + (failed.length ? '（' + failed.length + '日ぶんは作れませんでした）' : '');
      if (made.length) S.setMenuPlan({ from: o.from, to: o.to });
      stopBtn.hidden = true;
      closeBtn.hidden = false;
      shopBtn.hidden = !made.length;
      DL.app.render();
    }
  }

  /* まとめた買うものの「いくつ」。同じ言い方なら ×3、違えば足して並べる */
  function qtyText(x) {
    var qs = x.qty.filter(Boolean);
    if (!qs.length) return x.n > 1 ? x.n + '日ぶん' : '';
    var uniq = qs.filter(function (s, i, a) { return a.indexOf(s) === i; });
    if (uniq.length === 1) return uniq[0] + (x.n > 1 ? ' ×' + x.n : '');
    return qs.join('＋');
  }

  /* その献立に出てくる名前（献立の呼び名と、一品ずつの品名） */
  function namesIn(m) {
    var out = [];
    ((m && m.meals) || []).forEach(function (x) {
      if (x.name) out.push(x.name);
      (x.dishes || []).forEach(function (d) { if (d.name) out.push(d.name); });
    });
    return out;
  }

  /* ---------------- まとめ買いリスト ----------------

     期間ぶんの買い物を1つにまとめる。同じ品はまとめて、印はその日の献立へ書き戻す
     （どの日のぶんかは、まとめても分かるようにしておく）。 */

  function planShopSheet(from, to) {
    // 印を付けるたびに数え直す。入れ物だけ先に作って、中身を差し替える
    var host = el('div');
    function redraw() {
      U.clear(host);
      host.appendChild(planShopBody(from, to, redraw));
    }
    redraw();
    var close = ui.sheet({
      title: 'まとめ買いリスト',
      body: host,
      actions: [ui.btn('閉じる', 'ghost', function () { close(); })]
    });
  }

  function planShopBody(from, to, onChange) {
    var yen = DL.docs.yen;
    var box = el('div', { class: 'form' });
    var list = S.menusIn(from, to);

    box.appendChild(el('p', { class: 'muted small',
      text: U.fmtMD(from) + '〜' + U.fmtMD(to) + ' の献立 ' + list.length + '日ぶん' }));
    if (!list.length) {
      box.appendChild(ui.empty('この期間に献立がありません。'));
      return box;
    }

    // 同じ品をまとめる。名前のゆれは値段の控えと同じならしかたで見る
    var map = {}, order = [];
    list.forEach(function (o) {
      (o.menu.shopping || []).forEach(function (s) {
        var k = S.priceKey(s.name);
        if (!map[k]) { map[k] = { name: s.name, qty: [], price: 0, n: 0, got: true, at: [] }; order.push(k); }
        var it = map[k];
        it.qty.push(s.qty || '');
        it.price += U.num(s.price, 0);
        it.n += 1;
        it.at.push({ date: o.date, name: s.name });
        if (!s.got) it.got = false;
      });
    });

    var items = order.map(function (k) { return map[k]; });
    var total = items.reduce(function (n, x) { return n + x.price; }, 0);
    var gotN = items.filter(function (x) { return x.got; }).length;

    box.appendChild(el('div', { class: 'card sum-grid' }, [
      el('div', { class: 'sum-box big' }, [el('span', { text: '買うもの' }),
        el('b', { text: gotN + ' / ' + items.length + '点' })]),
      el('div', { class: 'sum-box' }, [el('span', { text: 'あわせて' }),
        el('b', { text: yen(total) })])
    ]));

    var ul = el('div', { class: 'mn-list' });
    items.forEach(function (x) {
      var row = el('label', { class: 'mn-item mn-buy' + (x.got ? ' got' : '') }, [
        el('input', {
          type: 'checkbox', class: 'mn-chk', checked: x.got,
          'aria-label': x.name + 'を買った',
          onchange: function (e) {
            var on = e.target.checked;
            x.at.forEach(function (a) { S.setShopGot(a.date, a.name, on); });
            if (onChange) onChange();
          }
        }),
        el('span', { class: 'mn-item-n', text: x.name }),
        el('span', { class: 'muted small', text: qtyText(x) }),
        el('b', { class: 'mn-plan-p', text: yen(x.price) })
      ]);
      ul.appendChild(row);
    });
    box.appendChild(ul);

    box.appendChild(ui.section('日ごと'));
    var dl = el('div', { class: 'list' });
    list.forEach(function (o) {
      dl.appendChild(el('a', { class: 'row', href: '#/day/' + o.date }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            ui.chip(U.fmtMDW(o.date), 'soft'),
            el('span', { text: DL.menu.namesOf(o.menu).join('・') })
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip(DL.menu.slotsLabel(o.menu) || '夕飯', 'ghosty'),
            el('span', { class: 'muted small', text: yen(o.menu.total) })
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
    });
    box.appendChild(dl);
    return box;
  }

  /* ---------------- 前に作った献立から選ぶ ----------------

     一度おいしかったものは、また作りたい。前に作った献立を星の数で分けて並べ、
     そこから選んでその日の献立にできる。
     値段は作ったときのものではなく、いまの控え（実際に払った額）に直して出す。
     そのうえで、1日の予算と貯金予算に収まるかを見る。 */

  var PAST_MAX = 60;         // さかのぼって見る献立の数

  /** 星の平均を、並べるときの段に落とす（4.5 は ★5 の段） */
  function starStep(n) { return Math.min(5, Math.max(0, Math.round(U.num(n, 0)))); }

  function starText(n) {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  /**
   * その献立を、いまの値段の控えで見直す。控えの無いものは作ったときの値段のまま。
   * @returns {object} {shopping, total, changed}
   */
  function repriced(m) {
    var changed = 0;
    var shopping = (m.shopping || []).map(function (s) {
      var was = Math.max(0, Math.round(U.num(s.price, 0)));
      var now = S.priceOf(s.name) || was;
      if (now !== was) changed++;
      // 買った印は付け直し。前に買ったぶんは、いまの買い物とは関わりがない
      return { name: s.name, qty: s.qty, price: now, was: was, got: false };
    });
    return {
      shopping: shopping, changed: changed,
      total: shopping.reduce(function (a, s) { return a + s.price; }, 0)
    };
  }

  /**
   * その日の予算と、貯金を守るなら使える額。
   * @returns {object} {day: 1日の予算（今日あと使える額）|null, save: 貯金ぶんを引いた額|null}
   */
  function budgetLimits(date) {
    var b = DL.expenses.dailyBudget(date);
    if (!b) return { day: null, save: null };
    var sv = savingLeft(date, b);
    return { day: b.todayLeft, save: sv ? sv.left : null, b: b };
  }

  /**
   * 前に作った献立の一覧。星ごとにまとめて出す。
   * @param {string} date その献立にしたい日
   */
  function pastMenuSheet(date) {
    var list = S.pastMenus({ before: date, max: PAST_MAX });
    var body = el('div', { class: 'form' });
    var closeList = function () { close(); };

    if (!list.length) {
      body.appendChild(ui.empty('前に作った献立が、まだありません。'));
    } else {
      body.appendChild(el('p', { class: 'muted small',
        text: U.fmtMD(date) + ' の献立にします。星は、その献立の一品に付けた評価の平均です。' }));
      [5, 4, 3, 2, 1, 0].forEach(function (n) {
        var rows = list.filter(function (r) { return starStep(r.stars) === n; });
        if (!rows.length) return;
        body.appendChild(ui.section(n ? starText(n) : 'まだ評価していない',
          el('span', { class: 'muted small', text: rows.length + '件' })));
        body.appendChild(el('div', { class: 'list' }, rows.map(function (r) {
          return pastRow(r, date, closeList);
        })));
      });
    }

    var close = ui.sheet({
      title: '前に作った献立から選ぶ',
      body: body,
      actions: [ui.btn('閉じる', 'ghost', function () { close(); })]
    });
  }

  /* 一覧の1行。押すと中身と買い物リストを開く */
  function pastRow(r, date, closeList) {
    var yen = DL.docs.yen;
    var rp = repriced(r.menu);
    var lim = budgetLimits(date);
    // 収まらないものは、一覧の時点で分かるようにしておく
    var overDay = lim.day !== null && rp.total > lim.day;
    var overSave = lim.save !== null && rp.total > lim.save;
    return el('button', {
      type: 'button', class: 'row pm-row',
      onclick: function () { pastPickSheet(r, date, closeList); }
    }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: r.names.join('・') })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(U.fmtMD(r.date), 'soft'),
          r.rated ? ui.chip('★' + (Math.round(r.stars * 10) / 10) + '（' + r.rated + '品）', 'ghosty')
            : ui.chip('評価なし', 'ghosty'),
          el('b', { class: overDay || overSave ? 'over' : '', text: yen(rp.total) }),
          overDay ? ui.chip('1日の予算オーバー', 'danger')
            : overSave ? ui.chip('貯金予算オーバー', 'warn') : null
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /**
   * 選んだ献立の中身。買い物リストを金額付きで出し、予算に収まるかを見せる。
   * @param {object} r S.pastMenus の1件
   * @param {string} date その献立にしたい日
   * @param {function} closeList 一覧を畳む
   */
  function pastPickSheet(r, date, closeList) {
    var yen = DL.docs.yen;
    var rp = repriced(r.menu);
    var lim = budgetLimits(date);
    var body = el('div', { class: 'form' });

    body.appendChild(el('p', { class: 'muted small',
      text: U.fmtMD(r.date) + ' に作ったもの　'
        + (r.menu.servings === 2 ? '2人分' : '1人分') }));

    // 中身（何を作るか）
    body.appendChild(ui.section('作るもの'));
    var meals = el('div', { class: 'list' });
    (r.menu.meals || []).forEach(function (x) {
      meals.appendChild(el('div', { class: 'row' }, el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.chip(DL.menu.SLOT_LABEL[x.slot] || '', 'soft'),
          el('span', { text: x.name })
        ]),
        (x.dishes || []).length ? el('div', { class: 'row-sub' },
          el('span', { class: 'muted small',
            text: x.dishes.map(function (d) { return d.name; }).join('・') })) : null
      ])));
    });
    body.appendChild(meals);

    // 買い物リスト。ふだんと同じ並びで、金額を添えて出す
    body.appendChild(ui.section('買うもの',
      el('span', { class: 'muted small', text: rp.shopping.length + '点' })));
    if (!rp.shopping.length) {
      body.appendChild(ui.empty('買うものは控えていません。'));
    } else {
      body.appendChild(el('div', { class: 'mn-list' }, rp.shopping.map(function (s) {
        return el('div', { class: 'mn-item' }, [
          el('span', { class: 'mn-item-n', text: s.name }),
          s.qty ? el('span', { class: 'muted small', text: s.qty }) : null,
          el('b', { class: 'mn-plan-p', text: yen(s.price) })
        ]);
      })));
      body.appendChild(el('div', { class: 'mn-item pm-sum' }, [
        el('span', { class: 'mn-item-n', text: 'あわせて' }),
        el('b', { class: 'mn-plan-p', text: yen(rp.total) })
      ]));
      if (rp.changed) {
        body.appendChild(el('p', { class: 'muted small',
          text: '値段 ' + rp.changed + '点は、そのあと控えた実際の額に直してあります'
            + '（作ったときは ' + yen(r.menu.total) + '）。' }));
      }
    }

    // 予算に収まるか
    body.appendChild(ui.section('予算'));
    var warn = [];
    var box = el('div', { class: 'list' });
    box.appendChild(limitRow('1日の予算（今日あと使える額）', lim.day, rp.total, warn, '1日の予算'));
    box.appendChild(limitRow('貯金予算（貯金ぶんを引いた額）', lim.save, rp.total, warn, '貯金予算'));
    body.appendChild(box);
    warn.forEach(function (w) {
      body.appendChild(el('p', { class: 'mn-warn small' }, [
        ui.icon('alert', 14), el('span', { text: w })
      ]));
    });

    var close = ui.sheet({
      title: r.names.join('・'),
      body: body,
      actions: [
        ui.btn('やめる', 'ghost', function () { close(); }),
        ui.btn('この献立にする', warn.length ? 'danger' : 'primary', function () {
          var m = U.clone(r.menu);
          m.shopping = rp.shopping.map(function (s) {
            return { name: s.name, qty: s.qty, price: s.price, got: false };
          });
          m.total = rp.total;
          S.setMenu(date, m);
          close();
          closeList();
          DL.app.render();
          ui.toast(U.fmtMD(date) + ' の献立にしました');
        })
      ]
    });
  }

  /**
   * 予算1行。収まらなければ、いくら足りないかを出して警告に足す。
   * @param {number|null} limit 決めていなければ null
   * @param {Array} warn 足りないぶんの言い分けを詰める先
   */
  function limitRow(label, limit, total, warn, shortName) {
    var yen = DL.docs.yen;
    if (limit === null) {
      return el('div', { class: 'row' }, el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, el('span', { text: label })),
        el('div', { class: 'row-sub' },
          el('span', { class: 'muted small', text: '決めていません' }))
      ]));
    }
    var over = total > limit;
    if (over) {
      warn.push(shortName + 'を ' + yen(total - limit) + ' オーバーします'
        + '（' + yen(limit) + ' のところ ' + yen(total) + '）。');
    }
    return el('div', { class: 'row pm-lim' }, el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title' }, [
        el('span', { text: label }),
        over ? ui.chip('オーバー', 'danger') : ui.chip('収まります', 'ok')
      ]),
      el('div', { class: 'row-sub' }, [
        el('span', { class: 'muted small', text: yen(limit) + ' − ' + yen(total) + ' ＝ ' }),
        el('b', { class: over ? 'over' : '', text: yen(limit - total) })
      ])
    ]));
  }

  /* 人数と、料理の系統。1行に並べる */
  function servRow() {
    /* 系統は「指定なし」を入れて4つになったので、人数とは行を分ける
       （iPhone の幅では1行に収まらず、字が読めなくなる） */
    return el('div', { class: 'mn-serv-wrap' }, [
      el('div', { class: 'mn-serv' },
        ui.segmented([{ value: 1, label: '1人分' }, { value: 2, label: '2人分' }],
          mServ, function (v) { mServ = U.num(v, 1); DL.app.render(); })),
      genrePick()
    ]);
  }

  /* 指定なし・和食・洋食・中華。いまどれなのかが分かるよう、
     「指定なし」も並びの中に置く（押して外す、では分かりにくい） */
  function genrePick() {
    var list = [{ value: '', label: '指定なし' }].concat(DL.menu.GENRES);
    return el('div', { class: 'mn-genre' }, list.map(function (g) {
      var on = mGenre === g.value;
      return el('button', {
        type: 'button', class: 'mn-g' + (on ? ' on' : ''),
        'aria-pressed': on ? 'true' : 'false',
        onclick: function () { mGenre = g.value; DL.app.render(); }
      }, el('span', { text: g.label }));
    }));
  }

  /* ---------------- 使いたい食材 ----------------

     冷蔵庫に鶏肉がある、今日は魚が食べたい、というときに先に渡しておく。
     いくつでも足せて、入れたものは必ず使った献立になる。 */

  /** 入れた文字を食材に割る。読点・カンマ・中黒・空白のどれで区切ってもいい */
  function splitUse(s) {
    return String(s || '').split(/[,、,・\s　]+/)
      .map(function (x) { return x.trim().slice(0, 30); })
      .filter(Boolean);
  }

  function addUse(s) {
    splitUse(s).forEach(function (x) {
      if (mUse.indexOf(x) < 0 && mUse.length < 8) mUse.push(x);
    });
  }

  /* 入れた食材の並びと、足すところ */
  function usePick() {
    var box = el('div', { class: 'mn-use' });
    box.appendChild(el('div', { class: 'mn-use-head' }, [
      el('span', { class: 'mn-use-l', text: '使いたい食材' }),
      mUse.length ? el('button', {
        type: 'button', class: 'mn-use-clear',
        onclick: function () { mUse = []; DL.app.render(); }
      }, el('span', { text: 'ぜんぶ外す' })) : null
    ]));

    if (mUse.length) {
      box.appendChild(el('div', { class: 'mn-use-tags' }, mUse.map(function (x) {
        return el('button', {
          type: 'button', class: 'mn-use-tag', 'aria-label': x + 'を外す',
          onclick: function () {
            mUse = mUse.filter(function (v) { return v !== x; });
            DL.app.render();
          }
        }, [el('span', { text: x }), ui.icon('close', 12)]);
      })));
    }

    var input = ui.input({
      value: '', maxlength: 60, placeholder: '例）魚、豚肉、なす',
      'aria-label': '使いたい食材を足す'
    });
    var push = function () {
      if (!input.value.trim()) return;
      addUse(input.value);
      input.value = '';
      DL.app.render();
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); push(); }
    });
    box.appendChild(el('div', { class: 'mn-use-add' }, [
      input,
      ui.btn('足す', 'ghost', push, 'plus')
    ]));
    // 打ち止めは、そのとき初めて出す知らせなので残す
    if (mUse.length >= 8) {
      box.appendChild(el('p', { class: 'muted small', text: '足せるのは8つまでです。' }));
    }
    return box;
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

  /**
   * 一品ぶん。主菜・副菜の別と、使う調味料の分量と、その一品の手順。
   * @param {object} [ctx] {m 献立, meal どの食事, draft まだ採っていないか}
   *   渡すと「この一品だけ出し直す」が出る
   */
  function dishBox(d, date, find, ctx) {
    var box = el('div', { class: 'mn-dish' });
    box.appendChild(el('div', { class: 'mn-dish-h' }, [
      d.role ? ui.chip(d.role, 'soft') : null,
      el('b', { text: d.name }),
      redoBtn(d, date, ctx)
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
    box.appendChild(rateRow(d.name));
    return box;
  }

  /* ---------------- 一品だけ出し直す ----------------

     献立をまるごと考え直すと、気に入っていた主菜まで変わってしまう。
     主菜はそのままで副菜だけ、とやり直せるようにする。
     買い物と合計は、返ってきたぶんで組み直す。 */

  var mRedo = '';            // いま出し直している一品（食事:品名）

  function redoKey(meal, d) { return (meal && meal.slot) + ':' + (d && d.name); }

  /* その一品を出し直すボタン。役どころが分からない一品には出さない */
  function redoBtn(d, date, ctx) {
    if (!ctx || !d.role || !DL.menu.ready()) return null;
    var busy = mRedo === redoKey(ctx.meal, d);
    return el('button', {
      type: 'button', class: 'mn-redo' + (busy ? ' busy' : ''),
      disabled: mRedo ? 'disabled' : null,
      'aria-label': d.role + 'を出し直す',
      onclick: function () { redoDish(d, date, ctx); }
    }, [
      ui.icon('refresh', 13),
      el('span', { text: busy ? '考え中…' : d.role + 'を出し直す' })
    ]);
  }

  function redoDish(d, date, ctx) {
    if (mRedo) return;
    var m = ctx.m;
    mRedo = redoKey(ctx.meal, d);
    DL.app.render();
    DL.menu.suggestDish({
      menu: m, slot: ctx.meal.slot, dish: d, genre: mGenre, use: mUse.slice(),
      budget: m.budget, date: date
    }).then(function (r) {
      mRedo = '';
      var next = swapDish(m, ctx.meal, d, r);
      if (ctx.draft) mDraft = next;
      else S.setMenu(date, next);      // 保存で描き直しが走る
      DL.app.render();
      ui.toast(d.role + 'を「' + r.dish.name + '」にしました'
        // 家にある調味料が買い物に混ざっていたら、外したことを断っておく
        + ((r.dropped || []).length
          ? '（' + r.dropped.join('・') + 'は家にあるので外しました）' : ''));
    }).catch(function (e) {
      mRedo = '';
      DL.app.render();
      ui.toast(e.message, 'danger');
    });
  }

  /**
   * 一品を差し替えた献立を作る。
   * 買い物は返ってきたぶんで置き替えるが、買った印は品名で引き継ぐ。
   */
  function swapDish(m, meal, d, r) {
    var meals = (m.meals || []).map(function (x) {
      if (x !== meal) return x;
      return Object.assign({}, x, {
        // 主菜が変われば呼び名も変わる。返ってこなければ元のまま
        name: r.name || x.name,
        dishes: (x.dishes || []).map(function (y) { return y === d ? r.dish : y; })
      });
    });
    var got = {};
    (m.shopping || []).forEach(function (s) { if (s.got) got[s.name] = true; });
    var shop = (r.shopping || m.shopping || []).map(function (s) {
      return Object.assign({}, s, { got: !!got[s.name] });
    });
    return S.normalizeMenu(Object.assign({}, m, {
      meals: meals, shopping: shop,
      // 新しい一品の調味料の言い換えを、この献立の突き合わせに足す
      match: Object.assign({}, m.match, r.match),
      total: 0,                       // 買い物から数え直す
      note: r.note || m.note,
      at: m.at
    }));
  }

  /* ---------------- 作った料理の評価とメモ ----------------

     星は押してすぐ入る。メモは押すと書ける。
     星2以下を付けたものは、次からあまり出さないよう向こうへ渡す。
     メモは、同じ料理がまた来たときに出して、向こうにも渡す。 */

  function rateRow(name) {
    var note = S.dishNote(name) || { stars: 0, memo: '' };
    var box = el('div', { class: 'mn-rate' });

    var stars = el('div', { class: 'mn-stars', role: 'group',
      'aria-label': name + 'の評価' });
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        stars.appendChild(el('button', {
          type: 'button', class: 'mn-star' + (n <= note.stars ? ' on' : ''),
          'aria-label': '星' + n, 'aria-pressed': n <= note.stars ? 'true' : 'false',
          // もう一度同じ星を押したら評価を外す
          onclick: function () {
            S.setDishNote(name, { stars: n === note.stars ? 0 : n, memo: note.memo });
            DL.app.render();
          }
        }, ui.icon('star', 17)));
      }(i));
    }
    box.appendChild(stars);

    // 星2以下は、次からあまり出さない。そうと分かるようにしておく
    if (note.stars && note.stars <= 2) {
      box.appendChild(ui.chip('あまり出さない', 'ghosty'));
    }
    box.appendChild(el('button', {
      type: 'button', class: 'mn-memo-btn' + (note.memo ? ' has' : ''),
      onclick: function () { memoSheet(name, note); }
    }, [ui.icon('edit', 14), el('span', { text: note.memo ? 'メモを直す' : 'メモ' })]));

    // 前に書いたメモは、次に同じ料理が来たときに読めるように出しておく
    if (note.memo) {
      box.appendChild(el('p', { class: 'mn-memo', text: note.memo }));
    }
    return box;
  }

  function memoSheet(name, note) {
    var input = ui.textarea
      ? ui.textarea({ value: note.memo, maxlength: 200, rows: 4 })
      : ui.input({ value: note.memo, maxlength: 200 });
    var close = ui.sheet({
      title: name,
      body: el('div', { class: 'form' }, [
        ui.field('次に作るときのメモ', input),
        null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.setDishNote(name, { stars: note.stars, memo: input.value });
          close();
          ui.toast('残しました');
        })
      ]
    });
    setTimeout(function () { input.focus(); }, 120);
  }

  /* 買うものを開いたままにしておくか。印を付けるたびに描き直しが走るので、
     ここで覚えていないと、1つ付けるたびに閉じてしまう */
  var shopOpen = false;

  /* 開いている食事（日付:食事）。一品を出し直したときに閉じてしまわないように */
  var mealOpen = {};

  /**
   * 買い物リストの1行。印を付けて消し込み、値段は押すと直せる。
   *
   * 印は、その日の献立として採ってあれば保存する（画面を移っても残る）。
   * まだ採っていない下書きのぶんは、その場かぎり（保存先が無いため）。
   *
   * @param {object} s 買うもの1点
   * @param {object} m その献立
   * @param {string} date
   */
  function shopRow(s, m, date) {
    var yen = DL.docs.yen;
    var saved = S.getMenu(date);
    var live = !!(saved && saved.shopping.some(function (x) { return x.name === s.name; }));
    // 控えてある額と同じなら、見当ではなく実際の値段だと分かるようにする
    var known = S.priceOf(s.name) === s.price && s.price > 0;

    var box = el('label', { class: 'mn-item mn-buy' + (s.got ? ' got' : '') }, [
      el('input', {
        type: 'checkbox', class: 'mn-chk', checked: !!s.got,
        'aria-label': s.name + 'を買った',
        onchange: function (e) {
          var on = e.target.checked;
          s.got = on;                              // 下書きでも見た目は変わる
          box.classList.toggle('got', on);
          if (live) S.setShopGot(date, s.name, on);   // 採ってあれば残す
        }
      }),
      el('span', { class: 'mn-item-n', text: s.name }),
      s.qty ? el('span', { class: 'muted small', text: s.qty }) : null,
      /* 値段。押すと実際に払った額を入れられる。
         入れた額は控えて、次の献立からはそちらを使う */
      el('button', {
        type: 'button', class: 'mn-price' + (known ? ' known' : ''),
        'aria-label': s.name + 'の値段を直す',
        onclick: function (e) {
          e.preventDefault();
          priceSheet(s, m, date, live);
        }
      }, el('b', { text: yen(s.price) }))
    ]);
    return box;
  }

  /* 実際に払った額を入れる。控えておいて、次の献立から使う */
  function priceSheet(s, m, date, live) {
    var yen = DL.docs.yen;
    var known = S.priceOf(s.name);
    var input = ui.input({ type: 'number', inputmode: 'numeric', min: 0, step: 10, value: s.price });
    var close = ui.sheet({
      title: s.name,
      body: el('div', { class: 'form' }, [
        ui.field('実際に払った額（円）', input,
          known ? '前に控えたのは ' + yen(known) + ' です'
            : '入れておくと、次の献立からこの値段で数えます'),
        null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('控える', 'primary', function () {
          var v = Math.max(0, Math.round(U.num(input.value, 0)));
          if (!v) { ui.toast('金額を入れてください', 'warn'); return; }
          S.setPrice(s.name, v);        // 次からはこの値段
          s.price = v;
          // 採ってある献立なら、その献立の値段と合計も直す
          if (live) {
            var saved = S.getMenu(date);
            var hit = saved.shopping.filter(function (x) { return x.name === s.name; })[0];
            if (hit) { hit.price = v; S.setMenu(date, saved); }
          }
          close();
          ui.toast('控えました');
          DL.app.render();
        })
      ]
    });
    setTimeout(function () { input.focus(); input.select(); }, 120);
  }

  /**
   * 献立の中身。ホームでも日別画面でも同じものを出す
   * @param {boolean} [draft] まだ採っていない下書きか（出し直しの書き戻し先が変わる）
   */
  function menuBody(m, date, draft) {
    var yen = DL.docs.yen;
    var box = el('div', { class: 'mn-body' });
    // 献立を作ったときに突き合わせた呼び方（しょうが(チューブ)＝おろししょうが）で当てる
    var find = DL.menu.matcher(m);
    // 家に無い調味料と、期限の切れた調味料。予算には数えず、買うものへ足す
    var extras = DL.menu.extras(m, date);

    (m.meals || []).forEach(function (x) {
      /* 一品を出し直すと描き直しが走るので、開いていた食事は開いたままにする */
      var okey = date + ':' + x.slot;
      var open = el('details', { class: 'mn-meal', open: mealOpen[okey] });
      open.addEventListener('toggle', function () { mealOpen[okey] = open.open; });
      open.appendChild(el('summary', {}, [
        ui.chip(DL.menu.SLOT_LABEL[x.slot] || '', 'soft'),
        el('b', { class: 'mn-name', text: x.name }),
        x.minutes ? el('span', { class: 'muted small', text: x.minutes + '分' }) : null
      ]));
      if (x.dishes.length) {
        open.appendChild(el('div', { class: 'mn-dishes' }, x.dishes.map(function (d) {
          return dishBox(d, date, find, { m: m, meal: x, draft: !!draft });
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
      var shop = m.shopping || [];
      var gotN = shop.filter(function (s) { return s.got; }).length;
      /* 開いたままにしておく。印を付けると保存で描き直しが走るので、
         そのたびに閉じてしまわないよう、開いているかを覚えておく */
      var sh = el('details', { class: 'mn-shop', open: shopOpen });
      sh.addEventListener('toggle', function () { shopOpen = sh.open; });
      sh.appendChild(el('summary', {}, [
        el('b', { text: '買うもの' }),
        ui.chip(gotN ? gotN + ' / ' + shop.length + '点' : shop.length + '点',
          gotN && gotN >= shop.length ? 'ok' : 'ghosty'),
        extras.length ? ui.chip('調味料' + extras.length + '点', 'ghosty') : null,
        el('span', { class: 'mn-total', text: yen(m.total) })
      ]));
      var ul = el('div', { class: 'mn-list' });
      shop.forEach(function (s) {
        ul.appendChild(shopRow(s, m, date));
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
      // 家にあるので買い物から外したもの。黙って消すと数が合わなく見える
      if ((m.dropped || []).length) {
        ul.appendChild(el('p', { class: 'muted small mn-extra-note',
          text: m.dropped.join('・') + ' は家にあるので、買い物から外しました。' }));
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
    menuBody: menuBody,     // 日別画面でも同じ中身を出す
    // 献立の一枚と、その見出しの右に置く入口。日別画面でもそのまま使う
    menuCard: menuCard, menuTools: menuTools
  };
})(window.DL);
