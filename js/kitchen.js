/* 家にある調味料と、残り物。

   今日の献立の歯車から開く。ここに書いた調味料は「家にあるもの」として扱い、
   書いていない調味料は、献立に出てきたときだけ買うものへ足す（予算には数えない）。
   残り物のほうは、先に食べ切ってほしいので献立を頼むときに渡す。
   どちらも期限が切れたら、ホームに「捨てる」として出す。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  var SOON = 3;   // これ以内なら「あと n日」と出す

  /** 設定のシートを開く */
  function open(onChange) {
    var body = el('div', { class: 'kt-wrap' });
    var refresh = function () {
      draw(body, refresh);
      if (onChange) onChange();
    };
    draw(body, refresh);
    ui.sheet({ title: '家にあるもの', body: body });
  }

  function draw(body, refresh) {
    var today = U.today();
    body.textContent = '';

    body.appendChild(ui.section('家にある調味料',
      el('span', { class: 'muted small', text: S.pantry().length + '点' })));
    body.appendChild(el('p', { class: 'muted small', text:
      'ここに無い調味料は、献立に出てきたら買うものへ足します（予算には数えません）。'
      + '砂糖や塩などもここに書いてください。' }));
    body.appendChild(list(S.pantry(), 'pantry', today, refresh,
      'まだありません。よく使う調味料を入れておくと、足りないものだけ買い物に出ます。'));
    body.appendChild(ui.btn('調味料を足す', 'ghost full', function () {
      edit('pantry', null, refresh);
    }, 'plus'));

    body.appendChild(ui.section('残り物',
      el('span', { class: 'muted small', text: S.leftovers().length + '点' })));
    body.appendChild(el('p', { class: 'muted small', text:
      'ここに書いたものから先に使う献立を考えます。'
      + '食材ではない作り置き（夕飯の残りなど）は「保存あり」にしてください。' }));
    body.appendChild(list(S.leftovers(), 'leftover', today, refresh,
      'まだありません。使いかけの食材や、作り置きを入れておけます。'));
    body.appendChild(ui.btn('残り物を足す', 'ghost full', function () {
      edit('leftover', null, refresh);
    }, 'plus'));
  }

  function list(rows, kind, today, refresh, emptyText) {
    if (!rows.length) return el('p', { class: 'muted small pad', text: emptyText });
    var box = el('div', { class: 'list' });
    rows.slice().sort(sorter).forEach(function (x) {
      box.appendChild(row(x, kind, today, refresh));
    });
    return box;
  }

  /* 期限の近いものから。決めていないものは後ろ */
  function sorter(a, b) {
    if (!a.until && !b.until) return U.cmp(a.name, b.name);
    if (!a.until) return 1;
    if (!b.until) return -1;
    return U.cmp(a.until, b.until);
  }

  function row(x, kind, today, refresh) {
    return el('button', { class: 'row kt-row', onclick: function () { edit(kind, x.id, refresh); } }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: x.name || '(名前なし)' }),
          x.kept ? ui.chip('保存あり', 'soft') : null
        ]),
        el('div', { class: 'row-sub' }, [
          S.foodQty(x) ? ui.chip(S.foodQty(x), 'ghosty') : null,
          untilChip(x, today)
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /** 期限の出しかた。切れていれば赤、近ければ黄 */
  function untilChip(x, today) {
    if (!x.until) return ui.chip('期限なし', 'ghosty');
    if (S.foodExpired(x, today)) return ui.chip('期限切れ', 'danger');
    var left = U.diffDays(today, x.until);
    if (left <= SOON) return ui.chip(left === 0 ? '今日まで' : 'あと' + left + '日', 'warn');
    return ui.chip(U.fmtMD(x.until) + 'まで', 'ghosty');
  }

  /* 1つぶんの入力。新しく足すときは id を渡さない */
  function edit(kind, id, refresh) {
    var isLeft = kind === 'leftover';
    var cur = (id ? (isLeft ? S.getLeftover(id) : S.getPantry(id)) : null)
      || { name: '', qty: '', unit: '', until: '', kept: false };

    var name = ui.input({ value: cur.name, placeholder: isLeft ? '例）鶏もも肉' : '例）しょうゆ' });
    var qty = ui.input({ value: cur.qty, placeholder: '例）1', inputmode: 'decimal' });
    var unit = ui.input({ value: cur.unit, placeholder: '例）本' });
    var until = ui.input({ type: 'date', value: cur.until });
    var kept = !!cur.kept;

    var box = el('div', {}, [
      ui.field('品名', name),
      el('div', { class: 'kt-qty' }, [
        ui.field('数量', qty), ui.field('単位', unit)
      ]),
      ui.field('消費期限', until, '決めなければ空のままで構いません'),
      isLeft ? ui.block('種類', ui.segmented(
        [{ value: 'food', label: '食材' }, { value: 'kept', label: '保存あり' }],
        kept ? 'kept' : 'food', function (v) { kept = v === 'kept'; }),
      '食材ではない作り置きは「保存あり」。期限は自分で決めてください') : null
    ]);

    var actions = [];
    if (id) {
      actions.push(el('button', { class: 'btn danger', text: '削除', onclick: function () {
        ui.confirm((cur.name || 'これ') + 'を消します。', { okText: '消す', danger: true })
          .then(function (ok) {
            if (!ok) return;
            if (isLeft) S.removeLeftover(id); else S.removePantry(id);
            close();
            refresh();
          });
      } }));
    }
    actions.push(el('button', { class: 'btn primary', text: '保存', onclick: function () {
      var v = {
        name: name.value.trim(), qty: qty.value.trim(),
        unit: unit.value.trim(), until: until.value
      };
      if (!v.name) { ui.toast('品名を入れてください', 'danger'); return; }
      if (isLeft) v.kept = kept;
      if (id) {
        if (isLeft) S.updateLeftover(id, v); else S.updatePantry(id, v);
      } else if (isLeft) S.addLeftover(v);
      else S.addPantry(v);
      close();
      refresh();
    } }));

    var close = ui.sheet({
      title: (id ? '' : '足す：') + (isLeft ? '残り物' : '調味料'),
      body: box, actions: actions
    });
  }

  DL.kitchen = { open: open, untilChip: untilChip };
})(window.DL);
