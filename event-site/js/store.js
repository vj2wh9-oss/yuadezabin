/* 画面がいま持っているもの。

   サーバーから読んだ券と頒布物は、そのまま置いておく。
   会場で足したもの・隠したもの・数えた在庫は、この端末に控える
   （電波が切れても消えないよう、localStorage に書く）。 */
(function (DL) {
  'use strict';
  var U = DL.util;

  var LS = 'datemeteo.work';

  var state = {
    events: [],          // 券の一覧
    eventId: '',         // いま見ている券
    one: null,           // その券の中身（サーバーから読んだまま）
    work: {}             // 券ごとの手元の控え { ticketId: {back:{}, add:[], hide:{}} }
  };

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(LS) || '{}');
      if (saved && typeof saved.work === 'object') state.work = saved.work;
    } catch (e) { /* 読めなければ空のまま */ }
  }

  function save() {
    try { localStorage.setItem(LS, JSON.stringify({ work: state.work })); }
    catch (e) { /* 入らなくても動く */ }
  }

  load();

  /** その券の手元の控え。無ければ作る */
  function work(id) {
    var w = state.work[id];
    if (!w) {
      w = { back: {}, add: [], hide: {} };
      state.work[id] = w;
    }
    if (!w.back) w.back = {};
    if (!w.add) w.add = [];
    if (!w.hide) w.hide = {};
    return w;
  }

  /**
   * いま画面に並べる行。
   * サーバーから来たぶんと、会場で足したぶんを合わせ、隠したものを落とす。
   * 持ち帰りの数は、手元の控えが勝つ（数えかけでも消えないように）。
   */
  function lines(id) {
    var w = work(id);
    var base = ((state.one && state.one.lines) || []).slice();
    w.add.forEach(function (x) {
      if (base.some(function (o) { return o.itemId === x.itemId; })) return;
      base.push(x);
    });
    return base.filter(function (x) { return !w.hide[x.itemId]; }).map(function (x) {
      var had = w.back[x.itemId];
      return Object.assign({}, x, {
        back: had === undefined ? x.back : had,
        added: w.add.some(function (o) { return o.itemId === x.itemId; })
      });
    });
  }

  /** 券に入っていない頒布物のうち、まだ足していないもの */
  function more(id) {
    var w = work(id);
    var have = {};
    lines(id).forEach(function (x) { have[x.itemId] = true; });
    return ((state.one && state.one.more) || []).filter(function (x) {
      return !have[x.itemId];
    });
  }

  function setBack(id, itemId, v) {
    var w = work(id);
    if (v === '' || v == null) delete w.back[itemId];
    else w.back[itemId] = Math.max(0, Math.round(U.num(v, 0)));
    save();
  }

  function setBring(id, itemId, v) {
    var w = work(id);
    w.add.forEach(function (x) {
      if (x.itemId === itemId) x.bring = Math.max(0, Math.round(U.num(v, 0)));
    });
    save();
  }

  function add(id, item) {
    var w = work(id);
    delete w.hide[item.itemId];
    if (!w.add.some(function (x) { return x.itemId === item.itemId; })) {
      w.add.push(Object.assign({}, item, { bring: U.num(item.bring, 0), back: null }));
    }
    save();
  }

  function hide(id, itemId) {
    var w = work(id);
    w.hide[itemId] = true;
    delete w.back[itemId];
    w.add = w.add.filter(function (x) { return x.itemId !== itemId; });
    save();
  }

  function show(id, itemId) {
    delete work(id).hide[itemId];
    save();
  }

  /** 隠してあるもの（戻せるように、名前だけ覚えておく） */
  function hidden(id) {
    var w = work(id);
    var all = ((state.one && state.one.lines) || []).concat((state.one && state.one.more) || []);
    return Object.keys(w.hide).map(function (k) {
      return all.filter(function (x) { return x.itemId === k; })[0];
    }).filter(Boolean);
  }

  /** 締めたあと、その券の控えを片づける */
  function done(id) {
    delete state.work[id];
    save();
  }

  /** いまの合計 */
  function sum(id) {
    var out = { bring: 0, back: 0, sold: 0, revenue: 0, counted: 0, all: 0 };
    lines(id).forEach(function (x) {
      var bring = Math.max(0, U.num(x.bring, 0));
      out.all++;
      out.bring += bring;
      if (x.back == null) return;
      var back = Math.min(bring, Math.max(0, U.num(x.back, 0)));
      out.counted++;
      out.back += back;
      out.sold += Math.max(0, bring - back);
      out.revenue += Math.max(0, bring - back) * U.num(x.price, 0);
    });
    return out;
  }

  DL.store = {
    state: state,
    work: work, lines: lines, more: more, hidden: hidden,
    setBack: setBack, setBring: setBring, add: add, hide: hide, show: show,
    done: done, sum: sum
  };
})(window.DL = window.DL || {});
