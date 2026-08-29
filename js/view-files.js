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
    // フォルダはいちばん上の階層にだけ置く（入れ子にはしない）
    var subs = cwd ? [] : S.folders().slice().sort(function (a, b) { return U.cmp(a.name, b.name); });

    /* ---- フォルダとファイルを同じ並びで ---- */
    var grid = el('div', { class: 'fgrid' });
    subs.forEach(function (f) { grid.appendChild(folderTile(f, all)); });
    here.forEach(function (f) { grid.appendChild(fileTile(f)); });

    if (!subs.length && !here.length) {
      wrap.appendChild(ui.empty(cwd ? 'このフォルダは空です。' : 'まだ何もありません。右下の＋から追加できます。'));
    } else {
      wrap.appendChild(grid);
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
    return el('div', { class: 'ftool' }, [
      el('button', { class: 'crumb-up', onclick: function () { cwd = ''; DL.app.render(); } }, [
        ui.icon('chevronLeft', 15), el('span', { text: 'ファイル' })
      ]),
      el('span', { class: 'ftool-here', text: f.name }),
      el('button', {
        class: 'iconbtn small', 'aria-label': 'フォルダの操作',
        onclick: function () { folderMenu(f, countIn(f.id)); }
      }, ui.icon('more', 18))
    ]);
  }

  function countIn(folderId) {
    return ((cache && cache.files) || []).filter(function (x) { return S.fileFolder(x.id) === folderId; }).length;
  }

  /* ---------------- タイル ---------------- */

  function folderTile(f, all) {
    var inside = all.filter(function (x) { return S.fileFolder(x.id) === f.id; });
    var bytes = inside.reduce(function (s, x) { return s + x.size; }, 0);
    return tile({
      icon: 'folderFill',
      cls: 'is-folder',
      name: f.name,
      note: inside.length ? inside.length + '項目・' + size(bytes) : '0項目',
      onOpen: function () { cwd = f.id; DL.app.render(); },
      onMenu: function () { folderMenu(f, inside.length); }
    });
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
    return el('div', { class: 'ftile ' + (o.cls || '') }, [
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

  function newFolder() {
    var input = ui.input({ placeholder: '例）納品データ / 資料 / ラフ', maxlength: 40 });
    var close = ui.sheet({
      title: 'フォルダを作る',
      body: el('div', { class: 'form' }, [
        ui.field('フォルダ名', input, '作ったフォルダは同期で両方の端末に出ます')
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('作る', 'primary', function () {
          var name = input.value.trim();
          if (!name) { ui.toast('名前を入れてください', 'warn'); return; }
          S.addFolder(name);
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

  /* 中身のあるフォルダは、消し方を選ばせる */
  function deleteFolder(f, count) {
    if (!count) {
      ui.confirm('「' + f.name + '」を削除します。', { danger: true, okText: '削除' }).then(function (ok) {
        if (!ok) return;
        if (cwd === f.id) cwd = '';
        S.removeFolder(f.id);
        ui.toast('削除しました');
      });
      return;
    }
    var close = ui.sheet({
      title: '「' + f.name + '」を削除',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'alert warn' }, [
          el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
          el('span', { text: 'このフォルダには ' + count + '件のファイルがあります。' })
        ]),
        choice('フォルダだけ削除', 'ファイルは残り、いちばん上の階層に移ります。', function () {
          close();
          if (cwd === f.id) cwd = '';
          S.removeFolder(f.id);
          ui.toast('フォルダを削除しました（ファイルは残っています）');
        }, true),
        choice('中のファイルごと削除', 'サーバーからファイルも消します。元に戻せません。', function () {
          close();
          ui.confirm(count + '件のファイルをサーバーから削除します。元に戻せません。', { danger: true, okText: '削除' })
            .then(function (ok) {
              if (!ok) return;
              var targets = (cache.files || []).filter(function (x) { return S.fileFolder(x.id) === f.id; });
              ui.toast('削除しています…');
              var chain = Promise.resolve();
              targets.forEach(function (t) { chain = chain.then(function () { return F.remove(t.id); }); });
              chain.then(function () {
                if (cwd === f.id) cwd = '';
                S.removeFolder(f.id);
                ui.toast(targets.length + '件を削除しました');
                load(true);
              }).catch(function (e) { ui.toast(e.message, 'danger'); load(true); });
            });
        })
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
      if (!dt || !dt.files) return;
      var list = Array.prototype.slice.call(dt.files);
      if (list.length) send(list);
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

  /* 選ばれたファイルを順に送る。いま開いているフォルダに入れる */
  function send(list) {
    if (!list.length) return;
    var folderId = cwd;

    list.forEach(function (file) {
      var entry = { name: file.name, pct: 0, error: '' };
      uploads.push(entry);
      DL.app.render();

      F.upload(file, {
        onProgress: function (p) {
          entry.pct = p;
          var bar = findBar(entry);
          if (bar) bar.style.width = Math.round(p * 100) + '%';
        }
      }).then(function (r) {
        if (folderId && r && r.id) S.setFileFolder(r.id, folderId);
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
      // 消えたファイルの割り当てが残らないように掃除する
      S.pruneFileFolders((r.files || []).map(function (f) { return f.id; }));
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
            ui.confirm('「' + f.name + '」をサーバーから削除します。元に戻せません。', { danger: true, okText: '削除' })
              .then(function (ok) {
                if (!ok) return;
                F.remove(f.id).then(function () {
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
    var opts = [{ value: '', label: '（いちばん上）' }].concat(
      S.folders().map(function (x) { return { value: x.id, label: x.name }; })
    );
    var sel = ui.select(opts, S.fileFolder(f.id));
    var close = ui.sheet({
      title: 'フォルダを移す',
      body: el('div', { class: 'form' }, [
        ui.field('移動先', sel, 'ファイルは入れ直さないので、大きくてもすぐ終わります'),
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
        ui.field('案件', sel, '選んだ案件のファイルとして印が付きます'),
        el('p', { class: 'muted small', text: '入れ直しになるため、大きいファイルは少し時間がかかります。' })
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('変更', 'primary', function () {
          close();
          ui.toast('入れ替えています…');
          var folderId = S.fileFolder(f.id);
          F.fetchBytes(f.id).then(function (bytes) {
            var file = new File([bytes], f.name, { type: f.type || 'application/octet-stream' });
            return F.upload(file, { projectId: sel.value }).then(function (r) {
              if (folderId && r && r.id) S.setFileFolder(r.id, folderId);   // フォルダは保つ
              return F.remove(f.id);
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

    // ZIP の中でもフォルダ分けを再現する
    var withPath = files.map(function (f) {
      var folder = S.getFolder(S.fileFolder(f.id));
      return { id: f.id, name: folder ? safe(folder.name) + '/' + f.name : f.name, uploadedAt: f.uploadedAt, size: f.size };
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

  DL.views = DL.views || {};
  DL.views.files = {
    render: render,
    pickFiles: pickFiles,
    // タブに入るたびに取り直す（もう片方の端末が上げたものをすぐ見せる）
    entered: function () { if (F.ready()) load(true); },
    reset: function () { cache = null; fetchedAt = 0; error = ''; cwd = ''; dropThumbs(); }
  };
})(window.DL);
