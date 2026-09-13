/* 頒布物の在庫と収支：残部・頒布数・売上・原価をまとめる */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var KIND_LABEL = { book: '本', goods: 'グッズ' };

  /* 在庫の出入り。増えるものと減るものを1か所で決める */
  var MOVES = [
    { value: 'in', label: '入庫', note: '刷り上がり・追加分', sign: 1 },
    { value: 'sale', label: '頒布', note: '売れたぶん', sign: -1 },
    { value: 'gift', label: '献本', note: '見本・お礼・献本', sign: -1 },
    { value: 'loss', label: '傷み', note: '傷んで出せないもの', sign: -1 },
    { value: 'adjust', label: '棚卸し', note: '数え直しての増減', sign: 1 }
  ];

  function moveDef(kind) {
    for (var i = 0; i < MOVES.length; i++) if (MOVES[i].value === kind) return MOVES[i];
    return MOVES[1];
  }

  function moveLabel(kind) { return moveDef(kind).label; }
  function kindLabel(k) { return KIND_LABEL[k] || KIND_LABEL.book; }

  /** その動きで在庫がいくつ増えるか（減るときは負の数） */
  function delta(m) {
    return moveDef(m.kind).sign * U.num(m.qty, 0);
  }

  /* ---------------- 余部 ----------------

     印刷所が発注ぶんに足してくれる端数（+10部前後）。
     もらいものなので原価は0。在庫を減らすときは、まずここから減らす。
     動き1件ごとに「そのうち何部が余部か」を持たせて数える。 */

  var EXTRA_SUFFIX = '（余部）';

  /** 余部ぶんの呼び名。「夏の本（余部）」 */
  function extraTitle(item) {
    return String((item && item.title) || '') + EXTRA_SUFFIX;
  }

  /** その動きで余部がいくつ増えるか（減るときは負の数） */
  function extraDelta(m) {
    return moveDef(m.kind).sign * U.num(m.extra, 0);
  }

  /**
   * いま残っている余部。
   * @param {string} itemId
   * @param {string} [exceptId] この動きは数えない（その記録を直しているとき）
   */
  function extraLeft(itemId, exceptId) {
    return S.stockMoves({ itemId: itemId }).reduce(function (n, m) {
      return m.id === exceptId ? n : n + extraDelta(m);
    }, 0);
  }

  /**
   * これから減らす数のうち、余部から出せるぶん。
   * 余部より多く出すときは、足りないぶんが本体から出る。
   * @param {string} itemId
   * @param {number} qty 減らす数（正の数）
   * @param {string} [exceptId] 直している記録
   */
  function takeExtra(itemId, qty, exceptId) {
    return Math.max(0, Math.min(Math.max(0, U.num(qty, 0)), extraLeft(itemId, exceptId)));
  }

  /** その動きの金額。頒布だけが売上になる（単価を書いていなければ頒布価格） */
  function money(m, item) {
    if (m.kind !== 'sale') return 0;
    var unit = U.num(m.price, 0) || U.num(item && item.price, 0);
    return unit * Math.max(0, U.num(m.qty, 0));
  }

  /**
   * 1つの頒布物のまとめ。
   * @param {object} item
   * @param {object} [q] {year} 年で絞る（残部は絞らずに全期間で数える）
   */
  function summary(item, q) {
    q = q || {};
    var all = S.stockMoves({ itemId: item.id });
    var out = {
      item: item, left: 0, extraLeft: 0,
      added: 0, sold: 0, gift: 0, loss: 0, adjust: 0, fromExtra: 0,
      revenue: 0, cost: 0, profit: 0, moves: all.length
    };
    all.forEach(function (m) {
      out.left += delta(m);
      out.extraLeft += extraDelta(m);
      // 年で絞るのは「その年にいくら頒布したか」の集計だけ
      if (q.year && m.date.slice(0, 4) !== String(q.year)) return;
      if (m.kind === 'adjust') out.adjust += U.num(m.qty, 0);
      else out[m.kind === 'in' ? 'added' : m.kind === 'sale' ? 'sold' : m.kind] += U.num(m.qty, 0);
      // 頒布・献本のうち、余部から出したぶん（原価に乗せない）
      if (m.kind === 'sale' || m.kind === 'gift') out.fromExtra += U.num(m.extra, 0);
      out.revenue += money(m, item);
    });
    /* 原価は「出た数」ぶん。刷ったぶん全部ではなく、頒布と献本に乗せる。
       余部はもらいものなので、そこから出たぶんは原価に数えない */
    out.cost = Math.max(0, out.sold + out.gift - out.fromExtra) * U.num(item.unitCost, 0);
    out.profit = out.revenue - out.cost;
    return out;
  }

  /** すべての頒布物のまとめ（残部の多い順ではなく、新しい順のまま） */
  function all(q) {
    q = q || {};
    return S.items({ withArchived: q.withArchived }).map(function (x) { return summary(x, q); });
  }

  /** 合計（在庫画面の上に出す） */
  function totals(list) {
    var out = { titles: list.length, left: 0, extraLeft: 0, sold: 0,
      revenue: 0, cost: 0, profit: 0, stockValue: 0 };
    list.forEach(function (s) {
      out.left += s.left;
      out.extraLeft += Math.max(0, s.extraLeft);
      out.sold += s.sold;
      out.revenue += s.revenue;
      out.cost += s.cost;
      out.profit += s.profit;
      // 残っているぶんの原価（まだ回収できていない金額）。余部はもらいものなので数えない
      out.stockValue += Math.max(0, s.left - Math.max(0, s.extraLeft)) * U.num(s.item.unitCost, 0);
    });
    return out;
  }

  /**
   * イベント（即売会の案件）ごとの頒布のまとめ。
   * 印刷費は、その案件に紐づけた経費から拾う。
   * @param {string} projectId
   * @param {number|string} [year] その年のぶんだけ数える
   */
  function eventSummary(projectId, year) {
    var moves = S.stockMoves({ projectId: projectId, kind: 'sale', year: year });
    var out = { sold: 0, revenue: 0, cost: 0, profit: 0, lines: [], expense: 0 };
    var byItem = {};
    moves.forEach(function (m) {
      var item = S.getItem(m.itemId);
      if (!item) return;
      var line = byItem[m.itemId] || (byItem[m.itemId] = { item: item, qty: 0, revenue: 0 });
      line.qty += U.num(m.qty, 0);
      line.revenue += money(m, item);
      out.sold += U.num(m.qty, 0);
      out.revenue += money(m, item);
      // 余部から出したぶんはもらいものなので、原価には乗せない
      out.cost += Math.max(0, U.num(m.qty, 0) - U.num(m.extra, 0)) * U.num(item.unitCost, 0);
    });
    out.lines = Object.keys(byItem).map(function (k) { return byItem[k]; })
      .sort(function (a, b) { return b.revenue - a.revenue; });
    // その案件に紐づけた経費（印刷費・交通費など）
    out.expense = S.expenses({ projectId: projectId, year: year })
      .reduce(function (n, x) { return n + U.num(x.amount, 0); }, 0);
    out.profit = out.revenue - out.cost;
    return out;
  }

  /** 頒布の売上（年・月ごと）。売上タブで請求書・支援金と並べるのに使う */
  function salesOf(year) {
    var out = { total: 0, months: [] };
    for (var i = 0; i < 12; i++) out.months.push(0);
    S.stockMoves({ kind: 'sale', year: year }).forEach(function (m) {
      var v = money(m, S.getItem(m.itemId));
      out.total += v;
      var mm = U.num(m.date.slice(5, 7), 1) - 1;
      if (mm >= 0 && mm < 12) out.months[mm] += v;
    });
    return out;
  }

  DL.stock = {
    MOVES: MOVES, KIND_LABEL: KIND_LABEL,
    moveDef: moveDef, moveLabel: moveLabel, kindLabel: kindLabel,
    delta: delta, money: money,
    extraDelta: extraDelta, extraLeft: extraLeft, takeExtra: takeExtra,
    EXTRA_SUFFIX: EXTRA_SUFFIX, extraTitle: extraTitle,
    summary: summary, all: all, totals: totals,
    eventSummary: eventSummary, salesOf: salesOf
  };
})(window.DL);
