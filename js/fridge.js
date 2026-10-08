/* 冷蔵庫の中身。

   困りごとはひとつ。
   買ってきたウィンナーの袋を開けてジップロックに移すと、
   もう消費期限が分からなくなる。パッケージごと捨ててしまうから。

   そこで、しまうときに期限を入れておく。
   あとは、切れる前にこちらから知らせる。

   持つのは3つ。どれも「置き場（冷蔵・冷凍・常温）」で並べる。

     食材     買ってきたもの（store の fridge）
     作り置き 作ったもの（store の leftovers。献立では先に食べ切る扱い）
     調味料   家にあるもの（store の pantry。期限より「あるか」が大事）

   作り置きの日もちは、料理名から見当がつく。
   そこだけ OpenAI に聞けるようにしてある（Worker 経由。鍵はこちらに持たない）。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var SOON = 3;        // 何日前から「もうすぐ」とするか
  var WATCH = 7;       // 画面の「気にするもの」に出す日数

  var WHERE = [
    { key: 'fridge', label: '冷蔵', icon: 'fridge' },
    { key: 'freezer', label: '冷凍', icon: 'snow' },
    { key: 'room', label: '常温', icon: 'box' }
  ];

  function whereLabel(k) {
    var w = WHERE.filter(function (o) { return o.key === k; })[0];
    return w ? w.label : '冷蔵';
  }

  /* ---------------- ひとまとめに見る ---------------- */

  /**
   * 冷蔵庫にあるものぜんぶ。食材・作り置き・調味料をひとつの形にそろえる。
   * @param {object} [o] {where, kind}
   * @returns {Array<{id, kind, name, qty, where, until, left, item}>}
   */
  function all(o) {
    o = o || {};
    var today = U.today();
    var out = [];

    S.fridge().forEach(function (x) {
      out.push(wrap('food', x, today));
    });
    S.leftovers().forEach(function (x) {
      out.push(wrap('cooked', x, today));
    });
    S.pantry().forEach(function (x) {
      out.push(wrap('season', x, today));
    });

    if (o.kind) out = out.filter(function (r) { return r.kind === o.kind; });
    if (o.where) out = out.filter(function (r) { return r.where === o.where; });
    return out.sort(order);
  }

  function wrap(kind, x, today) {
    var left = U.isISO(x.until) ? U.diffDays(today, x.until) : null;
    return {
      id: x.id, kind: kind, name: x.name, qty: S.foodQty(x),
      where: x.where || (kind === 'season' ? 'room' : 'fridge'),
      until: x.until || '', left: left,
      over: left !== null && left < 0,
      soon: left !== null && left >= 0 && left <= SOON,
      item: x
    };
  }

  /* 期限の近い順。期限の無いものは後ろ */
  function order(a, b) {
    if ((a.left === null) !== (b.left === null)) return a.left === null ? 1 : -1;
    if (a.left !== b.left) return a.left - b.left;
    return U.cmp(a.name, b.name);
  }

  /** 置き場ごとに束ねる（画面に並べるため） */
  function byWhere(o) {
    var map = {};
    WHERE.forEach(function (w) { map[w.key] = []; });
    all(o).forEach(function (r) { (map[r.where] || (map[r.where] = [])).push(r); });
    return map;
  }

  /** 気にするもの（切れている・もうすぐ切れる） */
  function watch(date, within) {
    var today = U.isISO(date) ? date : U.today();
    var n = U.num(within, WATCH);
    return all().filter(function (r) {
      if (r.left === null) return false;
      return r.left <= n;
    }).map(function (r) {
      // 日付をまたいで開いたままでも合うよう、その日で数え直す
      r.left = U.diffDays(today, r.until);
      r.over = r.left < 0;
      r.soon = r.left >= 0 && r.left <= SOON;
      return r;
    }).sort(order);
  }

  /** いまの様子（見出しに出す） */
  function summary(date) {
    var rows = all();
    var w = watch(date);
    return {
      all: rows.length,
      over: w.filter(function (r) { return r.over; }).length,
      soon: w.filter(function (r) { return !r.over; }).length
    };
  }

  /**
   * ホームの知らせ。
   * 切れたものは「捨てる」として今日やることに出ているので、ここでは
   * 「もうすぐ切れる」だけを言う（二重に言わない）。
   */
  function alerts(date) {
    var today = U.isISO(date) ? date : U.today();
    var rows = watch(today, SOON).filter(function (r) { return !r.over; });
    if (!rows.length) return [];
    return [{
      level: rows.some(function (r) { return r.left <= 1; }) ? 'warn' : 'info',
      href: '#/fridge',
      text: '冷蔵庫：' + rows.slice(0, 3).map(function (r) {
        return r.name + '（' + U.untilLabel(r.until, today) + '）';
      }).join('・') + (rows.length > 3 ? ' ほか' + (rows.length - 3) + '件' : '')
    }];
  }

  /** 献立を頼むときに回したい食材（切れそうなものから） */
  function useSoon(date, n) {
    var today = U.isISO(date) ? date : U.today();
    return all({ kind: 'food' }).filter(function (r) {
      return r.left !== null && r.left >= 0 && r.left <= U.num(n, WATCH);
    }).map(function (r) { return r.name; }).slice(0, 6);
  }

  /* ---------------- 出し入れ ---------------- */

  function add(kind, data) {
    if (kind === 'cooked') return S.addLeftover(data);
    if (kind === 'season') return S.addPantry(data);
    return S.addFridge(data);
  }

  function update(kind, id, patch) {
    if (kind === 'cooked') return S.updateLeftover(id, patch);
    if (kind === 'season') return S.updatePantry(id, patch);
    return S.updateFridge(id, patch);
  }

  function remove(kind, id) {
    if (kind === 'cooked') return S.removeLeftover(id);
    if (kind === 'season') return S.removePantry(id);
    return S.removeFridge(id);
  }

  function get(kind, id) {
    if (kind === 'cooked') return S.getLeftover(id);
    if (kind === 'season') return S.getPantry(id);
    return S.getFridge(id);
  }

  /** 使い切った・捨てた */
  function finish(kind, id) { return remove(kind, id); }

  /* ---------------- 作り置きの日もち ----------------

     料理名と置き場から、何日もつかを見てもらう。
     決めるのはこちらではなく OpenAI（Worker 経由）。
     つながらないときは、下の見当（KEEP_GUESS）で間に合わせる。 */

  /* つながらないときの、ざっくりした見当。日数。
     食材と作り置きでは持ちが違うので、分けて持つ */
  var KEEP_GUESS = { fridge: 3, freezer: 21, room: 1 };
  var KEEP_GUESS_FOOD = { fridge: 4, freezer: 30, room: 7 };
  var KEEP_GUESS_OPEN = { fridge: 2, freezer: 14, room: 3 };

  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }
  function ready() { return !!(base() && conf().token); }

  /**
   * 何日もつか、聞く。
   *
   * 作り置き（作ったもの）だけでなく、買ってきた食材も見てもらう。
   * 食材は「封を開けたか」で持ちがまるで変わるので、それも渡す。
   *
   * @param {string} name 料理名、または食材の名前
   * @param {object} [o] {kind:'cooked'|'food', where, madeOn, opened, memo}
   * @returns {Promise<{days:number, until:string, note:string, guess:boolean}>}
   */
  function keep(name, o) {
    o = o || {};
    var kind = o.kind === 'food' ? 'food' : 'cooked';
    var where = S.FOOD_WHERE.indexOf(o.where) >= 0 ? o.where : 'fridge';
    var madeOn = U.isISO(o.madeOn) ? o.madeOn : U.today();
    var opened = !!o.opened;
    var fallback = function (why) {
      var table = kind !== 'food' ? KEEP_GUESS
        : opened ? KEEP_GUESS_OPEN : KEEP_GUESS_FOOD;
      var days = table[where] || 3;
      return {
        days: days, until: U.addDays(madeOn, days),
        note: why || 'つながらなかったので、よくある日もちで置いています',
        guess: true
      };
    };
    if (!String(name || '').trim()) return Promise.resolve(fallback('名前がありません'));
    if (!ready()) return Promise.resolve(fallback('同期の接続先が未設定です'));

    return fetch(base() + '/v1/keep', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: String(name).slice(0, 60), kind: kind, where: where,
        opened: opened, memo: String(o.memo || '').slice(0, 120)
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok || !b || !b.data) {
          return fallback(res.status === 404
            ? 'Worker がまだ古いです（git pull && bash sync/setup.sh）'
            : 'うまく聞けませんでした');
        }
        var days = Math.min(365, Math.max(1, Math.round(U.num(b.data.days, 0))));
        if (!days) return fallback('日数が返りませんでした');
        return {
          days: days, until: U.addDays(madeOn, days),
          note: String(b.data.note || '').slice(0, 120), guess: false
        };
      });
    }, function () { return fallback('通信できませんでした'); });
  }

  DL.fridge = {
    SOON: SOON, WATCH: WATCH, WHERE: WHERE,
    KEEP_GUESS: KEEP_GUESS, KEEP_GUESS_FOOD: KEEP_GUESS_FOOD, KEEP_GUESS_OPEN: KEEP_GUESS_OPEN,
    whereLabel: whereLabel,
    all: all, byWhere: byWhere, watch: watch, summary: summary, alerts: alerts,
    useSoon: useSoon,
    add: add, update: update, remove: remove, get: get, finish: finish,
    ready: ready, keep: keep
  };
})(window.DL);
