/* METEO365 の同期サーバー（Cloudflare Worker）とのやりとり。

   持っているのは、このサイト専用の合鍵（32桁）だけ。
   これでできるのは次の3つで、ほかの持ちものには手が届かない。

     ・即売会の券の一覧を読む
     ・その券に持っていく頒布物を読む
     ・数えた在庫を預ける

   本物の合鍵（読み書き全部）は、こちらには渡ってこない。 */
(function (DL) {
  'use strict';
  var U = DL.util;

  /* 合鍵と置き場は URL の # に付けてもらい、端末に控える。
     # に付けたままだと、戻ったときに消えてしまうため */
  var LS = 'datemeteo.conf';

  function load() {
    var conf = { key: '', base: '' };
    try {
      var saved = JSON.parse(localStorage.getItem(LS) || '{}');
      conf.key = String(saved.key || '');
      conf.base = String(saved.base || '');
    } catch (e) { /* 読めなければ空のまま */ }

    // URL に付いていれば、そちらで上書きして控える
    var h = String(location.hash || '').replace(/^#/, '');
    if (h) {
      var p = {};
      h.split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
      });
      if (/^[0-9a-f]{32}$/.test(String(p.k || ''))) conf.key = p.k;
      if (/^https?:\/\//.test(String(p.s || ''))) conf.base = String(p.s).replace(/\/+$/, '');
      if (conf.key && conf.base) {
        save(conf);
        // 合鍵を画面の URL に出しっぱなしにしない
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
    return conf;
  }

  function save(conf) {
    try { localStorage.setItem(LS, JSON.stringify(conf)); } catch (e) { /* 入らなくても動く */ }
  }

  function forget() {
    try { localStorage.removeItem(LS); } catch (e) { /* そのまま */ }
  }

  var conf = load();

  function ready() { return !!(conf.key && conf.base); }

  function why(status, b) {
    var k = b && b.error;
    if (k === 'bad_key' || status === 401) return '合鍵が違います。METEO365 で作り直してください';
    if (k === 'no_state') return 'METEO365 からまだ同期されていません';
    if (k === 'not_found' && status === 404) return '見つかりませんでした';
    if (status === 404) return 'サーバーが未対応です。Worker を deploy し直してください';
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  function call(path, opts) {
    opts = opts || {};
    if (!ready()) return Promise.reject(new Error('合鍵がありません'));
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    var url = conf.base + path + sep + 'k=' + encodeURIComponent(conf.key);
    return fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : {},
      body: opts.body || null,
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(why(res.status, b));
        return b;
      });
    }, function () { throw new Error('通信できませんでした'); });
  }

  /** 即売会の券の一覧 */
  function events() { return call('/v1/event/list'); }

  /** その券に持っていく頒布物 */
  function one(id) { return call('/v1/event/one?id=' + encodeURIComponent(id)); }

  /** 数えた在庫を預ける */
  function close(body) {
    return call('/v1/event/close', { method: 'POST', body: JSON.stringify(body) });
  }

  /* 絵。'img:…' は置き場から引く。dataURL はそのまま使える。
     一度引いたものは覚えておく（同じ絵を何度も取りに行かない） */
  var pics = {};

  function pic(ref) {
    var s = String(ref || '');
    if (!s) return Promise.resolve('');
    if (s.indexOf('data:') === 0) return Promise.resolve(s);
    if (pics[s]) return pics[s];
    pics[s] = call('/v1/event/img?r=' + encodeURIComponent(s)).then(function (b) {
      return String((b && b.url) || '');
    }, function () { return ''; });
    return pics[s];
  }

  DL.api = {
    ready: ready, conf: function () { return conf; }, forget: forget,
    events: events, one: one, close: close, pic: pic
  };
})(window.DL = window.DL || {});
