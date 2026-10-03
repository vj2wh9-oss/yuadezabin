/* 出ていくお金の年表（画面）。

   上に「毎月いくら取りのけるか」と「いま取りのけてあるべき額」。
   その下に、これから24ヶ月ぶんを月ごとに束ねて並べる。
   払ったら「払った」を押す。経費にも同時に記録して、次の回へ送る。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;
  var O = DL.outgo, E = DL.expenses, D = DL.docs;

  /* 一覧を「これから」と「登録してあるもの」で切り替える */
  var tab = 'plan';

  function render(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });

    wrap.appendChild(el('div', { class: 'card' },
      ui.segmented([
        { value: 'plan', label: 'これから' },
        { value: 'all', label: '登録してあるもの' }
      ], tab, function (v) { tab = v; DL.app.render(); })));

    wrap.appendChild(ui.section('取りのけ',
      el('span', { class: 'muted small', text: '1ヶ月の予算から先に引いています' })));
    wrap.appendChild(reserveCard(today));

    if (tab === 'all') {
      wrap.appendChild(ui.section('登録してあるもの',
        el('span', { class: 'muted small', text: O.list().length + '件' })));
      wrap.appendChild(allCard(today));
    } else {
      wrap.appendChild(ui.section('もうすぐ出ていくお金',
        el('span', { class: 'muted small', text: 'これから' + SOON_DAYS + '日' })));
      wrap.appendChild(planCard(today));
    }

    wrap.appendChild(el('div', { class: 'row-wrap mt' }, [
      ui.btn('追加', 'primary', function () { editSheet(null); }, 'plus'),
      ui.btn('よく使うものから', 'ghost', function () { presetSheet(); }, 'star')
    ]));

    root.appendChild(wrap);
  }

  /* ---------------- 取りのけ ---------------- */

  function reserveCard(today) {
    var per = O.perMonth(today);
    var rv = O.reserve(today);
    var b = E.dailyBudget(today);
    var box = el('div', { class: 'card' });

    box.appendChild(el('div', { class: 'sum-grid' }, [
      sumBox('毎月の取りのけ', D.yen(per.total)),
      sumBox('いま貯まっているはず', D.yen(rv.total)),
      sumBox('ならすと年', D.yen(U.sum(O.list().filter(function (x) {
        return x.active !== false;
      }), function (x) { return O.yearly(x); })))
    ]));

    if (!per.total) {
      box.appendChild(el('p', { class: 'muted small',
        text: 'まだ年表がありません。年払いの保険や税金を入れておくと、'
          + 'その月にいきなり足りなくなることがなくなります。' }));
      return box;
    }

    if (b) {
      box.appendChild(el('p', { class: 'muted small',
        text: '1ヶ月の予算 ' + D.yen(b.month) + ' から、固定費 ' + D.yen(b.fixed)
          + ' と取りのけ ' + D.yen(per.total) + ' を先に引いて、'
          + '残り ' + D.yen(b.budget) + ' を日割りにしています。' }));
      if (b.noRoom) {
        box.appendChild(el('div', { class: 'alert danger' }, [
          el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
          el('span', { text: '固定費と取りのけだけで、1ヶ月の予算を超えています。'
            + '予算を見直すか、取りのけを外してください。' })
        ]));
      }
    }

    // 何にいくら取りのけているか
    var rows = el('div', { class: 'list tight' });
    per.rows.forEach(function (r) {
      rows.appendChild(el('div', { class: 'row flat' }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [el('span', { text: r.x.name })]),
          el('div', { class: 'row-sub' }, [
            ui.chip(O.cycleLabel(r.x), 'ghosty'),
            ui.chip('1回 ' + D.yen(r.x.amount), 'ghosty')
          ])
        ]),
        el('b', { class: 'fx-v', text: '月 ' + D.yen(r.per) })
      ]));
    });
    box.appendChild(rows);
    return box;
  }

  function sumBox(label, value) {
    return el('div', { class: 'sum-box' }, [el('span', { text: label }), el('b', { text: value })]);
  }

  /* ---------------- これから ---------------- */

  /* 近いものを出す範囲。これより先は、月ごとの山だけ見ればいい */
  var SOON_DAYS = 60;
  /* 月の山を並べる月数 */
  var YEAR_MONTHS = 12;

  /**
   * これから。
   *
   * 毎月のものを全部並べると、年金が24行続いて何も読み取れなくなる。
   * そこで2段に分ける。近いものは1件ずつ（払えるように）、
   * その先は月ごとの山だけ（どの月が重いかが分かるように）。
   */
  function planCard(today) {
    var box = el('div', {});
    // 払い残しも一緒に出す（払えるのはここだけなので）
    var soon = O.between(U.addMonths(today, -2), U.addDays(today, SOON_DAYS), { late: true });

    if (soon.length) {
      box.appendChild(el('div', { class: 'list' }, soon.map(function (oc) {
        return occRow(oc, today);
      })));
    } else {
      box.appendChild(el('div', { class: 'card muted small' },
        el('span', { text: 'これから' + SOON_DAYS + '日のうちに出ていくものはありません。' })));
    }

    /* 月ごとの山。棒の長さで、重い月がひと目で分かる */
    var months = [];
    for (var i = 0; i < YEAR_MONTHS; i++) {
      var ym = U.addMonths(U.monthStart(today), i).slice(0, 7);
      var rows = O.ofMonth(ym, { includePaid: true });
      months.push({ ym: ym, rows: rows,
        sum: U.sum(rows, function (r) { return r.amount; }) });
    }
    var top = Math.max.apply(null, months.map(function (m) { return m.sum; }).concat([1]));
    if (!months.some(function (m) { return m.sum > 0; })) return box;

    box.appendChild(ui.section('月ごとの山',
      el('span', { class: 'muted small',
        text: 'これから' + YEAR_MONTHS + 'ヶ月で ' + D.yen(U.sum(months, function (m) { return m.sum; })) })));

    var list = el('div', { class: 'card og-year' });
    months.forEach(function (m) {
      var names = {};
      m.rows.forEach(function (r) { names[r.name] = (names[r.name] || 0) + 1; });
      list.appendChild(el('div', { class: 'og-bar' + (m.sum ? '' : ' zero') }, [
        el('span', { class: 'og-bar-m',
          text: U.num(m.ym.slice(5, 7), 0) + '月' }),
        el('span', { class: 'og-bar-rail' },
          el('i', { style: { width: Math.round(m.sum / top * 100) + '%' } })),
        el('b', { class: 'og-bar-v', text: m.sum ? D.yen(m.sum) : '—' }),
        el('span', { class: 'og-bar-nm',
          text: Object.keys(names).map(function (n) {
            return n + (names[n] > 1 ? '×' + names[n] : '');
          }).join('・') })
      ]));
    });
    box.appendChild(list);
    return box;
  }

  function occRow(oc, today) {
    var left = U.diffDays(today, oc.date);
    var cls = 'row og-row' + (oc.late ? ' late' : left <= O.SOON ? ' soon' : '');
    return el('div', { class: cls }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: oc.name }),
          oc.late ? ui.chip('払い残し', 'danger') : null
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(U.fmtMDW(oc.date), oc.late ? 'danger' : left <= O.SOON ? 'warn' : 'soft'),
          ui.chip(U.untilLabel(oc.date, today), 'ghosty'),
          ui.chip(E.bookLabel(oc.book), 'ghosty'),
          oc.category ? ui.chip(oc.category, 'ghosty') : null
        ])
      ]),
      el('b', { class: 'fx-v', text: D.yen(oc.amount) }),
      el('div', { class: 'og-acts' }, [
        ui.btn('払った', 'ghost tiny', function () { paySheet(oc); }, 'check'),
        ui.btn('直す', 'ghost tiny', function () { editSheet(oc.x); }, 'edit')
      ])
    ]);
  }

  /* ---------------- 登録してあるもの ---------------- */

  function allCard(today) {
    var all = O.list();
    if (!all.length) {
      return ui.empty('まだ何も登録していません。',
        ui.btn('よく使うものから', 'primary', function () { presetSheet(); }, 'star'));
    }
    var box = el('div', { class: 'list' });
    all.slice().sort(function (a, b) {
      if (!a.active !== !b.active) return a.active ? -1 : 1;
      return (O.yearly(b) - O.yearly(a)) || U.cmp(a.name, b.name);
    }).forEach(function (x) {
      var nx = O.occurrencesOf(x, today, U.addMonths(today, O.MONTHS))[0];
      box.appendChild(el('button', {
        type: 'button', class: 'row', onclick: function () { editSheet(x); }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            el('span', { text: x.name }),
            x.active === false ? ui.chip('止めている', 'ghosty') : null,
            x.saveUp === false ? ui.chip('取りのけない', 'ghosty') : null
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip(O.cycleLabel(x), 'soft'),
            nx ? ui.chip('次 ' + U.fmtMD(nx.date), 'ghosty') : null,
            ui.chip('年 ' + D.yen(O.yearly(x)), 'ghosty'),
            ui.chip(E.bookLabel(x.book), 'ghosty')
          ])
        ]),
        el('b', { class: 'fx-v', text: D.yen(x.amount) }),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
    });
    return box;
  }

  /* ---------------- 払う ---------------- */

  function paySheet(oc) {
    var amountIn = ui.input({ type: 'number', inputmode: 'numeric', value: String(oc.amount) });
    var onIn = ui.input({ type: 'date',
      value: U.cmp(oc.date, U.today()) > 0 ? U.today() : oc.date });
    var recChk = el('input', { type: 'checkbox', class: 'check', checked: true });

    var close = ui.sheet({
      title: oc.name + 'を払った',
      body: el('div', { class: 'form' }, [
        el('p', { class: 'muted small',
          text: U.fmtYMDW(oc.date) + 'に出ていくぶんです。'
            + '実際に払った額が違っていれば、直して記録できます。' }),
        ui.field('払った額（円）', amountIn),
        ui.field('払った日', onIn),
        el('label', { class: 'row-check' }, [recChk,
          el('span', { text: '経費にも記録する（' + E.bookLabel(oc.book) + '・' + oc.category + '）' })]),
        el('p', { class: 'muted small',
          text: oc.x.kind === 'cycle' ? '次は ' + U.fmtYMD(U.addMonths(oc.date, oc.x.months)) + ' になります'
            : oc.x.kind === 'once' ? 'これで終わりになります（一度きり）'
              : '同じ年の残りの回は、そのまま残ります' })
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('記録する', 'primary', function () {
          var amount = Math.max(0, Math.round(U.num(amountIn.value, oc.amount)));
          if (recChk.checked) {
            O.pay(oc.id, oc.date, { amount: amount, on: onIn.value });
          } else {
            O.markPaid(oc.id, oc.date, { amount: amount });
          }
          close();
          ui.toast('記録しました');
          DL.app.render();
        })
      ]
    });
  }

  /* ---------------- 登録・編集 ---------------- */

  function editSheet(x, seed) {
    var isNew = !x;
    var v = x || Object.assign({
      name: '', amount: 0, book: 'life', category: 'その他', vendor: '',
      kind: 'cycle', months: 12, next: '', dates: [], saveUp: true, active: true
    }, seed || {});

    var kind = v.kind;
    var nameIn = ui.input({ value: v.name === '(名称未設定)' ? '' : (v.name || '') });
    var amountIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: v.amount ? String(v.amount) : '' });
    var vendorIn = ui.input({ value: v.vendor || '' });
    var nextIn = ui.input({ type: 'date', value: v.next || '' });
    var saveChk = el('input', { type: 'checkbox', class: 'check', checked: v.saveUp !== false });
    var activeChk = el('input', { type: 'checkbox', class: 'check', checked: v.active !== false });

    var book = v.book || 'life';
    var cats = E.categories(book);
    var catOpts = cats.slice();
    if (v.category && catOpts.indexOf(v.category) < 0) catOpts.unshift(v.category);
    var catSel = ui.select(catOpts.map(function (c) { return { value: c, label: c }; }),
      v.category || cats[0]);

    var monthsSel = ui.select(O.CYCLES.map(function (c) {
      return { value: String(c.months), label: c.label };
    }), String(v.months || 12));

    /* 年の決まった日。'MM-DD' を並べて持つ */
    var dates = (v.dates || []).slice();
    var datesBox = el('div', { class: 'row-wrap' });
    function drawDates() {
      U.clear(datesBox);
      dates.sort().forEach(function (md, i) {
        datesBox.appendChild(el('button', {
          type: 'button', class: 'chip soft', onclick: function () {
            dates.splice(i, 1); drawDates();
          }
        }, [el('span', { text: U.num(md.slice(0, 2), 0) + '/' + U.num(md.slice(3, 5), 0) }),
          ui.icon('close', 12)]));
      });
      if (!dates.length) {
        datesBox.appendChild(el('span', { class: 'muted small', text: 'まだありません' }));
      }
      datesBox.appendChild(ui.btn('日を足す', 'ghost tiny', function () {
        var pick = ui.input({ type: 'date', value: U.today() });
        var c2 = ui.sheet({
          title: '出ていく日を足す',
          body: el('div', { class: 'form' }, [
            ui.field('日付（年は見ません。月と日だけ使います）', pick)
          ]),
          actions: [
            ui.btn('キャンセル', 'ghost', function () { c2(); }),
            ui.btn('足す', 'primary', function () {
              if (U.isISO(pick.value)) {
                var md = pick.value.slice(5);
                if (dates.indexOf(md) < 0) dates.push(md);
                drawDates();
              }
              c2();
            })
          ]
        });
      }, 'plus'));
    }
    drawDates();

    var cycleRow = ui.field('どれくらいごと', monthsSel);
    var nextRow = ui.field('次に出ていく日', nextIn);
    var datesRow = ui.block('出ていく日（年に何回か）', datesBox,
      '住民税の4期のように、間が等しくないものはこちら');

    function drawKind() {
      cycleRow.hidden = kind !== 'cycle';
      nextRow.hidden = kind === 'dates';
      datesRow.hidden = kind !== 'dates';
      nextRow.querySelector('.field-label').textContent =
        kind === 'once' ? '出ていく日' : '次に出ていく日';
    }

    var kindSeg = ui.segmented([
      { value: 'cycle', label: '何ヶ月ごと' },
      { value: 'dates', label: '年の決まった日' },
      { value: 'once', label: '一度きり' }
    ], kind, function (val) { kind = val; drawKind(); });

    var bookSeg = ui.segmented(E.BOOKS, book, function (val) {
      book = val;
      var next = E.categories(book);
      U.clear(catSel);
      next.forEach(function (c) {
        catSel.appendChild(el('option', { value: c, text: c }));
      });
      catSel.value = next.indexOf(v.category) >= 0 ? v.category : next[0];
    });

    var close = ui.sheet({
      title: isNew ? '出ていくお金を登録' : '出ていくお金を編集',
      body: el('div', { class: 'form' }, [
        ui.field('名前', nameIn),
        ui.field('1回いくら（円）', amountIn),
        ui.block('どの帳簿', bookSeg),
        ui.field('科目', catSel),
        ui.field('支払先', vendorIn),
        ui.block('出かた', kindSeg),
        cycleRow, nextRow, datesRow,
        el('label', { class: 'row-check' }, [saveChk,
          el('span', { text: '毎月すこしずつ取りのける（1日の予算から先に引く）' })]),
        el('label', { class: 'row-check' }, [activeChk, el('span', { text: '年表に出す' })]),
        !isNew ? ui.btn('これを削除', 'danger full mt', function () {
          ui.confirm('「' + x.name + '」を年表から削除します。記録済みの経費はそのまま残ります。',
            { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeOutgo(x.id); close(); ui.toast('削除しました'); DL.app.render();
          });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var name = nameIn.value.trim();
          if (!name) { ui.toast('名前を入れてください', 'warn'); return; }
          if (!U.num(amountIn.value, 0)) { ui.toast('金額を入れてください', 'warn'); return; }
          if (kind !== 'dates' && !U.isISO(nextIn.value)) {
            ui.toast('出ていく日を入れてください', 'warn'); return;
          }
          if (kind === 'dates' && !dates.length) {
            ui.toast('出ていく日を1つ以上入れてください', 'warn'); return;
          }
          var data = {
            name: name, amount: U.num(amountIn.value, 0), book: book,
            category: catSel.value, vendor: vendorIn.value.trim(),
            kind: kind, months: U.num(monthsSel.value, 12),
            next: kind === 'dates' ? '' : nextIn.value, dates: dates,
            saveUp: saveChk.checked, active: activeChk.checked
          };
          if (isNew) S.addOutgo(data); else S.updateOutgo(x.id, data);
          close();
          ui.toast(isNew ? '登録しました' : '保存しました');
          DL.app.render();
        })
      ]
    });
    drawKind();
  }

  /* ---------------- よく使うもの ---------------- */

  function presetSheet() {
    var box = el('div', { class: 'list' });
    O.PRESETS.forEach(function (p) {
      box.appendChild(el('button', {
        type: 'button', class: 'row', onclick: function () {
          close();
          editSheet(null, Object.assign({}, p, {
            next: p.kind === 'dates' ? '' : U.addMonths(U.today(), 1)
          }));
        }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [el('span', { text: p.name })]),
          el('div', { class: 'row-sub' }, [
            ui.chip(O.cycleLabel(p), 'soft'),
            ui.chip(E.bookLabel(p.book), 'ghosty'),
            ui.chip(p.category, 'ghosty')
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
    });
    var close = ui.sheet({
      title: 'よく使うものから',
      body: el('div', {}, [
        el('p', { class: 'muted small pad',
          text: '金額と日付は、このあとの画面で入れてください。' }),
        box
      ])
    });
  }

  /* ---------------- ほかの画面から使うもの ---------------- */

  /** 経理の画面に出す、入口のカード */
  function entryCard() {
    var today = U.today();
    var per = O.perMonth(today);
    var next = O.upcoming(today, 3);
    if (!O.list().length) {
      return el('button', {
        type: 'button', class: 'row', onclick: function () { location.hash = '#/outgo'; }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            ui.icon('calendar', 17),
            el('span', { text: '出ていくお金の年表' })
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip('年払い・税・更新をここに', 'ghosty')
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]);
    }
    var box = el('div', { class: 'card' });
    box.appendChild(el('div', { class: 'list tight' }, next.map(function (oc) {
      var left = U.diffDays(today, oc.date);
      return el('div', { class: 'row flat' }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [el('span', { text: oc.name })]),
          el('div', { class: 'row-sub' }, [
            ui.chip(U.fmtMD(oc.date), oc.late ? 'danger' : left <= O.SOON ? 'warn' : 'soft'),
            ui.chip(U.untilLabel(oc.date, today), 'ghosty')
          ])
        ]),
        el('b', { class: 'fx-v', text: D.yen(oc.amount) })
      ]);
    })));
    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('年表を見る', 'ghost', function () { location.hash = '#/outgo'; }, 'calendar'),
      el('span', { class: 'muted small', text: '毎月の取りのけ ' + D.yen(per.total) })
    ]));
    return box;
  }

  DL.views = DL.views || {};
  DL.views.outgo = { render: render, entryCard: entryCard, editSheet: editSheet };
})(window.DL);
