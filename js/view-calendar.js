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

    var first = cursor, last = U.monthEnd(cursor);
    var monthTitle = cursor.slice(0, 4) + '年' + (+cursor.slice(5, 7)) + '月';
    var wrap = el('div', { class: 'page cal-page' });

    /* 月ナビ（月名をタップするとその月の締切一覧） */
    wrap.appendChild(el('div', { class: 'monthnav' }, [
      el('button', { class: 'iconbtn', 'aria-label': '前の月', onclick: function () { goMonth(-1); } }, ui.icon('chevronLeft', 20)),
      el('button', {
        class: 'monthlabel', 'aria-label': monthTitle + 'の締切一覧',
        onclick: function () { monthSheet(first, last, monthTitle, today); }
      }, [
        el('span', { text: monthTitle }),
        ui.icon('chevronDown', 15)
      ]),
      el('button', { class: 'iconbtn', 'aria-label': '次の月', onclick: function () { goMonth(1); } }, ui.icon('chevronRight', 20)),
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

    for (var c = 0; c < rows * 7; c++) {
      grid.appendChild(cell(U.addDays(gridStart, c), cursor, today));
    }
    wrap.appendChild(grid);

    attachSwipe(wrap);
    root.appendChild(wrap);
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

  /* 月名タップで開く、その月の締切・イベント一覧 */
  function monthSheet(first, last, title, today) {
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

    var cls = 'cal-cell';
    if (!inMonth) cls += ' out';
    if (date === today) cls += ' today';
    if (d === 0) cls += ' sun';
    if (d === 6) cls += ' sat';
    if (isOff) cls += ' off';

    /* その日の中身を数行だけ載せる（締切・イベントを優先） */
    var lines = el('div', { class: 'cal-lines' });
    var MAX = 4, shown = 0;

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
      lines.appendChild(el('span', { class: 'cal-line' + (doneAll ? ' done' : '') }, [
        el('i', { style: { background: e.project.color } }),
        el('span', { class: 'nm', text: e.task.name }),
        e.qty ? el('b', { text: String(e.qty) }) : null
      ]));
    });

    var rest = marks.length + load.entries.length - shown;
    if (rest > 0) lines.appendChild(el('span', { class: 'cal-more', text: '＋' + rest }));

    return el('a', { class: cls, href: '#/day/' + date }, [
      el('span', { class: 'cal-top' }, [
        el('span', { class: 'cal-n', text: String(+date.slice(8)) }),
        load.qty > 0 ? el('span', { class: 'cal-sum' + (load.done >= load.qty ? ' done' : ''), text: String(load.qty) }) : null
      ]),
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

  function renderDay(root, params) {
    var date = U.isISO(params.date) ? params.date : U.today();
    var today = U.today();
    var wrap = el('div', { class: 'page' });

    wrap.appendChild(el('div', { class: 'daynav' }, [
      el('a', { class: 'iconbtn', href: '#/day/' + U.addDays(date, -1), 'aria-label': '前の日' }, ui.icon('chevronLeft', 20)),
      el('div', { class: 'daytitle' }, [
        el('div', { class: 'today-date', text: U.fmtYMDW(date) }),
        el('div', { class: 'today-sub', text: U.untilLabel(date, today) })
      ]),
      el('a', { class: 'iconbtn', href: '#/day/' + U.addDays(date, 1), 'aria-label': '次の日' }, ui.icon('chevronRight', 20))
    ]));

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
      wrap.appendChild(ui.empty('この日に割り当てられたタスクはありません。'));
    } else {
      var list = el('div', { class: 'list' });
      load.entries.forEach(function (e) {
        var row = DL.views.home.quotaRow(e, date);
        row.appendChild(el('button', {
          class: 'iconbtn small', 'aria-label': 'ノルマ調整',
          onclick: function () { DL.forms.planOverrideSheet(e.project.id, e.task.id, date); }
        }, ui.icon('more', 18)));
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }

    /* 休業日設定 */
    var isHoliday = (S.settings.holidays || []).indexOf(date) >= 0;
    wrap.appendChild(el('div', { class: 'pad' }, [
      ui.btn(isHoliday ? 'この日の休みを解除' : 'この日を休みにする', 'ghost full', function () {
        var hs = S.settings.holidays || [];
        S.updateSettings({ holidays: isHoliday ? hs.filter(function (x) { return x !== date; }) : hs.concat([date]) });
        ui.toast(isHoliday ? '休みを解除しました' : '休みに設定し、ノルマを再配分しました');
      }),
      el('p', { class: 'muted small', text: '休みにすると、その日のノルマは他の稼働日へ自動で振り分けられます。' })
    ]));

    root.appendChild(wrap);
  }

  DL.views = DL.views || {};
  DL.views.calendar = { render: render, renderDay: renderDay, setMonth: function (m) { cursor = U.monthStart(m); } };
})(window.DL);
