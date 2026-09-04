/* レシートを撮って、読み取った内容を確かめてから経費に入れる。

   撮る → 紙だけ切り出す → 送る → 読む → ここで確かめる → 経費へ。

   読み取りは当たることも外すこともあるので、
   「そのまま入る」のではなく、必ず一度この画面で見せて直せるようにする。
   合計と品目が食い違うときや、向こうが「不鮮明」と言ってきたときは、
   その旨をここに出す。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, E = DL.expenses, D = DL.docs, R = DL.receipt, el = U.el;

  /* ---------------- 入口 ---------------- */

  /**
   * カメラ（または写真選択）から始めて、確認画面まで進む。
   * @param {object} [opts] {book:'work'|'life', camera:false で写真選択, onDone:fn(expense)}
   */
  function scan(opts) {
    opts = opts || {};
    if (!R.ready()) {
      ui.toast('先に「PC・iPhone の同期」を設定してください', 'danger');
      location.hash = '#/settings';
      return;
    }
    pick(opts.camera !== false, function (file) {
      run(file, opts);
    });
  }

  function pick(useCamera, cb) {
    var input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    if (useCamera) input.setAttribute('capture', 'environment');
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files[0];
      input.remove();
      if (f) cb(f);
    });
    input.click();
  }

  /* 進み具合を出しながら読み取り、終わったら確認画面を開く */
  function run(file, opts) {
    var STEP = { crop: 'レシートを切り出しています…', upload: '送っています…', read: '読み取っています…' };
    var note = el('p', { class: 'muted small', text: STEP.crop });
    var shot = el('div', { class: 'rc-shot' });
    var body = el('div', { class: 'form rc-wait' }, [shot, note, ui.progress(30, null)]);
    var close = ui.sheet({ title: 'レシートを読む', body: body });

    // 切り出したものが見えると、待っている間に「合っているか」が分かる
    var url = URL.createObjectURL(file);
    shot.appendChild(el('img', { class: 'rc-img', src: url, alt: '' }));

    R.read(file, {
      // 写真の置き場所は帳簿ごとに分かれている。撮った時点の帳簿へ置く
      book: opts.book,
      onStep: function (s) {
        note.textContent = STEP[s] || '';
        var bar = body.querySelector('.progress i');
        if (bar) bar.style.width = (s === 'crop' ? 30 : s === 'upload' ? 60 : 85) + '%';
      }
    }).then(function (r) {
      URL.revokeObjectURL(url);
      close();
      confirm(r, opts);
    }).catch(function (e) {
      URL.revokeObjectURL(url);
      close();
      // 読めなくても写真は残っているので、手で入れる道に逃がす
      ui.confirm(e.message + '\n\n写真は残っています。手で入力しますか？', {
        title: '読み取れませんでした', okText: '手で入れる'
      }).then(function (yes) {
        if (yes) DL.views.books.addExpense({ book: opts.book, preset: { fileId: e.fileId || '' } });
      });
    });
  }

  /* ---------------- 確認画面 ---------------- */

  /**
   * 読み取った内容を出して、直してから経費に入れる。
   * @param {object} r receipt.read() の返り
   */
  function confirm(r, opts) {
    opts = opts || {};
    var d = r.data;
    var bk = opts.book === 'life' ? 'life' : 'work';
    // すでにある経費を読み直したときは、入れ直すのではなく画面に返すだけ
    var applyMode = !!opts.onApply;
    // 分類は品目ごとに付ける。読み取った時点では空。
    // 読み直しのときは、同じ品目に付いていた札を引き継ぐ
    var items = d.items.map(function (i) {
      return { name: i.name, price: i.price, qty: i.qty, tagId: keepTag(i.name, opts.was) };
    });

    var storeIn = ui.input({ value: d.store || '', maxlength: 60, placeholder: '店舗名' });
    var dateIn = ui.input({ type: 'date', value: d.date || U.today() });
    var totalIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: d.total === null ? '' : d.total });

    var cats = E.categories(bk);
    var catSel = ui.select(cats.map(function (c) { return { value: c, label: c }; }), guessCategory(d, bk, cats));
    var bookSeg = ui.segmented(E.BOOKS, bk, function (val) {
      bk = val;
      // 科目は帳簿ごとに別なので、切り替えたら選び直す
      var next = E.categories(bk);
      U.clear(catSel);
      next.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
      catSel.value = guessCategory(d, bk, next);
    });

    var projSel = ui.select(
      [{ value: '', label: '（紐づけない）' }].concat(
        S.projects().filter(function (p) { return p.status !== 'archived'; })
          .map(function (p) { return { value: p.id, label: p.title }; })
      ), '');

    /* 品目。押すと直せて、いらないものは外せる */
    var itemBox = el('div', { class: 'rc-items' });
    var sumNote = el('p', { class: 'muted small' });

    function drawItems() {
      U.clear(itemBox);
      if (!items.length) {
        itemBox.appendChild(el('p', { class: 'muted small', text: '品目は読み取れませんでした。' }));
      }
      var hasTags = S.tags().length > 0;
      items.forEach(function (it, i) {
        var tagSel = hasTags ? ui.tagSelect(it.tagId, function (e) { it.tagId = e.target.value; }) : null;
        itemBox.appendChild(el('div', { class: 'rc-item' + (hasTags ? ' with-tag' : '') }, [
          el('input', {
            class: 'rc-item-name', value: it.name, maxlength: 80,
            oninput: function (e) { it.name = e.target.value; }
          }),
          el('input', {
            class: 'rc-item-price', type: 'number', inputmode: 'numeric',
            value: it.price === null ? '' : it.price,
            oninput: function (e) { it.price = e.target.value === '' ? null : U.num(e.target.value, 0); drawSum(); }
          }),
          el('button', {
            class: 'iconbtn small', 'aria-label': it.name + ' を外す',
            onclick: function () { items.splice(i, 1); drawItems(); drawSum(); }
          }, ui.icon('close', 16)),
          tagSel
        ]));
      });
      itemBox.appendChild(ui.btn('品目を足す', 'ghost tiny', function () {
        items.push({ name: '', price: null, qty: null, tagId: '' });
        drawItems();
      }, 'plus'));
      if (!hasTags) {
        itemBox.appendChild(el('p', { class: 'muted small' }, [
          el('span', { text: '品目ごとの分類は、' }),
          el('a', { class: 'link', href: '#/settings', text: '設定' }),
          el('span', { text: 'から追加すると、ここで選べるようになります。' })
        ]));
      }
      drawSum();
    }

    function drawSum() {
      var sum = items.reduce(function (a, x) { return a + (U.num(x.price, 0) || 0); }, 0);
      var total = U.num(totalIn.value, 0);
      var parts = [];
      if (sum) parts.push('品目の合計 ' + D.yen(sum));
      if (total && sum && Math.abs(total - sum) > 1) {
        parts.push(sum > total ? '（合計より ' + D.yen(sum - total) + ' 多い）'
          : '（合計との差 ' + D.yen(total - sum) + '）');
      }
      sumNote.textContent = parts.join('　');
    }
    totalIn.addEventListener('input', drawSum);
    drawItems();

    /* 気をつけて見てほしいところ */
    var flags = [];
    if (!d.total) flags.push('合計金額が読み取れませんでした。入れてください');
    if (!d.date) flags.push('日付が読み取れませんでした。確かめてください');
    if (d.unclear) flags.push('字が読みにくい箇所があると言っています。金額を確かめてください');
    if (d.mismatch) flags.push('品目の合計が総額を超えています。読み違えているかもしれません');
    if (r.retried) flags.push('一度で読めなかったので、読み直しました（' + jaReason(r.retryReason) + '）');

    // 撮ったばかりなら手元の写真、読み直しなら取り出しておいた絵を出す
    var imgUrl = r.imgUrl || (r.file ? URL.createObjectURL(r.file) : '');
    var head = el('div', { class: 'rc-head' }, [
      el('div', { class: 'rc-shot' }, imgUrl ? el('img', { class: 'rc-img', src: imgUrl, alt: '' }) : null),
      el('div', { class: 'rc-meta' }, [
        el('div', { class: 'rc-total' }, [
          el('b', { text: d.total === null ? '—' : D.yen(d.total) })
        ]),
        el('div', { class: 'muted small', text: (d.store || '店舗名なし') + '　' + (d.date || '日付なし') }),
        el('div', { class: 'muted small', text: '読み取り：' + (r.model || '') + (r.retried ? '（読み直し）' : '') })
      ])
    ]);

    var body = el('div', { class: 'form rc-form' }, [
      head,
      flags.length ? el('div', { class: 'alerts' }, flags.map(function (t) {
        return el('div', { class: 'alert warn' }, [
          el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
          el('span', { text: t })
        ]);
      })) : null,
      ui.block('帳簿', bookSeg),
      el('div', { class: 'grid2' }, [
        ui.field('日付', dateIn),
        ui.field('合計金額', totalIn)
      ]),
      ui.field('店舗名', storeIn),
      ui.field('科目', catSel),
      ui.field('案件', projSel, '印刷費などを案件に紐づけるときに'),
      ui.section('購入品目'),
      itemBox,
      sumNote
    ]);

    /* 画面で直したあとの中身。入れるときも、返すときも同じ形 */
    function collect(total) {
      return {
        book: bk,
        date: dateIn.value || U.today(),
        amount: total,
        category: catSel.value,
        vendor: storeIn.value.trim(),
        projectId: projSel.value,
        items: items.filter(function (i) { return i.name.trim(); })
          .map(function (i) {
            return { name: i.name.trim(), price: i.price, qty: i.qty, tagId: i.tagId || '' };
          })
      };
    }

    var close = ui.sheet({
      title: applyMode ? 'この内容に直しますか' : 'この内容で入れますか',
      body: body,
      actions: [
        ui.btn('やめる', 'ghost', function () {
          // 入れないなら、置いた写真も残さない。
          // すでにある経費の読み直しなら、写真はそのまま
          if (!applyMode) dropShot(r.fileId);
          close();
        }),
        ui.btn(applyMode ? 'この内容にする' : '経費に入れる', 'primary', function () {
          var total = U.num(totalIn.value, 0);
          if (!total) { ui.toast('合計金額を入れてください', 'danger'); totalIn.focus(); return; }
          if (applyMode) {
            var patch = collect(total);
            close();
            opts.onApply(patch);
            return;
          }
          moveShot(r, bk);
          var x = S.addExpense(Object.assign(collect(total), {
            issuerId: S.scopeId() || S.settings.defaultIssuerId || '',
            fileId: r.fileId
          }));
          close();
          ui.toast('経費に入れました（' + D.yen(total) + '）');
          if (opts.onDone) opts.onDone(x);
          else if (location.hash.indexOf('#/books') !== 0) location.hash = '#/books';
        }, 'check')
      ],
      onClose: function () { /* ボタン以外で閉じたときは、写真も記録も触らない */ }
    });
  }

  /* 読み直す前に付いていた分類。同じ名前の品目なら引き継ぐ */
  function keepTag(name, was) {
    var hit = (was || []).filter(function (i) { return i.name === name && i.tagId; })[0];
    return hit ? hit.tagId : '';
  }

  /**
   * 写真は撮った時点の帳簿のフォルダに置いてある。
   * この画面で帳簿を切り替えたときは、写真も合う方へ移す。
   */
  function moveShot(r, book) {
    if (!r.fileId) return;
    var want = E.receiptFolder(book);
    if (want === r.folder) return;
    S.setFileFolder(r.fileId, S.ensureFolderPath(want));
    r.folder = want;
  }

  /* 入れずにやめたときは、置いたばかりの写真を消す */
  function dropShot(fileId) {
    if (!fileId) return;
    DL.files.remove(fileId).catch(function () { /* 消せなくても困らない */ });
    S.setFileFolder(fileId, '');
  }

  /**
   * 店の名前から科目の当たりを付ける。
   * 外すこともあるので、あくまで初期値。画面で選び直せる。
   */
  var HINTS = [
    { re: /(印刷|プリント|ネップリ|栄光|ポプルス|グラフィック|同人誌)/, work: '印刷費' },
    { re: /(画材|世界堂|ユザワヤ|ハンズ|ロフト|文具|文房具|Tools|カラーインク|コピック)/i,
      work: '画材・消耗品', life: '日用品' },
    { re: /(書店|書房|ブックス|紀伊國屋|ジュンク堂|丸善|有隣堂|とらのあな|資料)/, work: '資料費' },
    { re: /(ヨドバシ|ビックカメラ|ドスパラ|パソコン|液タブ|タブレット|Apple|Wacom)/i, work: '機材費' },
    { re: /(JR|メトロ|電鉄|鉄道|タクシー|高速バス|Suica|PASMO)/i, work: '交通費', life: '交通費' },
    { re: /(薬局|ドラッグ|マツモトキヨシ|ウエルシア|サンドラッグ|ツルハ)/, life: '日用品' },
    { re: /(スーパー|マート|ストア|market|イオン|ライフ|オーケー|業務スーパー)/i, life: '食費' },
    { re: /(セブン-?イレブン|ローソン|ファミリーマート|ファミマ|ミニストップ)/, life: '食費' },
    { re: /(クリニック|病院|医院|歯科|薬剤)/, life: '医療・健康' }
  ];

  function guessCategory(d, book, cats) {
    var text = String(d.store || '') + ' ' + (d.items || []).map(function (i) { return i.name; }).join(' ');
    for (var i = 0; i < HINTS.length; i++) {
      var want = HINTS[i][book];
      if (want && HINTS[i].re.test(text) && cats.indexOf(want) >= 0) return want;
    }
    return cats[0];
  }

  function jaReason(w) {
    return ({
      unclear: '字が不鮮明', low_confidence: '自信が低い', no_total: '合計が読めない',
      no_date: '日付が読めない', items_over_total: '品目の合計が総額を超えた',
      items_short: '品目と総額が離れすぎ'
    })[w] || w || '';
  }

  DL.views = DL.views || {};
  DL.views.receipt = { scan: scan, confirm: confirm, guessCategory: guessCategory };
})(window.DL);
