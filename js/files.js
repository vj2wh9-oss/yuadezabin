/* 共有ファイル：同期サーバー（R2）とのやりとり。
   接続先と合鍵は同期の設定をそのまま使う。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var MAX_BYTES = 100 * 1024 * 1024;   // Workers の受信上限（無料・Pro）

  function conf() { return S.syncSettings(); }
  function ready() {
    var c = conf();
    return !!(c.url && c.token && c.token.length >= 24);
  }
  function base() { return String(conf().url).replace(/\/+$/, ''); }
  function auth() { return { authorization: 'Bearer ' + conf().token }; }

  function errText(status, body) {
    var e = body && body.error;
    if (status === 401) return '合鍵が違います';
    if (e === 'r2_not_bound') return 'サーバー側にファイル置き場（R2）がつながっていません。Worker の Settings → Bindings で R2 バケットを Variable name「FILES」で追加してください';
    if (e === 'too_large') return 'ファイルが大きすぎます（100MBまで）';
    if (e === 'bad_id') return 'ファイル名が扱えません';
    // 同期は動くのにここだけ 404 なら、サーバー側のコードがファイル共有より前の版
    if (status === 404) return 'サーバー側がファイル共有に未対応です。Cloudflare の Worker を最新のコードにして deploy し直してください';
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  /* 一覧 */
  function list() {
    if (!ready()) return Promise.reject(appError("同期の接続先が未設定です"));
    return fetch(base() + '/v1/files', { headers: auth(), cache: 'no-store' })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) {
          if (!res.ok) throw appError(errText(res.status, body));
          return body || { files: [], total: 0 };
        });
      })
      .catch(function (e) { throw asError(e); });
  }

  /* 自分で組み立てたエラーには印を付けておく */
  function appError(msg) {
    var e = new Error(msg);
    e.handled = true;
    return e;
  }

  /**
   * fetch が投げる TypeError（'Failed to fetch' など）はそのまま出すと
   * 何が起きたか伝わらないので、日本語に置き換える。
   */
  function asError(e) {
    if (e && e.handled) return e;
    return new Error('接続できませんでした。接続先のURLが違うか、オフラインの可能性があります');
  }

  /**
   * アップロード。進み具合を見たいので XHR を使う（fetch では送信の進捗が取れない）。
   * @param {File} file
   * @param {object} [opts] {projectId, folder, onProgress(0..1)}
   *   folder は '資料/ラフ' のようなパス。R2 側にも残すので、
   *   まだ同期していない端末でも同じ場所に出せる。
   */
  function upload(file, opts) {
    opts = opts || {};
    if (!ready()) return Promise.reject(appError("同期の接続先が未設定です"));
    if (file.size > MAX_BYTES) {
      return Promise.reject(appError(file.name + " は大きすぎます（100MBまで）"));
    }
    // フォルダのパスを送れない古い Worker では、CORS の事前確認で弾かれる。
    // その場合はパス無しで送り直し、アップロード自体は通す（置き場所はアプリ側の記録で持つ）
    return put(file, opts, !!opts.folder).catch(function (e) {
      if (!e || !e.corsMaybe) throw e;
      return put(file, opts, false);
    });
  }

  function put(file, opts, withFolder) {
    var id = U.uid().replace(/[^A-Za-z0-9_-]/g, '') + Date.now().toString(36);

    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', base() + '/v1/files/' + id);
      xhr.setRequestHeader('authorization', 'Bearer ' + conf().token);
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
      xhr.setRequestHeader('x-file-type', file.type || 'application/octet-stream');
      if (withFolder) xhr.setRequestHeader('x-file-folder', encodeURIComponent(opts.folder));
      xhr.setRequestHeader('x-file-project', opts.projectId || '');
      xhr.setRequestHeader('x-file-by', DL.sync.deviceName());
      if (xhr.upload && opts.onProgress) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) opts.onProgress(e.loaded / e.total);
        };
      }
      xhr.onload = function () {
        var body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* JSON でなければ無視 */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body || { id: id });
        else reject(appError(errText(xhr.status, body)));
      };
      xhr.onerror = function () {
        var e = appError("接続できませんでした。接続先のURLが違うか、オフラインの可能性があります");
        e.corsMaybe = withFolder;   // パス付きでだけ落ちたなら、古い Worker の可能性がある
        reject(e);
      };
      xhr.onabort = function () { reject(appError("中止しました")); };
      xhr.send(file);
    });
  }

  /* 中身を取り出す（ZIP にまとめるときにも使う） */
  function fetchBytes(id) {
    return fetch(base() + '/v1/files/' + id, { headers: auth(), cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw appError(errText(res.status, null));
        return res.arrayBuffer();
      })
      .then(function (buf) { return new Uint8Array(buf); })
      .catch(function (e) { throw asError(e); });
  }

  /* 1件を端末に保存する */
  function download(f) {
    return fetch(base() + '/v1/files/' + f.id, { headers: auth(), cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw appError(errText(res.status, null));
        return res.blob();
      })
      .then(function (blob) {
        saveBlob(blob, f.name);
        return true;
      })
      .catch(function (e) { throw asError(e); });
  }

  function remove(id) {
    return fetch(base() + '/v1/files/' + id, { method: 'DELETE', headers: auth() })
      .then(function (res) {
        if (!res.ok) throw appError(errText(res.status, null));
        return true;
      })
      .catch(function (e) { throw asError(e); });
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = U.el('a', { href: url, download: name || 'file' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  /**
   * まとめて1つの ZIP にして保存する（手元へのバックアップ用）。
   * 一度メモリに載せるので、呼ぶ側で合計サイズを確かめること。
   * @param {Array} files list() の files
   * @param {function} [onProgress] (done, total, name)
   */
  function downloadAll(files, onProgress) {
    var entries = [];
    var chain = Promise.resolve();
    files.forEach(function (f, i) {
      chain = chain.then(function () {
        if (onProgress) onProgress(i, files.length, f.name);
        return fetchBytes(f.id).then(function (bytes) {
          entries.push({ name: f.name, data: bytes, date: new Date(f.uploadedAt) });
        });
      });
    });
    return chain.then(function () {
      if (onProgress) onProgress(files.length, files.length, '');
      var blob = DL.zip.build(entries);
      saveBlob(blob, '案件ポータル-ファイル-' + U.today() + '.zip');
      return entries.length;
    });
  }

  DL.files = {
    MAX_BYTES: MAX_BYTES,
    ready: ready, list: list, upload: upload, download: download,
    fetchBytes: fetchBytes, remove: remove, downloadAll: downloadAll, saveBlob: saveBlob
  };
})(window.DL);
