/* 備えの棚（画面）。

   上から、買うもの → 期限 → 備蓄 → 消耗品。
   「買うもの」を上に置いてあるのは、ここだけ見れば用が足りるようにするため。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;
  var P = DL.supply, D = DL.docs;

  function render(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });
    var all = P.list();

    if (!all.length) {
      wrap.appendChild(ui.section('備えの棚'));
      wrap.appendChild(el('div', { class: 'card' }, [
        el('p', { text: '非常食・水・電池のような「期限のある備え」と、'
          + 'インク・コンタクト・フィルターのような「減っていく消耗品」を'
          + 'ここにまとめます。' }),
        el('p', { class: 'muted small',
          text: '買うときが来たら、ホームの買い物リストへ自分から積みます。' }),
        el('div', { class: 'row-wrap' }, [
          ui.btn('よく使うものから', 'primary', function () { presetSheet(); }, 'star'),
          ui.btn('自分で足す', 'ghost', function () { editSheet(null); }, 'plus')
        ])
      ]));
      root.appendChild(wrap);
      return;
    }

    /* ---- 買うもの ---- */
    var due = P.dueBuy(today);
    wrap.appendChild(ui.section('買うもの',
      due.length ? ui.chip(due.length + '件', 'warn') : ui.chip('足りています', 'ok')));
    wrap.appendChild(dueCard(due, today));

    /* ---- 期限 ---- */
    var ex = P.expiring(today);
    if (ex.length) {
      wrap.appendChild(ui.section('期限',
        el('span', { class: 'muted small', text: 'これから' + P.EXPIRE_SOON + '日ぶん' })));
      wrap.appendChild(expireCard(ex, today));
    }

    /* ---- 備蓄 ---- */
    var stock = P.list('stock');
    if (stock.length) {
      wrap.appendChild(ui.section('備蓄',
        el('span', { class: 'muted small', text: '古いものから使って、買い足す' })));
      wrap.appendChild(el('div', { class: 'list' }, stock.map(function (x) {
        return stockRow(x, today);
      })));
    }

    /* ---- 消耗品 ---- */
    var use = P.list('use');
    if (use.length) {
      wrap.appendChild(ui.section('消耗品',
        el('span', { class: 'muted small', text: '使うペースから、次に買う日を読む' })));
      wrap.appendChild(el('div', { class: 'list' }, use.map(function (x) {
        return useRow(x, today);
      })));
    }

    wrap.appendChild(el('div', { class: 'row-wrap mt' }, [
      ui.btn('足す', 'primary', function () { editSheet(null); }, 'plus'),
      ui.btn('よく使うものから', 'ghost', function () { presetSheet(); }, 'star')
    ]));
    root.appendChild(wrap);
  }

  /* ---------------- 買うもの ---------------- */

  function dueCard(due, today) {
    var box = el('div', { class: 'card' });
    if (!due.length) {
      box.appendChild(el('p', { class: 'muted small',
        text: 'いま買うものはありません。' }));
      return box;
    }

    box.appendChild(el('div', { class: 'list tight' }, due.map(function (d) {
      var queued = !!d.x.queuedAt || P.inShopping(d.x.name);
      return el('div', { class: 'row flat' }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [el('span', { text: d.x.name })]),
          el('div', { class: 'row-sub' }, [
            ui.chip(d.qty + (d.x.unit || '') + ' 買う', 'warn'),
            d.why === 'short'
              ? ui.chip('目標 ' + d.x.need + (d.x.unit || '') + ' に足りない', 'ghosty')
              : ui.chip(U.isISO(d.on) ? U.fmtMD(d.on) + ' ごろ切れる' : '切れそう', 'ghosty'),
            queued ? ui.chip('買い物リストに入れた', 'ok') : null
          ])
        ]),
        ui.btn('買った', 'ghost tiny', function () { buySheet(d.x, d.qty); }, 'check')
      ]);
    })));

    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('買い物リストへ入れる', 'primary', function () {
        var r = P.sync();
        ui.toast(r.added.length ? r.added.length + '件 入れました' : 'もう入っています');
        DL.app.render();
      }, 'plus')
    ]));
    return box;
  }

  /* ---------------- 期限 ---------------- */

  function expireCard(ex, today) {
    return el('div', { class: 'card' },
      el('div', { class: 'list tight' }, ex.map(function (e) {
        return el('div', { class: 'row flat' + (e.over ? ' late' : '') }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              el('span', { text: e.x.name }),
              e.over ? ui.chip('期限切れ', 'danger') : null
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip(U.fmtYMD(e.until), e.over ? 'danger' : e.left <= 14 ? 'warn' : 'soft'),
              ui.chip(U.untilLabel(e.until, today), 'ghosty'),
              ui.chip(e.qty + (e.x.unit || ''), 'ghosty')
            ])
          ]),
          el('div', { class: 'og-acts' }, [
            ui.btn('使った', 'ghost tiny', function () {
              P.spend(e.x.id, e.lot.id);
              ui.toast(e.x.name + 'を1つ使いました');
              DL.app.render();
            }, 'check'),
            e.over ? ui.btn('捨てた', 'ghost tiny', function () {
              P.toss(e.x.id, e.lot.id);
              ui.toast('片づけました');
              DL.app.render();
            }, 'trash') : null
          ])
        ]);
      })));
  }

  /* ---------------- 備蓄・消耗品の行 ---------------- */

  function stockRow(x, today) {
    /* 数は「いま使えるぶん」で出す。期限の切れたものは別に添える。
       棚には並んでいるのに数に入らない、というのが分かるように */
    var n = P.usable(x, today), sh = P.short(x, today), bad = P.dead(x, today);
    var until = P.firstUntil(x);
    return el('div', { class: 'row' + (x.active === false ? ' is-done' : '') }, [
      el('div', { class: 'row-main', onclick: function () { editSheet(x); } }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: x.name }),
          x.active === false ? ui.chip('止めている', 'ghosty') : null
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(n + (x.unit || '') + (x.need ? ' / ' + x.need + (x.unit || '') : ''),
            sh ? 'warn' : 'ok'),
          bad ? ui.chip('期限切れ ' + bad + (x.unit || ''), 'danger') : null,
          until ? ui.chip('期限 ' + U.fmtMD(until), 'ghosty') : null,
          x.place ? ui.chip(x.place, 'ghosty') : null
        ])
      ]),
      el('div', { class: 'og-acts' }, [
        n ? ui.btn('使った', 'ghost tiny', function () {
          P.spend(x.id);
          ui.toast(x.name + 'を1つ使いました');
          DL.app.render();
        }, 'minus') : null,
        ui.btn('買った', 'ghost tiny', function () { buySheet(x, sh || 1); }, 'plus')
      ])
    ]);
  }

  function useRow(x, today) {
    var out = P.runOutOn(x), on = P.buyOn(x);
    var soon = on && U.cmp(on, today) <= 0;
    return el('div', { class: 'row' + (x.active === false ? ' is-done' : '') }, [
      el('div', { class: 'row-main', onclick: function () { editSheet(x); } }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: x.name }),
          x.active === false ? ui.chip('止めている', 'ghosty') : null
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip('予備 ' + U.num(x.have, 0) + (x.unit || ''), U.num(x.have, 0) ? 'soft' : 'warn'),
          x.days ? ui.chip('1' + (x.unit || 'つ') + 'で' + x.days + '日', 'ghosty') : null,
          out ? ui.chip(U.fmtMD(out) + ' ごろ切れる', soon ? 'warn' : 'ghosty') : null
        ])
      ]),
      el('div', { class: 'og-acts' }, [
        ui.btn('開けた', 'ghost tiny', function () {
          P.spend(x.id);
          ui.toast(x.name + 'を1つ開けました');
          DL.app.render();
        }, 'minus'),
        ui.btn('買った', 'ghost tiny', function () { buySheet(x, 1); }, 'plus')
      ])
    ]);
  }

  /* ---------------- 買った ---------------- */

  function buySheet(x, qty) {
    var qtyIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: String(Math.max(1, U.num(qty, 1))) });
    var untilIn = ui.input({ type: 'date', value: '' });

    var close = ui.sheet({
      title: x.name + 'を買った',
      body: el('div', { class: 'form' }, [
        ui.field('いくつ', qtyIn),
        x.kind === 'stock'
          ? ui.field('期限', untilIn, '入れておくと、切れる前に知らせます')
          : el('p', { class: 'muted small',
            text: '予備として数えます。開けたときに「開けた」を押すと、'
              + 'そこから日数を数えなおします。' })
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('入れる', 'primary', function () {
          P.restock(x.id, U.num(qtyIn.value, 1), untilIn.value);
          close(); ui.toast('棚に入れました'); DL.app.render();
        })
      ]
    });
  }

  /* ---------------- 登録・編集 ---------------- */

  function editSheet(x, seed) {
    var isNew = !x;
    var v = x || Object.assign({
      name: '', kind: 'stock', unit: '個', need: 0, have: 0, days: 0,
      lastAt: U.today(), lead: P.DEFAULT_LEAD, price: 0, place: '', memo: '', active: true
    }, seed || {});

    var kind = v.kind;
    var nameIn = ui.input({ value: v.name === '(名称未設定)' ? '' : (v.name || '') });
    var unitIn = ui.input({ value: v.unit || '個' });
    var needIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: v.need ? String(v.need) : '' });
    var haveIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: v.have ? String(v.have) : '0' });
    var daysIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: v.days ? String(v.days) : '' });
    var lastIn = ui.input({ type: 'date', value: v.lastAt || U.today() });
    var leadIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: String(v.lead === undefined ? P.DEFAULT_LEAD : v.lead) });
    var priceIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: v.price ? String(v.price) : '' });
    var placeIn = ui.input({ value: v.place || '' });
    var memoIn = ui.textarea({ value: v.memo || '' });
    var activeChk = el('input', { type: 'checkbox', class: 'check', checked: v.active !== false });

    var needRow = ui.field('目標の数', needIn, 'この数を切ると、買うものに出します');
    var haveRow = ui.field('いまの予備の数', haveIn);
    var daysRow = ui.field('1つで何日もつか', daysIn);
    var lastRow = ui.field('最後に開けた日', lastIn);
    var leadRow = ui.field('届くまでの日数', leadIn, 'この日数ぶん手前で買うものに出します');

    function drawKind() {
      needRow.hidden = kind !== 'stock';
      haveRow.hidden = kind !== 'use';
      daysRow.hidden = kind !== 'use';
      lastRow.hidden = kind !== 'use';
      leadRow.hidden = kind !== 'use';
    }

    var kindSeg = ui.segmented([
      { value: 'stock', label: '備蓄（期限がある）' },
      { value: 'use', label: '消耗品（減っていく）' }
    ], kind, function (val) { kind = val; drawKind(); });

    /* 備蓄の中身（期限ごとの束） */
    var lotsBox = el('div', { class: 'list tight' });
    function drawLots() {
      U.clear(lotsBox);
      if (!x || x.kind !== 'stock') return;
      var ls = P.lots(x);
      if (!ls.length) {
        lotsBox.appendChild(el('p', { class: 'muted small', text: 'まだ何も入っていません。' }));
        return;
      }
      ls.forEach(function (l) {
        lotsBox.appendChild(el('div', { class: 'row flat' }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-sub' }, [
              ui.chip(l.qty + (x.unit || ''), 'soft'),
              ui.chip(l.until ? '期限 ' + U.fmtYMD(l.until) : '期限なし', 'ghosty')
            ])
          ]),
          ui.btn('捨てる', 'ghost tiny', function () {
            P.toss(x.id, l.id); drawLots();
          }, 'trash')
        ]));
      });
    }
    drawLots();

    var close = ui.sheet({
      title: isNew ? '備えを足す' : '備えを直す',
      body: el('div', { class: 'form' }, [
        ui.field('名前', nameIn),
        ui.block('どちら', kindSeg),
        el('div', { class: 'grid2' }, [
          ui.field('単位', unitIn),
          ui.field('1つの値段（円）', priceIn)
        ]),
        needRow, haveRow, daysRow, lastRow, leadRow,
        ui.field('しまってある場所', placeIn),
        ui.field('メモ', memoIn),
        (x && x.kind === 'stock') ? ui.block('いま棚にあるもの', lotsBox) : null,
        el('label', { class: 'row-check' }, [activeChk, el('span', { text: '棚に出す' })]),
        !isNew ? ui.btn('これを削除', 'danger full mt', function () {
          ui.confirm('「' + x.name + '」を棚から削除します。',
            { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeSupply(x.id); close(); ui.toast('削除しました'); DL.app.render();
          });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var name = nameIn.value.trim();
          if (!name) { ui.toast('名前を入れてください', 'warn'); return; }
          if (kind === 'use' && !U.num(daysIn.value, 0)) {
            ui.toast('1つで何日もつかを入れてください', 'warn'); return;
          }
          var data = {
            name: name, kind: kind, unit: unitIn.value.trim(),
            need: U.num(needIn.value, 0), have: U.num(haveIn.value, 0),
            days: U.num(daysIn.value, 0), lastAt: lastIn.value,
            lead: U.num(leadIn.value, P.DEFAULT_LEAD),
            price: U.num(priceIn.value, 0), place: placeIn.value.trim(),
            memo: memoIn.value.trim(), active: activeChk.checked
          };
          if (isNew) S.addSupply(data); else S.updateSupply(x.id, data);
          close(); ui.toast(isNew ? '足しました' : '保存しました'); DL.app.render();
        })
      ]
    });
    drawKind();
  }

  /* ---------------- よく使うもの ---------------- */

  function presetSheet() {
    var box = el('div', { class: 'list' }, P.PRESETS.map(function (p) {
      return el('button', {
        type: 'button', class: 'row', onclick: function () {
          close();
          editSheet(null, Object.assign({ lastAt: U.today() }, p));
        }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [el('span', { text: p.name })]),
          el('div', { class: 'row-sub' }, [
            ui.chip(p.kind === 'stock' ? '備蓄' : '消耗品', 'soft'),
            p.need ? ui.chip('目標 ' + p.need + p.unit, 'ghosty') : null,
            p.days ? ui.chip('1' + p.unit + 'で' + p.days + '日', 'ghosty') : null,
            p.memo ? ui.chip(p.memo, 'ghosty') : null
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]);
    }));
    var close = ui.sheet({ title: 'よく使うものから', body: box });
  }

  /* ---------------- ほかの画面から ---------------- */

  /** ホームの下に置く入口 */
  function entry() {
    var sm = P.summary();
    return el('a', { class: 'row', href: '#/supply' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('box', 17), el('span', { text: '備えの棚' })
        ]),
        sm.all ? el('div', { class: 'row-sub' }, [
          sm.due ? ui.chip('買うもの ' + sm.due + '件', 'warn') : ui.chip('足りています', 'ok'),
          sm.over ? ui.chip('期限切れ ' + sm.over + '件', 'danger') : null,
          sm.soon ? ui.chip('期限が近い ' + sm.soon + '件', 'ghosty') : null
        ]) : null
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  DL.views = DL.views || {};
  DL.views.supply = { render: render, entry: entry, editSheet: editSheet };
})(window.DL);
