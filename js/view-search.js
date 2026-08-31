/* 横断検索の画面：打ち込むそばから、種類ごとに並べて出す */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, F = DL.files, el = U.el;

  var keyword = '';
  var files = null;        // ファイルの一覧（開くたびに取り直すほどではないので少し持つ）
  var filesAt = 0;
  var STALE_MS = 60000;
  var loadingFiles = false;
  var fileError = '';

  function render(root) {
    var wrap = el('div', { class: 'page view-search-page' });

    var input = ui.input({
      value: keyword, type: 'search',
      placeholder: '案件・書類・経費・予定・ファイルから探す',
      enterkeyhint: 'search'
    });
    input.addEventListener('input', function () {
      keyword = input.value;
      draw();
    });
    // 消すボタン（iPhone の検索欄の × と同じ働き）
    var clear = el('button', {
      class: 'iconbtn small search-clear', 'aria-label': '消す',
      onclick: function () { keyword = ''; input.value = ''; input.focus(); draw(); }
    }, ui.icon('close', 16));

    var bar = el('div', { class: 'searchbox big' }, [ui.icon('search', 18), input, clear]);
    wrap.appendChild(bar);

    var results = el('div', { class: 'search-results' });
    wrap.appendChild(results);
    root.appendChild(wrap);

    // ファイルの一覧は非同期。まず在るものを出して、届いたら描き直す
    if (F.ready() && !loadingFiles && (!files || Date.now() - filesAt > STALE_MS)) {
      loadingFiles = true;
      F.list().then(function (r) {
        files = (r && r.files) || [];
        filesAt = Date.now();
        loadingFiles = false;
        draw();
      }).catch(function (e) {
        fileError = e.message; loadingFiles = false; draw();
      });
    }

    function draw() {
      clear.hidden = !keyword;
      U.clear(results);
      var q = keyword.trim();
      if (!q) { results.appendChild(hintBox()); return; }

      var r = DL.search.run(q, { files: files || [] });
      if (!r.total) {
        results.appendChild(ui.empty('「' + q + '」に当たるものはありませんでした。'));
        results.appendChild(el('p', { class: 'muted small pad', text:
          '言葉を短くするか、空白で区切らずに打ってみてください。空白で区切ると「どちらも入っているもの」を探します。' }));
        return;
      }

      results.appendChild(el('p', { class: 'muted small pad', text: r.total + '件見つかりました' }));
      r.groups.forEach(function (g) {
        results.appendChild(ui.section(g.label, el('span', { class: 'muted small',
          text: g.count > g.items.length ? g.items.length + ' / ' + g.count + '件' : g.count + '件' })));
        var list = el('div', { class: 'list' });
        g.items.forEach(function (it) { list.appendChild(row(it, g.icon)); });
        results.appendChild(list);
      });

      if (loadingFiles) {
        results.appendChild(el('p', { class: 'muted small pad', text: 'ファイルの一覧を取りに行っています…' }));
      } else if (fileError) {
        results.appendChild(el('p', { class: 'muted small pad', text: 'ファイルは探せませんでした：' + fileError }));
      }
    }

    draw();
    // 開いた直後は打てる状態にしておく（iPhone では自動で出さない）
    if (!keyword) setTimeout(function () { input.focus(); }, 80);
  }

  /* まだ何も打っていないときの案内 */
  function hintBox() {
    return el('div', { class: 'card' }, [
      el('div', { class: 'muted small', text: 'ここから探せるもの' }),
      el('div', { class: 'row-wrap mt' }, DL.search.KINDS.map(function (k) {
        return ui.chip(k.label, 'ghosty');
      })),
      el('p', { class: 'muted small', text:
        '空白で区切ると、どちらも入っているものだけを出します（例：「印刷 8月」）。'
        + 'カタカナ・ひらがな・全角半角は区別しません。' })
    ]);
  }

  function row(it, groupIcon) {
    var sub = (it.sub || []).filter(Boolean);
    var body = el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title' }, [
        it.color ? el('span', { class: 'dot', style: { background: it.color } }) : null,
        el('span', { text: it.title })
      ]),
      el('div', { class: 'row-sub' }, [
        it.date ? ui.chip(U.fmtMD(it.date), 'soft') : null
      ].concat(sub.map(function (s) { return ui.chip(s, 'ghosty'); }))
        .concat(it.note ? [el('span', { class: 'muted small', text: it.note })] : []))
    ]);
    var kids = [
      ui.icon(it.icon || groupIcon, 17),
      body,
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ];
    var cls = 'row sr-row' + (it.dim ? ' dim' : '');

    if (it.href) return el('a', { class: cls, href: it.href }, kids);
    return el('button', { class: cls, onclick: function () { open(it); } }, kids);
  }

  /* 画面を持たないものは、その場で開く（経費・予定・取引先・ファイル） */
  function open(it) {
    if (it.open === 'expense') {
      location.hash = '#/books';
      setTimeout(function () { DL.views.books.editExpense(it.id); }, 60);
      return;
    }
    if (it.open === 'recurring') {
      location.hash = '#/books';
      setTimeout(function () { DL.views.books.editRecurring(it.id); }, 60);
      return;
    }
    if (it.open === 'event') {
      var ev = S.getEvent(it.id);
      if (!ev) { ui.toast('予定が見つかりません', 'warn'); return; }
      // 日常の予定なので、カレンダーもそちら側に切り替えてから開く
      S.setCalMode('life');
      location.hash = '#/day/' + ev.date;
      return;
    }
    if (it.open === 'client') { DL.forms.clientSheet(it.id); return; }
    if (it.open === 'file') {
      DL.views.files.openAt(it.id);
      location.hash = '#/files';
      return;
    }
  }

  DL.views = DL.views || {};
  DL.views.search = {
    render: render,
    // 別の画面へ行ったら、次に開くときは新しい一覧を取り直す
    reset: function () { keyword = ''; files = null; filesAt = 0; fileError = ''; }
  };
})(window.DL);
