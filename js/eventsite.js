/* イベント当日用サイト（だてメテオ）とのやりとり。

   即売会の当日、会場では別の端末・別のサイトから在庫を数える。
   https://github.com/vj2wh9-oss/torani

   向こうに渡すのは、ここ専用の合鍵（32桁）だけ。
   それでできるのは「即売会の券と頒布物を読むこと」と
   「数えた在庫を預けること」の2つだけで、ほかの持ちものには手が届かない。
   本物の合鍵（読み書き全部）は、けっして向こうへ渡さない。

   届いた在庫は、券の「持ち帰り」として入れる。
   そこから先（販売数・売上・在庫から引く）は、これまでどおり券の画面で決める。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  /* イベント用サイトの置き場。合鍵を付けた URL を作って渡す */
  var SITE = 'https://vj2wh9-oss.github.io/torani/';

  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }

  /** 頼める状態か（同期の接続先が入っているか） */
  function ready() { return !!(base() && conf().token); }

  function api(path, opts) {
    opts = opts || {};
    if (!ready()) return Promise.reject(new Error('同期の接続先が未設定です'));
    var headers = { authorization: 'Bearer ' + conf().token };
    if (opts.body) headers['content-type'] = 'application/json';
    return fetch(base() + path, {
      method: opts.method || 'GET', headers: headers, body: opts.body || null
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (res.status === 404 && !b.ok) {
          throw new Error('Worker がまだ古いです。git pull && bash sync/setup.sh を通してください');
        }
        if (!res.ok) throw new Error('サーバーが断りました（' + res.status + '）');
        return b;
      });
    }, function () { throw new Error('通信できませんでした'); });
  }

  /* ---------------- 合鍵 ---------------- */

  var key = {
    /** いまの合鍵。無ければ {key:null} */
    get: function () {
      if (!ready()) return Promise.resolve({ key: null });
      return api('/v1/event/key').catch(function () { return { key: null, off: true }; });
    },
    /** 作る（作り直すと、前の合鍵は使えなくなる） */
    create: function () { return api('/v1/event/key', { method: 'POST' }); },
    /** 捨てる */
    remove: function () { return api('/v1/event/key', { method: 'DELETE' }); }
  };

  /** イベント用サイトを開く URL（合鍵つき）。会場の端末にはこれを渡す */
  function siteUrl(k) {
    if (!k) return '';
    return SITE + '#k=' + k + '&s=' + encodeURIComponent(base());
  }

  /* ---------------- 届いた在庫 ---------------- */

  /** 預かっているぶん。新しい順 */
  function pending() {
    if (!ready()) return Promise.resolve([]);
    return api('/v1/inbox/events').then(function (b) {
      return (b && b.items) || [];
    }, function () { return []; });
  }

  /** 取り込んだぶんを、向こうからも片づける */
  function forget(ids) {
    if (!ready() || !ids || !ids.length) return Promise.resolve(false);
    return api('/v1/inbox/events', {
      method: 'DELETE', body: JSON.stringify({ ids: ids.map(String) })
    }).then(function () { return true; }, function () { return false; });
  }

  /**
   * 届いた1件を、券へ入れる。
   *
   * 向こうで足した頒布物は、こちらに同じものがあれば持ち込みも入れる。
   * こちらに無いもの（会場で思いついて足したものなど）は入れられないので、
   * そのぶんは名前だけ返して、画面で知らせる。
   *
   * @param {object} got 預かっていた1件
   * @returns {{ticket, set, unknown}} 入れた行数と、入れられなかった名前
   */
  function apply(got) {
    var t = got && got.ticketId ? S.getTicket(got.ticketId) : null;
    if (!t) return { ticket: null, set: 0, unknown: [] };
    var set = 0, unknown = [];
    (got.lines || []).forEach(function (line) {
      var item = line.itemId ? S.getItem(line.itemId) : null;
      if (!item) { unknown.push(line.title || line.itemId); return; }
      var had = (t.stock || []).filter(function (o) { return o.itemId === item.id; })[0];
      var row = S.putTicketStock(t.id, {
        id: had ? had.id : undefined,
        itemId: item.id,
        // 会場で足したものは、向こうで入れた持ち込み数をそのまま使う
        bring: had ? U.num(had.bring, 0) : Math.max(0, U.num(line.bring, 0)),
        back: line.back == null ? null : Math.max(0, U.num(line.back, 0))
      });
      if (row) set++;
    });
    return { ticket: S.getTicket(t.id), set: set, unknown: unknown };
  }

  /** 届いた1件の、ひとこと */
  function text(got) {
    var counted = (got.lines || []).filter(function (x) { return x.back != null; }).length;
    return (got.ticketName || 'イベント') + '　'
      + (got.lines || []).length + '点'
      + (counted ? '（数えたぶん ' + counted + '点）' : '');
  }

  DL.eventsite = {
    SITE: SITE,
    ready: ready, key: key, siteUrl: siteUrl,
    pending: pending, forget: forget, apply: apply, text: text
  };
})(window.DL);
