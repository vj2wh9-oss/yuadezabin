/* カードの決済通知の取り込み。

   iOS 26 以降の「通知を受け取ったとき」のオートメーションで、
   Amex のアプリから来た通知の本文をそのまま Worker へ送ってもらう。
   Worker はそこから店の名前と金額を抜いて預かる。
   アプリは開いた拍子にそれを取りに行き、「取込済み」として貯めておく。

   経費に入れるかどうかは、経理の画面で1件ずつ決める。
   ここは「運ぶところ」だけで、経費に入れる判断はしない。

   合鍵は体重と同じで「決済を書き足すことしかできない」もの。
   本物の合鍵（読み書き全部）は、けっして URL に入れない。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

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
        if (res.status === 404) {
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
      return api('/v1/inbox/card/key').catch(function () { return { key: null, off: true }; });
    },
    /** 作る（作り直すと、前の合鍵は使えなくなる） */
    create: function () { return api('/v1/inbox/card/key', { method: 'POST' }); },
    /** 捨てる */
    remove: function () { return api('/v1/inbox/card/key', { method: 'DELETE' }); }
  };

  /** ショートカットに貼る送り先（カード用の合鍵つき） */
  function postUrl(k) {
    return (base() && k) ? base() + '/v1/inbox/card?k=' + k : '';
  }

  /* ---------------- 取り込み ---------------- */

  /**
   * 預かっているぶんを取り込む。取り込めたら、向こうからは片づける。
   * @returns {Promise<object>} {added, skipped}
   */
  function pull() {
    if (!ready()) return Promise.resolve({ added: 0, skipped: 0, off: true });
    return api('/v1/inbox/cards').then(function (b) {
      var list = (b && b.items) || [];
      if (!list.length) return { added: 0, skipped: 0 };
      var added = 0, skipped = 0;
      list.forEach(function (x) {
        if (S.addCardItem(x)) added++;
        else skipped++;
      });
      // 取り込めたら、預かってもらっていたぶんは片づける（二度入らない）
      return api('/v1/inbox/cards', {
        method: 'DELETE',
        body: JSON.stringify({ ids: list.map(function (x) { return x.id; }) })
      }).catch(function () { /* 消せなくても、同じものは足さない作りなので増えない */ })
        .then(function () { return { added: added, skipped: skipped }; });
    });
  }

  /**
   * 預かってもらっているぶんを、向こうからも消す。
   * 経費に入れたあと・捨てたあとに呼ぶ。消せなくてもアプリ側で弾くので、
   * 通らなくても困らない（念のための後始末）。
   * @param {string[]} ids
   */
  function forget(ids) {
    if (!ready() || !ids || !ids.length) return Promise.resolve(false);
    return api('/v1/inbox/cards', {
      method: 'DELETE', body: JSON.stringify({ ids: ids.map(String) })
    }).then(function () { return true; }, function () { return false; });
  }

  /* 画面を開いたときの、そっとした取り込み。
     何度も叩かないよう、しばらくは控える */
  var pulledAt = 0;

  function autoPull() {
    if (!ready()) return Promise.resolve({ added: 0 });
    if (Date.now() - pulledAt < 120000) return Promise.resolve({ added: 0 });
    pulledAt = Date.now();
    return pull().catch(function () { return { added: 0 }; });
  }

  /**
   * 文面をためす。預けずに、どう読めるかだけ見る。
   * 通知の言い回しが変わったとき、ここで確かめられる。
   * @param {string} text
   * @returns {Promise<object>} {store, amount}
   */
  function tryText(text) {
    if (!ready()) return Promise.reject(new Error('同期の接続先が未設定です'));
    return fetch(base() + '/v1/inbox/card/try', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'text/plain'
      },
      body: String(text || '')
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (res.status === 404) {
          throw new Error('Worker がまだ古いです。git pull && bash sync/setup.sh を通してください');
        }
        if (!res.ok) throw new Error('サーバーが断りました（' + res.status + '）');
        return b;
      });
    }, function () { throw new Error('通信できませんでした'); });
  }

  /* ---------------- 名前の言い換え ----------------

     カード会社から届く名前は「SUICAKEITAIKESSAI」のように読みにくい。
     覚えさせておいた組（変換元 → 変換後）に当てはめて、
     家計簿には読める名前で載せる。科目も一緒に決めておける。 */

  /* 比べるための形にそろえる。大文字小文字・空白・記号は見ない */
  function flat(s) {
    return String(s || '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\s　・．.\-ー－_/／\\()（）*＊]/g, '')
      .toLowerCase();
  }

  /**
   * 通知の名前を引く。覚えていなければ、そのまま返す。
   * まるごと同じものを先に見て、無ければ含んでいるものを見る。
   * @param {string} store 通知に出てきた名前
   * @returns {{name:string, category:string, book:string, hit:object|null}}
   */
  function look(store) {
    var raw = String(store || '');
    var key = flat(raw);
    var list = S.cardMaps ? S.cardMaps() : [];
    var hit = null;
    var i;
    for (i = 0; i < list.length; i++) {
      if (flat(list[i].from) && flat(list[i].from) === key) { hit = list[i]; break; }
    }
    if (!hit) {
      for (i = 0; i < list.length; i++) {
        var f = flat(list[i].from);
        if (f && key.indexOf(f) >= 0) { hit = list[i]; break; }
      }
    }
    return {
      name: (hit && hit.to) || raw,
      category: (hit && hit.category) || '',
      book: (hit && hit.book) || '',
      hit: hit
    };
  }

  /** 家計簿に載せる名前（言い換えたあと） */
  function nameOf(x) { return look(x && x.store).name || (x && x.store) || ''; }

  /* ---------------- 経費に入れる ----------------

     入れる中身は、通知から分かるぶんだけ（日付・時刻・店・金額）。
     名前と科目は、覚えさせてある言い換えがあればそれを使う。
     どの帳簿にするかは、入れるときに決めてもらう。 */

  /**
   * 取込済みの1件から、経費の下ごしらえを作る。
   * @param {object} x 取込済みの1件
   * @param {string} book 'work' | 'life'
   */
  function toExpense(x, book) {
    var m = look(x.store);
    var bk = m.book || (book === 'work' ? 'work' : 'life');
    var out = {
      book: bk,
      date: x.date,
      amount: x.amount,
      vendor: m.name,
      // 何時の決済だったかは、メモに残す（経費そのものは日付までしか持たない）
      memo: x.time ? 'カード ' + x.time : 'カード'
    };
    // 科目は、その帳簿にあるものだけ入れる（無い名前を入れても選べない）
    if (m.category && DL.expenses.categories(bk).indexOf(m.category) >= 0) {
      out.category = m.category;
    }
    return out;
  }

  /** 預かっている件数。経理の入口に出す */
  function pending() { return S.cardInbox().length; }

  DL.card = {
    ready: ready, key: key, postUrl: postUrl,
    pull: pull, autoPull: autoPull, tryText: tryText, forget: forget,
    look: look, nameOf: nameOf,
    toExpense: toExpense, pending: pending
  };
})(window.DL);
