/* 冷蔵庫（画面）。

   開けて中を見る、のと同じことが画面でできるように作ってある。
   置き場（冷蔵・冷凍・常温）ごとの棚に、札が並ぶ。
   札の色がそのまま期限の近さで、赤いものから食べる。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;
  var F = DL.fridge;

  /* いまどの置き場を見ているか。'' なら全部 */
  var where = '';
  /* 並べかた。'until'＝期限の近い順、'kind'＝種類ごと */
  var sort = 'until';

  var KIND = {
    food: { label: '食材', cls: 'food' },
    cooked: { label: '作り置き', cls: 'cooked' },
    season: { label: '調味料', cls: 'season' }
  };

  function render(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });
    var sm = F.summary(today);

    /* ---- 気にするもの ---- */
    var w = F.watch(today);
    if (w.length) {
      wrap.appendChild(ui.section('早く食べるもの',
        el('span', { class: 'muted small', text: 'これから' + F.WATCH + '日' })));
      wrap.appendChild(watchCard(w, today));
    }

    /* ---- 置き場の切り替え ---- */
    wrap.appendChild(el('div', { class: 'card' }, [
      ui.segmented([{ value: '', label: 'ぜんぶ' }].concat(F.WHERE.map(function (o) {
        return { value: o.key, label: o.label };
      })), where, function (v) { where = v; DL.app.render(); })
    ]));

    /* ---- 棚 ---- */
    var map = F.byWhere(where ? { where: where } : {});
    var shown = 0;
    F.WHERE.forEach(function (w2) {
      if (where && where !== w2.key) return;
      var rows = map[w2.key] || [];
      shown += rows.length;
      wrap.appendChild(ui.section(w2.label,
        el('span', { class: 'muted small', text: rows.length ? rows.length + '点' : '' })));
      wrap.appendChild(shelf(rows, today));
    });

    if (!sm.all) {
      wrap.appendChild(el('div', { class: 'card muted small' }, el('span', {
        text: '買ってきたものを、しまうときにここへ入れておくと、'
          + '袋を開けて移し替えても期限が分からなくなりません。'
      })));
    }

    wrap.appendChild(el('div', { class: 'row-wrap mt' }, [
      ui.btn('食材を入れる', 'primary', function () { editSheet('food', null); }, 'plus'),
      ui.btn('作り置きを入れる', 'ghost', function () { editSheet('cooked', null); }, 'plus'),
      ui.btn('調味料', 'ghost', function () { editSheet('season', null); }, 'plus')
    ]));

    root.appendChild(wrap);
  }

  /* ---------------- 早く食べるもの ---------------- */

  function watchCard(rows, today) {
    return el('div', { class: 'card' },
      el('div', { class: 'list tight' }, rows.map(function (r) {
        return el('button', {
          type: 'button', class: 'row flat', onclick: function () { editSheet(r.kind, r.item); }
        }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              el('span', { text: r.name }),
              r.over ? ui.chip('期限切れ', 'danger') : null
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip(U.untilLabel(r.until, today), r.over ? 'danger' : r.soon ? 'warn' : 'soft'),
              ui.chip(KIND[r.kind].label, 'ghosty'),
              ui.chip(F.whereLabel(r.where), 'ghosty'),
              r.qty ? ui.chip(r.qty, 'ghosty') : null
            ])
          ]),
          ui.btn('食べた', 'ghost tiny', function (e) {
            e.stopPropagation();
            F.finish(r.kind, r.id);
            ui.toast(r.name + 'を片づけました');
          }, 'check')
        ]);
      })));
  }

  /* ---------------- 棚 ---------------- */

  function shelf(rows, today) {
    if (!rows.length) {
      return el('div', { class: 'fr-shelf empty' },
        el('span', { class: 'muted small', text: 'からっぽです' }));
    }
    return el('div', { class: 'fr-shelf' }, rows.map(function (r) {
      return tile(r, today);
    }));
  }

  /** 1つぶんの札。色がそのまま期限の近さ */
  function tile(r, today) {
    var cls = 'fr-tile ' + KIND[r.kind].cls
      + (r.over ? ' over' : r.soon ? ' soon' : '');
    return el('button', {
      type: 'button', class: cls, onclick: function () { editSheet(r.kind, r.item); }
    }, [
      el('span', { class: 'fr-tile-k', text: KIND[r.kind].label }),
      el('b', { class: 'fr-tile-n', text: r.name }),
      el('span', { class: 'fr-tile-q', text: r.qty || '' }),
      el('span', { class: 'fr-tile-u',
        text: r.until ? (r.over ? Math.abs(r.left) + '日 超過'
          : r.left === 0 ? '今日まで' : 'あと' + r.left + '日') : '期限なし' })
    ]);
  }

  /* ---------------- 入れる・直す ---------------- */

  function editSheet(kind, x) {
    var isNew = !x;
    var v = x || { name: '', qty: '', unit: '', where: kind === 'season' ? 'room' : 'fridge',
      until: '', from: U.today(), openedAt: '', memo: '', kept: false };

    var nameIn = ui.input({ value: v.name || '' });
    var qtyIn = ui.input({ value: v.qty || '' });
    var unitIn = ui.input({ value: v.unit || '', placeholder: '本 / g / 袋' });
    var untilIn = ui.input({ type: 'date', value: v.until || '' });
    var fromIn = ui.input({ type: 'date', value: v.from || U.today() });
    var openedIn = ui.input({ type: 'date', value: v.openedAt || '' });
    var memoIn = ui.textarea({ value: v.memo || '' });
    var keptChk = el('input', { type: 'checkbox', class: 'check', checked: !!v.kept });

    var wh = v.where || (kind === 'season' ? 'room' : 'fridge');
    var whereSeg = ui.segmented(F.WHERE.map(function (o) {
      return { value: o.key, label: o.label };
    }), wh, function (val) { wh = val; });

    /* 期限を、日数から入れる近道。「あと3日」をよく使うので */
    var quick = el('div', { class: 'row-wrap' }, [1, 2, 3, 5, 7, 14, 30].map(function (n) {
      return ui.btn(n + '日', 'ghost tiny', function () {
        untilIn.value = U.addDays(U.today(), n);
      });
    }));

    /* 作り置きは、日もちを見てもらえる */
    var keepNote = el('p', { class: 'muted small' });
    var keepBtn = kind === 'cooked' ? ui.btn('日もちを見てもらう', 'ghost', function () {
      var name = nameIn.value.trim();
      if (!name) { ui.toast('料理の名前を入れてください', 'warn'); return; }
      keepBtn.disabled = true;
      keepNote.textContent = '聞いています…';
      F.keep(name, { where: wh, madeOn: fromIn.value, memo: memoIn.value })
        .then(function (r) {
          keepBtn.disabled = false;
          untilIn.value = r.until;
          keepNote.textContent = (r.guess ? '（見当）' : '')
            + name + 'は ' + F.whereLabel(wh) + 'で ' + r.days + '日ぶん。'
            + U.fmtYMD(r.until) + ' までにしました'
            + (r.note ? '　' + r.note : '');
        });
    }, 'idea') : null;

    var close = ui.sheet({
      title: (isNew ? '入れる' : '直す') + '（' + KIND[kind].label + '）',
      body: el('div', { class: 'form' }, [
        ui.field(kind === 'cooked' ? '料理の名前' : '名前', nameIn),
        el('div', { class: 'grid2' }, [
          ui.field('量', qtyIn),
          ui.field('単位', unitIn)
        ]),
        ui.block('どこにしまうか', whereSeg),
        ui.field(kind === 'cooked' ? '作った日' : '買った日', fromIn),
        kind === 'food' ? ui.field('袋を開けた日', openedIn,
          '開けたら入れておくと、残りの見当が付きます') : null,
        ui.field('いつまで', untilIn),
        ui.block('今日から', quick),
        keepBtn ? el('div', {}, [keepBtn, keepNote]) : null,
        kind === 'cooked'
          ? el('label', { class: 'row-check' }, [keptChk,
            el('span', { text: '食材ではなく、作り置き（献立では先に食べ切る扱い）' })])
          : null,
        ui.field('メモ', memoIn),
        !isNew ? el('div', { class: 'row-wrap' }, [
          ui.btn('食べた・使い切った', 'primary', function () {
            F.finish(kind, x.id); close(); ui.toast('片づけました'); DL.app.render();
          }, 'check'),
          ui.btn('捨てた', 'danger', function () {
            F.finish(kind, x.id); close(); ui.toast('片づけました'); DL.app.render();
          }, 'trash')
        ]) : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var name = nameIn.value.trim();
          if (!name) { ui.toast('名前を入れてください', 'warn'); return; }
          var data = {
            name: name, qty: qtyIn.value.trim(), unit: unitIn.value.trim(),
            where: wh, until: untilIn.value, from: fromIn.value,
            memo: memoIn.value.trim()
          };
          if (kind === 'food') data.openedAt = openedIn.value;
          if (kind === 'cooked') data.kept = keptChk.checked;
          if (isNew) F.add(kind, data); else F.update(kind, x.id, data);
          close(); ui.toast(isNew ? '入れました' : '保存しました'); DL.app.render();
        })
      ]
    });
  }

  /* ---------------- ほかの画面から ---------------- */

  /** 家事タブに置く入口 */
  function entry() {
    var sm = F.summary();
    return el('a', { class: 'row', href: '#/fridge' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('fridge', 17), el('span', { text: '冷蔵庫' })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(sm.all + '点', 'ghosty'),
          sm.over ? ui.chip('期限切れ ' + sm.over + '件', 'danger') : null,
          sm.soon ? ui.chip('もうすぐ ' + sm.soon + '件', 'warn') : null,
          (!sm.over && !sm.soon) ? ui.chip('急ぐものなし', 'ok') : null
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  DL.views = DL.views || {};
  DL.views.fridge = { render: render, entry: entry, editSheet: editSheet };
})(window.DL);
