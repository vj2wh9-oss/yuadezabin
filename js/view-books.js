/* 経理：経費とレシートの管理。
   レシートの写真は共有ファイル（R2）に置き、経費側はそのIDだけを持つ。
   写真をアプリのデータに埋めると同期の中身が一気に膨らむため。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, D = DL.docs, E = DL.expenses, F = DL.files, el = U.el;

  var RECEIPT_FOLDER = '経費レシート';

  var year = 0;          // 表示中の年（0 なら今年）
  var cat = '';          // 科目の絞り込み（空＝すべて）
  var thumbs = {};       // ファイルID → 表示用URL（この画面を開いている間だけ）
  var io = null;

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

    var all = S.expenses({ year: y, scoped: true });
    var spent = E.total(all);

    /* ---- 年間のまとめ ---- */
    var income = yearIncome(y);
    wrap.appendChild(ui.section(y + '年のまとめ', el('span', { class: 'muted small', text: all.length + '件' })));
    wrap.appendChild(el('div', { class: 'card sum-grid' }, [
      sumBox('経費の合計', D.yen(spent), 'big'),
      sumBox('売上', D.yen(income)),
      sumBox('差引', D.yen(income - spent), income - spent < 0 ? 'warn' : 'ok'),
      sumBox('件数', all.length + '件')
    ]));

    /* ---- 科目ごと ---- */
    var cats = E.byCategory(all);
    wrap.appendChild(ui.section('科目ごと'));
    wrap.appendChild(cats.length ? catCard(cats, spent)
      : ui.empty('まだ経費がありません。右下の＋から追加できます。'));

    /* ---- 月ごと ---- */
    if (all.length) {
      wrap.appendChild(ui.section('月ごと'));
      wrap.appendChild(monthCard(E.byMonth(all, y)));
    }

    /* ---- 一覧 ---- */
    var shown = cat ? all.filter(function (x) { return x.category === cat; }) : all;
    wrap.appendChild(ui.section('経費の一覧',
      cat ? ui.btn('絞り込みを外す', 'ghost tiny', function () { cat = ''; DL.app.render(); }) : null));
    if (cat) {
      wrap.appendChild(el('div', { class: 'row-wrap pad' }, [
        ui.chip(cat + '　' + D.yen(E.total(shown)), 'soft')
      ]));
    }
    if (!shown.length) {
      wrap.appendChild(ui.empty(cat ? 'この科目の経費はありません。' : y + '年の経費はまだありません。'));
    } else {
      var list = el('div', { class: 'list' });
      shown.forEach(function (x) { list.appendChild(expenseRow(x)); });
      wrap.appendChild(list);
    }

    wrap.appendChild(el('div', { class: 'pad row-wrap' }, [
      ui.btn('経費を追加', 'primary', function () { addExpense(); }, 'plus'),
      ui.btn('レシートを撮る', 'ghost', function () { addExpense({ shoot: true }); }, 'receipt')
    ]));

    wrap.appendChild(el('p', { class: 'muted small pad', text:
      'レシートの写真は共有ファイルの「' + RECEIPT_FOLDER + '」に入り、PCとiPhoneの両方から見られます。'
      + '「売上」と「差引」は、いま選んでいる名義のぶんだけを見ています。' }));

    root.appendChild(wrap);
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
        el('span', { class: 'cat-dot', style: { background: E.color(c.category) } }),
        el('span', { class: 'cat-name', text: c.category }),
        el('span', { class: 'cat-bar' }, el('i', { style: { width: pct + '%', background: E.color(c.category) } })),
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
    var p = x.projectId ? S.getProject(x.projectId) : null;
    var issuer = x.issuerId ? S.getIssuer(x.issuerId) : null;
    var shot = el('span', { class: 'ex-shot' + (x.fileId ? '' : ' none') },
      x.fileId ? ui.icon('receipt', 18) : ui.icon('receipt', 16));
    if (x.fileId) prepareThumb(shot, x.fileId);

    return el('button', { class: 'row ex-row', onclick: function () { editExpense(x.id); } }, [
      shot,
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { class: 'cat-dot', style: { background: E.color(x.category) } }),
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

  function addExpense(opts) { expenseSheet(null, opts); }
  function editExpense(id) { expenseSheet(S.getExpense(id)); }

  /**
   * 経費の入力。
   * @param {object} [x] 既存の経費（無ければ新規）
   * @param {object} [opts] {shoot} 開いてすぐカメラを出す
   */
  function expenseSheet(x, opts) {
    opts = opts || {};
    var isNew = !x;
    var v = {
      date: x ? x.date : U.today(),
      amount: x ? x.amount : '',
      category: x ? x.category : '印刷費',
      vendor: x ? x.vendor : '',
      memo: x ? x.memo : '',
      projectId: x ? x.projectId : '',
      issuerId: x ? x.issuerId : (S.scopeId() || S.settings.defaultIssuerId || ''),
      fileId: x ? x.fileId : ''
    };
    var picked = null;      // まだ送っていない写真

    var dateIn = ui.input({ type: 'date', value: v.date });
    var amountIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: v.amount, placeholder: '0' });
    var vendorIn = ui.input({ value: v.vendor, placeholder: '例）○○印刷 / 画材店', maxlength: 60 });
    var memoIn = ui.input({ value: v.memo, placeholder: '内容のメモ', maxlength: 120 });

    var catSel = ui.select(E.CATEGORIES.map(function (c) { return { value: c, label: c }; }), v.category);
    catSel.addEventListener('change', function () { v.category = catSel.value; });

    // 案件（印刷費などを案件に紐づける）
    var projSel = ui.select(
      [{ value: '', label: '（紐づけない）' }].concat(
        S.projects().filter(function (p) { return p.status !== 'archived'; })
          .map(function (p) { return { value: p.id, label: p.title }; })
      ), v.projectId);

    var issuerSel = null;
    if (S.issuers().length > 1) {
      issuerSel = ui.select(
        [{ value: '', label: '（指定しない）' }].concat(S.issuers().map(function (i) {
          return { value: i.id, label: i.name || '(名称未設定)' };
        })), v.issuerId);
    }

    /* --- レシートの写真 --- */
    var shotBox = el('div', { class: 'shot-box' });
    function renderShot() {
      U.clear(shotBox);
      if (picked) {
        shotBox.appendChild(el('img', { class: 'shot-preview', src: URL.createObjectURL(picked), alt: '' }));
        shotBox.appendChild(el('div', { class: 'muted small', text: picked.name + '（保存すると送ります）' }));
        shotBox.appendChild(ui.btn('取り消す', 'ghost tiny', function () { picked = null; renderShot(); }));
        return;
      }
      if (v.fileId) {
        var img = el('img', { class: 'shot-preview', alt: '' });
        shotBox.appendChild(img);
        if (thumbs[v.fileId]) img.src = thumbs[v.fileId];
        else F.fetchBytes(v.fileId).then(function (b) {
          var url = URL.createObjectURL(new Blob([b], { type: 'image/jpeg' }));
          thumbs[v.fileId] = url; img.src = url;
        }).catch(function () { U.clear(shotBox); shotBox.appendChild(el('div', { class: 'muted small', text: '写真を取り出せませんでした' })); });
        shotBox.appendChild(el('div', { class: 'row-wrap' }, [
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
      title: isNew ? '経費を追加' : '経費を編集',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'grid2' }, [
          ui.field('日付', dateIn),
          ui.field('金額（円）', amountIn)
        ]),
        ui.field('科目', catSel),
        ui.field('支払先', vendorIn),
        ui.field('メモ', memoIn),
        ui.field('案件', projSel, '印刷費などを案件に紐づけると、案件ごとの出費が分かります'),
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
        date: dateIn.value, amount: amount, category: catSel.value,
        vendor: vendorIn.value.trim(), memo: memoIn.value.trim(),
        projectId: projSel.value, issuerId: issuerSel ? issuerSel.value : v.issuerId,
        fileId: v.fileId
      };

      if (!picked) { commit(data); return; }
      // 写真は共有ファイルへ。名前は日付と支払先から作る
      ui.toast('レシートを送っています…');
      var name = data.date + (data.vendor ? '_' + data.vendor.replace(/[\\\/:*?"<>|]/g, '_') : '') + '.jpg';
      var file = new File([picked], name, { type: picked.type || 'image/jpeg' });
      F.upload(file, { folder: RECEIPT_FOLDER, projectId: data.projectId })
        .then(function (r) {
          if (r && r.id) {
            S.setFileFolder(r.id, S.ensureFolderPath(RECEIPT_FOLDER));
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
    reset: function () { year = 0; cat = ''; dropThumbs(); }
  };
})(window.DL);
