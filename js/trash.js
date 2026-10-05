/* ゴミの日。

   曜日で決まるものがほとんどなので、曜日で持つ。
   「第2・第4月曜」のような月に何度かのものは、週の番号も添える。

   いちばん効くのは「前の晩に思い出せること」なので、
   出す日そのものより、前の晩の知らせを大事にしている。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  /* 下ごしらえ。地域で違うので、名前と色だけ決めておく */
  var PRESETS = [
    { name: '燃えるゴミ', color: '#d9534f', weekdays: [2, 5] },
    { name: '燃えないゴミ', color: '#7a8aa0', weekdays: [1], weeks: [2, 4] },
    { name: '資源（びん・缶）', color: '#2f8f4e', weekdays: [3] },
    { name: 'ペットボトル', color: '#2f7fd4', weekdays: [3] },
    { name: '古紙・段ボール', color: '#b07a2a', weekdays: [4], weeks: [1, 3] },
    { name: 'プラスチック', color: '#8a62c8', weekdays: [6] }
  ];

  function list(o) {
    o = o || {};
    var all = S.trash();
    return o.all ? all : all.filter(function (t) { return t.active !== false; });
  }

  /** その日が第何週か（1〜5） */
  function weekOfMonth(date) {
    return Math.floor((U.num(String(date).slice(8, 10), 1) - 1) / 7) + 1;
  }

  /** その日に出すものか */
  function onDay(t, date) {
    if (!t || t.active === false || !U.isISO(date)) return false;
    if ((t.weekdays || []).indexOf(U.dow(date)) < 0) return false;
    if (!(t.weeks || []).length) return true;          // 毎週
    return t.weeks.indexOf(weekOfMonth(date)) >= 0;
  }

  /** その日に出すもの */
  function ofDay(date) {
    return list().filter(function (t) { return onDay(t, date); });
  }

  function byDay(from, to) {
    var map = {};
    U.rangeDays(from, to).forEach(function (d) {
      var rows = ofDay(d);
      if (rows.length) map[d] = rows;
    });
    return map;
  }

  /** 出した印 */
  function isDone(date, id) { return !!S.trashDone()[date + '|' + id]; }
  function setDone(date, id, on, opts) { return S.setTrashDone(date, id, on !== false, opts); }

  /** 次に出す日。いちばん近いもの */
  function next(date) {
    var today = U.isISO(date) ? date : U.today();
    for (var i = 0; i < 40; i++) {
      var d = U.addDays(today, i);
      var rows = ofDay(d).filter(function (t) { return !(i === 0 && isDone(d, t.id)); });
      if (rows.length) return { date: d, rows: rows, left: i };
    }
    return null;
  }

  /**
   * ホームの知らせ。
   *
   * 今日ぶんは「まだ出していなければ」、明日ぶんは「前の晩に思い出せるよう」出す。
   * 出した印を付けたものは、もう言わない。
   */
  function alerts(date) {
    var today = U.isISO(date) ? date : U.today();
    var out = [];

    var mine = ofDay(today).filter(function (t) { return !isDone(today, t.id); });
    if (mine.length) {
      out.push({
        level: 'warn', href: '#/trash',
        text: '今日は ' + mine.map(function (t) { return t.name; }).join('・') + ' の日です'
      });
    }

    var tm = U.addDays(today, 1);
    var next1 = ofDay(tm);
    if (next1.length) {
      out.push({
        level: 'info', href: '#/trash',
        text: '明日は ' + next1.map(function (t) { return t.name; }).join('・') + ' の日です'
      });
    }
    return out;
  }

  /** 曜日の言いかた */
  function whenLabel(t) {
    if (!t || !(t.weekdays || []).length) return '';
    var days = t.weekdays.map(U.wdName).join('・');
    if (!(t.weeks || []).length) return '毎週 ' + days;
    return '第' + t.weeks.join('・') + ' ' + days;
  }

  DL.trash = {
    PRESETS: PRESETS,
    list: list, onDay: onDay, ofDay: ofDay, byDay: byDay, weekOfMonth: weekOfMonth,
    isDone: isDone, setDone: setDone, next: next, alerts: alerts, whenLabel: whenLabel
  };
})(window.DL);
