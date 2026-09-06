/* Discord への夜のバックアップ（アプリ側）。

   送るのは Worker の仕事で、ここは様子を見るのと、
   手で1回送るのと、届いたファイルを読み戻すところだけを持つ。

   ファイルは3つの形がありうる。
     .json          そのまま
     .json.gz       gzip で縮めたもの
     .json.gz.enc   さらに合言葉で包んだもの
   包みの並びは worker.js の encrypt と同じで、
     目印 'M365BK1'(7) | 塩(16) | iv(12) | 中身
   になっている。 */
(function (DL) {
  'use strict';
  var S = DL.store;

  var MAGIC = 'M365BK1';

  function conf() { return S.syncSettings(); }
  function ready() {
    var c = conf();
    return !!(c.url && c.token && c.token.length >= 24);
  }
  function base() { return String(conf().url).replace(/\/+$/, ''); }
  function auth() { return { authorization: 'Bearer ' + conf().token }; }

  function api(path, init) {
    if (!ready()) return Promise.reject(new Error('同期の設定がまだです'));
    init = init || {};
    init.headers = Object.assign({}, auth(), init.headers || {});
    return fetch(base() + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok && !j.error) throw new Error('サーバーが応答しません（' + r.status + '）');
        return j;
      });
    });
  }

  /** いまの様子。{webhook, encrypted, hour, today, last} */
  function status() { return api('/v1/backup/status'); }

  /** いますぐ1回送る */
  function run() { return api('/v1/backup/run', { method: 'POST' }); }

  /* ---------------- 読み戻す ---------------- */

  function isGz(bytes) { return bytes[0] === 0x1f && bytes[1] === 0x8b; }

  function isEnc(bytes) {
    if (bytes.length < 36) return false;
    for (var i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
    }
    return true;
  }

  /** どんな形のファイルか。'json' | 'gz' | 'enc' */
  function kindOf(bytes) {
    if (isEnc(bytes)) return 'enc';
    if (isGz(bytes)) return 'gz';
    return 'json';
  }

  function ungzip(bytes) {
    if (!window.DecompressionStream) {
      return Promise.reject(new Error('この端末では gzip を開けません。PC で解凍してから読み込んでください'));
    }
    var ds = new DecompressionStream('gzip');
    return new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer()
      .then(function (b) { return new Uint8Array(b); })
      .catch(function () { throw new Error('gzip を開けませんでした（壊れているかもしれません）'); });
  }

  function deriveKey(pass, salt) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (k) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' },
          k, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      });
  }

  function unseal(bytes, pass) {
    if (!(window.crypto || {}).subtle) {
      return Promise.reject(new Error('この端末では暗号を開けません'));
    }
    var salt = bytes.slice(7, 23), iv = bytes.slice(23, 35), body = bytes.slice(35);
    return deriveKey(pass, salt).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, body);
    }).then(function (b) { return new Uint8Array(b); })
      .catch(function () { throw new Error('合言葉が違うか、ファイルが壊れています'); });
  }

  /**
   * バックアップのファイルを読んで、中の JSON の文字にする。
   * @param {File|Blob} file
   * @param {function():Promise<string>} askPass 包んであるときに合言葉を聞く
   * @returns {Promise<string>}
   */
  function readFile(file, askPass) {
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var kind = kindOf(bytes);

      var opened = Promise.resolve(bytes);
      if (kind === 'enc') {
        if (!askPass) return Promise.reject(new Error('合言葉が要ります'));
        opened = Promise.resolve(askPass()).then(function (pass) {
          if (!pass) throw new Error('やめました');
          return unseal(bytes, pass);
        });
      }

      return opened.then(function (b) {
        // 包みの中は gzip のことも、そのままのこともある
        return isGz(b) ? ungzip(b) : b;
      }).then(function (b) {
        return new TextDecoder().decode(b);
      });
    });
  }

  DL.backup = {
    ready: ready, status: status, run: run,
    kindOf: kindOf, readFile: readFile
  };
})(window.DL);
