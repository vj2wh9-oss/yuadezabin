/* 経理：経費とレシートの管理。
   レシートの写真は共有ファイル（R2）に置き、経費側はそのIDだけを持つ。
   写真をアプリのデータに埋めると同期の中身が一気に膨らむため。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, D = DL.docs, E = DL.expenses, F = DL.files, el = U.el;

  // 帳簿ごとにレシートの置き場を分ける
  var RECEIPT_FOLDER = { work: '経費レシート', life: '日常レシート' };

  var book = 'work';     // 事業 / 日常
  var year = 0;          // 表示中の年（0 なら今年）
  var cat = '';          // 科目の絞り込み（空＝すべて）
  var thumbs = {};       // ファイルID → 表示用URL（この画面を開いている間だけ）
  var io = null;

  function currentYear() { return year || U.num(U.today().slice(0, 4), 2026); }

  function render(root) {
    var y = currentYear();
    var wrap = el('div', { class: 'page' });

    /* ---- 事業 / 日常 の切り替え ---- */
    wrap.appendChild(el('div', { class: 'card book-switch' },
      ui.segmented(E.BOOKS, book, function (v) { book = v; cat = ''; DL.app.render(); })));

    /* ---- 年の切り替え ---- */
    wrap.appendChild(el('div', { class: 'year-nav' }, [
      el('button', { class: 'iconbtn', 'aria-label': '前の年', onclick: function () { year = y - 1; DL.app.render(); } }, ui.icon('chevronLeft', 20)),
      el('button', {
        class: 'year-label', text: y + '年',
        onclick: function () { year = U.num(U.today().slice(0, 4), y); DL.app.render(); }
      }),
      el('button', { class: 'iconbtn', 'aria-label': '次の年', onclick: function () { year = y + 1; DL.app.render(); } }, ui.icon('chevronRight', 20))
    ]));

    var isLife = book === 'life';
    var all = S.expenses({ book: book, year: y, scoped: !isLife });
    var spent = E.total(all);

    /* ---- 年間のまとめ ---- */
    wrap.appendChild(ui.section(y + '年の' + (isLife ? '支出' : 'まとめ'),
      el('span', { class: 'muted small', text: all.length + '件' })));
    wrap.appendChild(el('div', { class: 'card sum-grid' }, isLife
      ? lifeBoxes(all, spent, y) : workBoxes(spent, all, y)));

    if (isLife) wrap.appendChild(budgetCard(all, y));

    /* ---- 固定費 ---- */
    var fixed = S.recurring(book);
    var due = E.dueRecurring(fixed);
    if (due.length) wrap.appendChild(dueCard(due));
    wrap.appendChild(ui.section('固定費',
      el('span', { class: 'muted small', text: fixed.length ? '毎月 ' + D.yen(monthlyFixed(fixed)) : '' })));
    wrap.appendChild(fixedCard(fixed));

    /* ---- 科目ごと ---- */
    var cats = E.byCategory(all);
    wrap.appendChild(ui.section('科目ごと'));
    wrap.appendChild(cats.length ? catCard(cats, spent)
      : ui.empty(isLife ? 'まだ支出がありません。右下の＋から追加できます。'
                        : 'まだ経費がありません。右下の＋から追加できます。'));

    /* ---- 月ごと ---- */
    if (all.length) {
      wrap.appendChild(ui.section('月ごと'));
      wrap.appendChild(monthCard(E.byMonth(all, y)));
    }

    /* ---- 一覧 ---- */
    var shown = cat ? all.filter(function (x) { return x.category === cat; }) : all;
    wrap.appendChild(ui.section(isLife ? '支出の一覧' : '経費の一覧',
      cat ? ui.btn('絞り込みを外す', 'ghost tiny', function () { cat = ''; DL.app.render(); }) : null));
    if (cat) {
      wrap.appendChild(el('div', { class: 'row-wrap pad' }, [
        ui.chip(cat + '　' + D.yen(E.total(shown)), 'soft')
      ]));
    }
    if (!shown.length) {
      wrap.appendChild(ui.empty(cat ? 'この科目の記録はありません。' : y + '年の記録はまだありません。'));
    } else {
      var list = el('div', { class: 'list' });
      shown.forEach(function (x) { list.appendChild(expenseRow(x)); });
      wrap.appendChild(list);
    }

    wrap.appendChild(el('div', { class: 'pad row-wrap' }, [
      ui.btn(isLife ? '支出を追加' : '経費を追加', 'primary', function () { addExpense(); }, 'plus'),
      ui.btn('レシートを撮る', 'ghost', function () { addExpense({ shoot: true }); }, 'receipt'),
      ui.btn('CSVで書き出す', 'ghost', function () { exportCSV(all, y); }, 'arrowDown')
    ]));

    wrap.appendChild(el('p', { class: 'muted small pad', text: isLife
      ? 'レシートの写真は共有ファイルの「' + RECEIPT_FOLDER.life + '」に入ります。日常の記録は名義や案件とは結びつけません。'
      : 'レシートの写真は共有ファイルの「' + RECEIPT_FOLDER.work + '」に入り、PCとiPhoneの両方から見られます。'
        + '「売上」と「差引」は、いま選んでいる名義のぶんだけを見ています。' }));

    root.appendChild(wrap);
  }

  /* 事業：売上と突き合わせて残りを見る */
  function workBoxes(spent, all, y) {
    var income = yearIncome(y);
    return [
      sumBox('経費の合計', D.yen(spent), 'big'),
      sumBox('売上', D.yen(income)),
      sumBox('差引', D.yen(income - spent), income - spent < 0 ? 'warn' : 'ok'),
      sumBox('件数', all.length + '件')
    ];
  }

  /* 日常：家計簿として、月あたり・1日あたりの目安を出す */
  function lifeBoxes(all, spent, y) {
    var t = U.today();
    var thisMonth = E.total(all.filter(function (x) { return x.date.slice(0, 7) === t.slice(0, 7); }));
    // 記録のある月だけで割る（まだ来ていない月で薄めない）
    var months = {};
    all.forEach(function (x) { months[x.date.slice(0, 7)] = true; });
    var n = Object.keys(months).length || 1;
    var sameYear = t.slice(0, 4) === String(y);
    return [
      sumBox('支出の合計', D.yen(spent), 'big'),
      sumBox(sameYear ? '今月' : '月あたり', D.yen(sameYear ? thisMonth : Math.round(spent / n))),
      sumBox('1ヶ月の平均', D.yen(Math.round(spent / n))),
      sumBox('件数', all.length + '件')
    ];
  }

  /* 1ヶ月の予算と、今月の残り */
  function budgetCard(all, y) {
    var t = U.today();
    var budget = U.num(S.settings.lifeBudget, 0);
    var thisMonth = E.total(all.filter(function (x) { return x.date.slice(0, 7) === t.slice(0, 7); }));
    var box = el('div', { class: 'card' });

    if (!budget) {
      box.appendChild(el('p', { class: 'muted small', text: '1ヶ月の予算を決めておくと、今月あといくら使えるかが出ます。' }));
      box.appendChild(ui.btn('予算を決める', 'ghost full', function () { budgetSheet(); }, 'plus'));
      return box;
    }
    var left = budget - thisMonth;
    var pct = Math.min(100, Math.round(thisMonth / budget * 100));
    box.appendChild(el('div', { class: 'bg-head' }, [
      el('span', { text: U.num(t.slice(5, 7), 0) + '月の予算' }),
      el('b', { class: left < 0 ? 'over' : '', text: left < 0 ? D.yen(-left) + ' 超過' : '残り ' + D.yen(left) })
    ]));
    box.appendChild(el('div', { class: 'bg-bar' + (left < 0 ? ' over' : '') }, el('i', { style: { width: pct + '%' } })));
    box.appendChild(el('div', { class: 'bg-foot' }, [
      el('span', { class: 'muted small', text: D.yen(thisMonth) + ' / ' + D.yen(budget) + '（' + pct + '%）' }),
      ui.btn('予算を変える', 'ghost tiny', function () { budgetSheet(); })
    ]));
    return box;
  }

  function budgetSheet() {
    var input = ui.input({ type: 'number', inputmode: 'numeric', min: 0,
      value: U.num(S.settings.lifeBudget, 0) || '' });
    var close = ui.sheet({
      title: '1ヶ月の予算',
      body: el('div', { class: 'form' },
        ui.field('予算（円）', input, '0 か空にすると、予算の表示をやめます')),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.updateSettings({ lifeBudget: Math.max(0, U.num(input.value, 0)) });
          close(); ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- 固定費 ---------------- */

  function monthlyFixed(list) {
    return list.filter(function (r) { return r.active; })
      .reduce(function (n, r) { return n + r.amount; }, 0);
  }

  /* まだ記録していない月があることを知らせる */
  function dueCard(due) {
    var total = due.reduce(function (n, d) { return n + d.amount; }, 0);
    var months = {};
    due.forEach(function (d) { months[d.ym] = true; });
    var names = due.slice(0, 3).map(function (d) { return d.name; }).join('・')
      + (due.length > 3 ? ' ほか' : '');
    return el('div', { class: 'card due-card' }, [
      el('div', { class: 'row-title' }, [
        ui.icon('info', 17),
        el('span', { text: '固定費が ' + due.length + '件（' + Object.keys(months).length + 'ヶ月ぶん）まだ記録されていません' })
      ]),
      el('div', { class: 'muted small', text: names + '　合計 ' + D.yen(total) }),
      el('div', { class: 'row-wrap' }, [
        ui.btn('まとめて記録', 'primary', function () {
          var n = S.postRecurring(due);
          ui.toast(n + '件を記録しました');
        }, 'check'),
        ui.btn('内訳を見る', 'ghost', function () { dueSheet(due); })
      ])
    ]);
  }

  function dueSheet(due) {
    var list = el('div', { class: 'fb-preview' });
    due.forEach(function (d) {
      list.appendChild(el('div', { class: 'fb-prow' }, [
        el('span', { text: d.ym.replace('-', '年') + '月　' + d.name }),
        el('b', { text: D.yen(d.amount) })
      ]));
    });
    var close = ui.sheet({
      title: 'これから記録する固定費',
      body: el('div', { class: 'form' }, [
        el('p', { class: 'muted small', text: '記録すると、それぞれの月の経費として入ります。日付は固定費に決めた「毎月◯日」です。' }),
        list
      ]),
      actions: [
        ui.btn('やめる', 'ghost', function () { close(); }),
        ui.btn('記録する', 'primary', function () {
          var n = S.postRecurring(due); close(); ui.toast(n + '件を記録しました');
        })
      ]
    });
  }

  function fixedCard(list) {
    var box = el('div', { class: 'card' });
    if (!list.length) {
      box.appendChild(el('p', { class: 'muted small',
        text: '家賃・通信費・サブスクのように毎月きまって出るものを登録しておくと、月が変わったときにまとめて記録できます。' }));
    } else {
      var rows = el('div', { class: 'fx-list' });
      list.forEach(function (r) {
        rows.appendChild(el('button', {
          class: 'fx-row' + (r.active ? '' : ' off'),
          onclick: function () { recurringSheet(r); }
        }, [
          el('div', { class: 'fx-main' }, [
            el('div', { class: 'row-title' }, [
              el('span', { text: r.name }),
              r.active ? null : ui.chip('休止中', 'ghosty')
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip('毎月' + r.day + '日', 'soft'),
              ui.chip(r.category, 'ghosty'),
              r.lastYm ? el('span', { class: 'muted small', text: '最後 ' + r.lastYm.replace('-', '/') }) : null
            ])
          ]),
          el('b', { class: 'fx-v', text: D.yen(r.amount) }),
          el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
        ]));
      });
      box.appendChild(rows);
    }
    box.appendChild(ui.btn('固定費を登録', 'ghost full', function () { recurringSheet(null); }, 'plus'));
    return box;
  }

  function recurringSheet(r) {
    var isNew = !r;
    var bk = r ? r.book : book;
    var cats = E.categories(bk);
    var nameIn = ui.input({ value: r ? r.name : '', maxlength: 40,
      placeholder: bk === 'life' ? '例）家賃 / スマホ代' : '例）サーバー代 / 事務所家賃' });
    var amountIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: r ? r.amount : '' });
    var dayIn = ui.input({ type: 'number', inputmode: 'numeric', min: 1, max: 31, value: r ? r.day : 1 });
    var startIn = ui.input({ type: 'month', value: r ? r.startYm : U.today().slice(0, 7) });
    var catOpts = cats.slice();
    if (r && catOpts.indexOf(r.category) < 0) catOpts.unshift(r.category);
    var catSel = ui.select(catOpts.map(function (c) { return { value: c, label: c }; }), r ? r.category : cats[0]);
    var activeChk = el('input', { type: 'checkbox', class: 'check', checked: r ? r.active : true });

    var close = ui.sheet({
      title: (isNew ? '固定費を登録' : '固定費を編集') + '（' + E.bookLabel(bk) + '）',
      body: el('div', { class: 'form' }, [
        ui.field('名前', nameIn),
        el('div', { class: 'grid2' }, [
          ui.field('金額（円）', amountIn),
          ui.field('毎月何日', dayIn, '無い日は月末に寄せます')
        ]),
        ui.field('科目', catSel),
        ui.field('いつから', startIn, 'この月のぶんから記録できるようになります'),
        el('label', { class: 'row-check' }, [activeChk, el('span', { text: '記録の対象にする' })]),
        !isNew ? ui.btn('この固定費を削除', 'danger full mt', function () {
          ui.confirm('「' + r.name + '」を削除します。記録済みの経費はそのまま残ります。',
            { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeRecurring(r.id); close(); ui.toast('削除しました');
          });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var name = nameIn.value.trim();
          if (!name) { ui.toast('名前を入れてください', 'warn'); return; }
          if (!U.num(amountIn.value, 0)) { ui.toast('金額を入れてください', 'warn'); return; }
          var data = {
            book: bk, name: name, amount: U.num(amountIn.value, 0),
            category: catSel.value, day: U.num(dayIn.value, 1),
            startYm: startIn.value, active: activeChk.checked
          };
          if (isNew) S.addRecurring(data); else S.updateRecurring(r.id, data);
          close(); ui.toast(isNew ? '登録しました' : '保存しました');
        })
      ]
    });
  }

  /* ---------------- CSV ---------------- */

  function exportCSV(rows, y) {
    if (!rows.length) { ui.toast('書き出すものがありません', 'warn'); return; }
    var csv = E.toCSV(rows, {
      project: function (id) { var p = S.getProject(id); return p ? p.title : ''; },
      issuer: function (id) { var i = S.getIssuer(id); return i ? i.name : ''; }
    });
    var name = 'METEO365_' + (book === 'life' ? '日常' : '事業') + '_' + y + '.csv';
    ui.download(name, csv, 'text/csv');
    ui.toast(rows.length + '件を書き出しました');
  }

  function sumBox(label, value, cls) {
    return el('div', { class: 'sum-box ' + (cls || '') }, [
      el('span', { text: label }), el('b', { text: value })
    ]);
  }

  /* 売上（請求書＋支援金）。経費と同じ絞り込みで見る */
  function yearIncome(y) {
    var scope = S.scopeId();
    var docs = S.allDocs().filter(function (e) {
      if (String(e.doc.issueDate).slice(0, 4) !== String(y)) return false;
      return !scope || (e.doc.issuerId || '') === scope;
    });
    var fb = S.fanboxInScope() ? S.fanbox(y) : [];
    return D.sales(docs).total + fb.reduce(function (s, r) { return s + r.amount; }, 0);
  }

  /* ---------------- 科目ごと ---------------- */

  function catCard(cats, spent) {
    var box = el('div', { class: 'card cat-list' });
    cats.forEach(function (c) {
      var pct = spent ? Math.round(c.amount / spent * 100) : 0;
      box.appendChild(el('button', {
        class: 'cat-row' + (cat === c.category ? ' on' : ''),
        onclick: function () { cat = (cat === c.category ? '' : c.category); DL.app.render(); }
      }, [
        el('span', { class: 'cat-name', text: c.category }),
        el('span', { class: 'cat-bar' }, el('i', { style: { width: pct + '%' } })),
        el('b', { class: 'cat-v', text: D.yen(c.amount) }),
        el('span', { class: 'cat-p', text: pct + '%' })
      ]));
    });
    return box;
  }

  function monthCard(months) {
    var max = Math.max.apply(null, months.map(function (x) { return x.amount; }).concat([1]));
    var box = el('div', { class: 'card month-sales' });
    var now = U.today().slice(0, 7);
    months.forEach(function (x) {
      box.appendChild(el('div', { class: 'ms-row' + (x.ym === now ? ' now' : '') + (x.amount ? '' : ' zero') }, [
        el('span', { class: 'ms-m', text: x.m + '月' }),
        el('span', { class: 'ms-bar' }, el('i', { style: { width: Math.round(x.amount / max * 100) + '%' } })),
        el('span', { class: 'ms-v', text: x.amount ? D.yen(x.amount) : '—' }),
        el('span', { class: 'ms-u', text: x.count ? x.count + '件' : '' })
      ]));
    });
    return box;
  }

  /* ---------------- 一覧の1行 ---------------- */

  function expenseRow(x) {
    var p = (x.book !== 'life' && x.projectId) ? S.getProject(x.projectId) : null;
    var issuer = (x.book !== 'life' && x.issuerId) ? S.getIssuer(x.issuerId) : null;
    var shot = el('span', { class: 'ex-shot' + (x.fileId ? '' : ' none') },
      x.fileId ? ui.icon('receipt', 18) : ui.icon('receipt', 16));
    if (x.fileId) prepareThumb(shot, x.fileId);

    return el('button', { class: 'row ex-row', onclick: function () { editExpense(x.id); } }, [
      shot,
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: x.vendor || x.category }),
          el('b', { class: 'ex-amount', text: D.yen(x.amount) })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(U.fmtMD(x.date), 'soft'),
          ui.chip(x.category, 'ghosty'),
          p ? ui.chip(p.title, 'ghosty') : null,
          issuer ? ui.chip(issuer.name || '名義', 'ghosty') : null,
          x.memo ? el('span', { class: 'muted small', text: x.memo }) : null
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* ---------------- レシートの絵を出す ---------------- */

  function prepareThumb(box, fileId) {
    if (thumbs[fileId]) { showThumb(box, thumbs[fileId]); return; }
    if (!F.ready() || !window.IntersectionObserver) return;
    box._fileId = fileId;
    observer().observe(box);
  }

  function observer() {
    if (io) return io;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        fetchThumb(en.target);
      });
    }, { rootMargin: '300px' });
    return io;
  }

  function fetchThumb(box) {
    var id = box._fileId;
    if (!id || thumbs[id]) return;
    F.fetchBytes(id).then(function (bytes) {
      var url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      thumbs[id] = url;
      // 取っている間に描き直されていることがあるので、いま出ている枠を探す
      showThumb(box, url);
      U.$$('.ex-shot').forEach(function (n) {
        if (n !== box && n._fileId === id) showThumb(n, url);
      });
    }).catch(function () { /* 取れなければ印のまま */ });
  }

  function showThumb(box, url) {
    box.classList.remove('none');
    box.classList.add('has-shot');
    U.clear(box);
    box.appendChild(el('img', { src: url, alt: '', loading: 'lazy' }));
  }

  function dropThumbs() {
    Object.keys(thumbs).forEach(function (id) {
      try { URL.revokeObjectURL(thumbs[id]); } catch (e) { /* 解放済みなら気にしない */ }
    });
    thumbs = {};
    if (io) { io.disconnect(); io = null; }
  }

  /* ---------------- 追加・編集 ---------------- */

  function addExpense(opts) { expenseSheet(null, opts || {}); }
  function editExpense(id) { expenseSheet(S.getExpense(id)); }

  /**
   * 経費の入力。
   * @param {object} [x] 既存の経費（無ければ新規）
   * @param {object} [opts] {shoot} 開いてすぐカメラを出す
   */
  function expenseSheet(x, opts) {
    opts = opts || {};
    var isNew = !x;
    // 編集のときはその記録の帳簿、新規のときはいま見ている帳簿
    var bk = x ? x.book : book;
    var isLife = bk === 'life';
    var cats = E.categories(bk);
    var v = {
      date: x ? x.date : U.today(),
      amount: x ? x.amount : '',
      category: x ? x.category : cats[0],
      vendor: x ? x.vendor : '',
      memo: x ? x.memo : '',
      projectId: x ? x.projectId : '',
      issuerId: x ? x.issuerId : (S.scopeId() || S.settings.defaultIssuerId || ''),
      fileId: x ? x.fileId : ''
    };
    var picked = null;      // まだ送っていない写真

    var dateIn = ui.input({ type: 'date', value: v.date });
    var amountIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: v.amount, placeholder: '0' });
    var vendorIn = ui.input({
      value: v.vendor, maxlength: 60,
      placeholder: isLife ? '例）スーパー / ドラッグストア' : '例）○○印刷 / 画材店'
    });
    var memoIn = ui.input({ value: v.memo, placeholder: '内容のメモ', maxlength: 120 });

    // 選んだ科目が帳簿に無いとき（帳簿を切り替えた記録）も選べるようにしておく
    var catOpts = cats.slice();
    if (catOpts.indexOf(v.category) < 0) catOpts.unshift(v.category);
    var catSel = ui.select(catOpts.map(function (c) { return { value: c, label: c }; }), v.category);
    catSel.addEventListener('change', function () { v.category = catSel.value; });

    // 帳簿の切り替え。事業↔日常を後から直せるようにする
    var bookSeg = ui.segmented(E.BOOKS, bk, function (val) {
      // 科目は帳簿ごとに別なので、切り替えたらその帳簿の先頭に戻す
      var keep = collect();
      close();
      expenseSheet(
        x ? Object.assign({}, x, keep, { book: val, category: E.categories(val)[0] }) : null,
        { keep: keep, book: val }
      );
    });

    // 案件（印刷費などを案件に紐づける）。日常では使わない
    var projSel = isLife ? null : ui.select(
      [{ value: '', label: '（紐づけない）' }].concat(
        S.projects().filter(function (p) { return p.status !== 'archived'; })
          .map(function (p) { return { value: p.id, label: p.title }; })
      ), v.projectId);

    var issuerSel = null;
    if (!isLife && S.issuers().length > 1) {
      issuerSel = ui.select(
        [{ value: '', label: '（指定しない）' }].concat(S.issuers().map(function (i) {
          return { value: i.id, label: i.name || '(名称未設定)' };
        })), v.issuerId);
    }

    /* いま入力されている内容（帳簿を切り替えても打ち直さなくて済むように） */
    function collect() {
      return {
        date: dateIn.value, amount: U.num(amountIn.value, 0),
        vendor: vendorIn.value, memo: memoIn.value, fileId: v.fileId
      };
    }
    // 帳簿を切り替えて開き直したときは、打った内容を引き継ぐ
    if (opts.keep) {
      dateIn.value = opts.keep.date || v.date;
      amountIn.value = opts.keep.amount || '';
      vendorIn.value = opts.keep.vendor || '';
      memoIn.value = opts.keep.memo || '';
      v.fileId = opts.keep.fileId || '';
    }

    /* --- レシートの写真 --- */
    var shotBox = el('div', { class: 'shot-box' });
    function renderShot() {
      U.clear(shotBox);
      if (picked) {
        shotBox.appendChild(el('img', { class: 'shot-preview', src: URL.createObjectURL(picked), alt: '' }));
        shotBox.appendChild(el('div', { class: 'muted small', text: picked.name + '（保存すると送ります）' }));
        shotBox.appendChild(el('div', { class: 'row-wrap' }, [
          ui.btn('金額を読み取る', 'ghost tiny', function () { readAmount(picked); }, 'search'),
          ui.btn('取り消す', 'ghost tiny', function () { picked = null; renderShot(); })
        ]));
        shotBox.appendChild(ocrBox);
        return;
      }
      if (v.fileId) {
        var img = el('img', { class: 'shot-preview', alt: '' });
        shotBox.appendChild(img);
        shotBox.appendChild(ocrBox);
        if (thumbs[v.fileId]) img.src = thumbs[v.fileId];
        else F.fetchBytes(v.fileId).then(function (b) {
          var url = URL.createObjectURL(new Blob([b], { type: 'image/jpeg' }));
          thumbs[v.fileId] = url; img.src = url;
        }).catch(function () { U.clear(shotBox); shotBox.appendChild(el('div', { class: 'muted small', text: '写真を取り出せませんでした' })); });
        shotBox.appendChild(el('div', { class: 'row-wrap' }, [
          ui.btn('金額を読み取る', 'ghost tiny', function () { readSaved(v.fileId); }, 'search'),
          ui.btn('撮り直す', 'ghost tiny', function () { pick(true); }, 'receipt'),
          ui.btn('写真を外す', 'ghost tiny', function () { v.fileId = ''; renderShot(); })
        ]));
        return;
      }
      if (!F.ready()) {
        shotBox.appendChild(el('div', { class: 'muted small',
          text: '写真を残すには、先に同期の接続先を設定してください（設定 →「PC・iPhone の同期」）。金額だけなら今のまま登録できます。' }));
        return;
      }
      shotBox.appendChild(el('div', { class: 'row-wrap' }, [
        ui.btn('レシートを撮る', 'ghost', function () { pick(true); }, 'receipt'),
        ui.btn('写真を選ぶ', 'ghost', function () { pick(false); }, 'illust')
      ]));
    }

    /* --- レシートから金額を読み取る --- */
    var ocrBox = el('div', { class: 'ocr-box' });
    var ocrBusy = false;

    function readSaved(fileId) {
      if (thumbs[fileId]) return fetch(thumbs[fileId]).then(function (r) { return r.blob(); }).then(readAmount);
      ui.toast('写真を取り出しています…');
      F.fetchBytes(fileId).then(function (b) { readAmount(new Blob([b], { type: 'image/jpeg' })); })
        .catch(function (e) { ui.toast(e.message, 'danger'); });
    }

    function readAmount(blob) {
      if (ocrBusy) return;
      ocrBusy = true;
      U.clear(ocrBox);
      var note = el('div', { class: 'muted small', text: '読み取っています…（初回は部品の取得に少しかかります）' });
      var bar = ui.progress(0, null);
      ocrBox.appendChild(note); ocrBox.appendChild(bar);

      DL.ocr.read(blob, function (p) {
        var i = bar.querySelector('i');
        if (i) i.style.width = Math.round(p * 100) + '%';
      }).then(function (r) {
        ocrBusy = false;
        U.clear(ocrBox);
        if (!r.amounts.length) {
          ocrBox.appendChild(el('div', { class: 'muted small', text: '金額を見つけられませんでした。明るいところで、まっすぐ写すと読み取りやすくなります。' }));
          return;
        }
        ocrBox.appendChild(el('div', { class: 'muted small', text: '読み取った候補（タップで金額に入ります）' }));
        var row = el('div', { class: 'row-wrap' });
        r.amounts.forEach(function (c, i) {
          row.appendChild(ui.btn(D.yen(c.value), i === 0 ? 'tiny' : 'ghost tiny', function () {
            amountIn.value = c.value;
            ui.toast(D.yen(c.value) + ' を入れました');
          }));
        });
        ocrBox.appendChild(row);
      }).catch(function (e) {
        ocrBusy = false;
        U.clear(ocrBox);
        ocrBox.appendChild(el('div', { class: 'muted small', text: e.message }));
      });
    }

    /* カメラを開く（capture を付けると iPhone では撮影が先に出る） */
    function pick(useCamera) {
      var input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      if (useCamera) input.setAttribute('capture', 'environment');
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        var f = input.files[0];
        input.remove();
        if (!f) return;
        ui.toast('写真を整えています…');
        E.shrink(f).then(function (small) { picked = small; renderShot(); });
      });
      input.click();
    }
    renderShot();

    var close = ui.sheet({
      title: (isNew ? '追加' : '編集') + '（' + E.bookLabel(bk) + '）',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'grid2' }, [
          ui.field('日付', dateIn),
          ui.field('金額（円）', amountIn)
        ]),
        ui.field('帳簿', bookSeg, '事業＝仕事の経費／日常＝家計簿'),
        ui.field('科目', catSel),
        ui.field('支払先', vendorIn),
        ui.field('メモ', memoIn),
        projSel ? ui.field('案件', projSel, '印刷費などを案件に紐づけると、案件ごとの出費が分かります') : null,
        issuerSel ? ui.field('名義', issuerSel, '名義を絞って見ているとき、その名義の経費として数えます') : null,
        ui.field('レシート', shotBox),
        !isNew ? ui.btn('この経費を削除', 'danger full mt', function () {
          ui.confirm('この経費を削除します。', { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeExpense(x.id); close(); ui.toast('削除しました');
          });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () { save(); })
      ]
    });

    function save() {
      var amount = U.num(amountIn.value, 0);
      if (!amount) { ui.toast('金額を入れてください', 'warn'); return; }
      var data = {
        book: bk,
        date: dateIn.value, amount: amount, category: catSel.value,
        vendor: vendorIn.value.trim(), memo: memoIn.value.trim(),
        // 日常は案件にも名義にも紐づけない
        projectId: isLife ? '' : (projSel ? projSel.value : ''),
        issuerId: isLife ? '' : (issuerSel ? issuerSel.value : v.issuerId),
        fileId: v.fileId
      };

      if (!picked) { commit(data); return; }
      // 写真は共有ファイルへ。名前は日付と支払先から作る
      ui.toast('レシートを送っています…');
      var folder = RECEIPT_FOLDER[bk] || RECEIPT_FOLDER.work;
      var name = data.date + (data.vendor ? '_' + data.vendor.replace(/[\\\/:*?"<>|]/g, '_') : '') + '.jpg';
      var file = new File([picked], name, { type: picked.type || 'image/jpeg' });
      F.upload(file, { folder: folder, projectId: data.projectId })
        .then(function (r) {
          if (r && r.id) {
            S.setFileFolder(r.id, S.ensureFolderPath(folder));
            data.fileId = r.id;
          }
          commit(data);
        })
        .catch(function (e) {
          ui.toast('写真を送れませんでした：' + e.message, 'danger');
          commit(data);      // 金額の記録だけは残す
        });
    }

    function commit(data) {
      if (isNew) S.addExpense(data);
      else S.updateExpense(x.id, data);
      close();
      ui.toast(isNew ? '追加しました' : '保存しました');
    }

    if (opts.shoot && F.ready()) setTimeout(function () { pick(true); }, 250);
  }

  DL.views = DL.views || {};
  DL.views.books = {
    render: render,
    addExpense: addExpense,
    reset: function () { book = 'work'; year = 0; cat = ''; dropThumbs(); }
  };
})(window.DL);
