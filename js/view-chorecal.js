/* 家事タブ。

   いちばん上に月のカレンダーを置く。マスには3つだけ出す。

     ゴミの日   色の付いた細い帯（何のゴミかが色で分かる）
     家事       その日が「次」になっている周期の家事
     献立       決まっていれば、主菜の名前

   日を押すと、その日の画面（献立を作る・家事・ゴミ）へ行く。
   下には、冷蔵庫・ゴミの日・周期表・備えの棚への入口を並べる。

   日付ごとの献立は、これまでどおり同じ持ちもの（menus）を使う。
   カレンダーが2つになっただけで、中身はひとつ。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;
  var C = DL.chores, T = DL.trash, F = DL.fridge;

  /* いま見ている月 */
  var month = '';

  function render(root, params) {
    if (U.isISO(params && params.date)) { renderDay(root, params.date); return; }

    var today = U.today();
    var wrap = el('div', { class: 'page' });

    /* ---- 今日 ---- */
    wrap.appendChild(todayCard(today));

    /* ---- 月のカレンダー ---- */
    wrap.appendChild(monthCal(today));

    /* ---- 入口 ---- */
    wrap.appendChild(ui.section('家のこと'));
    wrap.appendChild(el('div', { class: 'list' }, [
      DL.views.fridge.entry(),
      DL.views.trash.entry(),
      DL.views.chores.entry(),
      DL.views.supply.entry()
    ]));

    root.appendChild(wrap);
  }

  /* ---------------- 今日 ---------------- */

  function todayCard(today) {
    var box = el('div', { class: 'card ch-today' });
    var tr = T.ofDay(today).filter(function (t) { return !T.isDone(today, t.id); });
    var ch = C.due(today).filter(function (st) { return st.over; });
    var fw = F.watch(today, F.SOON);
    var menu = S.getMenu ? S.getMenu(today) : null;

    box.appendChild(el('div', { class: 'ch-today-h' }, [
      ui.dateHead(today),
      el('a', { class: 'btn ghost tiny', href: '#/chores/' + today }, el('span', { text: 'この日を開く' }))
    ]));

    var rows = el('div', { class: 'row-wrap' });
    if (tr.length) {
      tr.forEach(function (t) {
        rows.appendChild(el('span', { class: 'tr-pill', style: { background: t.color } },
          el('span', { text: t.name })));
      });
    }
    if (ch.length) rows.appendChild(ui.chip('遅れている家事 ' + ch.length + '件', 'warn'));
    if (fw.length) {
      rows.appendChild(ui.chip('早く食べる ' + fw.length + '件',
        fw.some(function (r) { return r.over; }) ? 'danger' : 'warn'));
    }
    if (menu && (menu.meals || []).length) {
      rows.appendChild(ui.chip('献立あり', 'ok'));
    }
    if (!rows.children.length) rows.appendChild(ui.chip('急ぐものはありません', 'ok'));
    box.appendChild(rows);
    return box;
  }

  /* ---------------- 月のカレンダー ---------------- */

  function monthCal(today) {
    if (!U.isISO(month)) month = U.monthStart(today);
    var first = U.monthStart(month);
    var box = el('div', { class: 'cc-cal' });

    box.appendChild(el('div', { class: 'monthnav' }, [
      el('button', { class: 'iconbtn', 'aria-label': '前の月',
        onclick: function () { month = U.addMonths(first, -1); DL.app.render(); }
      }, ui.icon('chevronLeft', 20)),
      el('span', { class: 'fc-title',
        text: first.slice(0, 4) + '年' + (+first.slice(5, 7)) + '月' }),
      el('button', { class: 'iconbtn', 'aria-label': '次の月',
        onclick: function () { month = U.addMonths(first, 1); DL.app.render(); }
      }, ui.icon('chevronRight', 20)),
      ui.btn('今月', 'tiny ghost', function () { month = U.monthStart(today); DL.app.render(); })
    ]));

    var weekStart = U.num(S.settings.weekStart, 0) === 1 ? 1 : 0;
    var head = el('div', { class: 'cal-head' });
    for (var i = 0; i < 7; i++) {
      var d = (weekStart + i) % 7;
      head.appendChild(el('div', {
        class: 'cal-hd' + (d === 0 ? ' sun' : d === 6 ? ' sat' : ''),
        text: U.wdName(d)
      }));
    }
    box.appendChild(head);

    var gridStart = U.addDays(first, -((U.dow(first) - weekStart + 7) % 7));
    var last = U.monthEnd(first);
    var cells = Math.ceil((U.diffDays(gridStart, last) + 1) / 7) * 7;

    var trMap = T.byDay(gridStart, U.addDays(gridStart, cells - 1));
    var chMap = C.byDay(gridStart, U.addDays(gridStart, cells - 1));

    var grid = el('div', { class: 'cc-grid' });
    for (var c = 0; c < cells; c++) {
      grid.appendChild(cell(U.addDays(gridStart, c), first, today,
        trMap[U.addDays(gridStart, c)] || [], chMap[U.addDays(gridStart, c)] || []));
    }
    box.appendChild(grid);
    return box;
  }

  function cell(date, cursor, today, trs, chs) {
    var dow = U.dow(date);
    var hol = DL.holidays.name(date);
    var cls = 'cc-cell';
    if (date.slice(0, 7) !== cursor.slice(0, 7)) cls += ' out';
    if (date === today) cls += ' today';
    if (dow === 0 || hol) cls += ' sun';
    else if (dow === 6) cls += ' sat';

    var menu = S.getMenu ? S.getMenu(date) : null;
    var main = menu && (menu.meals || []).length
      ? mainDish(menu) : '';

    return el('a', { class: cls, href: '#/chores/' + date }, [
      el('span', { class: 'cc-d', text: String(+date.slice(8)) }),
      // ゴミは色の帯で。名前はマスに入らないので、色だけで見分ける
      trs.length ? el('span', { class: 'cc-tr' }, trs.map(function (t) {
        return el('i', { style: { background: t.color }, title: t.name });
      })) : null,
      chs.length ? el('span', { class: 'cc-ch', text: chs.length === 1
        ? chs[0].name : '家事' + chs.length + '件' }) : null,
      main ? el('span', { class: 'cc-mn', text: main }) : null
    ]);
  }

  /* 献立の顔。主菜があればそれ、無ければ最初の一品 */
  function mainDish(menu) {
    var dishes = [];
    (menu.meals || []).forEach(function (m) {
      (m.dishes || []).forEach(function (d) { dishes.push(d); });
    });
    var main = dishes.filter(function (d) { return d.role === 'main'; })[0];
    var d2 = main || dishes[0];
    return d2 ? String(d2.name || '') : '';
  }

  /* ---------------- その日 ---------------- */

  function renderDay(root, date) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });

    wrap.appendChild(el('div', { class: 'daynav' }, [
      el('a', { class: 'iconbtn', href: '#/chores/' + U.addDays(date, -1),
        'aria-label': '前の日' }, ui.icon('chevronLeft', 20)),
      el('div', { class: 'daytitle' }, [
        ui.dateHead(date),
        el('div', { class: 'today-sub', text: rel(date, today) })
      ]),
      el('a', { class: 'iconbtn', href: '#/chores/' + U.addDays(date, 1),
        'aria-label': '次の日' }, ui.icon('chevronRight', 20))
    ]));

    /* ---- ゴミ ---- */
    var trs = T.ofDay(date);
    if (trs.length) {
      wrap.appendChild(ui.section('この日のゴミ'));
      wrap.appendChild(el('div', { class: 'card' },
        el('div', { class: 'list tight' }, trs.map(function (t) {
          var done = T.isDone(date, t.id);
          var row = el('label', { class: 'bd-pill' + (done ? ' on' : '') }, [
            el('input', {
              type: 'checkbox', class: 'mn-chk', checked: done,
              'aria-label': t.name + 'を出した',
              onchange: function (e) {
                T.setDone(date, t.id, e.target.checked, { noRender: true });
                row.classList.toggle('on', e.target.checked);
              }
            }),
            el('span', { class: 'dot', style: { background: t.color } }),
            el('span', { class: 'bd-pill-n', text: t.name }),
            t.memo ? el('span', { class: 'muted small', text: t.memo }) : null
          ]);
          return row;
        }))));
    }

    /* ---- 献立。日付ごとの持ちものは、これまでと同じものを使う ---- */
    var card = DL.views.home.menuCard(date);
    wrap.appendChild(ui.section('献立', DL.views.home.menuTools(date)));
    if (card) wrap.appendChild(card);
    else {
      wrap.appendChild(ui.empty('この日の献立はまだありません。',
        el('span', { class: 'muted small', text: '上の「献立」から作れます' })));
    }

    /* 冷蔵庫で早く食べたいものを、ここで思い出せるように */
    var soon = F.watch(date, F.WATCH);
    if (soon.length) {
      wrap.appendChild(ui.section('早く食べるもの',
        el('a', { class: 'btn ghost tiny', href: '#/fridge' }, el('span', { text: '冷蔵庫' }))));
      wrap.appendChild(el('div', { class: 'card' },
        el('div', { class: 'row-wrap' }, soon.slice(0, 10).map(function (r) {
          return ui.chip(r.name + '（' + U.untilLabel(r.until, date) + '）',
            r.over ? 'danger' : r.soon ? 'warn' : 'ghosty');
        }))));
    }

    /* ---- 家事 ---- */
    var chs = C.ofDay(date);
    var dueRows = date === today ? C.due(date) : [];
    wrap.appendChild(ui.section('この日の家事',
      el('a', { class: 'btn ghost tiny', href: '#/choreplan' }, el('span', { text: '周期表' }))));
    var rows = chs.length ? chs : dueRows.map(function (st) { return st.c; });
    if (!rows.length) {
      wrap.appendChild(ui.empty('この日に回ってくる家事はありません。'));
    } else {
      wrap.appendChild(el('div', { class: 'list' }, rows.map(function (c) {
        var st = C.state(c, date);
        return el('div', { class: 'row' + (st.over ? ' ch-row late' : '') }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [el('span', { text: c.name })]),
            el('div', { class: 'row-sub' }, [
              ui.chip(C.everyLabel(c.every), 'soft'),
              c.place ? ui.chip(c.place, 'ghosty') : null,
              c.lastAt ? ui.chip('最後 ' + U.fmtMD(c.lastAt), 'ghosty') : null
            ])
          ]),
          el('button', {
            class: 'checkbtn', 'aria-label': c.name + 'をやった',
            onclick: function () {
              C.done(c.id, date);
              ui.toast('「' + c.name + '」をやりました');
            }
          }, ui.icon('check', 17))
        ]);
      })));
    }

    root.appendChild(wrap);
  }

  function rel(date, today) {
    var d = U.diffDays(today, date);
    if (d === 0) return '今日';
    if (d === 1) return '明日';
    if (d === -1) return '昨日';
    return d > 0 ? 'あと' + d + '日' : Math.abs(d) + '日前';
  }

  DL.views = DL.views || {};
  DL.views.chorecal = { render: render, renderDay: renderDay };
})(window.DL);
