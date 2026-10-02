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

  /* ---------------- 捨てたぶんの控え（AMEX_OLD） ----------------

     捨てた決済も、あとから「やっぱり経費だった」と気づくことがある。
     端末の中に貯めるとデータが膨らむので、共有ファイルの
     「AMEX_OLD」フォルダへ、1件1枚のテキストとして預ける。

     戻すときは、その紙を読んで預かりに入れ直し、紙のほうは片づける
     （同じ決済が2か所にあると、どちらが本物か分からなくなるため）。 */

  var OLD_FOLDER = 'AMEX_OLD';

  function oldReady() { return !!(DL.files && DL.files.ready()); }

  /* 1件を紙にする。読んで分かる形にしておく（あとで人が見ることもある） */
  function oldText(x) {
    return [
      'METEO365 カード決済の控え',
      '日付: ' + (x.date || ''),
      '時刻: ' + (x.time || ''),
      '支払先: ' + (x.store || ''),
      '金額: ' + U.num(x.amount, 0),
      '受取: ' + (x.at || ''),
      'もとのID: ' + (x.id || ''),
      '捨てた日: ' + new Date().toISOString(),
      // 改行を含むことがあるので、いちばん最後に置く
      '文面: ' + String(x.raw || '').replace(/\r?\n/g, ' ')
    ].join('\n') + '\n';
  }

  /* 紙を読み戻す。行の頭の見出しで引く */
  function oldParse(text) {
    var out = { date: '', time: '', store: '', amount: 0, at: '', raw: '' };
    var lines = String(text || '').split(/\r?\n/);
    var keys = { '日付': 'date', '時刻': 'time', '支払先': 'store', '金額': 'amount', '受取': 'at' };
    for (var i = 0; i < lines.length; i++) {
      var m = /^([^:]+):\s?([\s\S]*)$/.exec(lines[i]);
      if (!m) continue;
      var k = keys[m[1].trim()];
      if (k) out[k] = k === 'amount' ? U.num(m[2], 0) : m[2].trim();
      // 文面から先は、残りぜんぶ
      if (m[1].trim() === '文面') {
        out.raw = lines.slice(i).join('\n').replace(/^文面:\s?/, '').replace(/\s+$/, '');
        break;
      }
    }
    return out;
  }

  /* 紙の名前。並べたときに日付順になるようにする。
     「_」は区切りに使うので、支払先の中のものは「-」に替えておく
     （名前だけ見れば中身が分かるようにしてある） */
  function oldName(x) {
    var safe = String(x.store || 'ななし')
      .replace(/[\\/:*?"<>|\n\r\t_]/g, '-').trim().slice(0, 24) || 'ななし';
    return [(x.date || '').replace(/-/g, ''), (x.time || '').replace(':', '') || '0000',
      safe, U.num(x.amount, 0) + '円'].join('_') + '.txt';
  }

  /**
   * 捨てた1件を AMEX_OLD へ預ける。
   * 置けなくても捨てる操作は止めない（控えが取れないだけ）。
   * @returns {Promise<boolean>} 置けたか
   */
  function oldSave(x) {
    if (!oldReady() || !x) return Promise.resolve(false);
    var file;
    try {
      file = new File([oldText(x)], oldName(x), { type: 'text/plain;charset=utf-8' });
    } catch (e) {
      return Promise.resolve(false);           // File が作れない古い端末
    }
    return DL.files.upload(file, { folder: OLD_FOLDER }).then(function (r) {
      /* ファイルの画面でも、すぐ AMEX_OLD の中に出るようにしておく。
         R2 の記録からも組み直せるが、それは次に一覧を取りに行ったとき */
      try {
        if (r && r.id) S.setFileFolder(r.id, S.ensureFolderPath(OLD_FOLDER, true));
      } catch (e) { /* 置けてはいるので、ここで転ばせない */ }
      return true;
    }, function () { return false; });
  }

  /** AMEX_OLD に預けてあるぶん。新しい順 */
  function oldList() {
    if (!oldReady()) return Promise.resolve([]);
    return DL.files.list().then(function (r) {
      return (r.files || []).filter(function (f) { return f.folder === OLD_FOLDER; })
        .sort(function (a, b) { return U.cmp(String(b.uploadedAt), String(a.uploadedAt)); });
    }, function () { return []; });
  }

  /** 1枚ぶんの中身を読む */
  function oldRead(f) {
    return DL.files.fetchBytes(f.id).then(function (bytes) {
      return oldParse(new TextDecoder('utf-8').decode(bytes));
    });
  }

  /**
   * 1枚を預かりへ戻す。戻したら、紙のほうは片づける。
   * @returns {Promise<object>} 戻した中身
   */
  function oldRestore(f) {
    return oldRead(f).then(function (x) {
      // 捨てた印を外さないと、足しても弾かれてしまう
      S.unmarkCardDone(x);
      S.addCardItem(x);
      return DL.files.remove(f.id).catch(function () { /* 消せなくても戻りはした */ })
        .then(function () { return x; });
    });
  }

  DL.card = {
    ready: ready, key: key, postUrl: postUrl,
    pull: pull, autoPull: autoPull, tryText: tryText, forget: forget,
    look: look, nameOf: nameOf,
    toExpense: toExpense, pending: pending,
    OLD_FOLDER: OLD_FOLDER,
    oldReady: oldReady, oldSave: oldSave, oldList: oldList,
    oldRead: oldRead, oldRestore: oldRestore,
    oldText: oldText, oldParse: oldParse, oldName: oldName
  };
})(window.DL);
