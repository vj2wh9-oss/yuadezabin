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

  /* ---------------- 名前と色 ----------------

     何をしていたかは、その都度自由に書ける。
     よく使う名前は選び口に並べ、色は名前ごとに決めて使い回す。 */

  /** 選び口に出す名前。よく使う順、そのあとに決まった名前 */
  function labels() { return S.timeLabels(); }

  /** その名前に使う色 */
  function colorOf(label) { return S.timeColor(label); }

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

  /* ---------------- 帯の色 ----------------

     名前ごとではなく「いつのことか」で決める。0時から24時へ、
     淡い水色から紺へ移っていく。画面に出すときに毎回そこから作るので、
     すでに書いてある帯にもそのまま効く（保存してある色は見ない）。 */

  var RAMP = [
    { at: 0, c: [125, 211, 245] },      // 0時　淡い水色
    { at: 360, c: [56, 189, 248] },     // 6時　水色
    { at: 720, c: [37, 99, 235] },      // 12時　青
    { at: 1080, c: [29, 78, 216] },     // 18時　濃い青
    { at: DAY, c: [23, 45, 110] }       // 24時　紺
  ];

  function hex(c) {
    return '#' + c.map(function (v) {
      var n = Math.max(0, Math.min(255, Math.round(v)));
      return (n < 16 ? '0' : '') + n.toString(16);
    }).join('');
  }

  /**
   * その時刻の色。
   * @param {number} min 0時からの分
   * @returns {string} '#7dd3f5' のような色
   */
  function colorAt(min) {
    var m = Math.max(0, Math.min(DAY, U.num(min, 0)));
    for (var i = 1; i < RAMP.length; i++) {
      if (m > RAMP[i].at) continue;
      var a = RAMP[i - 1], b = RAMP[i];
      var t = (m - a.at) / (b.at - a.at);
      return hex([
        a.c[0] + (b.c[0] - a.c[0]) * t,
        a.c[1] + (b.c[1] - a.c[1]) * t,
        a.c[2] + (b.c[2] - a.c[2]) * t
      ]);
    }
    return hex(RAMP[RAMP.length - 1].c);
  }

  /* ---------------- その日の帯 ---------------- */

  /**
   * その日の画面に出す帯。0〜24時に収まる形にそろえる。
   * 前の日から続いているものは、0時から始まる帯として足す。
   * @returns {Array<{id,label,color,memo,start,end,date,carry,over}>}
   *   date … その帯が保存されている日／carry … 前の日から続いているか
   */
  function ofDay(date) {
    var out = [];
    var prev = U.addDays(date, -1);
    S.timeblocks(prev).forEach(function (b) {
      if (b.end <= DAY) return;
      var start = Math.max(0, b.start - DAY);
      out.push({
        id: b.id, label: b.label, color: colorAt(start), memo: b.memo, projectId: b.projectId || '',
        start: start, end: Math.min(DAY, b.end - DAY),
        date: prev, carry: true, over: false
      });
    });
    S.timeblocks(date).forEach(function (b) {
      if (b.start >= DAY) return;      // 翌日ぶんだけの帯は、翌日の画面で出す
      out.push({
        id: b.id, label: b.label, color: colorAt(b.start), memo: b.memo, projectId: b.projectId || '',
        start: b.start, end: Math.min(DAY, b.end),
        date: date, carry: false, over: b.end > DAY
      });
    });
    return out.sort(function (a, b) { return a.start - b.start; });
  }

  /** 何かしら登録してあるか（前の日からの続きも数える） */
  function has(date) { return ofDay(date).length > 0; }

  /**
   * 名前ごとの合計（分）。その日の画面に出ているぶんで数える。
   * @returns {Array<{label,color,min,pct}>} 多い順
   */
  function sums(date) {
    var map = {}, color = {}, longest = {};
    ofDay(date).forEach(function (b) {
      var len = b.end - b.start;
      map[b.label] = (map[b.label] || 0) + len;
      // 色は時刻ごとに変わるので、同じ名前ではいちばん長い帯の色を代表にする
      if (!(longest[b.label] >= len)) { longest[b.label] = len; color[b.label] = b.color; }
    });
    return Object.keys(map).map(function (k) {
      return {
        label: k, color: color[k] || colorOf(k),
        min: map[k], pct: Math.round(map[k] / DAY * 100)
      };
    }).sort(function (a, b) { return b.min - a.min; });
  }

  /* ---------------- 案件ごとの時間 ----------------

     帯に案件を結びつけておくと、その案件に実際どれだけ使ったかが分かる。
     見積もりが合っていたか、次に同じ仕事を受けるかの手がかりになる。

     帯は「始まった日」に置いてあるので、日をまたぐぶんも
     その日の持ちものとして数える（ofDay のように切り分けない）。 */

  /**
   * その案件に使った時間（分）。
   * @param {string} projectId
   * @param {object} [opts] {from, to} 'YYYY-MM-DD'（どちらも含む）
   * @returns {number}
   */
  function projectMinutes(projectId, opts) {
    if (!projectId) return 0;
    var sum = 0;
    eachBlock(opts, function (b) {
      if (b.projectId === projectId) sum += Math.max(0, b.end - b.start);
    });
    return sum;
  }

  /**
   * 案件ごとの合計。多い順。
   * @param {object} [opts] {from, to}
   * @returns {Array<{projectId,project,title,min,days}>}
   */
  function byProject(opts) {
    var map = {};
    eachBlock(opts, function (b, date) {
      if (!b.projectId) return;
      var g = map[b.projectId] || (map[b.projectId] = { projectId: b.projectId, min: 0, days: {} });
      g.min += Math.max(0, b.end - b.start);
      g.days[date] = true;
    });
    return Object.keys(map).map(function (id) {
      var g = map[id];
      var p = S.getProject(id);
      return {
        projectId: id, project: p || null,
        title: p ? p.title : '（消された案件）',
        min: g.min, days: Object.keys(g.days).length
      };
    }).sort(function (a, b) { return b.min - a.min; });
  }

  /**
   * その日の帯のうち、案件に結びついているぶん。
   * @returns {Array<{projectId,project,title,color,min}>} 多い順
   */
  function projectsOfDay(date) {
    var map = {};
    ofDay(date).forEach(function (b) {
      if (!b.projectId) return;
      var g = map[b.projectId] || (map[b.projectId] = { min: 0, color: b.color });
      g.min += b.end - b.start;
    });
    return Object.keys(map).map(function (id) {
      var p = S.getProject(id);
      return {
        projectId: id, project: p || null, title: p ? p.title : '（消された案件）',
        color: (p && p.color) || map[id].color, min: map[id].min
      };
    }).sort(function (a, b) { return b.min - a.min; });
  }

  /* 期間のあいだの帯を順に見る。始まった日で数える */
  function eachBlock(opts, fn) {
    opts = opts || {};
    var map = S.settings.timeblocks || {};
    Object.keys(map).forEach(function (date) {
      if (opts.from && U.cmp(date, opts.from) < 0) return;
      if (opts.to && U.cmp(date, opts.to) > 0) return;
      (map[date] || []).forEach(function (b) { fn(b, date); });
    });
  }

  /** 分 → '3時間20分' のように読める形に */
  function hours(min) {
    var m = Math.max(0, Math.round(U.num(min, 0)));
    var h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + '分';
    return h + '時間' + (r ? r + '分' : '');
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
      { label: '睡眠', start: 0, end: 450 },              // 〜7:30 起床
      { label: '仕事', start: 480, end: 990 }             // 8:00〜16:30
    ],
    office: [
      { label: '睡眠', start: 0, end: 355 },              // 〜5:55 起床
      { label: '通勤', start: 390, end: 480 },            // 6:30〜8:00
      { label: '仕事', start: 480, end: 990 },            // 8:00〜16:30
      { label: '通勤', start: 990, end: 1065 }            // 16:30〜17:45
    ],
    stay: [
      { label: '睡眠', start: 0, end: 840 },              // 〜14:00 起床
      { label: '通勤', start: 870, end: 960 },            // 14:30〜16:00
      { label: '仕事', start: 960, end: 1950 },           // 16:00〜翌8:30
      { label: '通勤', start: 1950, end: 2025 }           // 翌8:30〜翌9:45
    ]
  };

  /** その出勤形態のひな型。無ければ null */
  function presetFor(duty) {
    var list = PRESETS[duty];
    return list ? list.map(function (b) { return { label: b.label, start: b.start, end: b.end }; }) : null;
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
      return b.label + ' ' + fmtDay(b.start) + '〜' + fmtDay(b.end);
    }).join('　');
  }

  /* ---------------- 勤務実績を入れる頃合い ----------------

     仕事が終わったころに、ホームで「勤務実績入力」とうながす。
     時刻はひな型の「仕事」の終わりに合わせてある（0時からの分）。
     泊まり勤務は 1950 分＝翌8:30 なので、そのまま翌日に出る。 */

  var REMIND = {
    remote: 990,     // 16:30（仕事の終わり）
    office: 990,     // 16:30（仕事の終わり。このあと帰りの通勤）
    stay: 1950       // 翌8:30（夜勤明け）
  };

  /** その勤務にうながす時刻（0時からの分）。無ければ null */
  function remindMin(duty) {
    return REMIND[duty] === undefined ? null : REMIND[duty];
  }

  /** その勤務日に、うながす時刻が来る瞬間。無ければ null */
  function remindAt(date, duty) {
    var m = remindMin(duty);
    if (m === null || !U.isISO(date)) return null;
    var p = date.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2], 0, 0, 0, 0);
    d.setMinutes(d.getMinutes() + m);
    return d;
  }

  /**
   * いま出すべき「勤務実績入力」の一覧。新しい日が先。
   * 勤務を選んである日のうち、うながす時刻を過ぎていて、
   * まだ入れ終えた印が付いていないものを拾う。
   * @param {object} [opts] {now:Date, backDays:さかのぼる日数}
   */
  function dueWorkLogs(opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var back = opts.backDays === undefined ? 14 : opts.backDays;
    var duties = S.settings.duties || {};
    var from = U.addDays(U.today(), -back);
    var out = [];

    Object.keys(duties).forEach(function (date) {
      if (!U.isISO(date) || U.cmp(date, from) < 0) return;
      var duty = duties[date];
      var at = remindAt(date, duty);
      if (!at || at.getTime() > now.getTime()) return;      // まだその時刻になっていない
      if (S.dutyLogDone(date)) return;                       // もう入れ終えている
      out.push({ date: date, duty: duty, label: S.dutyLabel(duty), at: at });
    });

    return out.sort(function (a, b) { return U.cmp(b.date, a.date); });
  }

  DL.timeblocks = {
    DAY: DAY,
    REMIND: REMIND, remindMin: remindMin, remindAt: remindAt, dueWorkLogs: dueWorkLogs,
    labels: labels, colorOf: colorOf,
    fmt: fmt, fmtDay: fmtDay, parse: parse, colorAt: colorAt,
    ofDay: ofDay, has: has, sums: sums, filled: filled, gaps: gaps,
    projectMinutes: projectMinutes, byProject: byProject, projectsOfDay: projectsOfDay,
    hours: hours,
    presetFor: presetFor, hasPreset: hasPreset, applyPreset: applyPreset, presetText: presetText
  };
})(window.DL);
