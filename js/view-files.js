/* 共有ファイル：PC と iPhone で同じ置き場を見る画面。
   「ファイル」アプリのように、フォルダとファイルを同じ並びで一覧する。
   フォルダはアプリ側のデータで持ち、同期でそのまま両端末に行き渡る。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, F = DL.files, el = U.el;

  var cache = null;        // 直近の一覧（画面の再描画で毎回取りに行かないため）
  var fetchedAt = 0;
  var STALE_MS = 20000;    // これより古ければ、表示はそのままに裏で取り直す
  var loading = false;
  var error = '';
  var cwd = '';            // いま開いているフォルダID（空＝いちばん上）
  var uploads = [];        // 進行中のアップロード {name, pct, error}

  // 小さい画像だけ中身を出す。通信量が増えるので上限を決め、
  // さらに画面に入ったものだけ取りに行く。
  var THUMB_MAX = 2 * 1024 * 1024;
  var thumbs = {};         // ファイルID → 表示用のURL（この画面を開いている間だけ持つ）
  var io = null;

  function render(root) {
    var wrap = el('div', { class: 'page files-page' });

    if (!F.ready()) {
      wrap.appendChild(ui.empty(
        'ファイル共有を使うには、先に同期の接続先を設定してください。',
        ui.btn('同期の設定へ', 'primary', function () { location.hash = '#/settings'; })
      ));
      root.appendChild(wrap);
      return;
    }

    // 開いていたフォルダが消えていたら、いちばん上に戻す
    if (cwd && !S.getFolder(cwd)) cwd = '';

    wrap.appendChild(toolbar());
    if (uploads.length) wrap.appendChild(uploadList());

    if (loading && !cache) {
      wrap.appendChild(el('p', { class: 'muted small pad', text: '読み込み中…' }));
      root.appendChild(wrap);
      load();
      return;
    }
    if (error) {
      wrap.appendChild(el('div', { class: 'alert danger' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: error })
      ]));
      wrap.appendChild(ui.btn('もう一度読み込む', 'ghost full', function () { load(true); }, 'refresh'));
      root.appendChild(wrap);
      return;
    }
    if (!cache) { root.appendChild(wrap); load(); return; }

    var all = cache.files || [];
    var here = all.filter(function (f) { return S.fileFolder(f.id) === cwd; })
      .sort(function (a, b) { return U.cmp(a.name, b.name); });
    // いま開いている階層の直下のフォルダ（並べ替えた順）
    var subs = S.folderChildren(cwd);

    /* ---- フォルダとファイルを同じ並びで ---- */
    var grid = el('div', { class: 'fgrid' });
    subs.forEach(function (f) { grid.appendChild(folderTile(f, all)); });
    here.forEach(function (f) { grid.appendChild(fileTile(f)); });

    if (!subs.length && !here.length) {
      wrap.appendChild(ui.empty(cwd ? 'このフォルダは空です。' : 'まだ何もありません。右下の＋から追加できます。'));
    } else {
      wrap.appendChild(grid);
      // フォルダは長押しでつまんで動かせる（並び順はこの端末の見え方の話で、
      // 置き場所そのものは変わらない）
      if (subs.length > 1) {
        makeSortable(grid);
        wrap.appendChild(el('p', { class: 'muted small fgrid-hint', text: 'フォルダは長押しすると並べ替えられます。' }));
      }
    }

    // PC ではこの一帯にドラッグ＆ドロップできる
    dropTarget(wrap);

    /* ---- 手元へのバックアップ（いちばん上のときだけ） ---- */
    if (!cwd) {
      wrap.appendChild(el('div', { class: 'files-foot' }, [
        el('span', { class: 'muted small', text: all.length + '件・' + size(cache.total) }),
        el('div', { class: 'row-wrap' }, [
          ui.btn('すべてZIPで保存', 'ghost tiny', function () { backupAll(all); }, 'arrowDown'),
          ui.btn('読み込み直す', 'ghost tiny', function () { load(true); }, 'refresh')
        ])
      ]));
    }

    root.appendChild(wrap);
    load();     // 古ければ裏で取り直す（表示は保ったまま）
  }

  /* ---------------- 上の帯 ---------------- */

  function toolbar() {
    var f = cwd ? S.getFolder(cwd) : null;
    // いちばん上では、上のバーに「ファイル」と出ているので見出しは繰り返さない
    if (!f) {
      return el('div', { class: 'ftool' }, [
        el('span', { class: 'ftool-here' }),
        ui.btn('フォルダを作る', 'ghost tiny', function () { newFolder(); }, 'plus')
      ]);
    }
    var parent = f.parentId ? S.getFolder(f.parentId) : null;
    return el('div', { class: 'ftool' }, [
      el('button', { class: 'crumb-up', onclick: function () { up(); } }, [
        ui.icon('chevronLeft', 15), el('span', { text: parent ? parent.name : 'ファイル' })
      ]),
      // 中に入っているときは、フォルダの色を名前そのものに乗せる（幅を取らない）
      el('span', {
        class: 'ftool-here', text: f.name, title: S.folderPath(f.id),
        style: f.color ? { '--fc': f.color } : null
      }),
      // 入れ子にできるので、フォルダの中でもフォルダを作れる
      ui.btn('フォルダを作る', 'ghost tiny', function () { newFolder(); }, 'plus'),
      el('button', {
        class: 'iconbtn small', 'aria-label': 'フォルダの操作',
        onclick: function () { folderMenu(f, countIn(f.id)); }
      }, ui.icon('more', 18))
    ]);
  }

  /**
   * ひとつ上の階層へ戻る。下のタブの「ファイル」を押したときに呼ばれる。
   * いちばん上まで来ていたら何もしない（押しても画面はそのまま）。
   * @returns {boolean} 戻ったら true
   */
  function up() {
    if (!cwd) return false;
    var f = S.getFolder(cwd);
    cwd = (f && f.parentId) ? f.parentId : '';
    DL.app.render();
    return true;
  }

  /* そのフォルダと、その下の階層にあるファイルの数 */
  function countIn(folderId) {
    var ids = {};
    S.folderTreeIds(folderId).forEach(function (x) { ids[x] = true; });
    return ((cache && cache.files) || []).filter(function (x) { return ids[S.fileFolder(x.id)]; }).length;
  }

  /* ---------------- タイル ---------------- */

  function folderTile(f, all) {
    var ids = {};
    S.folderTreeIds(f.id).forEach(function (x) { ids[x] = true; });
    var inside = all.filter(function (x) { return ids[S.fileFolder(x.id)]; });
    var subs = S.folderChildren(f.id).length;
    var bytes = inside.reduce(function (s, x) { return s + x.size; }, 0);
    var t = tile({
      icon: 'folderFill',
      cls: 'is-folder' + (f.color ? ' tinted' : ''),
      color: f.color,
      name: f.name,
      note: inside.length ? inside.length + '項目・' + size(bytes)
        : subs ? subs + 'フォルダ' : '0項目',
      onOpen: function () { cwd = f.id; DL.app.render(); },
      onMenu: function () { folderMenu(f, inside.length); }
    });
    t.dataset.folder = f.id;      // 並べ替えのときに、どのフォルダか分かるように
    return t;
  }

  function fileTile(f) {
    var p = f.projectId ? S.getProject(f.projectId) : null;
    var t = tile({
      icon: iconFor(f),
      cls: 'is-file',
      name: f.name,
      note: size(f.size) + '・' + when(f.uploadedAt),
      badge: p ? p.title : '',
      onOpen: function () {
        ui.toast('取得しています…');
        F.download(f).catch(function (e) { ui.toast(e.message, 'danger'); });
      },
      onMenu: function () { fileMenu(f); }
    });
    if (wantsThumb(f)) prepareThumb(t.querySelector('.ftile-icon'), f);
    return t;
  }

  function tile(o) {
    return el('div', { class: 'ftile ' + (o.cls || ''), style: o.color ? { '--fc': o.color } : null }, [
      el('button', { class: 'ftile-main', onclick: o.onOpen }, [
        el('span', { class: 'ftile-icon' }, ui.icon(o.icon, 46)),
        el('span', { class: 'ftile-name', text: o.name }),
        el('span', { class: 'ftile-note', text: o.note }),
        o.badge ? el('span', { class: 'ftile-badge', text: o.badge }) : null
      ]),
      el('button', {
        class: 'ftile-more', 'aria-label': o.name + ' の操作',
        onclick: function (e) { e.stopPropagation(); o.onMenu(); }
      }, ui.icon('more', 16))
    ]);
  }

  /* ---------------- フォルダの並べ替え ----------------
     長押しでつまんで、置きたいところへ動かす（iPhone のホーム画面と同じ感じ）。
     並び順はこの画面の見え方だけの話で、R2 側の置き場所は動かさない。 */

  var HOLD_MS = 320;       // これだけ押し続けたら「つまんだ」ことにする
  var SLIP = 8;            // つまむ前にこれ以上動いたら、画面を送る操作だとみなす

  function makeSortable(grid) {
    var timer = null, held = null, ph = null;
    var sx = 0, sy = 0, dx = 0, dy = 0, moved = false;
    // つまんだ時点のマス目の位置。動かしている間は並びを変えないので、
    // ここがずれない＝置き場所の判断がぶれない
    var slots = [], others = [], at = 0, from0 = 0;

    grid.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      var tile = e.target.closest && e.target.closest('.ftile.is-folder');
      if (!tile || !grid.contains(tile)) return;
      if (e.target.closest('.ftile-more')) return;      // 「…」は並べ替えの対象外

      sx = e.clientX; sy = e.clientY; moved = false;
      timer = setTimeout(function () { timer = null; pick(tile, e); }, HOLD_MS);
    });

    grid.addEventListener('pointermove', function (e) {
      if (timer && (Math.abs(e.clientX - sx) > SLIP || Math.abs(e.clientY - sy) > SLIP)) {
        clearTimeout(timer); timer = null;      // 画面を送ろうとしている
        return;
      }
      if (!held) return;
      e.preventDefault();
      moved = true;
      held.style.left = (e.clientX - dx) + 'px';
      held.style.top = (e.clientY - dy) + 'px';
      place(e.clientX, e.clientY);
    });

    ['pointerup', 'pointercancel'].forEach(function (name) {
      grid.addEventListener(name, function (e) { stop(e, name === 'pointerup'); });
    });

    // つまんでいる間は画面を送らせない。
    // touch-action を後から変えても間に合わない（指を置いた時点の値で決まる）ので、
    // ここで指の動きそのものを止める。止めないと、送る操作と見なされて手が離れてしまう
    grid.addEventListener('touchmove', function (e) {
      if (held) e.preventDefault();
    }, { passive: false });
    // 長押しで出る「コピー」などの吹き出しも、つまんでいる間は邪魔になる
    grid.addEventListener('contextmenu', function (e) { if (held) e.preventDefault(); });

    /* つまむ */
    function pick(tile, e) {
      var r = tile.getBoundingClientRect();
      dx = sx - r.left; dy = sy - r.top;

      // つまんだところに、同じ大きさの空きを置いて並びを保つ
      ph = el('div', { class: 'ftile ftile-hole' });
      ph.style.width = r.width + 'px';
      ph.style.height = r.height + 'px';
      tile.parentNode.insertBefore(ph, tile);

      held = tile;
      held.classList.add('ftile-held');
      held.style.width = r.width + 'px';
      held.style.height = r.height + 'px';
      held.style.left = r.left + 'px';
      held.style.top = r.top + 'px';
      grid.appendChild(held);          // 位置は fixed なので、どこに付いていてもよい
      grid.classList.add('sorting');

      // 空きと、残りのフォルダ。この並びのまま最後まで動かさない
      var cells = U.$$('.ftile.is-folder, .ftile-hole', grid).filter(function (n) { return n !== held; });
      others = cells.filter(function (n) { return n !== ph; });
      slots = cells.map(function (n) { return n.getBoundingClientRect(); });
      at = from0 = cells.indexOf(ph);   // いまの場所（動かさずに放したら、ここに戻る）

      try { grid.setPointerCapture(e.pointerId); } catch (err) { /* 拾えなくても動く */ }
      if (navigator.vibrate) navigator.vibrate(8);
    }

    /* 置き場所を、指にいちばん近いマスにする（並びは動かさないのでぶれない） */
    function place(x, y) {
      var best = at, bestD = Infinity;
      slots.forEach(function (r, i) {
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best === at) return;
      at = best;
      shuffle();
    }

    /**
     * 残りのフォルダを、置き場所が空くように脇へずらす。
     * ずらすのは見た目（transform）だけなので、マス目の位置は変わらない
     * ＝ 置き場所の判断がぶれない。
     */
    function shuffle() {
      others.forEach(function (n, i) {
        // もともと i 番目のフォルダがいたマスと、いま行ってほしいマス
        move(n, slots[i < from0 ? i : i + 1], slots[i < at ? i : i + 1]);
      });
      move(ph, slots[from0], slots[at]);      // 空きも、放したら入る場所へ
    }

    function move(node, a, b) {
      if (!node || !a || !b) return;
      var x = Math.round(b.left - a.left), y = Math.round(b.top - a.top);
      node.style.transform = (x || y) ? 'translate(' + x + 'px,' + y + 'px)' : '';
    }

    function settle() {
      others.forEach(function (n) { n.style.transform = ''; });
      if (ph) ph.style.transform = '';
    }

    /* 放す */
    function stop(e, commit) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!held) return;
      var tile = held;
      held = null;
      settle();
      grid.classList.remove('sorting');
      tile.classList.remove('ftile-held');
      tile.style.width = tile.style.height = tile.style.left = tile.style.top = '';
      ph.parentNode.insertBefore(tile, ph);
      ph.parentNode.removeChild(ph);
      ph = null;

      // 放した直後の click で、フォルダが開いてしまわないようにする
      if (moved) {
        grid.addEventListener('click', function once(ev) {
          ev.stopPropagation(); ev.preventDefault();
          grid.removeEventListener('click', once, true);
        }, true);
      }
      if (!commit || !moved) return;

      // 残りの並びに、つまんだものを at 番目として入れ直す
      var ids = others.map(function (n) { return n.dataset.folder; });
      ids.splice(Math.min(at, ids.length), 0, tile.dataset.folder);
      S.reorderFolders(cwd, ids);      // ここで画面が描き直される
    }
  }

  /* ---------------- 画像の中身を出す ---------------- */

  function wantsThumb(f) {
    return (f.type || '').indexOf('image/') === 0 && f.size <= THUMB_MAX;
  }

  /* 取得済みならすぐ出し、まだなら画面に入ったときに取りに行く */
  function prepareThumb(box, f) {
    if (thumbs[f.id]) { showThumb(box, thumbs[f.id]); return; }
    if (!window.IntersectionObserver) return;   // 対応していなければアイコンのまま
    box._file = f;
    box.classList.add('waiting');
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
    var f = box._file;
    if (!f || thumbs[f.id]) return;
    F.fetchBytes(f.id).then(function (bytes) {
      var url = URL.createObjectURL(new Blob([bytes], { type: f.type }));
      thumbs[f.id] = url;
      // 取っている間に画面が描き直されていることがあるので、いま出ている枠を探す
      showThumb(box, url);
      U.$$('.ftile-icon').forEach(function (n) {
        if (n !== box && n._file && n._file.id === f.id) showThumb(n, url);
      });
    }).catch(function () {
      box.classList.remove('waiting');   // 取れなければアイコンのまま
    });
  }

  function showThumb(box, url) {
    box.classList.remove('waiting');
    box.classList.add('has-thumb');
    U.clear(box);
    box.appendChild(el('img', { class: 'ftile-thumb', src: url, alt: '', loading: 'lazy' }));
  }

  function dropThumbs() {
    Object.keys(thumbs).forEach(function (id) {
      try { URL.revokeObjectURL(thumbs[id]); } catch (e) { /* 解放済みなら気にしない */ }
    });
    thumbs = {};
    if (io) { io.disconnect(); io = null; }
  }

  /* ---------------- フォルダ ---------------- */

  /* いま開いている階層にフォルダを作る。フォルダの中にも作れる */
  function newFolder() {
    var here = cwd ? S.getFolder(cwd) : null;
    var input = ui.input({ placeholder: '例）納品データ / 資料 / ラフ', maxlength: 40 });
    var close = ui.sheet({
      title: here ? '「' + here.name + '」の中にフォルダを作る' : 'フォルダを作る',
      body: el('div', { class: 'form' }, [
        ui.field('フォルダ名', input)
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('作る', 'primary', function () {
          var name = input.value.trim();
          if (!name) { ui.toast('名前を入れてください', 'warn'); return; }
          if (S.folderChildren(cwd).some(function (x) { return x.name === name; })) {
            ui.toast('同じ名前のフォルダがあります', 'warn'); return;
          }
          S.addFolder(name, cwd);
          close(); ui.toast('「' + name + '」を作りました');
        })
      ]
    });
    setTimeout(function () { input.focus(); }, 100);
  }

  function folderMenu(f, count) {
    var close = ui.sheet({
      title: f.name,
      body: el('div', { class: 'menu' }, [
        cwd === f.id ? null : item('folder', '開く', function () { close(); cwd = f.id; DL.app.render(); }),
        item('edit', '名前を変える', function () { close(); renameFolder(f); }),
        item('folder', '色を変える', function () { close(); colorFolder(f); }),
        item('trash', '削除する', function () { close(); deleteFolder(f, count); })
      ])
    });
  }

  function item(icon, text, onclick) {
    return el('button', { class: 'menu-item', onclick: onclick }, [ui.icon(icon, 18), el('span', { text: text })]);
  }

  function renameFolder(f) {
    var input = ui.input({ value: f.name, maxlength: 40 });
    var close = ui.sheet({
      title: '名前を変える',
      body: el('div', { class: 'form' }, ui.field('フォルダ名', input)),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('変更', 'primary', function () {
          if (!input.value.trim()) { ui.toast('名前を入れてください', 'warn'); return; }
          S.renameFolder(f.id, input.value);
          close(); ui.toast('変更しました');
        })
      ]
    });
  }

  /* フォルダの色。日常の予定と同じ色見本から選ぶ */
  function colorFolder(f) {
    var color = f.color || '';
    var row = el('div', { class: 'sw-row' });

    function sw(value, label) {
      var b = el('button', {
        type: 'button', class: 'sw' + (value === color ? ' on' : '') + (value ? '' : ' sw-none'),
        'aria-label': label, style: value ? { background: value } : null,
        onclick: function () {
          color = value;
          U.$$('.sw', row).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        }
      }, value ? null : ui.icon('close', 16));
      return b;
    }

    row.appendChild(sw('', '色を付けない'));
    S.EVENT_COLORS.forEach(function (c) { row.appendChild(sw(c.value, c.label)); });

    var close = ui.sheet({
      title: f.name + ' の色',
      body: el('div', { class: 'form' }, ui.field('フォルダの色', row, '左端の×で色なしに戻せます')),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.setFolderColor(f.id, color);
          close(); ui.toast(color ? '色を変えました' : '色を外しました');
        })
      ]
    });
  }

  /* 中身のあるフォルダは、消し方を選ばせる。下の階層もまとめて対象になる */
  function deleteFolder(f, count) {
    var tree = S.folderTreeIds(f.id);
    var inTree = {};
    tree.forEach(function (x) { inTree[x] = true; });
    var subs = tree.length - 1;

    // 消したフォルダの中を開いたままにしない
    function leave() { if (inTree[cwd]) cwd = f.parentId || ''; }

    if (!count && !subs) {
      ui.confirm('「' + f.name + '」を削除します。', { danger: true, okText: '削除' }).then(function (ok) {
        if (!ok) return;
        leave();
        S.removeFolder(f.id);
        ui.toast('削除しました');
      });
      return;
    }
    var what = [count ? count + '件のファイル' : '', subs ? subs + '個のフォルダ' : '']
      .filter(Boolean).join('と');
    var close = ui.sheet({
      title: '「' + f.name + '」を削除',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'alert warn' }, [
          el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
          el('span', { text: 'このフォルダの中には ' + what + 'があります。' })
        ]),
        choice('フォルダだけ削除', 'ファイルは残り、いちばん上の階層に移ります。', function () {
          close();
          leave();
          S.removeFolder(f.id);
          ui.toast('フォルダを削除しました（ファイルは残っています）');
        }, true),
        count ? choice('中のファイルごと削除', 'サーバーからファイルも消します。元に戻せません。', function () {
          close();
          ui.confirm(count + '件のファイルをサーバーから削除します。元に戻せません。', { danger: true, okText: '削除' })
            .then(function (ok) {
              if (!ok) return;
              var targets = (cache.files || []).filter(function (x) { return inTree[S.fileFolder(x.id)]; });
              ui.toast('削除しています…');
              var chain = Promise.resolve();
              targets.forEach(function (t) {
                chain = chain.then(function () { return F.remove(t.id); })
                  .then(function () { S.forgetFiles(t.id); });   // 経費のレシート紐付けも外す
              });
              chain.then(function () {
                leave();
                S.removeFolder(f.id);
                ui.toast(targets.length + '件を削除しました');
                load(true);
              }).catch(function (e) { ui.toast(e.message, 'danger'); load(true); });
            });
        }) : null
      ]),
      actions: [ui.btn('やめる', 'ghost', function () { close(); })]
    });
  }

  function choice(label, note, onclick, primary) {
    return el('button', { class: 'choice' + (primary ? ' primary' : ''), onclick: onclick }, [
      el('div', {}, [el('strong', { text: label }), el('div', { class: 'muted small', text: note })]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* ---------------- 追加 ---------------- */

  /* ＋ボタンから呼ばれる。いま開いているフォルダに入る */
  function pickFiles() {
    var input = el('input', { type: 'file', multiple: true, style: { display: 'none' } });
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      send(Array.prototype.slice.call(input.files));
      input.remove();
    });
    input.click();
  }

  /* PC からのドラッグ＆ドロップ。画面のどこに落としても受ける */
  function dropTarget(wrap) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) {
        if (!e.dataTransfer || e.dataTransfer.types.indexOf('Files') < 0) return;
        e.preventDefault(); e.stopPropagation();
        wrap.classList.add('dropping');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        if (ev === 'dragleave' && wrap.contains(e.relatedTarget)) return;
        wrap.classList.remove('dropping');
      });
    });
    wrap.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      // フォルダごと落とされることがある。dt.files にはフォルダが
      // 中身0バイトのファイルとして入ってしまうので、items から辿る
      walkDrop(dt).then(function (list) {
        if (list.length) send(list);
        else ui.toast('入れられるファイルがありませんでした', 'warn');
      }).catch(function () {
        var plain = Array.prototype.slice.call(dt.files || []).map(function (f) { return { file: f, path: '' }; });
        if (plain.length) send(plain);
      });
    });
  }

  /**
   * 落とされたものを {file, path} の一覧にほどく。
   * path はフォルダの相対パス（'資料/ラフ'）。ファイルだけなら空。
   */
  function walkDrop(dt) {
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entries = items.map(function (it) {
      return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
    }).filter(Boolean);

    // フォルダに対応していないブラウザは、これまでどおりファイルだけ受ける
    if (!entries.length) {
      return Promise.resolve(Array.prototype.slice.call(dt.files || []).map(function (f) {
        return { file: f, path: '' };
      }));
    }
    return Promise.all(entries.map(function (en) { return walkEntry(en, ''); }))
      .then(function (lists) {
        return lists.reduce(function (a, b) { return a.concat(b); }, []);
      });
  }

  function walkEntry(entry, path) {
    if (entry.isFile) {
      return new Promise(function (resolve) {
        entry.file(function (f) { resolve([{ file: f, path: path }]); },
                   function () { resolve([]); });   // 読めないものは飛ばす
      });
    }
    if (!entry.isDirectory) return Promise.resolve([]);
    var sub = path ? path + '/' + entry.name : entry.name;
    var reader = entry.createReader();
    var found = [];
    // readEntries は一度に100件ほどしか返さないので、空になるまで読む
    function step() {
      return new Promise(function (resolve) {
        reader.readEntries(function (list) { resolve(list); }, function () { resolve([]); });
      }).then(function (list) {
        if (!list.length) return found;
        found = found.concat(list);
        return step();
      });
    }
    return step().then(function (list) {
      return Promise.all(list.map(function (en) { return walkEntry(en, sub); }));
    }).then(function (lists) {
      return lists.reduce(function (a, b) { return a.concat(b); }, []);
    });
  }

  function uploadList() {
    var up = el('div', { class: 'card uploads' });
    uploads.forEach(function (u) {
      up.appendChild(el('div', { class: 'upload-row' + (u.error ? ' failed' : '') }, [
        el('div', { class: 'row-title' }, [
          ui.icon(u.error ? 'alert' : 'arrowUp', 15),
          el('span', { text: u.name })
        ]),
        u.error ? el('div', { class: 'muted small', text: u.error })
          : ui.progress(Math.round(u.pct * 100), null)
      ]));
    });
    return up;
  }

  /**
   * 選ばれたものを順に送る。いま開いているフォルダに入れる。
   * @param {Array} list File の配列、または {file, path} の配列。
   *   path はフォルダごと落としたときの相対パス。その分だけフォルダを作って入れる。
   */
  function send(list) {
    if (!list.length) return;
    var base = cwd;

    list.map(function (x) {
      return (x && x.file) ? x : { file: x, path: '' };
    }).forEach(function (it) {
      var file = it.file;
      // フォルダごと落とされたぶんは、その階層をこちらにも作る
      var folderId = it.path ? S.ensureFolderPath(joinPath(S.folderPath(base), it.path)) : base;
      var entry = { name: (it.path ? it.path + '/' : '') + file.name, pct: 0, error: '' };
      uploads.push(entry);
      DL.app.render();

      F.upload(file, {
        // R2 にも置き場所を残す。もう片方の端末が状態を同期する前でも同じ場所に出せる
        folder: S.folderPath(folderId),
        onProgress: function (p) {
          entry.pct = p;
          var bar = findBar(entry);
          if (bar) bar.style.width = Math.round(p * 100) + '%';
        }
      }).then(function (r) {
        if (r && r.id) S.setFileFolder(r.id, folderId);
        uploads.splice(uploads.indexOf(entry), 1);
        load(true);
      }).catch(function (e) {
        entry.error = e.message;
        DL.app.render();
        setTimeout(function () {
          var i = uploads.indexOf(entry);
          if (i >= 0) { uploads.splice(i, 1); DL.app.render(); }
        }, 6000);
      });
    });
  }

  function joinPath(a, b) {
    return [a, b].filter(Boolean).join('/');
  }

  /* 進捗バーだけ動かして、全体の再描画を避ける */
  function findBar(entry) {
    var i = uploads.indexOf(entry);
    if (i < 0) return null;
    var rows = U.$$('.upload-row');
    return rows[i] ? rows[i].querySelector('.bar i') : null;
  }

  /* ---------------- 一覧 ---------------- */

  /**
   * 一覧を取りに行く。
   * もう片方の端末が上げたファイルを取りこぼさないよう、
   * 少し時間が経っていたら画面に来るたび取り直す。
   */
  function load(force) {
    if (loading) return;
    if (!force && cache && (Date.now() - fetchedAt) < STALE_MS) return;
    loading = true;
    error = '';
    F.list().then(function (r) {
      cache = r; fetchedAt = Date.now(); loading = false;
      // まだ知らないファイルは、R2 に残った置き場所から割り当てる。
      // これをしないと、もう片方の端末で入れたファイルがいちばん上に出てしまう
      S.applyFolderHints(r.files || []);
      // 消えたファイルの割り当てが残らないように掃除する
      var ids = (r.files || []).map(function (f) { return f.id; });
      S.pruneFileFolders(ids);
      // 写真だけ先に消えている経費があれば、レシートの紐付けを外す
      S.pruneReceiptLinks(ids);
      DL.app.render();
    }).catch(function (e) {
      error = e.message; fetchedAt = Date.now(); loading = false; DL.app.render();
    });
  }

  function fileMenu(f) {
    var close = ui.sheet({
      title: f.name,
      body: el('div', {}, [
        el('div', { class: 'menu' }, [
          item('arrowDown', '保存する', function () {
            close();
            ui.toast('取得しています…');
            F.download(f).catch(function (e) { ui.toast(e.message, 'danger'); });
          }),
          item('folder', 'フォルダを移す', function () { close(); moveTo(f); }),
          item('projects', f.projectId ? '案件を変える' : '案件に紐づける', function () {
            close(); assign(f);
          }),
          item('trash', '削除する', function () {
            close();
            // レシートとして経費に紐づいている写真なら、消えることを先に伝える
            var used = S.expensesWithFile(f.id).length;
            ui.confirm('「' + f.name + '」をサーバーから削除します。元に戻せません。'
              + (used ? '\nこの写真はレシートとして' + used + '件の経費に紐づいています。経費は残りますが、写真は外れます。' : ''),
              { danger: true, okText: '削除' })
              .then(function (ok) {
                if (!ok) return;
                F.remove(f.id).then(function () {
                  S.forgetFiles(f.id);
                  ui.toast('削除しました'); load(true);
                }).catch(function (e) { ui.toast(e.message, 'danger'); });
              });
          })
        ]),
        el('div', { class: 'row-sub pad' }, [
          ui.chip(size(f.size), 'ghosty'),
          ui.chip(when(f.uploadedAt), 'soft'),
          f.by ? ui.chip(f.by, 'ghosty') : null
        ])
      ])
    });
  }

  /* フォルダの移動。対応表を書き換えるだけなので一瞬で終わる */
  function moveTo(f) {
    // 入れ子にできるので、どこにあるフォルダか分かるようパスで並べる
    var opts = [{ value: '', label: '（いちばん上）' }].concat(
      S.folders().map(function (x) { return { value: x.id, label: S.folderPath(x.id) }; })
        .sort(function (a, b) { return U.cmp(a.label, b.label); })
    );
    var sel = ui.select(opts, S.fileFolder(f.id));
    var close = ui.sheet({
      title: 'フォルダを移す',
      body: el('div', { class: 'form' }, [
        ui.field('移動先', sel),
        ui.btn('新しいフォルダを作る', 'ghost full', function () { close(); newFolder(); }, 'plus')
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('移動', 'primary', function () {
          S.setFileFolder(f.id, sel.value);
          close();
          var to = sel.value ? S.getFolder(sel.value) : null;
          ui.toast(to ? '「' + to.name + '」へ移しました' : 'いちばん上へ移しました');
        })
      ]
    });
  }

  /**
   * 案件への紐付けを変える。
   * こちらは R2 のメタ情報なので、取り直して入れ直す必要がある。
   */
  function assign(f) {
    var opts = [{ value: '', label: '（紐づけない）' }].concat(
      S.projects().filter(function (p) { return p.status !== 'archived'; })
        .map(function (p) { return { value: p.id, label: p.title }; })
    );
    var sel = ui.select(opts, f.projectId || '');
    var close = ui.sheet({
      title: '案件に紐づける',
      body: el('div', { class: 'form' }, [
        ui.field('案件', sel),
        el('p', { class: 'muted small', text: '大きいファイルは少し時間がかかります。' })
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('変更', 'primary', function () {
          close();
          ui.toast('入れ替えています…');
          var folderId = S.fileFolder(f.id);
          F.fetchBytes(f.id).then(function (bytes) {
            var file = new File([bytes], f.name, { type: f.type || 'application/octet-stream' });
            return F.upload(file, { projectId: sel.value, folder: S.folderPath(folderId) }).then(function (r) {
              if (r && r.id) {
                S.setFileFolder(r.id, folderId);              // フォルダは保つ
                S.retargetExpenseFiles(f.id, r.id);           // レシートの紐付けも新しい ID へ移す
              }
              return F.remove(f.id).then(function () { S.forgetFiles(f.id); });
            });
          }).then(function () {
            ui.toast('変更しました'); load(true);
          }).catch(function (e) { ui.toast(e.message, 'danger'); });
        })
      ]
    });
  }

  /* ---------------- まとめて保存 ---------------- */

  function backupAll(files) {
    if (!files.length) { ui.toast('ファイルがありません', 'warn'); return; }
    var total = files.reduce(function (n, f) { return n + f.size; }, 0);

    // ZIP の中でもフォルダ分けを再現する（入れ子もそのまま）
    var withPath = files.map(function (f) {
      var path = S.folderPath(S.fileFolder(f.id)).split('/').filter(Boolean).map(safe).join('/');
      return { id: f.id, name: path ? path + '/' + f.name : f.name, uploadedAt: f.uploadedAt, size: f.size };
    });

    var go = function () {
      var note = el('p', { class: 'muted small', text: '準備しています…' });
      var close = ui.sheet({
        title: 'ZIPにまとめています', body: el('div', { class: 'form' }, [
          note,
          el('p', { class: 'muted small', text: '終わるまでこの画面を閉じないでください。' })
        ])
      });
      F.downloadAll(withPath, function (done, all, name) {
        note.textContent = done >= all ? 'ZIPを作っています…' : (done + 1) + ' / ' + all + '件目：' + name;
      }).then(function (n) {
        close();
        ui.toast(n + '件をZIPで保存しました');
      }).catch(function (e) {
        close();
        ui.toast('まとめられませんでした：' + e.message, 'danger');
      });
    };

    // 大きいとメモリに載りきらないことがあるので、そこは先に断っておく
    if (total > 300 * 1024 * 1024) {
      ui.confirm('合計 ' + size(total) + ' あります。ZIPを作る間これだけメモリを使うため、' +
        'iPhone では途中で止まることがあります。PCで実行することをおすすめします。続けますか？',
        { okText: '続ける' }).then(function (ok) { if (ok) go(); });
      return;
    }
    go();
  }

  /* ZIP の中でフォルダ名として使えない文字を落とす */
  function safe(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '_') || 'folder';
  }

  /* ---------------- 表示の小道具 ---------------- */

  function size(n) {
    n = U.num(n, 0);
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + 'GB';
  }

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var day = U.toISO(d);
    return day === U.today() ? U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()) : U.fmtMD(day);
  }

  function iconFor(f) {
    var t = f.type || '';
    var name = (f.name || '').toLowerCase();
    if (t.indexOf('image/') === 0) return 'illust';
    if (t.indexOf('zip') >= 0 || /\.(zip|rar|7z)$/.test(name)) return 'backup';
    if (/\.(psd|clip|sai|ai|xcf)$/.test(name)) return 'design';
    return 'fileFill';
  }

  /* 同期で相手の状態を受け取ると、こちらの割り当てはそれで置き換わる。
     そこに無かったファイルはまた「置き場所を知らない」状態に戻るので、
     R2 の記録から組み直しておく（相手がまだ送っていない直後の取りこぼしを防ぐ）。 */
  if (DL.sync && DL.sync.on) {
    DL.sync.on(function (ev) {
      if (!ev || ev.phase !== 'done' || !ev.result) return;
      if (ev.result.status !== 'pulled' && ev.result.status !== 'merged') return;
      if (cache) S.applyFolderHints(cache.files || []);
    });
  }

  DL.views = DL.views || {};
  DL.views.files = {
    render: render,
    pickFiles: pickFiles,
    up: up,
    // タブに入るたびに取り直す（もう片方の端末が上げたものをすぐ見せる）
    entered: function () { if (F.ready()) load(true); },
    // 横断検索から、そのファイルが入っているフォルダを開く
    openAt: function (fileId) { cwd = S.fileFolder(fileId) || ''; },
    reset: function () { cache = null; fetchedAt = 0; error = ''; cwd = ''; dropThumbs(); }
  };
})(window.DL);
