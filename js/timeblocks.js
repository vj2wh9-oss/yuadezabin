/* 1日の時間の振り分け。

   その日を何にどれだけ使ったかを、時間の帯で持つ。
   案件と日常で分けず、同じものをどちらからも見る。

   時刻は0時からの分で扱う。夜勤のように日をまたぐものは 1440 を超える値で持ち
   （32:30 なら 1950）、始まった日のほうに置く。翌日の画面では、そのはみ出しを
   0時からの帯として出す。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var DAY = 1440;

  /* ---------------- 種類 ---------------- */

  function kinds() { return S.TIME_KINDS; }

  function kind(v) {
    var list = S.TIME_KINDS;
    for (var i = 0; i < list.length; i++) if (list[i].value === v) return list[i];
    return list[list.length - 1];      // 分からないものは「その他」に寄せる
  }

  function label(v) { return kind(v).label; }
  function color(v) { return kind(v).color; }

  /* ---------------- 時刻の読み書き ---------------- */

  /** 分 → '8:30' / '32:30'（24時を超えるぶんはそのまま出す） */
  function fmt(min) {
    var m = Math.max(0, Math.round(U.num(min, 0)));
    return Math.floor(m / 60) + ':' + pad(m % 60);
  }

  /** 分 → '8:30'（翌日ぶんは '翌8:30'）。人に見せるとき用 */
  function fmtDay(min) {
    var m = Math.max(0, Math.round(U.num(min, 0)));
    return (m >= DAY ? '翌' : '') + Math.floor((m % DAY) / 60) + ':' + pad(m % 60);
  }

  /** '8:30' '08:30' '32:30' '830' → 分。読めなければ null */
  function parse(text) {
    var s = String(text == null ? '' : text).trim().replace(/[：]/g, ':');
    if (!s) return null;
    var m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
    if (m) return clamp(+m[1] * 60 + (+m[2]));
    // 区切りのない「830」「0830」も受ける
    var n = /^(\d{3,4})$/.exec(s);
    if (n) {
      var v = n[1];
      return clamp(+v.slice(0, v.length - 2) * 60 + (+v.slice(-2)));
    }
    var h = /^(\d{1,2})$/.exec(s);
    if (h) return clamp(+h[1] * 60);
    return null;
  }

  function clamp(v) {
    if (!isFinite(v)) return null;
    return Math.max(0, Math.min(DAY * 2, Math.round(v)));
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- その日の帯 ---------------- */

  /**
   * その日の画面に出す帯。0〜24時に収まる形にそろえる。
   * 前の日から続いているものは、0時から始まる帯として足す。
   * @returns {Array<{id,kind,memo,start,end,date,carry,over}>}
   *   date … その帯が保存されている日／carry … 前の日から続いているか
   */
  function ofDay(date) {
    var out = [];
    var prev = U.addDays(date, -1);
    S.timeblocks(prev).forEach(function (b) {
      if (b.end <= DAY) return;
      out.push({
        id: b.id, kind: b.kind, memo: b.memo,
        start: Math.max(0, b.start - DAY), end: Math.min(DAY, b.end - DAY),
        date: prev, carry: true, over: false
      });
    });
    S.timeblocks(date).forEach(function (b) {
      if (b.start >= DAY) return;      // 翌日ぶんだけの帯は、翌日の画面で出す
      out.push({
        id: b.id, kind: b.kind, memo: b.memo,
        start: b.start, end: Math.min(DAY, b.end),
        date: date, carry: false, over: b.end > DAY
      });
    });
    return out.sort(function (a, b) { return a.start - b.start; });
  }

  /** 何かしら登録してあるか（前の日からの続きも数える） */
  function has(date) { return ofDay(date).length > 0; }

  /**
   * 種類ごとの合計（分）。その日の画面に出ているぶんで数える。
   * @returns {Array<{kind,label,color,min,pct}>} 多い順
   */
  function sums(date) {
    var map = {};
    ofDay(date).forEach(function (b) {
      map[b.kind] = (map[b.kind] || 0) + (b.end - b.start);
    });
    return Object.keys(map).map(function (k) {
      return {
        kind: k, label: label(k), color: color(k),
        min: map[k], pct: Math.round(map[k] / DAY * 100)
      };
    }).sort(function (a, b) { return b.min - a.min; });
  }

  /** 埋まっている分の合計。24時間のうち、どれだけ書いたか */
  function filled(date) {
    return ofDay(date).reduce(function (n, b) { return n + (b.end - b.start); }, 0);
  }

  /** 帯の間の空き。円グラフと帯グラフの「まだ書いていない」ところ */
  function gaps(date) {
    var out = [], at = 0;
    ofDay(date).forEach(function (b) {
      if (b.start > at) out.push({ start: at, end: b.start });
      at = Math.max(at, b.end);
    });
    if (at < DAY) out.push({ start: at, end: DAY });
    return out;
  }

  /* ---------------- 出勤形態からのひな型 ---------------- */

  /* 起床の時刻までを睡眠にして、そのあとの通勤と仕事を並べる。
     泊まり勤務は翌朝までまたぐので、24時を超える値のまま持つ */
  var PRESETS = {
    remote: [
      { kind: 'sleep', start: 0, end: 450 },              // 〜7:30 起床
      { kind: 'work', start: 480, end: 990 }              // 8:00〜16:30
    ],
    office: [
      { kind: 'sleep', start: 0, end: 355 },              // 〜5:55 起床
      { kind: 'commute', start: 390, end: 480 },          // 6:30〜8:00
      { kind: 'work', start: 480, end: 990 },             // 8:00〜16:30
      { kind: 'commute', start: 990, end: 1065 }          // 16:30〜17:45
    ],
    stay: [
      { kind: 'sleep', start: 0, end: 840 },              // 〜14:00 起床
      { kind: 'commute', start: 870, end: 960 },          // 14:30〜16:00
      { kind: 'work', start: 960, end: 1950 },            // 16:00〜翌8:30
      { kind: 'commute', start: 1950, end: 2025 }         // 翌8:30〜翌9:45
    ]
  };

  /** その出勤形態のひな型。無ければ null */
  function presetFor(duty) {
    var list = PRESETS[duty];
    return list ? list.map(function (b) { return { kind: b.kind, start: b.start, end: b.end }; }) : null;
  }

  /** ひな型があるか（勤務を選んだときに聞くかどうかの判断に使う） */
  function hasPreset(duty) { return !!PRESETS[duty]; }

  /**
   * 出勤形態のひな型をその日に入れる。
   * すでに書いてあるものは、消さずに上から置く（帯どうしのぶつかりは store が捌く）。
   * @param {boolean} [replace] true なら、その日の帯を入れ替える
   */
  function applyPreset(date, duty, replace) {
    var list = presetFor(duty);
    if (!list) return null;
    if (replace) return S.setTimeblocks(date, list);
    list.forEach(function (b) { S.putTimeblock(date, b); });
    return S.timeblocks(date);
  }

  /** ひな型の中身を、そのまま読める文にする（入れる前の確認に使う） */
  function presetText(duty) {
    var list = presetFor(duty);
    if (!list) return '';
    return list.map(function (b) {
      return label(b.kind) + ' ' + fmtDay(b.start) + '〜' + fmtDay(b.end);
    }).join('　');
  }

  DL.timeblocks = {
    DAY: DAY,
    kinds: kinds, kind: kind, label: label, color: color,
    fmt: fmt, fmtDay: fmtDay, parse: parse,
    ofDay: ofDay, has: has, sums: sums, filled: filled, gaps: gaps,
    presetFor: presetFor, hasPreset: hasPreset, applyPreset: applyPreset, presetText: presetText
  };
})(window.DL);
