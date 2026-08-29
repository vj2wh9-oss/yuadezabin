/* 売上：案件をまたいで請求書・領収書を集計する */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, D = DL.docs, el = U.el;

  var year = 0;          // 表示中の年（0 なら今年）

  function currentYear() { return year || U.num(U.today().slice(0, 4), 2026); }

  function render(root) {
    var y = currentYear();
    var wrap = el('div', { class: 'page' });

    /* ---- 年の切り替え ---- */
    wrap.appendChild(el('div', { class: 'year-nav' }, [
      el('button', { class: 'iconbtn', 'aria-label': '前の年', onclick: function () { year = y - 1; DL.app.render(); } }, ui.icon('chevronLeft', 20)),
      el('button', {
        class: 'year-label', text: y + '年',
        onclick: function () { year = U.num(U.today().slice(0, 4), y); DL.app.render(); }
      }),
      el('button', { class: 'iconbtn', 'aria-label': '次の年', onclick: function () { year = y + 1; DL.app.render(); } }, ui.icon('chevronRight', 20))
    ]));

    /* ---- 屋号の絞り込み（アプリ全体の切り替えと同じもの） ---- */
    var issuers = S.issuers();
    var active = S.scopeId();
    if (issuers.length > 1) {
      var opts = [{ value: '', label: 'すべて' }].concat(issuers.map(function (x) {
        return { value: x.id, label: x.name || '(名称未設定)' };
      }));
      wrap.appendChild(el('div', { class: 'card' },
        ui.field('屋号', ui.segmented(opts, active, function (v) { S.setScope(v); }),
          'ホーム・カレンダー・案件一覧の表示も、選んだ屋号に合わせて切り替わります')
      ));
    }

    /* ---- 対象の書類 ---- */
    var all = S.allDocs().filter(function (e) {
      if (String(e.doc.issueDate).slice(0, 4) !== String(y)) return false;
      if (active && (e.doc.issuerId || '') !== active) return false;
      return true;
    });

    var totals = D.sales(all);

    /* ---- 年間の集計 ---- */
    wrap.appendChild(ui.section(y + '年の合計', el('span', { class: 'muted small', text: totals.count + '件' })));
    wrap.appendChild(el('div', { class: 'card sum-grid' }, [
      sumBox('売上（税込）', D.yen(totals.total), 'big'),
      sumBox('うち消費税', D.yen(totals.tax)),
      sumBox('税抜（小計）', D.yen(totals.subtotal)),
      sumBox('源泉徴収', totals.withholding ? '-' + D.yen(totals.withholding) : '—'),
      sumBox('入金済み', D.yen(totals.paid), 'ok'),
      sumBox('未入金', D.yen(totals.unpaid), totals.unpaid ? 'warn' : '')
    ]));

    if (totals.draftCount) {
      wrap.appendChild(el('div', { class: 'alert info' }, [
        el('span', { class: 'alert-icon' }, ui.icon('info', 17)),
        el('span', { text: '下書きの書類が ' + totals.draftCount + '件（' + D.yen(totals.draft) + '）あります。発行済みにすると売上に入ります。' })
      ]));
    }

    /* ---- 月別 ---- */
    wrap.appendChild(ui.section('月別'));
    wrap.appendChild(monthTable(all, y));

    /* ---- 書類の一覧 ---- */
    wrap.appendChild(ui.section('書類', el('span', { class: 'muted small', text: all.length + '件' })));
    if (!all.length) {
      wrap.appendChild(ui.empty(y + '年の書類はまだありません。'));
    } else {
      var list = el('div', { class: 'list' });
      all.forEach(function (e) { list.appendChild(docRow(e)); });
      wrap.appendChild(list);
    }

    wrap.appendChild(el('p', { class: 'muted small pad', text: '請求書を売上として数えます。請求書が無い案件は領収書を数えます（二重計上を避けるため）。' }));

    root.appendChild(wrap);
  }

  function sumBox(label, value, cls) {
    return el('div', { class: 'sum-box ' + (cls || '') }, [
      el('span', { text: label }), el('b', { text: value })
    ]);
  }

  /* 月ごとの棒と金額 */
  function monthTable(entries, y) {
    var months = [];
    for (var m = 1; m <= 12; m++) {
      var mm = (m < 10 ? '0' : '') + m;
      var inMonth = entries.filter(function (e) { return e.doc.issueDate.slice(5, 7) === mm; });
      months.push({ m: m, sum: D.sales(inMonth) });
    }
    var max = Math.max.apply(null, months.map(function (x) { return x.sum.total; }).concat([1]));

    var box = el('div', { class: 'card month-sales' });
    var thisMonth = U.today().slice(0, 7);
    months.forEach(function (x) {
      var mm = (x.m < 10 ? '0' : '') + x.m;
      var key = y + '-' + mm;
      var w = Math.round(x.sum.total / max * 100);
      box.appendChild(el('div', { class: 'ms-row' + (key === thisMonth ? ' now' : '') + (x.sum.total ? '' : ' zero') }, [
        el('span', { class: 'ms-m', text: x.m + '月' }),
        el('span', { class: 'ms-bar' }, el('i', { style: { width: w + '%' } })),
        el('span', { class: 'ms-v', text: x.sum.total ? D.yen(x.sum.total) : '—' }),
        el('span', { class: 'ms-u', text: x.sum.unpaid ? '未' + D.yen(x.sum.unpaid) : '' })
      ]));
    });
    return box;
  }

  function docRow(e) {
    var p = e.project, d = e.doc;
    var c = D.calc(d);
    var issuer = S.issuers().filter(function (x) { return x.id === d.issuerId; })[0];
    var color = S.issuerColor(d.issuerId);
    return el('a', { class: 'row doc', href: '#/doc/' + p.id + '/' + d.id }, [
      color ? el('div', { class: 'row-bar', style: { background: color } }) : null,
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon(D.TYPE_ICON[d.type], 16),
          el('span', { text: d.clientName || p.title }),
          d.number ? el('span', { class: 'muted small', text: d.number }) : null
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(U.fmtYMD(d.issueDate), 'soft'),
          ui.chip(D.yen(c.payable), 'ghosty'),
          ui.chip(D.STATUS_LABEL[d.status], d.status === 'paid' ? 'ok' : d.status === 'issued' ? 'soft' : 'ghosty'),
          issuer ? ui.chip(issuer.name || '屋号', 'ghosty') : null
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* ホームに出す当月・当年のミニ集計 */
  function homeCard() {
    var t = U.today();
    var scope = S.scopeId();
    function pick(prefix) {
      return S.allDocs().filter(function (e) {
        if (String(e.doc.issueDate).indexOf(prefix) !== 0) return false;
        return !scope || (e.doc.issuerId || '') === scope;
      });
    }
    // 屋号を登録していないうちは請求書機能自体を使っていないので出さない
    if (!S.issuers().length) return null;
    var month = D.sales(pick(t.slice(0, 7)));
    var yearSum = D.sales(pick(t.slice(0, 4)));

    return el('a', { class: 'card sales-card', href: '#/sales' }, [
      el('div', { class: 'row-title' }, [
        ui.icon('sales', 16), el('span', { text: '売上' }),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]),
      el('div', { class: 'quota-row three' }, [
        el('div', { class: 'quota-box' }, [el('span', { text: '今月' }), el('b', { text: D.yen(month.total) })]),
        el('div', { class: 'quota-box' }, [el('span', { text: '今年' }), el('b', { text: D.yen(yearSum.total) })]),
        el('div', { class: 'quota-box' + (yearSum.unpaid ? ' over' : '') }, [
          el('span', { text: '未入金' }), el('b', { text: D.yen(yearSum.unpaid) })
        ])
      ])
    ]);
  }

  DL.views = DL.views || {};
  DL.views.sales = { render: render, homeCard: homeCard };
})(window.DL);
