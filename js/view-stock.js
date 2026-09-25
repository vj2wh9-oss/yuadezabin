/* 頒布と在庫：既刊・新刊の残部と、イベントごとの頒布をまとめる画面 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, D = DL.docs, K = DL.stock, el = U.el;

  var year = 0;              // 0＝今年
  var showArchived = false;  // 頒布を終えたものも出すか
  var LOW = 5;               // これ以下になったら「残りわずか」と出す

  function currentYear() { return year || U.num(U.today().slice(0, 4), 2026); }

  function render(root) {
    var y = currentYear();
    var wrap = el('div', { class: 'page stock-page' });

    /* ---- 年の切り替え（頒布数と売上はこの年のぶん） ---- */
    wrap.appendChild(el('div', { class: 'year-nav' }, [
      el('button', { class: 'iconbtn', 'aria-label': '前の年', onclick: function () { year = y - 1; DL.app.render(); } }, ui.icon('chevronLeft', 20)),
      el('button', {
        class: 'year-label', text: y + '年',
        onclick: function () { year = U.num(U.today().slice(0, 4), y); DL.app.render(); }
      }),
      el('button', { class: 'iconbtn', 'aria-label': '次の年', onclick: function () { year = y + 1; DL.app.render(); } }, ui.icon('chevronRight', 20))
    ]));

    /* ---- 当日モード（近いイベントがあるとき） ---- */
    var next = nextEvent();
    if (next) {
      wrap.appendChild(ui.btn(
        '当日モード：' + (next.eventName || next.title),
        'primary full', function () { location.hash = '#/onsite/' + next.id; }, 'sales'
      ));
    }

    var list = K.all({ year: y, withArchived: showArchived });
    if (!list.length && !S.items({ withArchived: true }).length) {
      wrap.appendChild(ui.empty(
        'まだ頒布物がありません。本やグッズを登録すると、残部と頒布数を数えられます。',
        ui.btn('頒布物を登録する', 'primary', function () { itemForm(null); }, 'plus')
      ));
      root.appendChild(wrap);
      return;
    }

    /* ---- 合計 ---- */
    var t = K.totals(list);
    wrap.appendChild(el('div', { class: 'card sum-grid' }, [
      sumBox('いまの在庫', t.left + '部', 'big'),
      sumBox(y + '年の頒布', t.sold + '部'),
      sumBox(y + '年の頒布額', D.yen(t.revenue), 'ok'),
      sumBox('在庫の原価', D.yen(t.stockValue))
    ]));

    /* ---- 残りわずか ---- */
    var low = list.filter(function (s) { return s.left > 0 && s.left <= LOW; });
    if (low.length) {
      wrap.appendChild(el('div', { class: 'alert warn' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: '残りわずか：' + low.map(function (s) {
          return s.item.title + '（残' + s.left + '）';
        }).join('、') })
      ]));
    }

    /* ---- 頒布物 ---- */
    wrap.appendChild(ui.section('頒布物', el('span', { class: 'muted small', text: list.length + '点' })));
    var box = el('div', { class: 'list' });
    list.forEach(function (s) {
      box.appendChild(itemRow(s, y));
      // 余部は「タイトル（余部）¥0」として、その下に別立てで出す
      if (s.extraLeft > 0) box.appendChild(extraRow(s));
    });
    wrap.appendChild(box);

    var hidden = S.items({ withArchived: true }).length - S.items().length;
    if (hidden > 0 || showArchived) {
      wrap.appendChild(ui.btn(
        showArchived ? '頒布を終えたものを隠す' : '頒布を終えたものも出す（' + hidden + '点）',
        'ghost full', function () { showArchived = !showArchived; DL.app.render(); }, 'swap'
      ));
    }

    /* ---- イベントごと ---- */
    var events = eventRows(y);
    if (events.length) {
      wrap.appendChild(ui.section('イベントごとの頒布', el('span', { class: 'muted small', text: events.length + '件' })));
      var ebox = el('div', { class: 'list' });
      events.forEach(function (e) { ebox.appendChild(eventRow(e)); });
      wrap.appendChild(ebox);
    }

    /* ---- 最近の出入り ---- */
    var recent = S.stockMoves().slice(0, 12);
    if (recent.length) {
      wrap.appendChild(ui.section('最近の出入り'));
      var mbox = el('div', { class: 'list' });
      recent.forEach(function (m) { mbox.appendChild(moveRow(m, true)); });
      wrap.appendChild(mbox);
    }

    root.appendChild(wrap);
  }

  function sumBox(label, value, cls) {
    return el('div', { class: 'sum-box ' + (cls || '') }, [
      el('span', { text: label }), el('b', { text: value })
    ]);
  }

  /* ---------------- 行 ---------------- */

  function itemRow(s, y) {
    var x = s.item;
    var low = s.left > 0 && s.left <= LOW;
    return el('button', {
      class: 'row stock-row' + (x.archived ? ' dim' : ''),
      onclick: function () { itemSheet(x.id); }
    }, [
      // 表紙を登録してあれば、名前の左に小さく出す
      x.cover ? el('img', { class: 'stock-thumb', src: x.cover, alt: '' }) : null,
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          x.cover ? null : ui.icon(x.kind === 'goods' ? 'illust' : 'books', 16),
          el('span', { text: x.title })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(K.kindLabel(x.kind), 'ghosty'),
          x.price ? ui.chip(D.yen(x.price), 'ghosty') : null,
          s.sold ? ui.chip(y + '年 ' + s.sold + '部', 'soft') : null,
          s.extraLeft > 0 ? ui.chip('うち余部 ' + s.extraLeft, 'ghosty') : null,
          s.revenue ? el('span', { class: 'muted small', text: D.yen(s.revenue) }) : null,
          x.archived ? ui.chip('頒布終了', 'ghosty') : null
        ])
      ]),
      el('span', { class: 'stock-left' + (low ? ' low' : '') + (s.left <= 0 ? ' none' : '') }, [
        el('b', { text: String(s.left) }),
        el('span', { text: '残' })
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* 余部の行。印刷所が足してくれたぶんで、原価は0。
     在庫はここから先に減るので、本体とは分けて出す */
  function extraRow(s) {
    var x = s.item;
    return el('button', {
      class: 'row stock-row extra-row',
      onclick: function () { itemSheet(x.id); }
    }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('plus', 15),
          el('span', { text: K.extraTitle(x) })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(D.yen(0), 'ghosty'),
          ui.chip('余部', 'soft'),
          el('span', { class: 'muted small', text: 'ここから先に減ります' })
        ])
      ]),
      el('span', { class: 'stock-left' }, [
        el('b', { text: String(s.extraLeft) }),
        el('span', { text: '残' })
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* 当日モードの入口を出す相手。開催が近い（前後1か月の）即売会 */
  function nextEvent() {
    var today = U.today();
    return S.projects().filter(function (p) {
      if (p.kind !== 'event' || p.status === 'archived' || !U.isISO(p.eventDate)) return false;
      var d = U.diffDays(today, p.eventDate);
      return d >= -30 && d <= 30;
    }).sort(function (a, b) {
      return Math.abs(U.diffDays(today, a.eventDate)) - Math.abs(U.diffDays(today, b.eventDate));
    })[0] || null;
  }

  /* 頒布の記録がある即売会の案件を、新しい順に */
  function eventRows(y) {
    var out = [];
    S.projects().forEach(function (p) {
      if (p.kind !== 'event') return;
      var moves = S.stockMoves({ projectId: p.id, kind: 'sale' });
      if (!moves.length) return;
      if (y && !moves.some(function (m) { return m.date.slice(0, 4) === String(y); })) return;
      out.push({ project: p, sum: K.eventSummary(p.id, y) });
    });
    return out.sort(function (a, b) {
      return U.cmp(b.project.eventDate || b.project.deadline || '', a.project.eventDate || a.project.deadline || '');
    });
  }

  function eventRow(e) {
    var p = e.project, s = e.sum;
    var net = s.revenue - s.expense;
    return el('a', { class: 'row', href: '#/project/' + p.id }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { class: 'dot', style: { background: p.color } }),
          el('span', { text: p.eventName || p.title })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(s.sold + '部', 'soft'),
          ui.chip(D.yen(s.revenue), 'ghosty'),
          s.expense ? ui.chip('経費 ' + D.yen(s.expense), 'ghosty') : null,
          el('span', { class: 'muted small', text: '差し引き ' + (net < 0 ? '-' : '') + D.yen(Math.abs(net)) })
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* その記録で余部がどう動いたか。数だけ見ても分からないので添える */
  function extraChip(m) {
    var ex = U.num(m.extra, 0);
    if (!ex) return null;
    if (m.kind === 'in') return ui.chip('余部', 'soft');
    if (m.kind === 'adjust') return ui.chip('余部 ' + (ex > 0 ? '+' : '') + ex, 'ghosty');
    return ui.chip('余部から' + ex + '部', 'ghosty');
  }

  function moveRow(m, withTitle) {
    var x = S.getItem(m.itemId);
    var def = K.moveDef(m.kind);
    var n = K.delta(m);
    return el('button', { class: 'row move-row', onclick: function () { moveSheet(m.itemId, m.kind, m); } }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: withTitle && x ? x.title : def.label })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(U.fmtMD(m.date), 'soft'),
          withTitle ? ui.chip(def.label, 'ghosty') : null,
          extraChip(m),
          m.place ? ui.chip(m.place, 'ghosty') : null,
          m.memo ? el('span', { class: 'muted small', text: m.memo }) : null
        ])
      ]),
      el('span', { class: 'move-qty' + (n < 0 ? ' minus' : '') , text: (n > 0 ? '+' : '') + n })
    ]);
  }

  /* ---------------- 1点の詳細 ---------------- */

  function itemSheet(id) {
    var x = S.getItem(id);
    if (!x) return;
    var s = K.summary(x, { year: currentYear() });

    var quick = el('div', { class: 'row-wrap' }, [
      ui.btn('頒布を記録', 'primary', function () { close(); moveSheet(x.id, 'sale'); }, 'sales'),
      ui.btn('入庫', 'ghost', function () { close(); moveSheet(x.id, 'in'); }, 'plus'),
      ui.btn('献本', 'ghost', function () { close(); moveSheet(x.id, 'gift'); }, 'arrowRight'),
      ui.btn('棚卸し', 'ghost', function () { close(); moveSheet(x.id, 'adjust'); }, 'refresh')
    ]);

    var moves = S.stockMoves({ itemId: x.id });
    var hist = el('div', { class: 'list' });
    moves.slice(0, 30).forEach(function (m) { hist.appendChild(moveRow(m, false)); });

    var body = el('div', { class: 'form' }, [
      x.cover ? el('img', { class: 'stock-cover', src: x.cover, alt: x.title + 'の画像' }) : null,
      el('div', { class: 'card sum-grid' }, [
        sumBox('残部', s.left + '部', 'big'),
        sumBox('うち余部', Math.max(0, s.extraLeft) + '部'),
        sumBox('入庫', s.added + '部'),
        sumBox('頒布', s.sold + '部'),
        sumBox('献本・傷み', (s.gift + s.loss) + '部')
      ]),
      el('div', { class: 'card sum-grid' }, [
        sumBox(currentYear() + '年の頒布額', D.yen(s.revenue), 'ok'),
        sumBox('原価', D.yen(s.cost)),
        sumBox('差し引き', D.yen(s.profit), s.profit < 0 ? 'warn' : '')
      ]),
      quick,
      x.memo ? el('p', { class: 'muted small', text: x.memo }) : null,
      ui.section('出入り', el('span', { class: 'muted small', text: moves.length + '件' })),
      moves.length ? hist : ui.empty('まだ記録がありません。'),
      ui.btn('この頒布物を編集', 'ghost full', function () { close(); itemForm(x); }, 'edit')
    ]);

    var close = ui.sheet({
      title: x.title,
      body: body,
      actions: [ui.btn('閉じる', 'ghost', function () { close(); })]
    });
  }

  /* ---------------- 出入りの入力 ---------------- */

  /**
   * 在庫の出入りを1件入れる。
   * @param {string} itemId
   * @param {string} kind 既定の種類
   * @param {object} [m] 直すとき
   */
  function moveSheet(itemId, kind, m) {
    var x = S.getItem(itemId);
    if (!x) return;
    var isNew = !m;
    var cur = m ? m.kind : kind;
    var s = K.summary(x);

    var dateIn = ui.input({ type: 'date', value: m ? m.date : U.today() });
    var qtyIn = ui.stepper({ value: m ? Math.abs(m.qty) : 1, max: 9999 });
    var priceIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0,
      value: m && m.price ? m.price : '', placeholder: String(x.price || 0) });
    var placeIn = ui.input({ value: m ? m.place : '', maxlength: 60, placeholder: '例）通販 / 委託' });
    var memoIn = ui.input({ value: m ? m.memo : '', maxlength: 200, placeholder: '任意' });

    // 減らす向きの棚卸し（数え直したら少なかった）を入れられるようにする
    var minus = el('input', { type: 'checkbox', class: 'check', checked: !!(m && m.qty < 0) });
    // 入庫のとき、それが余部（印刷所からのおまけ）かどうか
    var asExtra = el('input', { type: 'checkbox', class: 'check',
      checked: !!(m && m.kind === 'in' && m.extra > 0) });

    // 即売会の案件を選ぶと、イベントごとの集計に入る
    var evOpts = [{ value: '', label: '（イベントと結びつけない）' }].concat(
      S.projects().filter(function (p) { return p.kind === 'event'; })
        .sort(function (a, b) { return U.cmp(b.eventDate || '', a.eventDate || ''); })
        .map(function (p) { return { value: p.id, label: (p.eventName || p.title) + (p.eventDate ? '（' + U.fmtMD(p.eventDate) + '）' : '') }; })
    );
    var evSel = ui.select(evOpts, m ? m.projectId : '');

    var kindSeg = ui.segmented(
      K.MOVES.map(function (k) { return { value: k.value, label: k.label }; }),
      cur, function (v) { cur = v; refresh(); }
    );

    var hint = el('p', { class: 'muted small' });
    var priceField = ui.field('単価（円）', priceIn, '空のままなら頒布価格（' + D.yen(x.price) + '）で数えます');
    var evField = ui.field('イベント', evSel);
    var minusField = el('label', { class: 'row-check' }, [minus, el('span', { text: '数え直したら少なかった（減らす）' })]);
    var extraField = el('label', { class: 'row-check' }, [asExtra,
      el('span', { text: '余部（印刷所が足してくれたぶん。原価は0で数えます）' })]);
    // 余部から何部出るか。減らすときだけ出す
    var extraNote = el('p', { class: 'muted small' });

    // いま残っている余部（この記録を直しているときは、それを除いて数える）
    var exLeft = K.extraLeft(x.id, m ? m.id : '');

    function refresh() {
      var def = K.moveDef(cur);
      hint.textContent = def.label + '：' + def.note + '　いまの残部 ' + s.left + '部'
        + (exLeft > 0 ? '（うち余部 ' + exLeft + '部）' : '');
      priceField.hidden = cur !== 'sale';
      evField.hidden = (cur !== 'sale' && cur !== 'gift');
      minusField.hidden = cur !== 'adjust';
      extraField.hidden = cur !== 'in';
      var down = cur === 'sale' || cur === 'gift' || cur === 'loss';
      extraNote.hidden = !(down && exLeft > 0);
      if (!extraNote.hidden) {
        var take = Math.min(qtyIn.getValue(), exLeft);
        extraNote.textContent = '余部から先に減らします（このうち ' + take + '部）。';
      }
    }
    refresh();
    // 数を動かすたびに、余部から何部出るかを言い直す
    qtyIn.addEventListener('input', refresh);
    qtyIn.addEventListener('click', function () { setTimeout(refresh, 0); });

    var body = el('div', { class: 'form' }, [
      ui.field('種類', kindSeg),
      hint,
      el('div', { class: 'grid2' }, [
        ui.field('日付', dateIn),
        ui.field('数', qtyIn)
      ]),
      minusField,
      extraField,
      extraNote,
      priceField,
      evField,
      ui.field('場所・メモ書き', placeIn),
      ui.field('メモ', memoIn),
      !isNew ? ui.btn('この記録を削除', 'danger full mt', function () {
        ui.confirm('この記録を削除します。', { danger: true, okText: '削除' }).then(function (ok) {
          if (!ok) return;
          S.removeMove(m.id); close(); ui.toast('削除しました');
        });
      }, 'trash') : null
    ]);

    var close = ui.sheet({
      title: x.title + '　' + (isNew ? '記録を追加' : '記録を直す'),
      body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () { save(); })
      ]
    });

    function save() {
      var qty = qtyIn.getValue();
      if (!qty) { ui.toast('数を入れてください', 'warn'); return; }
      if (cur === 'adjust' && minus.checked) qty = -qty;
      /* 余部のぶん。入庫は「おまけかどうか」、減るときは余部から先に出す。
         棚卸しで減らすときも、まず余部から減らす */
      var extra = 0;
      if (cur === 'in') extra = asExtra.checked ? qty : 0;
      else if (qty < 0) extra = -K.takeExtra(x.id, -qty, m ? m.id : '');
      else if (cur !== 'adjust') extra = K.takeExtra(x.id, qty, m ? m.id : '');
      var data = {
        itemId: x.id, date: dateIn.value, kind: cur, qty: qty, extra: extra,
        price: cur === 'sale' ? U.num(priceIn.value, 0) : 0,
        place: placeIn.value.trim(),
        projectId: (cur === 'sale' || cur === 'gift') ? evSel.value : '',
        memo: memoIn.value.trim()
      };
      if (isNew) S.addMove(data);
      else S.updateMove(m.id, data);
      close();
      var now = K.summary(S.getItem(x.id));
      ui.toast((isNew ? '記録しました' : '直しました') + '（残 ' + now.left + '部'
        + (now.extraLeft > 0 ? '・うち余部 ' + now.extraLeft + '部' : '') + '）');
    }
  }

  /* ---------------- 頒布物の登録 ---------------- */

  /**
   * 頒布物の入力。
   * @param {object} [x] 直すとき
   * @param {object} [opts] projectId … はじめから結びつけておく即売会
   */
  function itemForm(x, opts) {
    opts = opts || {};
    var isNew = !x;
    var titleIn = ui.input({ value: x ? x.title : '', maxlength: 80, placeholder: '例）『夏の本』' });
    var priceIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: x ? x.price : '', placeholder: '700' });
    var dateIn = ui.input({ type: 'date', value: x ? x.releaseDate : U.today() });
    var costIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: x ? x.unitCost : '', placeholder: '0' });
    var memoIn = ui.textarea({ value: x ? x.memo : '', placeholder: '判型・ページ数・印刷所など', maxlength: 300 });
    var cover = x ? x.cover : '';      // 表紙などの画像（縮めた dataURL）
    var kind = x ? x.kind : 'book';
    var kindSeg = ui.segmented([
      { value: 'book', label: '本' }, { value: 'goods', label: 'グッズ' }
    ], kind, function (v) { kind = v; });

    // 新しく作るときは、刷った部数をそのまま最初の入庫にする
    var firstIn = isNew ? ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: '', placeholder: '例）100' }) : null;

    /* 余部と、いまの在庫。
       余部は印刷所が発注ぶんに足してくれる端数（+10部前後）で、原価は0。
       いまの在庫は、数が合わなくなったときに書き直せるようにしておく */
    var cur = x ? K.summary(x) : null;
    var extraIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0,
      value: cur ? Math.max(0, cur.extraLeft) : '', placeholder: '例）10' });
    var leftIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: cur ? cur.left : '', placeholder: isNew ? '刷った部数＋余部' : '' });

    // 印刷費の合計と部数から1部あたりを出す（電卓を出さずに済むように）
    var totalIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: '', placeholder: '例）32000' });
    var countIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: '', placeholder: '例）100' });
    var calcBtn = ui.btn('1部あたりを計算', 'ghost tiny', function () {
      var total = U.num(totalIn.value, 0), n = U.num(countIn.value, 0);
      if (!total || !n) { ui.toast('印刷費と部数を入れてください', 'warn'); return; }
      costIn.value = Math.round(total / n);
      ui.toast('1部あたり ' + D.yen(Math.round(total / n)) + ' にしました');
    }, 'refresh');

    var evOpts = [{ value: '', label: '（結びつけない）' }].concat(
      S.projects().filter(function (p) { return p.kind === 'event'; })
        .sort(function (a, b) { return U.cmp(b.eventDate || '', a.eventDate || ''); })
        .map(function (p) { return { value: p.id, label: p.eventName || p.title }; })
    );
    var evSel = ui.select(evOpts, x ? x.projectId : (opts.projectId || ''));

    /* 表紙の画像。大きいままだと持ちきれないので、縮めて dataURL で持つ */
    var coverBox = el('div', { class: 'imgfield' });
    var coverFile = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    coverFile.addEventListener('change', function () {
      var f = coverFile.files[0];
      coverFile.value = '';
      if (!f) return;
      U.readImage(f, 640, 'image/jpeg', 0.8).then(function (url) {
        cover = url;
        drawCover();
        ui.toast('読み込みました');
      }).catch(function (e) { ui.toast(e.message, 'danger'); });
    });
    function drawCover() {
      U.clear(coverBox);
      coverBox.appendChild(cover
        ? el('img', { class: 'imgfield-prev cover', src: cover, alt: '' })
        : el('div', { class: 'imgfield-empty' }, ui.icon('illust', 22)));
      coverBox.appendChild(el('div', { class: 'row-wrap' }, [
        ui.btn(cover ? '選び直す' : '画像を選ぶ', 'ghost tiny', function () { coverFile.click(); }, 'plus'),
        cover ? ui.btn('削除', 'ghost tiny', function () { cover = ''; drawCover(); }) : null
      ]));
      coverBox.appendChild(coverFile);
    }
    drawCover();

    var archived = el('input', { type: 'checkbox', class: 'check', checked: !!(x && x.archived) });

    var body = el('div', { class: 'form' }, [
      ui.field('タイトル', titleIn),
      ui.field('種類', kindSeg),
      el('div', { class: 'grid2' }, [
        ui.field('頒布価格（円）', priceIn),
        ui.field('発行日', dateIn)
      ]),
      isNew ? ui.field('刷った部数', firstIn) : null,
      el('div', { class: 'grid2' }, [
        ui.field('余部', extraIn,
          isNew ? '印刷所が足してくれたぶん' : '在庫のうち何部が余部か'),
        ui.field('現在の在庫数', leftIn, isNew ? '違うときだけ' : 'いまの残部')
      ]),
      el('p', { class: 'muted small', text:
        '余部は「' + (titleIn.value.trim() || 'タイトル') + K.EXTRA_SUFFIX + '」'
        + D.yen(0) + ' として在庫に入り、減らすときはここから先に減ります。' }),
      ui.field('1部あたりの原価（円）', costIn),
      el('div', { class: 'panel' }, [
        el('span', { class: 'field-label', text: '原価の計算' }),
        el('div', { class: 'grid2' }, [
          ui.field('印刷費の合計', totalIn),
          ui.field('部数', countIn)
        ]),
        calcBtn
      ]),
      ui.field('イベント', evSel),
      ui.field('画像（表紙など）', coverBox),
      ui.field('メモ', memoIn),
      !isNew ? el('label', { class: 'row-check' }, [archived, el('span', { text: '頒布を終えた（一覧では畳む）' })]) : null,
      !isNew ? ui.btn('この頒布物を削除', 'danger full mt', function () {
        var n = S.stockMoves({ itemId: x.id }).length;
        ui.confirm('「' + x.title + '」を削除します。' + (n ? '\n出入りの記録 ' + n + '件も一緒に消えます。' : ''),
          { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeItem(x.id); close(); ui.toast('削除しました');
          });
      }, 'trash') : null
    ]);

    var close = ui.sheet({
      title: isNew ? '頒布物を登録' : '頒布物を編集',
      body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () { save(); })
      ]
    });

    function save() {
      var title = titleIn.value.trim();
      if (!title) { ui.toast('タイトルを入れてください', 'warn'); return; }
      var data = {
        title: title, kind: kind,
        price: U.num(priceIn.value, 0), unitCost: U.num(costIn.value, 0),
        releaseDate: dateIn.value, projectId: evSel.value, cover: cover,
        memo: memoIn.value.trim(), archived: !isNew && archived.checked
      };
      if (isNew) {
        var created = S.addItem(data);
        var day = data.releaseDate || U.today();
        var n = U.num(firstIn.value, 0);
        if (n > 0) {
          S.addMove({ itemId: created.id, date: day, kind: 'in', qty: n, memo: '最初の入庫' });
        }
        // 登録のときの余部は「発注ぶんに足してもらったぶん」なので、そのまま入庫する
        var ex = U.num(extraIn.value, 0);
        if (ex > 0) {
          S.addMove({ itemId: created.id, date: day, kind: 'in', qty: ex, extra: ex, memo: '余部' });
        }
        applyLeft(created.id, day, leftIn.value);
        applyExtra(created.id, day, extraIn.value);
        close();
        var made = K.summary(S.getItem(created.id));
        ui.toast(made.left > 0
          ? '登録しました（在庫 ' + made.left + '部'
            + (made.extraLeft > 0 ? '・うち余部 ' + made.extraLeft + '部' : '') + '）'
          : '登録しました');
      } else {
        S.updateItem(x.id, data);
        // 先に数を合わせてから、そのうち何部が余部かを合わせる
        applyLeft(x.id, U.today(), leftIn.value);
        applyExtra(x.id, U.today(), extraIn.value);
        close();
        ui.toast('保存しました');
      }
    }

    /**
     * いまの在庫のうち、何部が余部かを合わせる。
     * 数そのものは動かさない（棚卸しの qty 0 で、余部の数だけ直す）。
     */
    function applyExtra(id, date, raw) {
      if (String(raw == null ? '' : raw).trim() === '') return;
      var s = K.summary(S.getItem(id));
      // 在庫より多い余部はありえない
      var want = Math.max(0, Math.min(Math.round(U.num(raw, 0)), Math.max(0, s.left)));
      var d = want - Math.max(0, s.extraLeft);
      if (!d) return;
      S.addMove({
        itemId: id, date: date, kind: 'adjust', qty: 0, extra: d,
        memo: '余部を' + want + '部にした'
      });
    }

    /* いまの在庫を、入れられた数に合わせる。差は棚卸しとして残す。
       減らすときは余部から先に減らす */
    function applyLeft(id, date, raw) {
      if (String(raw == null ? '' : raw).trim() === '') return;
      var want = Math.round(U.num(raw, 0));
      var have = K.summary(S.getItem(id)).left;
      var d = want - have;
      if (!d) return;
      S.addMove({
        itemId: id, date: date, kind: 'adjust', qty: d,
        extra: d < 0 ? -K.takeExtra(id, -d) : 0,
        memo: '今の在庫に合わせた'
      });
    }
  }

  DL.views = DL.views || {};
  DL.views.stock = {
    render: render,
    addItem: function (opts) { itemForm(null, opts); },
    openItem: itemSheet,
    reset: function () { year = 0; showArchived = false; }
  };
})(window.DL);
