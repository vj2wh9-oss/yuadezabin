/* 日本の祝日。ネットにつながなくても分かるよう、その場で計算する。
   （祝日法どおりに、固定日・ハッピーマンデー・春分秋分・振替休日・国民の休日を組み立てる） */
(function (DL) {
  'use strict';
  var U = DL.util;

  /* 月ごとの決まり。
     day: その日 / nth: 第n月曜 / equinox: 'spring'|'autumn' */
  var RULES = [
    { m: 1, day: 1, name: '元日' },
    { m: 1, nth: 2, name: '成人の日', from: 2000 },
    { m: 1, day: 15, name: '成人の日', to: 1999 },
    { m: 2, day: 11, name: '建国記念の日', from: 1967 },
    { m: 2, day: 23, name: '天皇誕生日', from: 2020 },
    { m: 3, equinox: 'spring', name: '春分の日' },
    { m: 4, day: 29, name: '昭和の日', from: 2007 },
    { m: 5, day: 3, name: '憲法記念日' },
    { m: 5, day: 4, name: 'みどりの日', from: 2007 },
    { m: 5, day: 5, name: 'こどもの日' },
    { m: 7, nth: 3, name: '海の日', from: 2003 },
    { m: 8, day: 11, name: '山の日', from: 2016 },
    { m: 9, nth: 3, name: '敬老の日', from: 2003 },
    { m: 9, equinox: 'autumn', name: '秋分の日' },
    { m: 10, nth: 2, name: 'スポーツの日', from: 2020 },
    { m: 10, nth: 2, name: '体育の日', from: 2000, to: 2019 },
    { m: 11, day: 3, name: '文化の日' },
    { m: 11, day: 23, name: '勤労感謝の日' }
  ];

  /* 年ごとの入れ替え（オリンピックの移動など）。無ければ上の決まりどおり */
  var MOVED = {
    2020: { '2020-07-23': '海の日', '2020-07-24': 'スポーツの日', '2020-08-10': '山の日',
      drop: ['海の日', 'スポーツの日', '山の日'] },
    2021: { '2021-07-22': '海の日', '2021-07-23': 'スポーツの日', '2021-08-08': '山の日',
      drop: ['海の日', 'スポーツの日', '山の日'] }
  };

  /* 一度きりの祝日（即位の日など） */
  var ONCE = {
    '2019-05-01': '天皇の即位の日',
    '2019-10-22': '即位礼正殿の儀の行われる日',
    '2019-04-30': '国民の休日',
    '2019-05-02': '国民の休日'
  };

  var cache = {};      // 年 → { 'YYYY-MM-DD': 名前 }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /* 第n月曜の日 */
  function nthMonday(y, m, n) {
    var first = new Date(y, m - 1, 1).getDay();       // 0=日
    var offset = (8 - first) % 7;                      // 1日から最初の月曜まで
    return 1 + offset + (n - 1) * 7;
  }

  /**
   * 春分・秋分の日。国立天文台の発表に合わせた近似式
   * （1900〜2099年のあいだはこれで一致する）。
   */
  function equinox(y, which) {
    var a = which === 'spring' ? 20.8431 : 23.2488;
    return Math.floor(a + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  /* その年ぶんを組み立てる */
  function build(y) {
    var map = {};
    var moved = MOVED[y];

    RULES.forEach(function (r) {
      if (r.from && y < r.from) return;
      if (r.to && y > r.to) return;
      if (moved && moved.drop.indexOf(r.name) >= 0) return;    // その年は別の日に動く
      var d = r.day ? r.day
        : r.nth ? nthMonday(y, r.m, r.nth)
        : equinox(y, r.equinox);
      map[iso(y, r.m, d)] = r.name;
    });

    if (moved) {
      Object.keys(moved).forEach(function (k) { if (k !== 'drop') map[k] = moved[k]; });
    }
    Object.keys(ONCE).forEach(function (k) { if (k.slice(0, 4) === String(y)) map[k] = ONCE[k]; });

    // 振替休日：日曜と重なったら、次の平日を休みにする（1973年から）
    if (y >= 1973) {
      Object.keys(map).sort().forEach(function (k) {
        if (new Date(k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8)).getDay() !== 0) return;
        var d = k;
        do { d = U.addDays(d, 1); } while (map[d]);
        map[d] = '振替休日';
      });
    }

    // 国民の休日：祝日にはさまれた平日（1986年から）
    if (y >= 1986) {
      Object.keys(map).slice().sort().forEach(function (k) {
        var next = U.addDays(k, 2);
        var mid = U.addDays(k, 1);
        if (!map[next] || map[mid]) return;
        if (new Date(mid.slice(0, 4), +mid.slice(5, 7) - 1, +mid.slice(8)).getDay() === 0) return;
        map[mid] = '国民の休日';
      });
    }
    return map;
  }

  function ofYear(y) {
    if (!cache[y]) cache[y] = build(y);
    return cache[y];
  }

  /**
   * その日が祝日なら名前を返す。祝日でなければ空文字。
   * @param {string} date 'YYYY-MM-DD'
   * @returns {string}
   */
  function name(date) {
    if (!U.isISO(date)) return '';
    return ofYear(+date.slice(0, 4))[date] || '';
  }

  function is(date) { return !!name(date); }

  /* その月の祝日 { 'YYYY-MM-DD': 名前 } */
  function ofMonth(month) {
    var y = +String(month).slice(0, 4), m = String(month).slice(0, 7);
    var all = ofYear(y), out = {};
    Object.keys(all).forEach(function (k) { if (k.slice(0, 7) === m) out[k] = all[k]; });
    return out;
  }

  DL.holidays = { name: name, is: is, ofYear: ofYear, ofMonth: ofMonth };
})(window.DL);
