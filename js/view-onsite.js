/* イベント当日モード：大きなボタンで会計して、その場で頒布を記録する */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, D = DL.docs, K = DL.stock, el = U.el;

  var tray = {};        // itemId → いま会計に入れている数
  var trayFor = '';     // そのトレイがどのイベントのものか
  var paid = 0;         // お預かり（0＝まだ受け取っていない）
  var lock = null;      // 画面を消さないための保持
  var PAY = [1000, 2000, 5000, 10000];

  /* ---------------- 画面 ---------------- */

  function render(root, params) {
    var p = params.id ? S.getProject(params.id) : null;
    if (!p || p.kind !== 'event') { pick(root); return; }
    if (trayFor !== p.id) { tray = {}; paid = 0; trayFor = p.id; }
    keepAwake();

    var wrap = el('div', { class: 'page onsite-page' });
    wrap.appendChild(head(p));

    var list = S.items().slice().sort(function (a, b) {
      // このイベントに結びつけた頒布物を先に出す
      return (b.projectId === p.id) - (a.projectId === p.id);
    });
    if (!list.length) {
      wrap.appendChild(ui.empty(
        'まだ頒布物がありません。',
        ui.btn('頒布物を登録する', 'primary', function () { DL.views.stock.addItem(); }, 'plus')
      ));
      root.appendChild(wrap);
      return;
    }

    wrap.appendChild(ui.section('押すと会計に入ります'));
    var grid = el('div', { class: 'onsite-grid' });
    list.forEach(function (x) { grid.appendChild(tile(x)); });
    wrap.appendChild(grid);

    var last = lastSale(p);
    wrap.appendChild(el('div', { class: 'row-wrap' }, [
      last ? ui.btn('1つ戻す（' + D.yen(saleTotal(last)) + '）', 'ghost', function () { undo(p, last); }, 'refresh') : null,
      ui.btn('頒布と在庫', 'ghost', function () { location.hash = '#/stock'; }, 'books')
    ]));

    if (total() > 0) wrap.appendChild(el('div', { class: 'onsite-spacer' }));
    root.appendChild(wrap);
    if (total() > 0) root.appendChild(bar(p));
  }

  /* イベントを選んでいないとき */
  function pick(root) {
    var wrap = el('div', { class: 'page' });
    var list = events();
    if (!list.length) {
      wrap.appendChild(ui.empty(
        '即売会の案件がありません。先に案件を作ってください。',
        ui.btn('案件を作る', 'primary', function () { DL.forms.projectForm(); }, 'plus')
      ));
      root.appendChild(wrap);
      return;
    }
    wrap.appendChild(ui.section('どのイベントですか'));
    var box = el('div', { class: 'list' });
    list.forEach(function (p) {
      box.appendChild(el('a', { class: 'row', href: '#/onsite/' + p.id }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            el('span', { class: 'dot', style: { background: p.color } }),
            el('span', { text: p.eventName || p.title })
          ]),
          el('div', { class: 'row-sub' }, [
            U.isISO(p.eventDate) ? ui.chip(U.fmtMDW(p.eventDate), 'soft') : null,
            U.isISO(p.eventDate) ? ui.chip(U.untilLabel(p.eventDate, U.today()), 'ghosty') : null,
            p.space ? ui.chip(p.space, 'ghosty') : null
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
    });
    wrap.appendChild(box);
    root.appendChild(wrap);
  }

  /* 開催日の近い順（今日・これからを先に） */
  function events() {
    var today = U.today();
    return S.projects().filter(function (p) { return p.kind === 'event' && p.status !== 'archived'; })
      .sort(function (a, b) {
        var da = a.eventDate || '', db = b.eventDate || '';
        var fa = da && U.cmp(da, today) >= 0, fb = db && U.cmp(db, today) >= 0;
        if (fa !== fb) return fa ? -1 : 1;
        return fa ? U.cmp(da, db) : U.cmp(db, da);
      });
  }

  /* ---------------- 上のまとめ ---------------- */

  function head(p) {
    var s = K.eventSummary(p.id);
    var cash = U.num(p.eventCash.float, 0) + s.revenue;
    var closed = U.isISO(String(p.eventCash.closedAt || '').slice(0, 10));
    var diff = U.num(p.eventCash.counted, 0) - cash;

    return el('div', { class: 'card onsite-head' }, [
      el('div', { class: 'row-title' }, [
        el('span', { class: 'dot', style: { background: p.color } }),
        el('span', { text: p.eventName || p.title })
      ]),
      el('div', { class: 'row-sub' }, [
        U.isISO(p.eventDate) ? ui.chip(U.fmtMDW(p.eventDate), 'soft') : null,
        p.space ? ui.chip(p.space, 'ghosty') : null,
        p.venue ? ui.chip(p.venue, 'ghosty') : null
      ]),
      el('div', { class: 'sum-grid' }, [
        box('頒布', s.sold + '部', 'big'),
        box('売上', D.yen(s.revenue), 'ok'),
        box('手元の現金', D.yen(cash))
      ]),
      closed ? el('div', { class: 'alert ' + (diff === 0 ? 'ok' : 'warn') }, [
        el('span', { class: 'alert-icon' }, ui.icon(diff === 0 ? 'check' : 'alert', 17)),
        el('span', { text: diff === 0 ? '締めました。数えた額と合っています。'
          : '締めました。数えた額との差 ' + (diff > 0 ? '+' : '-') + D.yen(Math.abs(diff)) })
      ]) : null,
      el('div', { class: 'row-wrap' }, [
        ui.btn('釣銭 ' + D.yen(U.num(p.eventCash.float, 0)), 'ghost', function () { floatSheet(p); }, 'sales'),
        ui.btn(closed ? '締め直す' : 'レジを締める', 'ghost', function () { closeSheet(p); }, 'check')
      ])
    ]);
  }

  function box(label, value, cls) {
    return el('div', { class: 'sum-box ' + (cls || '') }, [
      el('span', { text: label }), el('b', { text: value })
    ]);
  }

  /* ---------------- 頒布物のボタン ---------------- */

  function tile(x) {
    var left = K.summary(x).left;
    var n = U.num(tray[x.id], 0);
    return el('button', {
      class: 'onsite-tile' + (left <= 0 ? ' out' : '') + (n ? ' on' : ''),
      onclick: function () { add(x, left); }
    }, [
      n ? el('span', { class: 'onsite-badge', text: String(n) }) : null,
      el('b', { class: 'onsite-name', text: x.title }),
      el('span', { class: 'onsite-price', text: D.yen(x.price) }),
      el('span', { class: 'onsite-left' + (left <= 0 ? ' none' : ''), text: '残 ' + left })
    ]);
  }

  function add(x, left) {
    var n = U.num(tray[x.id], 0) + 1;
    tray[x.id] = n;
    paid = 0;
    if (n > left) ui.toast(x.title + ' は残 ' + Math.max(0, left) + '部です', 'warn');
    DL.app.render();
  }

  /* ---------------- 下の会計バー ---------------- */

  function bar(p) {
    var sum = total();
    var change = paid ? paid - sum : 0;

    var lines = el('div', { class: 'onsite-lines' });
    Object.keys(tray).forEach(function (id) {
      var n = U.num(tray[id], 0);
      if (n <= 0) return;
      var x = S.getItem(id);
      if (!x) { delete tray[id]; return; }
      lines.appendChild(el('div', { class: 'onsite-line' }, [
        el('span', { class: 'onsite-line-name', text: x.title }),
        el('button', { class: 'stepbtn', 'aria-label': '減らす', onclick: function () { bump(id, -1); } }, ui.icon('minus', 18)),
        el('b', { class: 'onsite-line-qty', text: String(n) }),
        el('button', { class: 'stepbtn', 'aria-label': '増やす', onclick: function () { bump(id, 1); } }, ui.icon('plus', 18)),
        el('span', { class: 'onsite-line-sum', text: D.yen(U.num(x.price, 0) * n) })
      ]));
    });

    var pays = el('div', { class: 'pay-row' }, [
      payBtn('ちょうど', sum)
    ].concat(PAY.map(function (v) { return payBtn(D.yen(v), v); }))
      .concat([ui.btn('その他', 'ghost tiny', function () { paySheet(sum); })]));

    return el('div', { class: 'onsite-bar' }, [
      lines,
      el('div', { class: 'onsite-total' }, [
        el('span', { class: 'muted small', text: count() + '点' }),
        el('b', { text: D.yen(sum) })
      ]),
      pays,
      paid ? el('div', { class: 'onsite-change' + (change < 0 ? ' short' : '') }, [
        el('span', { text: change < 0 ? '不足' : 'おつり' }),
        el('b', { text: D.yen(Math.abs(change)) }),
        el('span', { class: 'muted small', text: 'お預かり ' + D.yen(paid) })
      ]) : null,
      el('div', { class: 'onsite-act' }, [
        ui.btn('取り消し', 'ghost', function () { tray = {}; paid = 0; DL.app.render(); }),
        ui.btn('受け取る', 'primary', function () { commit(p); }, 'check')
      ])
    ]);
  }

  function payBtn(label, value) {
    return ui.btn(label, 'ghost tiny' + (paid === value ? ' on' : ''), function () {
      paid = value; DL.app.render();
    });
  }

  function paySheet(sum) {
    var inp = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: '', placeholder: String(sum) });
    var close = ui.sheet({
      title: 'お預かり',
      body: el('div', { class: 'form' }, [ui.field('受け取った額（円）', inp)]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('決定', 'primary', function () {
          paid = U.num(inp.value, 0); close(); DL.app.render();
        })
      ]
    });
  }

  function bump(id, n) {
    tray[id] = U.num(tray[id], 0) + n;
    if (tray[id] <= 0) delete tray[id];
    paid = 0;
    DL.app.render();
  }

  function count() {
    return Object.keys(tray).reduce(function (n, id) { return n + U.num(tray[id], 0); }, 0);
  }

  function total() {
    return Object.keys(tray).reduce(function (n, id) {
      var x = S.getItem(id);
      return n + (x ? U.num(x.price, 0) * U.num(tray[id], 0) : 0);
    }, 0);
  }

  /* ---------------- 記録する・戻す ---------------- */

  function commit(p) {
    var ids = Object.keys(tray).filter(function (id) { return U.num(tray[id], 0) > 0; });
    if (!ids.length) return;
    var sum = total();
    // 1回の会計に同じ印を付けておくと、まとめて戻せる
    var saleId = U.uid();
    var place = p.eventName || p.title;
    ids.forEach(function (id) {
      var x = S.getItem(id);
      if (!x) return;
      S.addMove({
        itemId: id, date: U.today(), kind: 'sale', qty: U.num(tray[id], 0),
        price: U.num(x.price, 0), projectId: p.id, place: place, saleId: saleId
      });
    });
    tray = {}; paid = 0;
    DL.app.render();       // 記録の描き直しはトレイを空にする前に走るので、ここでもう一度
    ui.toast('記録しました（' + D.yen(sum) + '）');
  }

  /* 直前の会計（同じ印の付いた記録をまとめて） */
  function lastSale(p) {
    var moves = S.stockMoves({ projectId: p.id, kind: 'sale' });
    if (!moves.length) return null;
    var head = moves[0];
    if (!head.saleId) return [head];
    return moves.filter(function (m) { return m.saleId === head.saleId; });
  }

  function saleTotal(moves) {
    return moves.reduce(function (n, m) { return n + K.money(m, S.getItem(m.itemId)); }, 0);
  }

  function undo(p, moves) {
    ui.confirm('直前の会計（' + D.yen(saleTotal(moves)) + '）を取り消します。', { danger: true, okText: '取り消す' })
      .then(function (ok) {
        if (!ok) return;
        moves.forEach(function (m) { S.removeMove(m.id); });
        ui.toast('取り消しました');
      });
  }

  /* ---------------- 釣銭とレジ締め ---------------- */

  function floatSheet(p) {
    var inp = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: p.eventCash.float || '', placeholder: '20000' });
    var close = ui.sheet({
      title: '釣銭の準備金',
      body: el('div', { class: 'form' }, [
        ui.field('はじめに用意した現金（円）', inp, '手元の現金は、これに頒布の売上を足して数えます')
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.updateProject(p.id, { eventCash: Object.assign({}, p.eventCash, { float: U.num(inp.value, 0) }) });
          close(); ui.toast('保存しました');
        })
      ]
    });
  }

  function closeSheet(p) {
    var s = K.eventSummary(p.id);
    var expect = U.num(p.eventCash.float, 0) + s.revenue;
    var inp = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: p.eventCash.counted || '', placeholder: String(expect) });
    var out = el('p', { class: 'muted small' });

    function refresh() {
      var v = U.num(inp.value, 0);
      if (!v) { out.textContent = '数えた額を入れると、差額を出します。'; return; }
      var d = v - expect;
      out.textContent = d === 0 ? '合っています。' : (d > 0 ? '多い' : '少ない') + ' ' + D.yen(Math.abs(d));
    }
    inp.addEventListener('input', refresh);
    refresh();

    var close = ui.sheet({
      title: 'レジを締める',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'sum-grid' }, [
          box('釣銭', D.yen(U.num(p.eventCash.float, 0))),
          box('頒布の売上', D.yen(s.revenue)),
          box('あるはずの現金', D.yen(expect), 'big')
        ]),
        ui.field('実際に数えた額（円）', inp),
        out
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('締める', 'primary', function () {
          S.updateProject(p.id, { eventCash: Object.assign({}, p.eventCash, {
            counted: U.num(inp.value, 0), closedAt: new Date().toISOString()
          }) });
          close(); ui.toast('締めました');
        })
      ]
    });
  }

  /* ---------------- 画面を消さない ---------------- */

  function keepAwake() {
    if (lock || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) {
      lock = l;
      l.addEventListener('release', function () { lock = null; });
    }).catch(function () { /* 使えない端末では普通に消える */ });
  }

  function left() {
    if (!lock) return;
    try { lock.release(); } catch (e) { /* すでに外れている */ }
    lock = null;
  }

  // 別のアプリに移って戻ってきたときは、取り直さないと効かない
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (DL.app && DL.app.route && DL.app.route.name === 'onsite') keepAwake();
  });

  DL.views = DL.views || {};
  DL.views.onsite = { render: render, left: left, events: events };
})(window.DL);
