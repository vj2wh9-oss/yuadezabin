/* METEO LOCK — ID とパスワードの金庫。

   ここでいう「暗号」は、金庫を開けるために入れてもらう文字列のこと
   （画面でもそう呼んでいる）。暗号そのものは、どこにも保存しない。

   守りかたの考えかた（ここは手を抜くと意味が無いので、長めに書く）

   1) 中身は必ず暗号で守る。
      サービス名も ID もパスワードも、読める形では一度も保存しない。
      IndexedDB にも localStorage にも、同期先にも、控えにも、
      入るのは「暗号のかたまり」だけ。

   2) 鍵は二段にする。
      ・金庫の鍵（vault key）… 作るときに1本だけ、でたらめに作る 256bit
      ・暗号から作る鍵（KEK）… 入れてもらった暗号を PBKDF2 で 60万回 練る
      金庫の鍵を、暗号から作る鍵で包んでしまっておく。
      こうしておくと、暗号を変えても包み直すだけで済み、
      中身を全部つけ替えずに済む。顔での解錠も同じ鍵を別に包むだけ。

   3) 解いた中身は記憶の中だけ。
      解いたものは変数にしか置かない。保存もしないし、同期にも乗せない。
      決めた時間 触らなければ、自分から鍵をかける。
      ほかのアプリに移っているあいだも同じように数える
      （切り替えた拍子に閉じてしまうと、入れ直してばかりになるため）。
      入力の途中だけは、数えるのを止める（hold）。

   4) 顔だけでは開けない。
      顔（Face ID）は「その端末の中にある鍵で、包みを解く」ためのもの。
      WebAuthn の PRF が使える端末でだけ用意する。使えない端末では出さない。
      顔の登録が無い端末では、暗号でしか開かない。
      ——「顔を見せれば画面が出る」だけの蓋にはしない。

   5) 暗号は預けない。
      暗号そのものも、その潰した形も、どこにも保存しない。
      合っているかどうかは「包みが解けたかどうか」で分かる（AES-GCM の検め）。
      忘れたら誰にも開けられない。そのぶん、中身は誰にも読めない。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var VER = 1;
  var ITER = 600000;        // PBKDF2 の回し数（OWASP の目安）
  /* 暗号の最短の長さ。金庫の控えは、暗号を解いていない形のまま
     同期先にもバックアップにも渡る。万一それが人手に渡っても、
     時間をかけて解かれない長さにしておく */
  var MIN_PASS = 12;
  var MAX_ITEMS = 500;

  /* 解いた鍵と中身。ここにしか無い。保存もしないし、同期にも乗せない */
  var vaultKey = null;      // CryptoKey（AES-GCM 256）
  var items = null;         // [{id,name,user,pass,url,note,at}]
  var lastTouch = 0;
  var tick = null;
  var clipTimer = null;
  var listeners = [];
  /* 入力の途中など、いま鍵をかけられては困るあいだの数。
     0より大きいうちは、時間で閉じない */
  var holds = 0;

  /* ---------------- 下ごしらえ ---------------- */

  function sub() { return (window.crypto || {}).subtle || null; }

  /** この端末で使えるか（https でないと暗号が使えない） */
  function ready() { return !!(sub() && window.isSecureContext !== false); }

  function rand(n) {
    var a = new Uint8Array(n);
    window.crypto.getRandomValues(a);
    return a;
  }

  function b64(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unb64(str) {
    var s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function enc(s) { return new TextEncoder().encode(s); }
  function dec(buf) { return new TextDecoder().decode(buf); }

  /* 暗号から鍵を練る。ここが重いほど、総当たりが割に合わなくなる */
  function kekFrom(pass, salt, iter) {
    return sub().importKey('raw', enc(String(pass)), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return sub().deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iter || ITER, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  function gcmEncrypt(key, iv, bytes) {
    return sub().encrypt({ name: 'AES-GCM', iv: iv }, key, bytes);
  }

  function gcmDecrypt(key, iv, bytes) {
    return sub().decrypt({ name: 'AES-GCM', iv: iv }, key, bytes);
  }

  /* 金庫の鍵。包んでしまっておけるよう、取り出せる形で作る */
  function newVaultKey() {
    return sub().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  function importVaultKey(raw) {
    return sub().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  /* ---------------- 金庫の中身 ---------------- */

  function normalizeItem(x) {
    x = x || {};
    return {
      id: x.id || U.uid(),
      name: String(x.name || '').slice(0, 120),
      user: String(x.user || '').slice(0, 200),
      pass: String(x.pass == null ? '' : x.pass).slice(0, 400),
      url: String(x.url || '').slice(0, 300),
      note: String(x.note || '').slice(0, 2000),
      at: x.at || new Date().toISOString()
    };
  }

  /* ---------------- 開け閉め ---------------- */

  function hasVault() { return !!S.lockBox(); }

  /** いま開いているか */
  function isOpen() { return !!vaultKey && !!items; }

  function emit() {
    listeners.forEach(function (fn) { try { fn(isOpen()); } catch (e) { /* 続ける */ } });
  }

  /** 開け閉めが変わったときに呼んでもらう（画面の描き直し用） */
  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  /**
   * 金庫を作る（はじめてのとき）。
   * @param {string} pass 暗号
   * @returns {Promise<boolean>}
   */
  function create(pass) {
    if (!ready()) return Promise.reject(new Error('この端末では暗号が使えません'));
    if (hasVault()) return Promise.reject(new Error('もう金庫があります'));
    var bad = passProblem(pass);
    if (bad) return Promise.reject(new Error(bad));
    var salt = rand(16), wrapIv = rand(12);
    var vk;
    return newVaultKey().then(function (k) {
      vk = k;
      return Promise.all([kekFrom(pass, salt, ITER), sub().exportKey('raw', k)]);
    }).then(function (r) {
      return gcmEncrypt(r[0], wrapIv, r[1]);
    }).then(function (wrapped) {
      vaultKey = vk;
      items = [];
      return writeBox({
        salt: b64(salt), wrapIv: b64(wrapIv), wrapped: b64(wrapped), iter: ITER
      });
    }).then(function () {
      touch();
      emit();
      return true;
    });
  }

  /**
   * 暗号で開ける。
   * @returns {Promise<boolean>} 合っていなければ false（待ち時間中は例外）
   */
  function unlock(pass) {
    if (!ready()) return Promise.reject(new Error('この端末では暗号が使えません'));
    var box = S.lockBox();
    if (!box) return Promise.reject(new Error('まだ金庫がありません'));
    var wait = waitLeft();
    if (wait > 0) return Promise.reject(new Error('あと ' + waitText(wait) + ' 待ってください'));

    return kekFrom(pass, unb64(box.salt), box.iter)
      .then(function (kek) { return gcmDecrypt(kek, unb64(box.wrapIv), unb64(box.wrapped)); })
      .then(function (raw) { return openWith(raw, box); })
      .then(function () { clearGuard(); return true; })
      .catch(function (e) {
        if (e && e.dlFatal) throw e;
        failed();
        return false;
      });
  }

  /* 金庫の鍵（生）で開ける。暗号からでも、顔からでも、ここに合流する */
  function openWith(raw, box) {
    box = box || S.lockBox();
    return importVaultKey(raw).then(function (k) {
      return gcmDecrypt(k, unb64(box.iv), unb64(box.data)).then(function (plain) {
        var body;
        try { body = JSON.parse(dec(plain)); } catch (e) {
          var err = new Error('金庫の中身を読めませんでした');
          err.dlFatal = true;
          throw err;
        }
        vaultKey = k;
        items = (body.items || []).map(normalizeItem);
        touch();
        emit();
        return true;
      });
    });
  }

  /** 鍵をかける。解いた中身は捨てる */
  function lock() {
    vaultKey = null;
    items = null;
    holds = 0;
    stopTick();
    emit();
  }

  /* ---------------- 自動で鍵をかける ---------------- */

  /** 触ったことを伝える（自動施錠までの時間を数え直す） */
  function touch() {
    lastTouch = Date.now();
    if (isOpen()) startTick();
  }

  function autoSec() { return S.lockOpts().autoSec; }

  /** 自動で鍵をかけるまでの残り秒 */
  function leftSec() {
    if (!isOpen()) return 0;
    return Math.max(0, Math.ceil(autoSec() - (Date.now() - lastTouch) / 1000));
  }

  function startTick() {
    if (tick) return;
    tick = setInterval(function () {
      if (!isOpen()) { stopTick(); return; }
      // 入力の途中は数えない（打っている最中に閉じられては困る）
      if (holds > 0) { lastTouch = Date.now(); return; }
      if (leftSec() <= 0) lock();
    }, 1000);
  }

  function stopTick() {
    if (tick) clearInterval(tick);
    tick = null;
  }

  /**
   * いま鍵をかけられては困る、と伝える（入力のシートを開いているあいだなど）。
   * 開くときに true、閉じるときに false。入れ子でも数で合う。
   */
  function hold(on) {
    holds = Math.max(0, holds + (on ? 1 : -1));
    touch();
  }

  /** 入力の途中かどうか（画面が「まだ閉じません」と出すため） */
  function held() { return holds > 0; }

  /* ほかのアプリに移っているあいだも、時間で数える。
     戻ってきたときに、もう過ぎていれば その場で鍵をかける。
     （後ろに回した瞬間に閉じてしまうと、ちょっと切り替えるたびに
       入れ直すことになるので、決めた時間のうちは開けたままにする） */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (isOpen() && holds <= 0 && leftSec() <= 0) lock();
  });

  /* ---------------- 間違えたときの待ち時間 ----------------

     端末を取られたときに、何度も総当たりで試されないようにする。
     3回までは咎めず、そこから倍々に延ばし、最長5分。 */

  function waitLeft() {
    var g = S.lockGuard();
    return Math.max(0, g.until - Date.now());
  }

  function waitText(ms) {
    var s = Math.ceil(ms / 1000);
    return s >= 60 ? Math.ceil(s / 60) + '分' : s + '秒';
  }

  function failed() {
    var g = S.lockGuard();
    var n = g.fails + 1;
    var sec = n <= 3 ? 0 : Math.min(300, Math.pow(2, n - 3));
    S.setLockGuard({ fails: n, until: sec ? Date.now() + sec * 1000 : 0 });
  }

  function clearGuard() { S.setLockGuard({ fails: 0, until: 0 }); }

  /** いま何秒待たされているか（画面に出す用） */
  function penalty() { return { fails: S.lockGuard().fails, wait: waitLeft() }; }

  /* ---------------- 書き込み ---------------- */

  /* 中身を暗号にして仕舞う。開いているときだけ */
  function writeBox(seed) {
    var box = S.lockBox() || {};
    var iv = rand(12);
    var body = JSON.stringify({ v: VER, items: items || [] });
    return gcmEncrypt(vaultKey, iv, enc(body)).then(function (data) {
      S.setLockBox({
        v: VER,
        iter: (seed && seed.iter) || box.iter || ITER,
        salt: (seed && seed.salt) || box.salt,
        wrapIv: (seed && seed.wrapIv) || box.wrapIv,
        wrapped: (seed && seed.wrapped) || box.wrapped,
        iv: b64(iv), data: b64(data),
        at: new Date().toISOString()
      });
      return true;
    });
  }

  /* ---------------- 一覧・出し入れ ---------------- */

  /**
   * 中身を返す（開いているときだけ）。
   * @param {string} [q] サービス名・ID・URL・メモから探す
   */
  function list(q) {
    if (!isOpen()) return [];
    var s = String(q || '').trim().toLowerCase();
    var out = items.slice().sort(function (a, b) {
      return U.cmp(a.name.toLowerCase(), b.name.toLowerCase());
    });
    if (!s) return out;
    var words = s.split(/[\s　]+/).filter(Boolean);
    return out.filter(function (x) {
      var hay = (x.name + ' ' + x.user + ' ' + x.url + ' ' + x.note).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  function get(id) {
    if (!isOpen()) return null;
    return items.filter(function (x) { return x.id === id; })[0] || null;
  }

  /**
   * 足す・書き換える。
   * @returns {Promise<object>} 仕舞ったあとの1件
   */
  function put(x) {
    if (!isOpen()) return Promise.reject(new Error('鍵がかかっています'));
    var v = normalizeItem(x);
    if (!v.name) return Promise.reject(new Error('サービス名を入れてください'));
    v.at = new Date().toISOString();
    var i = items.map(function (o) { return o.id; }).indexOf(v.id);
    if (i >= 0) items[i] = v;
    else {
      if (items.length >= MAX_ITEMS) return Promise.reject(new Error('これ以上は入りません'));
      items.push(v);
    }
    touch();
    return writeBox().then(function () { return v; });
  }

  function remove(id) {
    if (!isOpen()) return Promise.reject(new Error('鍵がかかっています'));
    items = items.filter(function (x) { return x.id !== id; });
    touch();
    return writeBox();
  }

  /** 何件入っているか（開いているときだけ分かる） */
  function count() { return isOpen() ? items.length : -1; }

  /* ---------------- 暗号を変える ---------------- */

  /**
   * 暗号を入れ替える。中身はそのまま、包み直すだけ。
   * 顔の包みは金庫の鍵を包んだものなので、そのまま使える。
   */
  function changePass(cur, next) {
    if (!isOpen()) return Promise.reject(new Error('先に開けてください'));
    var bad = passProblem(next);
    if (bad) return Promise.reject(new Error(bad));
    var box = S.lockBox();
    // いまの暗号が合っているか、包みを解いて確かめる
    return kekFrom(cur, unb64(box.salt), box.iter)
      .then(function (kek) { return gcmDecrypt(kek, unb64(box.wrapIv), unb64(box.wrapped)); })
      .catch(function () { throw new Error('いまの暗号が違います'); })
      .then(function (raw) {
        var salt = rand(16), wrapIv = rand(12);
        return kekFrom(next, salt, ITER).then(function (kek2) {
          return gcmEncrypt(kek2, wrapIv, raw);
        }).then(function (wrapped) {
          return writeBox({ salt: b64(salt), wrapIv: b64(wrapIv), wrapped: b64(wrapped), iter: ITER });
        });
      }).then(function () { clearGuard(); return true; });
  }

  /** 金庫ごと捨てる（中身も顔の包みも） */
  function destroy() {
    S.setLockBox(null);
    S.setLockFace(null);
    clearGuard();
    lock();
  }

  /* ---------------- 暗号の強さ ---------------- */

  /** だめな理由。問題なければ '' */
  function passProblem(pass) {
    var p = String(pass == null ? '' : pass);
    if (p.length < MIN_PASS) return '暗号は ' + MIN_PASS + '文字以上にしてください';
    if (/^(.)\1+$/.test(p)) return '同じ文字だけの暗号は使えません';
    if (/^[0-9]+$/.test(p) && p.length < 16) return '数字だけなら 16文字以上にしてください';
    return '';
  }

  /**
   * 強さの目安。0〜4 と、ひとこと。
   * 長さを主に見る（記号を混ぜるより、長いほうが効く）
   */
  function strength(pass) {
    var p = String(pass == null ? '' : pass);
    if (!p) return { score: 0, text: '' };
    var kinds = 0;
    if (/[a-z]/.test(p)) kinds++;
    if (/[A-Z]/.test(p)) kinds++;
    if (/[0-9]/.test(p)) kinds++;
    if (/[^a-zA-Z0-9]/.test(p)) kinds++;
    var score = 0;
    if (p.length >= 10) score++;
    if (p.length >= 14) score++;
    if (p.length >= 20) score++;
    if (kinds >= 3) score++;
    if (/^(.)\1+$/.test(p) || /^[0-9]+$/.test(p)) score = Math.min(score, 1);
    var text = ['とても弱い', '弱い', 'まずまず', '強い', 'とても強い'][score];
    return { score: score, text: text };
  }

  /* ---------------- パスワードを作る ---------------- */

  var SETS = {
    lower: 'abcdefghijkmnopqrstuvwxyz',      // l は除く
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',       // I と O は除く
    digit: '23456789',                       // 0 と 1 は除く
    sign: '!#$%&*+-=?@^_'
  };

  /**
   * でたらめなパスワードを作る。偏らないよう、余りの出る目は引き直す。
   * @param {{len:number, sign:boolean}} [o]
   */
  function genPass(o) {
    o = o || {};
    var len = Math.min(64, Math.max(8, U.num(o.len, 20) || 20));
    var pool = SETS.lower + SETS.upper + SETS.digit + (o.sign === false ? '' : SETS.sign);
    var out = '';
    while (out.length < len) {
      var buf = rand(len * 2);
      for (var i = 0; i < buf.length && out.length < len; i++) {
        // 256 を字数で割った余りの帯は捨てる（偏らせないため）
        var lim = 256 - (256 % pool.length);
        if (buf[i] >= lim) continue;
        out += pool.charAt(buf[i] % pool.length);
      }
    }
    return out;
  }

  /* ---------------- 写す（コピー） ----------------

     写したものは、しばらくしたら消す。
     ほかのアプリに貼り付けたつもりのものが、いつまでも残らないように。 */

  /**
   * 写して、しばらくしたら消す。
   * @param {string} text
   * @param {boolean} [wipe] false で消さない（ID など、残っても困らないもの）
   */
  function copy(text, wipe) {
    var sec = S.lockOpts().clipSec;
    return U.copy(String(text == null ? '' : text)).then(function (ok) {
      touch();
      if (!ok || wipe === false || !sec) return ok;
      if (clipTimer) clearTimeout(clipTimer);
      clipTimer = setTimeout(function () {
        clipTimer = null;
        U.copy('').catch(function () { /* 消せなくても構わない */ });
      }, sec * 1000);
      return ok;
    });
  }

  /* ---------------- 顔（Face ID）で開ける ----------------

     顔だけで開く仕組みにはしない。
     「その端末の中にある鍵でしか解けない包み」を1つ作っておき、
     顔はその鍵を使う許しを端末に出してもらうためのもの。
     包みを解く材料（PRF）は端末の外に出ないので、
     金庫を盗られても、その端末が無ければ開かない。 */

  var PRF_INFO = 'METEO LOCK face wrap v1';

  function faceReady() {
    return !!(ready() && window.PublicKeyCredential && navigator.credentials);
  }

  /** この端末に顔などの鍵があるか。@returns {Promise<boolean>} */
  function faceAvailable() {
    if (!faceReady()) return Promise.resolve(false);
    var f = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    if (!f) return Promise.resolve(false);
    return f.call(window.PublicKeyCredential).catch(function () { return false; });
  }

  /** この端末で、顔で開けるようにしてあるか */
  function faceOn() { return !!S.lockFace(); }

  /* PRF で返ってきた材料から、包み用の鍵を作る */
  function wrapKeyFrom(prfOut) {
    return sub().importKey('raw', prfOut, 'HKDF', false, ['deriveKey']).then(function (k) {
      return sub().deriveKey({
        name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc(PRF_INFO)
      }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  function prfOf(res) {
    var ext = res && res.getClientExtensionResults ? res.getClientExtensionResults() : null;
    var r = ext && ext.prf && ext.prf.results;
    return (r && r.first) || null;
  }

  /**
   * この端末で顔で開けるようにする。開いているあいだにだけできる。
   * PRF を使えない端末では false（顔だけの蓋は作らない）。
   * @returns {Promise<boolean>}
   */
  function enrollFace() {
    if (!faceReady() || !isOpen()) return Promise.resolve(false);
    var prfSalt = rand(32);
    var cred = null;
    return navigator.credentials.create({
      publicKey: {
        challenge: rand(32),
        rp: { name: 'METEO365' },
        user: { id: rand(16), name: 'METEO LOCK', displayName: 'METEO LOCK' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred'
        },
        timeout: 60000,
        attestation: 'none',
        extensions: { prf: {} }
      }
    }).then(function (c) {
      if (!c) return false;
      cred = c;
      var ext = c.getClientExtensionResults ? c.getClientExtensionResults() : {};
      // PRF が使えない端末では、顔での解錠は用意しない
      if (!ext.prf || ext.prf.enabled === false) return false;
      // 材料を一度もらう（作ったときには返らない端末が多いので、あらためて聞く）
      return navigator.credentials.get({
        publicKey: {
          challenge: rand(32),
          allowCredentials: [{ type: 'public-key', id: cred.rawId }],
          userVerification: 'required',
          timeout: 60000,
          extensions: { prf: { eval: { first: prfSalt } } }
        }
      }).then(function (res) {
        var out = prfOf(res);
        if (!out) return false;
        var iv = rand(12);
        return wrapKeyFrom(out).then(function (wk) {
          return sub().exportKey('raw', vaultKey).then(function (raw) {
            return gcmEncrypt(wk, iv, raw);
          });
        }).then(function (wrapped) {
          S.setLockFace({
            id: b64(cred.rawId), prfSalt: b64(prfSalt),
            iv: b64(iv), wrapped: b64(wrapped)
          });
          return true;
        });
      });
    }).catch(function () { return false; });
  }

  function forgetFace() { S.setLockFace(null); }

  /**
   * 顔で開ける。断られたり、包みが合わなければ false。
   * @returns {Promise<boolean>}
   */
  function faceUnlock() {
    var saved = S.lockFace();
    if (!faceReady() || !saved || !hasVault()) return Promise.resolve(false);
    if (waitLeft() > 0) return Promise.reject(new Error('あと ' + waitText(waitLeft()) + ' 待ってください'));
    return navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        allowCredentials: [{ type: 'public-key', id: unb64(saved.id) }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: unb64(saved.prfSalt) } } }
      }
    }).then(function (res) {
      var out = prfOf(res);
      if (!out) return false;
      return wrapKeyFrom(out)
        .then(function (wk) { return gcmDecrypt(wk, unb64(saved.iv), unb64(saved.wrapped)); })
        .then(function (raw) { return openWith(raw); })
        .then(function () { clearGuard(); return true; });
    }).catch(function () { return false; });
  }

  /* ---------------- 控え ----------------

     暗号のかたまりのまま写す。これ自体はどこに置いても中身は読めないが、
     暗号が弱いと時間をかけて破られる。強い暗号にしておくこと。 */

  function exportBox() {
    var box = S.lockBox();
    return box ? JSON.stringify(box) : '';
  }

  DL.lock = {
    ready: ready, hasVault: hasVault, isOpen: isOpen, onChange: onChange,
    create: create, unlock: unlock, lock: lock, destroy: destroy,
    list: list, get: get, put: put, remove: remove, count: count,
    changePass: changePass, passProblem: passProblem, strength: strength,
    genPass: genPass, copy: copy,
    touch: touch, leftSec: leftSec, autoSec: autoSec, penalty: penalty,
    hold: hold, held: held,
    faceReady: faceReady, faceAvailable: faceAvailable, faceOn: faceOn,
    enrollFace: enrollFace, forgetFace: forgetFace, faceUnlock: faceUnlock,
    exportBox: exportBox,
    MIN_PASS: MIN_PASS, ITER: ITER
  };
})(window.DL);
