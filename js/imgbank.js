/* 絵だけの置き場。

   考えかた
     同期の中身（state）には「鍵」だけを入れ、絵そのものは別の道で運ぶ。
     鍵は中身そのものから作る（SHA-256 の先頭32桁）ので、
       ・同じ絵は1つしか持たない
       ・上書きが起きない＝端末どうしでぶつからない
     という良さがある。

   置き場所
     端末の中     … IndexedDB の images（k:鍵, url:dataURL）
     端末のあいだ … 同期サーバーの /v1/img/<鍵>（R2）

   まだサーバー側が絵の受け口を持っていない（deploy 前）ときや、
   同期を使っていないときは、これまでどおり dataURL をそのまま
   state に入れて運ぶ。どちらの形でも読めるようにしてある。 */
(function (DL) {
  'use strict';
  var S = DL.store;

  var PREFIX = 'img:';
  var mem = {};          // 鍵 → dataURL（描くときは同期的に引きたいので memory に載せる）
  var asked = {};        // 取りに行った鍵（何度も叩かないため）
  var sent = {};         // 送り終えた鍵
  var loaded = false;
  var renderTimer = null;
  var RETRY_GAP = 30000;  // 取れなかった絵を、もう一度試すまでの間

  function conf() { return S.syncSettings ? S.syncSettings() : {}; }
  function ready() {
    var c = conf();
    return !!(c.url && c.token && c.token.length >= 24);
  }
  function base() { return String(conf().url).replace(/\/+$/, ''); }
  function auth() { return { authorization: 'Bearer ' + conf().token }; }

  function isRef(v) { return typeof v === 'string' && v.indexOf(PREFIX) === 0; }
  function keyOf(v) { return isRef(v) ? v.slice(PREFIX.length) : ''; }

  /* 中身から鍵を作る */
  function hash(text) {
    var enc = new TextEncoder().encode(text);
    if (!window.crypto || !window.crypto.subtle) {
      // 保険（古い環境）。ぶつかりにくさは落ちるが、動きは同じ
      var h = 0, i;
      for (i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) >>> 0; }
      return Promise.resolve(('00000000' + h.toString(16)).slice(-8) + ('0000000' + text.length.toString(16)).slice(-8));
    }
    return window.crypto.subtle.digest('SHA-256', enc).then(function (buf) {
      var b = new Uint8Array(buf), out = '', j;
      for (j = 0; j < 16; j++) out += ('0' + b[j].toString(16)).slice(-2);
      return out;
    });
  }

  /* 端末の中にあるぶんを、まとめて memory へ */
  function init() {
    if (loaded) return Promise.resolve();
    return DL.db.all('images').then(function (rows) {
      (rows || []).forEach(function (r) { if (r && r.k && r.url) mem[r.k] = r.url; });
      loaded = true;
    }).catch(function () { loaded = true; });
  }

  /**
   * 絵を預ける。
   * @param {string} dataURL
   * @returns {Promise<string>} state に入れる値。
   *   サーバーへ送れたときは 'img:<鍵>'、送れないときは dataURL そのもの
   */
  function put(dataURL) {
    if (!/^data:image\//.test(String(dataURL || ''))) return Promise.resolve('');
    return hash(dataURL).then(function (k) {
      mem[k] = dataURL;
      DL.db.put('images', { k: k, url: dataURL, at: new Date().toISOString() });
      if (!ready()) return dataURL;      // 同期を使っていない → これまでどおり
      return upload(k, dataURL).then(function (ok) {
        return ok ? PREFIX + k : dataURL;
      });
    });
  }

  /* サーバーへ1枚送る。送れたかどうかだけ返す（例外は投げない） */
  function upload(k, dataURL) {
    if (sent[k]) return Promise.resolve(true);
    return fetch(base() + '/v1/img/' + k, {
      method: 'PUT',
      headers: Object.assign({ 'content-type': 'application/json' }, auth()),
      body: JSON.stringify({ url: dataURL })
    }).then(function (res) {
      if (res.ok) { sent[k] = true; return true; }
      return false;
    }).catch(function () { return false; });
  }

  /**
   * 描くときに使う。state に入っている値を dataURL に直す。
   * まだ手元に無ければ、裏で取りに行って、届いたら描き直す。
   * @param {string} v 'img:<鍵>' か dataURL
   * @returns {string} dataURL（まだ無ければ空）
   */
  function src(v) {
    if (!v) return '';
    if (!isRef(v)) return v;             // 昔からの dataURL はそのまま
    var k = keyOf(v);
    if (mem[k]) return mem[k];
    fetchOne(k);
    return '';
  }

  /* 手元に無い絵を1枚だけ取りに行く。
     取れなかったとき（サーバーがまだ絵の受け口を持っていない、通信できない）は、
     しばらくしてからもう一度試せるようにしておく。
     一度きりにすると、Worker を新しくしたあともアプリを開き直すまで出てこない */
  function fetchOne(k) {
    if (asked[k] || !ready() || !/^[0-9a-f]{8,64}$/.test(k)) return;
    asked[k] = true;
    var retry = function () { setTimeout(function () { delete asked[k]; }, RETRY_GAP); };
    fetch(base() + '/v1/img/' + k, { headers: auth(), cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        var url = body && body.url;
        if (!/^data:image\//.test(String(url || ''))) { retry(); return; }
        mem[k] = url;
        sent[k] = true;                  // サーバーにあるのは分かっている
        DL.db.put('images', { k: k, url: url, at: new Date().toISOString() });
        laterRender();
      })
      .catch(retry);
  }

  /* 何枚か続けて届くことがあるので、描き直しは一度にまとめる */
  function laterRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      if (DL.app && DL.app.render) DL.app.render();
    }, 200);
  }

  /**
   * 手元にあってサーバーに送れていないぶんを、まとめて送る。
   * 同期を入れ直したときや、Worker を deploy したあとに効く。
   * 送れた絵は、state の側も dataURL から鍵に置き換える。
   */
  function pushAll() {
    if (!ready() || !loaded) return Promise.resolve(0);
    var keys = Object.keys(mem).filter(function (k) { return !sent[k]; });
    if (!keys.length) return Promise.resolve(0);
    return keys.reduce(function (p, k) {
      return p.then(function (n) {
        return upload(k, mem[k]).then(function (ok) { return n + (ok ? 1 : 0); });
      });
    }, Promise.resolve(0));
  }

  /**
   * state に dataURL のまま入っている絵を、置き場へ移して鍵に置き換える。
   * サーバー側がまだ絵の受け口を持っていなかったころに登録したぶんを、
   * deploy のあとに追いつかせるためのもの。
   * いまのところ絵を持つのはチケットのロゴだけなので、そこだけ見る。
   */
  function relink() {
    if (!ready() || !S.tickets) return Promise.resolve(0);
    var todo = [];
    S.tickets().forEach(function (t) {
      if (/^data:image\//.test(t.logo || '')) {
        todo.push({ url: t.logo, put: function (ref) { S.updateTicket(t.id, { logo: ref }); } });
      }
    });
    (S.logos ? S.logos() : []).forEach(function (x) {
      if (/^data:image\//.test(x.ref || '')) {
        todo.push({ url: x.ref, put: function (ref) { S.removeLogo(x.id); S.addLogo(ref, x.name); } });
      }
    });
    if (!todo.length) return Promise.resolve(0);
    return todo.reduce(function (p, o) {
      return p.then(function (n) {
        return hash(o.url).then(function (k) {
          if (!mem[k]) {
            mem[k] = o.url;
            DL.db.put('images', { k: k, url: o.url, at: new Date().toISOString() });
          }
          return upload(k, o.url).then(function (ok) {
            if (!ok) return n;
            o.put(PREFIX + k);
            return n + 1;
          });
        });
      });
    }, Promise.resolve(0));
  }

  DL.imgbank = {
    init: init, put: put, src: src, pushAll: pushAll, relink: relink,
    isRef: isRef, key: keyOf, PREFIX: PREFIX
  };
})(window.DL);
