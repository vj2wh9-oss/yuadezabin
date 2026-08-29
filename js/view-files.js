/* 共有ファイル：PC と iPhone で同じ置き場を見る画面 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, F = DL.files, el = U.el;

  var cache = null;        // 直近の一覧（画面の再描画で毎回取りに行かないため）
  var fetchedAt = 0;
  var STALE_MS = 20000;    // これより古ければ、表示はそのままに裏で取り直す
  var loading = false;
  var error = '';
  var filterProject = '';  // 案件で絞る
  var uploads = [];        // 進行中のアップロード {name, pct, error}

  function render(root) {
    var wrap = el('div', { class: 'page' });

    if (!F.ready()) {
      wrap.appendChild(ui.empty(
        'ファイル共有を使うには、先に同期の接続先を設定してください。',
        ui.btn('同期の設定へ', 'primary', function () { location.hash = '#/settings'; })
      ));
      root.appendChild(wrap);
      return;
    }

    /* ---- 受け取り口（PCではドラッグ＆ドロップ、iPhoneではタップ） ---- */
    wrap.appendChild(dropZone());

    /* ---- アップロード中 ---- */
    if (uploads.length) {
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
      wrap.appendChild(up);
    }

    /* ---- 一覧 ---- */
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

    var files = cache.files || [];

    // 案件で絞る
    var withProject = files.filter(function (f) { return f.projectId; });
    if (withProject.length) {
      var opts = [{ value: '', label: 'すべて' }];
      var seen = {};
      withProject.forEach(function (f) {
        if (seen[f.projectId]) return;
        seen[f.projectId] = 1;
        var p = S.getProject(f.projectId);
        opts.push({ value: f.projectId, label: p ? p.title : '(削除された案件)' });
      });
      wrap.appendChild(el('div', { class: 'card' },
        ui.field('案件で絞る', ui.select(opts, filterProject, function (v) {
          filterProject = v; DL.app.render();
        }))
      ));
    }
    var shown = filterProject ? files.filter(function (f) { return f.projectId === filterProject; }) : files;

    wrap.appendChild(ui.section('ファイル', el('span', { class: 'muted small', text: shown.length + '件・' + size(cache.total) })));

    if (!shown.length) {
      wrap.appendChild(ui.empty(files.length ? 'この案件のファイルはありません。' : 'まだファイルがありません。'));
    } else {
      var list = el('div', { class: 'list' });
      shown.forEach(function (f) { list.appendChild(row(f)); });
      wrap.appendChild(list);
    }

    /* ---- 手元へのバックアップ ---- */
    wrap.appendChild(ui.section('手元にバックアップ'));
    wrap.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted small', text: 'サーバー上のファイルをまとめて1つのZIPにして保存します。PCで実行して、外付けやローカルに残しておくと安心です。' }),
      ui.btn('すべてZIPで保存（' + files.length + '件・' + size(cache.total) + '）', 'primary full',
        function () { backupAll(files); }, 'arrowDown'),
      ui.btn('一覧を読み込み直す', 'ghost full', function () { load(true); }, 'refresh')
    ]));

    root.appendChild(wrap);
    load();     // 古ければ裏で取り直す（表示は保ったまま）
  }

  /* ---------------- 受け取り口 ---------------- */

  function dropZone() {
    var input = el('input', {
      type: 'file', multiple: true, style: { display: 'none' }
    });
    input.addEventListener('change', function () {
      send(Array.prototype.slice.call(input.files));
      input.value = '';
    });

    var zone = el('div', { class: 'dropzone', onclick: function () { input.click(); } }, [
      ui.icon('arrowUp', 26),
      el('strong', { text: 'ファイルを追加' }),
      el('span', { class: 'muted small', text: 'タップして選ぶ / ここにドラッグ＆ドロップ（PC）' }),
      el('span', { class: 'muted small', text: '1ファイル100MBまで' }),
      input
    ]);

    // ドラッグ＆ドロップ（PC）。ページ全体で受けると誤爆するのでこの枠だけ
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        zone.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove('over');
      });
    });
    zone.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      var list = dt.files ? Array.prototype.slice.call(dt.files) : [];
      if (list.length) send(list);
    });
    return zone;
  }

  /* 選ばれたファイルを順に送る */
  function send(list) {
    if (!list.length) return;
    var pid = filterProject;   // 案件で絞っているときは、その案件のファイルとして入れる

    list.forEach(function (file) {
      var entry = { name: file.name, pct: 0, error: '' };
      uploads.push(entry);
      DL.app.render();

      F.upload(file, {
        projectId: pid,
        onProgress: function (p) {
          entry.pct = p;
          var bar = findBar(entry);
          if (bar) bar.style.width = Math.round(p * 100) + '%';
        }
      }).then(function () {
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
      cache = r; fetchedAt = Date.now(); loading = false; DL.app.render();
    }).catch(function (e) {
      error = e.message; fetchedAt = Date.now(); loading = false; DL.app.render();
    });
  }

  function row(f) {
    var p = f.projectId ? S.getProject(f.projectId) : null;
    return el('div', { class: 'row file' }, [
      el('span', { class: 'file-icon' }, ui.icon(iconFor(f), 18)),
      el('button', {
        class: 'row-main file-main',
        onclick: function () {
          ui.toast('取得しています…');
          F.download(f).catch(function (e) { ui.toast(e.message, 'danger'); });
        }
      }, [
        el('div', { class: 'row-title' }, [el('span', { text: f.name })]),
        el('div', { class: 'row-sub' }, [
          ui.chip(size(f.size), 'ghosty'),
          ui.chip(when(f.uploadedAt), 'soft'),
          f.by ? ui.chip(f.by, 'ghosty') : null,
          p ? ui.iconChip('projects', p.title, 'ghosty') : null
        ])
      ]),
      el('button', {
        class: 'iconbtn small', 'aria-label': 'この ファイルの操作',
        onclick: function () { menu(f); }
      }, ui.icon('more', 18))
    ]);
  }

  function menu(f) {
    var close = ui.sheet({
      title: f.name,
      body: el('div', { class: 'menu' }, [
        item('arrowDown', '保存する', function () {
          close();
          ui.toast('取得しています…');
          F.download(f).catch(function (e) { ui.toast(e.message, 'danger'); });
        }),
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
      ])
    });
    function item(icon, text, onclick) {
      return el('button', { class: 'menu-item', onclick: onclick }, [ui.icon(icon, 18), el('span', { text: text })]);
    }
  }

  /**
   * 案件への紐付けを変える。
   * R2 のメタ情報だけを差し替える手段が無いので、取り直して入れ直す。
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
        ui.field('案件', sel, '選んだ案件のファイルとして一覧に出ます'),
        el('p', { class: 'muted small', text: '入れ直しになるため、大きいファイルは少し時間がかかります。' })
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('変更', 'primary', function () {
          close();
          ui.toast('入れ替えています…');
          F.fetchBytes(f.id).then(function (bytes) {
            var file = new File([bytes], f.name, { type: f.type || 'application/octet-stream' });
            return F.upload(file, { projectId: sel.value }).then(function () { return F.remove(f.id); });
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

    var go = function () {
      var note = el('p', { class: 'muted small', text: '準備しています…' });
      var close = ui.sheet({
        title: 'ZIPにまとめています', body: el('div', { class: 'form' }, [
          note,
          el('p', { class: 'muted small', text: '終わるまでこの画面を閉じないでください。' })
        ])
      });
      F.downloadAll(files, function (done, all, name) {
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
    if (t === 'application/pdf' || /\.pdf$/.test(name)) return 'receipt';
    if (t.indexOf('zip') >= 0 || /\.(zip|rar|7z)$/.test(name)) return 'backup';
    if (/\.(psd|clip|sai|ai|xcf)$/.test(name)) return 'design';
    return 'task';
  }

  DL.views = DL.views || {};
  DL.views.files = {
    render: render,
    // タブに入るたびに取り直す（もう片方の端末が上げたものをすぐ見せる）
    entered: function () { if (F.ready()) load(true); },
    reset: function () { cache = null; fetchedAt = 0; error = ''; }
  };
})(window.DL);
