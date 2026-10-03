/* 備えの棚。

   台所は調味料と残り物まで見ているのに、
   「期限のある備え」と「減っていく消耗品」だけが抜けていた。

   持つのは2種類。

     備蓄   非常食・水・電池・カセットボンベ。期限がある。
            古いものから使って、使ったぶんを買い足す（ローリングストック）
     消耗品 インク・コンタクト・フィルター・歯ブラシ。期限ではなく、
            使うペースで無くなる。無くなる前に買う

   どちらも「買うべきもの」になったら、買い物リストへ自分から積む。
   同じものを二度積まないよう、積んだ印を持っておく。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var EXPIRE_SOON = 60;    // 期限の何日前から知らせるか（備蓄は長いので広めに）
  var DEFAULT_LEAD = 3;    // 買ってから手元に届くまでの見込み日数

  /* 下ごしらえ。よく使うものを、単位と持ちぶんつきで並べておく */
  var PRESETS = [
    { name: '水（2L）', kind: 'stock', unit: '本', need: 18, memo: '1人1日3L × 3日ぶん' },
    { name: 'レトルトご飯', kind: 'stock', unit: '個', need: 9 },
    { name: 'カップ麺', kind: 'stock', unit: '個', need: 6 },
    { name: '缶詰', kind: 'stock', unit: '缶', need: 9 },
    { name: 'カセットボンベ', kind: 'stock', unit: '本', need: 6 },
    { name: '乾電池（単3）', kind: 'stock', unit: '本', need: 8 },
    { name: 'モバイルバッテリー', kind: 'stock', unit: '個', need: 1 },
    { name: '常備薬', kind: 'stock', unit: '箱', need: 1 },
    { name: 'トイレットペーパー', kind: 'use', unit: 'ロール', days: 4 },
    { name: 'ティッシュ', kind: 'use', unit: '箱', days: 20 },
    { name: 'コンタクトレンズ', kind: 'use', unit: '箱', days: 30 },
    { name: 'プリンタのインク', kind: 'use', unit: '本', days: 90 },
    { name: '歯ブラシ', kind: 'use', unit: '本', days: 30 },
    { name: '浄水フィルター', kind: 'use', unit: '個', days: 90 },
    { name: 'エアコンのフィルター', kind: 'use', unit: '枚', days: 180 }
  ];

  function list(kind) {
    var all = S.supplies();
    return kind ? all.filter(function (x) { return x.kind === kind; }) : all;
  }

  function live(x) { return !!x && x.active !== false; }

  /* ---------------- 備蓄 ---------------- */

  /** いま手元にいくつあるか。備蓄は期限ごとの束を足す */
  function have(x) {
    if (!x) return 0;
    if (x.kind !== 'stock') return Math.max(0, U.num(x.have, 0));
    return (x.lots || []).reduce(function (n, l) { return n + Math.max(0, U.num(l.qty, 0)); }, 0);
  }

  /**
   * いま使えるのはいくつか。期限の切れたものは、あっても数えない。
   * 「手元にある数（have）」とは分けて持つ——棚には並んでいるのに
   * 数に入らない、というのが分かるようにするため。
   */
  function usable(x, date) {
    if (!x) return 0;
    if (x.kind !== 'stock') return Math.max(0, U.num(x.have, 0));
    var today = U.isISO(date) ? date : U.today();
    return (x.lots || []).reduce(function (n, l) {
      if (U.isISO(l.until) && U.cmp(l.until, today) < 0) return n;
      return n + Math.max(0, U.num(l.qty, 0));
    }, 0);
  }

  /** 期限が切れてしまっている数 */
  function dead(x, date) { return Math.max(0, have(x) - usable(x, date)); }

  /** 足りない数。目標に届いていなければ、そのぶん（期限切れは数に入れない） */
  function short(x, date) {
    return Math.max(0, U.num(x && x.need, 0) - usable(x, date));
  }

  /** 期限の近い束から順に。期限の無いものは最後 */
  function lots(x) {
    return (x && x.lots ? x.lots : []).slice().sort(function (a, b) {
      if (!a.until !== !b.until) return a.until ? -1 : 1;
      return U.cmp(a.until || '', b.until || '');
    });
  }

  /** いちばん早く切れる期限 */
  function firstUntil(x) {
    var l = lots(x).filter(function (o) { return U.isISO(o.until); })[0];
    return l ? l.until : '';
  }

  /**
   * 期限の切れたもの・近いもの。
   * ローリングストックは「古いものから食べて買い足す」ものなので、
   * 切れてから気づくのでは遅い。既定では2ヶ月前から出す。
   */
  function expiring(date, within) {
    var today = U.isISO(date) ? date : U.today();
    var n = U.num(within, EXPIRE_SOON);
    var out = [];
    list('stock').forEach(function (x) {
      if (!live(x)) return;
      lots(x).forEach(function (l) {
        if (!U.isISO(l.until) || U.num(l.qty, 0) <= 0) return;
        var left = U.diffDays(today, l.until);
        if (left > n) return;
        out.push({ x: x, lot: l, until: l.until, qty: U.num(l.qty, 0),
          left: left, over: left < 0 });
      });
    });
    return out.sort(function (a, b) { return U.cmp(a.until, b.until); });
  }

  /* ---------------- 消耗品 ---------------- */

  /**
   * いつ無くなるか。
   * 「1つで何日もつか」と「いま何個あるか」と「最後に新しくした日」から読む。
   * @returns {string} ISO。読めなければ空
   */
  function runOutOn(x) {
    if (!x || x.kind !== 'use') return '';
    var days = Math.max(1, U.num(x.days, 0));
    if (!days) return '';
    var from = U.isISO(x.lastAt) ? x.lastAt : '';
    if (!from) return '';
    // いま開けているぶん（lastAt から days 日）＋ 手元の予備
    return U.addDays(from, days * (1 + Math.max(0, U.num(x.have, 0))));
  }

  /** いつ買えばいいか（届くまでの日数ぶん手前） */
  function buyOn(x) {
    var out = runOutOn(x);
    if (!out) return '';
    return U.addDays(out, -Math.max(0, U.num(x.lead, DEFAULT_LEAD)));
  }

  /* ---------------- 買うもの ---------------- */

  /**
   * いま買うべきもの。
   *
   *   備蓄   目標に足りていない（期限切れは数に入れない）
   *   消耗品 買う日が来ている
   *
   * @returns {Array<{x, qty, why, on}>}
   */
  function dueBuy(date) {
    var today = U.isISO(date) ? date : U.today();
    var out = [];
    list().forEach(function (x) {
      if (!live(x)) return;
      if (x.kind === 'stock') {
        var need = short(x, today);      // 期限切れは数に入れない
        if (need > 0) out.push({ x: x, qty: need, why: 'short', on: today });
      } else {
        var on = buyOn(x);
        if (!on) return;
        if (U.cmp(on, today) <= 0) {
          out.push({ x: x, qty: 1, why: 'runout', on: runOutOn(x) });
        }
      }
    });
    return out.sort(function (a, b) { return U.cmp(a.on || '', b.on || ''); });
  }

  /** 買い物リストに、同じ名前の行があるか */
  function inShopping(name) {
    return S.shopItems().some(function (o) { return o.name === name; });
  }

  /**
   * 買うべきものを、買い物リストへ積む。
   *
   * 同じものを二度積まないよう、積んだ印（queuedAt）を持っておく。
   * 買い足して「買うべきもの」でなくなったら印を外すので、
   * 次に足りなくなればまた積まれる。
   *
   * @returns {{added:Array<string>, cleared:number}}
   */
  function sync(date) {
    var today = U.isISO(date) ? date : U.today();
    var due = {};
    dueBuy(today).forEach(function (d) { due[d.x.id] = d; });
    var added = [], cleared = 0;

    list().forEach(function (x) {
      var d = due[x.id];
      if (d) {
        if (x.queuedAt || inShopping(x.name)) return;
        S.addShopItem({
          name: x.name,
          qty: d.qty + (x.unit || ''),
          price: Math.max(0, U.num(x.price, 0)) * d.qty
        });
        S.updateSupply(x.id, { queuedAt: today });
        added.push(x.name);
      } else if (x.queuedAt) {
        S.updateSupply(x.id, { queuedAt: '' });
        cleared++;
      }
    });
    return { added: added, cleared: cleared };
  }

  /* ---------------- 出し入れ ---------------- */

  /** 買い足す（備蓄は期限つきの束として、消耗品は数だけ） */
  function restock(id, qty, until) {
    var x = S.getSupply(id);
    if (!x) return null;
    var n = Math.max(1, Math.round(U.num(qty, 1)));
    if (x.kind === 'stock') {
      var ls = (x.lots || []).slice();
      var same = U.isISO(until)
        ? ls.filter(function (l) { return l.until === until; })[0] : null;
      if (same) same.qty = U.num(same.qty, 0) + n;
      else ls.push({ id: U.uid(), until: U.isISO(until) ? until : '', qty: n });
      return S.updateSupply(id, { lots: ls, queuedAt: '' });
    }
    return S.updateSupply(id, { have: U.num(x.have, 0) + n, queuedAt: '' });
  }

  /**
   * 使う。
   *
   *   備蓄   古い束から1つ減らす（ローリングストックの「古いものから」）
   *   消耗品 予備を1つ開けて、そこから日数を数えなおす
   */
  function spend(id, lotId) {
    var x = S.getSupply(id);
    if (!x) return null;
    if (x.kind === 'stock') {
      var ls = lots(x);
      var l = lotId ? ls.filter(function (o) { return o.id === lotId; })[0] : ls[0];
      if (!l) return x;
      l.qty = Math.max(0, U.num(l.qty, 0) - 1);
      return S.updateSupply(id, {
        lots: (x.lots || []).filter(function (o) { return U.num(o.qty, 0) > 0; })
      });
    }
    return S.updateSupply(id, {
      have: Math.max(0, U.num(x.have, 0) - 1), lastAt: U.today(), queuedAt: ''
    });
  }

  /** 期限の切れた束を捨てる */
  function toss(id, lotId) {
    var x = S.getSupply(id);
    if (!x) return null;
    return S.updateSupply(id, {
      lots: (x.lots || []).filter(function (o) { return o.id !== lotId; })
    });
  }

  /* ---------------- 知らせ ---------------- */

  function alerts(date) {
    var today = U.isISO(date) ? date : U.today();
    var out = [];

    // 期限の切れたもの
    expiring(today, EXPIRE_SOON).forEach(function (e) {
      if (!e.over) return;
      out.push({
        level: 'warn', overdue: true, href: '#/supply',
        text: e.x.name + 'の期限が切れています（' + U.fmtMD(e.until) + '・'
          + e.qty + (e.x.unit || '') + '）'
      });
    });

    // 買うべきもの。まとめて1行
    var due = dueBuy(today);
    if (due.length) {
      out.push({
        level: 'info', href: '#/supply',
        text: '備えの棚：買うもの ' + due.length + '件（'
          + due.slice(0, 3).map(function (d) { return d.x.name; }).join('・')
          + (due.length > 3 ? ' ほか' : '') + '）'
      });
    }
    return out;
  }

  /** 棚ぜんぶの様子（画面の見出しに出す） */
  function summary(date) {
    var today = U.isISO(date) ? date : U.today();
    var ex = expiring(today, EXPIRE_SOON);
    return {
      all: list().filter(live).length,
      due: dueBuy(today).length,
      over: ex.filter(function (e) { return e.over; }).length,
      soon: ex.filter(function (e) { return !e.over; }).length
    };
  }

  DL.supply = {
    EXPIRE_SOON: EXPIRE_SOON, DEFAULT_LEAD: DEFAULT_LEAD, PRESETS: PRESETS,
    list: list, have: have, usable: usable, dead: dead, short: short,
    lots: lots, firstUntil: firstUntil,
    expiring: expiring, runOutOn: runOutOn, buyOn: buyOn,
    dueBuy: dueBuy, inShopping: inShopping, sync: sync,
    restock: restock, spend: spend, toss: toss,
    alerts: alerts, summary: summary
  };
})(window.DL);
