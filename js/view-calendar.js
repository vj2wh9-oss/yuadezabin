/* カレンダー（月表示）と日別表示 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  var cursor = null; // 表示中の月（その月の1日）

  var slideDir = null;   // 月移動の向き（アニメーション用）

  function goMonth(delta) {
    cursor = U.addMonths(cursor, delta);
    slideDir = delta > 0 ? 'from-right' : 'from-left';
    DL.app.render();
  }

  function render(root, params) {
    var today = U.today();
    if (params && U.isISO(params.month)) cursor = U.monthStart(params.month);
    if (!cursor) cursor = U.monthStart(today);

    // 案件のカレンダーと日常のカレンダーは中身を混ぜない。
    // どちらを見るかは上部の切替ボタンで決める
    var life = S.calMode() === 'life';

    var first = cursor, last = U.monthEnd(cursor);
    var monthTitle = cursor.slice(0, 4) + '年' + (+cursor.slice(5, 7)) + '月';
    var wrap = el('div', { class: 'page cal-page' + (life ? ' cal-life' : '') });

    /* 月ナビ（月名をタップするとその月の一覧） */
    wrap.appendChild(el('div', { class: 'monthnav' }, [
      el('button', { class: 'iconbtn', 'aria-label': '前の月', onclick: function () { goMonth(-1); } }, ui.icon('chevronLeft', 20)),
      el('button', {
        class: 'monthlabel', 'aria-label': monthTitle + (life ? 'の予定一覧' : 'の締切一覧'),
        onclick: function () { monthSheet(first, last, monthTitle, today, life); }
      }, [
        el('span', { text: monthTitle }),
        ui.icon('chevronDown', 15)
      ]),
      el('button', { class: 'iconbtn', 'aria-label': '次の月', onclick: function () { goMonth(1); } }, ui.icon('chevronRight', 20)),
      // 日常はカレンダーの上に＋を出す（下の丸ボタンはマスに重なるので置かない）
      life ? el('button', {
        class: 'iconbtn', 'aria-label': '予定を追加',
        onclick: function () { DL.views.events.form(null, { date: addDate(cursor, today) }); }
      }, ui.icon('plus', 20)) : null,
      ui.btn('今日', 'tiny ghost', function () { cursor = U.monthStart(today); slideDir = null; DL.app.render(); })
    ]));

    /* 曜日見出し */
    var ws = U.num(S.settings.weekStart, 0);
    var head = el('div', { class: 'cal-head' });
    for (var i = 0; i < 7; i++) {
      var d = (ws + i) % 7;
      head.appendChild(el('div', { class: 'cal-hd' + (d === 0 ? ' sun' : d === 6 ? ' sat' : ''), text: U.wdName(d) }));
    }
    wrap.appendChild(head);

    /* グリッド */
    var lead = (U.dow(first) - ws + 7) % 7;
    var gridStart = U.addDays(first, -lead);
    var rows = Math.ceil((lead + U.diffDays(first, last) + 1) / 7);
    var grid = el('div', { class: 'cal-grid' + (slideDir ? ' ' + slideDir : '') });
    slideDir = null;

    // 日常は繰り返しを毎回ひろげるので、画面に出す範囲を一度にまとめて計算する
    var evMap = life ? DL.events.byDay(gridStart, U.addDays(gridStart, rows * 7 - 1)) : null;

    for (var c = 0; c < rows * 7; c++) {
      var dt = U.addDays(gridStart, c);
      grid.appendChild(life ? lifeCell(dt, cursor, today, evMap[dt] || []) : cell(dt, cursor, today));
    }
    wrap.appendChild(grid);

    attachSwipe(wrap);
    attachWheel(wrap);
    root.appendChild(wrap);
    sizeRows(wrap, grid, rows);
  }

  /**
   * 行の最低の高さを決める。
   * 予定が少ない月はこれまでどおり画面ぴったりに収まり、
   * 1日に多く入っている月だけ、その行が中身の分だけ伸びて縦にスクロールする。
   */
  function sizeRows(wrap, grid, rows) {
    var view = wrap.parentNode;
    if (!view || !rows) return;
    var gap = 2;
    // グリッドが始まる位置から、タブに隠れない下端までが使える高さ
    var pad = parseFloat(getComputedStyle(view).paddingBottom) || 0;
    var avail = (view.getBoundingClientRect().bottom - pad) - grid.getBoundingClientRect().top;
    var per = Math.floor((avail - gap * (rows - 1)) / rows);
    grid.style.gridAutoRows = 'minmax(' + Math.max(per, 34) + 'px, auto)';
  }

  /**
   * PC のマウスホイールで月を移す（下で次の月・上で前の月）。
   * タッチ操作の慣性スクロールで連続して動かないよう、指で触れる端末では付けない。
   */
  function attachWheel(node) {
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var last = 0;
    node.addEventListener('wheel', function (e) {
      var dy = e.deltaY;
      if (!dy || Math.abs(dy) < Math.abs(e.deltaX)) return;

      // 予定が多くて縦に伸びている月では、まず中身をスクロールさせる。
      // 端まで来てから月を移す（スクロールを奪わないため）
      var box = node.parentNode;                       // .view.view-calendar
      var room = box ? box.scrollHeight - box.clientHeight : 0;
      if (room > 1) {
        var atEnd = dy > 0
          ? box.scrollTop >= room - 1
          : box.scrollTop <= 1;
        if (!atEnd) return;                            // ふつうのスクロールに任せる
      }

      e.preventDefault();
      var now = Date.now();
      if (now - last < 260) return;       // 1回のホイールで何ヶ月も飛ばさない
      last = now;
      goMonth(dy > 0 ? 1 : -1);
      if (box) box.scrollTop = 0;         // 月を移したら上から見せる
    }, { passive: false });
  }

  /* 左右スワイプで月を移動する */
  function attachSwipe(node) {
    var x0 = 0, y0 = 0, t0 = 0, tracking = false, swiped = false;

    node.addEventListener('touchstart', function (e) {
      swiped = false;
      if (e.touches.length !== 1) { tracking = false; return; }
      tracking = true;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
    }, { passive: true });

    node.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      if (Date.now() - t0 > 700) return;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      swiped = true;              // 直後のタップ（日付リンク）は無効にする
      goMonth(dx < 0 ? 1 : -1);
    }, { passive: true });

    node.addEventListener('click', function (e) {
      if (!swiped) return;
      swiped = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  /* 予定を足すときの初期日付。その月を見ていれば今日、別の月なら月初 */
  function addDate(month, today) {
    return today.slice(0, 7) === month.slice(0, 7) ? today : month;
  }

  /* 月名タップで開く、その月の一覧 */
  function monthSheet(first, last, title, today, life) {
    if (life) {
      ui.sheet({ title: title + 'の予定', body: DL.views.events.monthBody(first, last) });
      return;
    }
    var items = sc.timeline(first, U.diffDays(first, last));
    var body;
    if (!items.length) {
      body = ui.empty('この月に締切・イベントはありません。');
    } else {
      body = el('div', { class: 'list' }, items.map(function (it) {
        return DL.views.home.deadlineRow(it, today);
      }));
      body.addEventListener('click', function () { close(); });
    }
    var close = ui.sheet({ title: title + 'の締切・イベント', body: body });
  }

  function cell(date, cursorMonth, today) {
    var inMonth = date.slice(0, 7) === cursorMonth.slice(0, 7);
    var marks = sc.dayMarks(date);
    var load = sc.loadOfDay(date);
    var d = U.dow(date);
    var isOff = !sc.isWorkday(null, date);

    // 入稿日・締切日はうっすら赤、イベント当日はうっすら緑に色を敷く。
    // 両方ある日は、当日そこに行くイベントを優先する。
    var hasEvent = marks.some(function (m) { return m.type === 'event'; });
    var hasDue = marks.some(function (m) { return m.type === 'deadline' || m.type === 'printing'; });

    var cls = 'cal-cell';
    if (!inMonth) cls += ' out';
    if (date === today) cls += ' today';
    if (d === 0) cls += ' sun';
    if (d === 6) cls += ' sat';
    if (isOff) cls += ' off';
    if (hasEvent) cls += ' has-event';
    else if (hasDue) cls += ' has-due';

    /* その日の中身を数行だけ載せる（締切・イベントを優先） */
    var lines = el('div', { class: 'cal-lines' });
    // 1マスに載せる上限。これを超えた分だけ「＋n」にまとめる。
    // 収まらない月はマスの高さが伸び、カレンダーごと縦にスクロールする
    var MAX = 10, shown = 0;

    marks.forEach(function (m) {
      if (shown >= MAX) return;
      shown++;
      lines.appendChild(el('span', { class: 'cal-line mk ' + m.type }, [
        el('i', { style: { background: m.project.color } }),
        el('span', { class: 'nm', text: markText(m) })
      ]));
    });

    load.entries.forEach(function (e) {
      if (shown >= MAX) return;
      shown++;
      var doneAll = e.qty > 0 ? e.done >= e.qty : e.done > 0;
      var rt = sc.rangeText(e.task, e.from, e.to, { noUnit: true, sep: '-' });
      lines.appendChild(el('span', { class: 'cal-line' + (doneAll ? ' done' : '') }, [
        el('i', { style: { background: e.project.color } }),
        el('span', { class: 'nm', text: e.task.name }),
        rt ? el('b', { text: rt }) : null
      ]));
    });

    var rest = marks.length + load.entries.length - shown;
    if (rest > 0) lines.appendChild(el('span', { class: 'cal-more', text: '＋' + rest }));

    return el('a', { class: cls, href: '#/day/' + date }, [
      el('span', { class: 'cal-top' }, [
        el('span', { class: 'cal-n', text: String(+date.slice(8)) }),
        load.qty > 0 ? el('span', {
        class: 'cal-sum' + (load.done >= load.qty ? ' done' : sc.isOverloaded(date) ? ' over' : ''),
        text: String(load.qty)
      }) : null
      ]),
      lines
    ]);
  }

  /* 日常のマス。案件の締切・ノルマは出さず、その日の予定だけを載せる */
  function lifeCell(date, cursorMonth, today, list) {
    var d = U.dow(date);
    var cls = 'cal-cell';
    if (date.slice(0, 7) !== cursorMonth.slice(0, 7)) cls += ' out';
    if (date === today) cls += ' today';
    if (d === 0) cls += ' sun';
    if (d === 6) cls += ' sat';
    if (list.length) cls += ' has-plan';
    // 出社・リモート・泊まりの色は、予定があるかどうかより優先して敷く
    var duty = S.duty(date);
    if (duty) cls += ' duty-' + duty;

    var lines = el('div', { class: 'cal-lines' });
    var MAX = 10, shown = 0;
    list.forEach(function (o) {
      if (shown >= MAX) return;
      shown++;
      var note = DL.events.cellNote(o);
      lines.appendChild(el('span', { class: 'cal-line' }, [
        el('i', { style: { background: o.ev.color } }),
        el('span', { class: 'nm', text: o.ev.title }),
        note ? el('b', { text: note }) : null
      ]));
    });
    var rest = list.length - shown;
    if (rest > 0) lines.appendChild(el('span', { class: 'cal-more', text: '＋' + rest }));

    // 予定はそのまま行として並ぶので、件数の数字は付けない（ノルマと違って数える意味がない）
    return el('a', { class: cls, href: '#/day/' + date }, [
      el('span', { class: 'cal-top' }, el('span', { class: 'cal-n', text: String(+date.slice(8)) })),
      lines
    ]);
  }

  // セルは狭いので、締切は種別の言葉だけを出す（どの案件かは色の帯で示す）
  function markText(m) {
    if (m.type === 'event') return m.project.eventName || m.project.title;
    if (m.type === 'printing') return (m.label || '入稿').split('：')[0];
    return sc.deadlineShort(m.project);
  }

  /* ---------------- 日別 ---------------- */

  /* 日常には締切が無いので「12日超過」ではなく、ただの前後で言う */
  function dayRel(date, today) {
    var d = U.diffDays(today, date);
    if (d === 0) return '今日';
    if (d === 1) return '明日';
    if (d === 2) return '明後日';
    if (d === -1) return '昨日';
    return d > 0 ? 'あと' + d + '日' : Math.abs(d) + '日前';
  }

  /* 日別の見出し。休業日の印は日付の右に並べる */
  function dayTitle(date, isHoliday) {
    var head = ui.dateHead(date);
    if (isHoliday) head.appendChild(ui.chip('休業日', 'soft'));
    return head;
  }

  function renderDay(root, params) {
    var date = U.isISO(params.date) ? params.date : U.today();
    var today = U.today();
    var life = S.calMode() === 'life';
    var isHoliday = !life && (S.settings.holidays || []).indexOf(date) >= 0;
    var wrap = el('div', { class: 'page' });

    wrap.appendChild(el('div', { class: 'daynav' }, [
      el('a', { class: 'iconbtn', href: '#/day/' + U.addDays(date, -1), 'aria-label': '前の日' }, ui.icon('chevronLeft', 20)),
      el('div', { class: 'daytitle' }, [
        dayTitle(date, isHoliday),
        el('div', { class: 'today-sub', text: life ? dayRel(date, today) : U.untilLabel(date, today) })
      ]),
      el('a', { class: 'iconbtn', href: '#/day/' + U.addDays(date, 1), 'aria-label': '次の日' }, ui.icon('chevronRight', 20))
    ]));

    // 日常を見ているときは、案件の締切・ノルマ・休業日は出さない
    if (life) {
      DL.views.events.dayView(wrap, date);
      root.appendChild(wrap);
      return;
    }

    var marks = sc.dayMarks(date);
    if (marks.length) {
      var ml = el('div', { class: 'list' });
      marks.forEach(function (m) {
        ml.appendChild(el('a', { class: 'row deadline ' + (m.type === 'event' ? 'urgent' : 'soon'), href: '#/project/' + m.project.id }, [
          el('div', { class: 'row-bar', style: { background: m.project.color } }),
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              ui.icon(m.type === 'event' ? 'event' : m.type === 'printing' ? 'printer' : 'deadline', 16),
              el('span', { text: m.label })
            ]),
            el('div', { class: 'row-sub' }, [ui.kindChip(m.project), ui.catChip(m.project)])
          ]),
          el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
        ]));
      });
      wrap.appendChild(ml);
    }

    var load = sc.loadOfDay(date);
    wrap.appendChild(ui.section('この日のノルマ', load.qty ? ui.chip('合計 ' + load.done + ' / ' + load.qty, load.done >= load.qty ? 'ok' : 'soft') : null));
    if (!load.entries.length) {
      wrap.appendChild(isHoliday
        ? ui.empty('休業日')
        : ui.empty('この日に割り当てられたタスクはありません。'));
    } else {
      var list = el('div', { class: 'list' });
      load.entries.forEach(function (e) {
        var row = DL.views.home.quotaRow(e, date);
        row.appendChild(el('button', {
          class: 'iconbtn small', 'aria-label': 'この予定の操作',
          onclick: function () { entryMenu(e, date); }
        }, ui.icon('more', 18)));
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }

    /* この日に実績を足す */
    wrap.appendChild(el('div', { class: 'pad' },
      ui.btn('この日の実績を追加', 'ghost full', function () { pickTaskSheet(date); }, 'plus')
    ));

    /* 休業日設定 */
    wrap.appendChild(el('div', { class: 'pad' }, [
      ui.btn(isHoliday ? 'この日の休みを解除' : 'この日を休みにする', 'ghost full', function () {
        var before = DL.forms.planSnapshot();
        var hs = S.settings.holidays || [];
        S.updateSettings({ holidays: isHoliday ? hs.filter(function (x) { return x !== date; }) : hs.concat([date]) });
        ui.toast(isHoliday ? '休みを解除しました' : '休みに設定しました');
        if (!isHoliday) DL.forms.offerReschedule(before);
      }),
      el('p', { class: 'muted small', text: '休みにすると、その日のノルマを振り分け直します。' })
    ]));

    root.appendChild(wrap);
  }

  /* 予定1件の操作メニュー */
  function entryMenu(e, date) {
    var close = ui.sheet({
      title: e.task.name + '（' + U.fmtMD(date) + '）',
      body: el('div', { class: 'menu' }, [
        el('button', { class: 'menu-item', onclick: function () { close(); DL.forms.progressSheet(e.project.id, e.task.id, date); } },
          [ui.icon('check', 18), el('span', { text: '実績を記録する' })]),
        el('button', { class: 'menu-item', onclick: function () { close(); DL.forms.deferSheet(e.project.id, e.task.id, date); } },
          [ui.icon('arrowRight', 18), el('span', { text: 'できなかった → 翌日以降に回す' })]),
        el('button', { class: 'menu-item', onclick: function () { close(); DL.forms.planOverrideSheet(e.project.id, e.task.id, date); } },
          [ui.icon('edit', 18), el('span', { text: 'この日のノルマを調整' })]),
        el('button', { class: 'menu-item', onclick: function () { close(); DL.forms.shiftTaskSheet(e.project.id, e.task.id); } },
          [ui.icon('swap', 18), el('span', { text: 'この工程を別の日に動かす' })]),
        el('a', { class: 'menu-item', href: '#/project/' + e.project.id, onclick: function () { close(); } },
          [ui.icon('projects', 18), el('span', { text: '案件を開く' })])
      ])
    });
  }

  /* その日に実績を足すタスクを選ぶ */
  function pickTaskSheet(date) {
    var rows = [];
    S.activeProjects().forEach(function (p) {
      (p.tasks || []).forEach(function (t) {
        if (sc.taskIsComplete(t)) return;
        rows.push(el('button', {
          class: 'menu-item', onclick: function () { close(); DL.forms.progressSheet(p.id, t.id, date); }
        }, [
          el('span', { class: 'dot', style: { background: p.color } }),
          el('span', {}, [el('b', { text: t.name }), el('span', { class: 'muted small', text: '　' + p.title })])
        ]));
      });
    });
    var close = ui.sheet({
      title: U.fmtMDW(date) + ' の実績を追加',
      body: rows.length ? el('div', { class: 'menu' }, rows) : ui.empty('記録できるタスクがありません。')
    });
  }

  DL.views = DL.views || {};
  DL.views.calendar = { render: render, renderDay: renderDay, setMonth: function (m) { cursor = U.monthStart(m); } };
})(window.DL);
