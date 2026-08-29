/* カレンダー（月表示）と日別表示 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  var cursor = null; // 表示中の月（その月の1日）

  function render(root, params) {
    var today = U.today();
    if (params && U.isISO(params.month)) cursor = U.monthStart(params.month);
    if (!cursor) cursor = U.monthStart(today);

    var wrap = el('div', { class: 'page' });

    /* 月ナビ */
    wrap.appendChild(el('div', { class: 'monthnav' }, [
      el('button', { class: 'iconbtn', text: '‹', 'aria-label': '前の月', onclick: function () { cursor = U.addMonths(cursor, -1); DL.app.render(); } }),
      el('div', { class: 'monthlabel', text: cursor.slice(0, 4) + '年' + (+cursor.slice(5, 7)) + '月' }),
      el('button', { class: 'iconbtn', text: '›', 'aria-label': '次の月', onclick: function () { cursor = U.addMonths(cursor, 1); DL.app.render(); } }),
      el('button', { class: 'btn tiny ghost', text: '今日', onclick: function () { cursor = U.monthStart(today); DL.app.render(); } })
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
    var first = cursor, last = U.monthEnd(cursor);
    var lead = (U.dow(first) - ws + 7) % 7;
    var gridStart = U.addDays(first, -lead);
    var totalCells = Math.ceil((lead + U.diffDays(first, last) + 1) / 7) * 7;
    var grid = el('div', { class: 'cal-grid' });

    for (var c = 0; c < totalCells; c++) {
      grid.appendChild(cell(U.addDays(gridStart, c), cursor, today));
    }
    wrap.appendChild(grid);

    /* 凡例 */
    wrap.appendChild(el('div', { class: 'legend' }, [
      el('span', {}, [el('i', { class: 'lg ev' }), 'イベント']),
      el('span', {}, [el('i', { class: 'lg dl' }), '締切/入稿']),
      el('span', {}, [el('i', { class: 'lg tk' }), 'ノルマ'])
    ]));

    /* 今月の締切一覧 */
    var items = sc.timeline(first, U.diffDays(first, last));
    wrap.appendChild(ui.section('この月の締切・イベント'));
    if (!items.length) wrap.appendChild(ui.empty('この月に締切はありません。'));
    else {
      var list = el('div', { class: 'list' });
      items.forEach(function (it) { list.appendChild(DL.views.home.deadlineRow(it, today)); });
      wrap.appendChild(list);
    }

    root.appendChild(wrap);
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

    var dots = el('div', { class: 'dots' });
    marks.slice(0, 4).forEach(function (m) {
      dots.appendChild(el('i', {
        class: 'dot ' + (m.type === 'event' ? 'ev' : 'dl'),
        style: { background: m.type === 'event' ? m.project.color : null }
      }));
    });

    var badge = null;
    if (load.qty > 0) {
      var doneAll = load.done >= load.qty;
      badge = el('span', { class: 'cal-q' + (doneAll ? ' done' : ''), text: String(load.qty) });
    } else if (load.entries.length) {
      badge = el('span', { class: 'cal-q soft', text: '・' });
    }

    // その日のメイン締切を小さく表示
    var label = marks.length ? el('span', { class: 'cal-mark ' + marks[0].type, text: shortLabel(marks[0]) }) : null;

    return el('a', { class: cls, href: '#/day/' + date }, [
      el('span', { class: 'cal-n', text: String(+date.slice(8)) }),
      badge, label, dots
    ]);
  }

  function shortLabel(m) {
    if (m.type === 'event') return '🎪' + (m.project.eventName || m.project.title).slice(0, 5);
    if (m.type === 'printing') return '🖨' + (m.project.title).slice(0, 5);
    return '⏰' + m.project.title.slice(0, 5);
  }

  /* ---------------- 日別 ---------------- */

  function renderDay(root, params) {
    var date = U.isISO(params.date) ? params.date : U.today();
    var today = U.today();
    var wrap = el('div', { class: 'page' });

    wrap.appendChild(el('div', { class: 'daynav' }, [
      el('a', { class: 'iconbtn', text: '‹', href: '#/day/' + U.addDays(date, -1), 'aria-label': '前の日' }),
      el('div', { class: 'daytitle' }, [
        el('div', { class: 'today-date', text: U.fmtYMDW(date) }),
        el('div', { class: 'today-sub', text: U.untilLabel(date, today) })
      ]),
      el('a', { class: 'iconbtn', text: '›', href: '#/day/' + U.addDays(date, 1), 'aria-label': '次の日' })
    ]));

    var marks = sc.dayMarks(date);
    if (marks.length) {
      var ml = el('div', { class: 'list' });
      marks.forEach(function (m) {
        ml.appendChild(el('a', { class: 'row deadline ' + (m.type === 'event' ? 'urgent' : 'soon'), href: '#/project/' + m.project.id }, [
          el('div', { class: 'row-bar', style: { background: m.project.color } }),
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title', text: (m.type === 'event' ? '🎪 ' : m.type === 'printing' ? '🖨 ' : '⏰ ') + m.label }),
            el('div', { class: 'row-sub' }, [ui.kindChip(m.project), ui.catChip(m.project)])
          ]),
          el('span', { class: 'chev', text: '›' })
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
          class: 'iconbtn small', text: '⋯', 'aria-label': 'ノルマ調整',
          onclick: function () { DL.forms.planOverrideSheet(e.project.id, e.task.id, date); }
        }));
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
