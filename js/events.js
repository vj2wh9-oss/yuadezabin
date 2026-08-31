/* 日常の予定の展開と表示文言。

   予定は「始まる日・続く日数・繰り返し」で持っていて、
   実際に何日に出るかはここで計算する（毎回の展開を保存しない）。
   繰り返しを持つ予定を1件だけ持てば済むようにするため。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var REPEATS = [
    { value: '', label: 'なし' },
    { value: 'weekly', label: '毎週' },
    { value: 'monthly', label: '毎月' },
    { value: 'yearly', label: '毎年' }
  ];

  function repeatLabel(v) {
    for (var i = 0; i < REPEATS.length; i++) if (REPEATS[i].value === (v || '')) return REPEATS[i].label;
    return 'なし';
  }

  /* 繰り返しの説明（入力画面に出す） */
  function repeatNote(ev) {
    if (!ev.repeat) return '';
    var d = ev.date;
    if (ev.repeat === 'weekly') return '毎週' + U.wdName(U.dow(d)) + '曜日';
    if (ev.repeat === 'monthly') {
      var day = U.num(d.slice(8), 1);
      return '毎月' + day + '日' + (day > 28 ? '（その日が無い月は月末）' : '');
    }
    return '毎年' + (+d.slice(5, 7)) + '月' + (+d.slice(8)) + '日';
  }

  /**
   * その予定が始まる日を、[from, to] に掛かる範囲だけ並べる。
   * 複数日にまたがる予定は、掛かっていれば期間より前に始まったものも拾う。
   * @returns {Array<string>} 'YYYY-MM-DD' の配列（古い順）
   */
  function starts(ev, from, to) {
    var span = Math.min(60, Math.max(1, U.num(ev.days, 1)));
    // ここから始まれば to までのどこかに掛かる、という下限
    var lo = U.addDays(from, -(span - 1));
    var hi = to;
    if (U.cmp(lo, ev.date) < 0) lo = ev.date;                 // 開始日より前には出さない
    if (ev.until && U.cmp(hi, ev.until) > 0) hi = ev.until;   // 繰り返しの終わりで止める
    if (U.cmp(lo, hi) > 0) return [];

    if (!ev.repeat) {
      return (U.cmp(ev.date, lo) >= 0 && U.cmp(ev.date, hi) <= 0) ? [ev.date] : [];
    }

    var out = [], guard = 0;

    if (ev.repeat === 'weekly') {
      // lo 以降で最初に来る同じ曜日から
      var skip = Math.max(0, Math.ceil(U.diffDays(ev.date, lo) / 7));
      var d = U.addDays(ev.date, skip * 7);
      while (U.cmp(d, hi) <= 0 && guard++ < 400) { out.push(d); d = U.addDays(d, 7); }
      return out;
    }

    var day = U.num(ev.date.slice(8), 1);

    if (ev.repeat === 'monthly') {
      var ym = lo.slice(0, 7);
      while (U.cmp(ym + '-01', hi) <= 0 && guard++ < 400) {
        // 31日など無い日は、その月の末日に寄せる（固定費と同じ考え方）
        var c = U.clampDay(ym, day);
        if (U.cmp(c, lo) >= 0 && U.cmp(c, hi) <= 0 && U.cmp(c, ev.date) >= 0) out.push(c);
        ym = U.addYm(ym, 1);
      }
      return out;
    }

    // 毎年（2月29日は、無い年は28日に寄る）
    var mm = ev.date.slice(5, 7);
    var y = U.num(lo.slice(0, 4), 2000), yEnd = U.num(hi.slice(0, 4), 2000);
    while (y <= yEnd && guard++ < 200) {
      var c2 = U.clampDay(y + '-' + mm, day);
      if (U.cmp(c2, lo) >= 0 && U.cmp(c2, hi) <= 0 && U.cmp(c2, ev.date) >= 0) out.push(c2);
      y++;
    }
    return out;
  }

  /**
   * [from, to] に掛かる予定を日付ごとに割り振る。
   * @returns {object} { 'YYYY-MM-DD': [{ev, date, start, span, index}] }
   *   date は出ている日、index は何日目か（0 始まり）
   */
  function byDay(from, to) {
    var map = {};
    S.events().forEach(function (ev) {
      var span = Math.min(60, Math.max(1, U.num(ev.days, 1)));
      starts(ev, from, to).forEach(function (s) {
        for (var i = 0; i < span; i++) {
          var d = U.addDays(s, i);
          if (U.cmp(d, from) < 0) continue;
          if (U.cmp(d, to) > 0) break;
          (map[d] = map[d] || []).push({ ev: ev, date: d, start: s, span: span, index: i });
        }
      });
    });
    Object.keys(map).forEach(function (d) { map[d].sort(order); });
    return map;
  }

  /* ホームの「今日やること」から外したか。カレンダーからは消さない */
  function isDone(o) { return S.isEventDone(o.ev.id, o.date); }

  function ofDay(date) { return byDay(date, date)[date] || []; }

  /* 終日を先に、あとは時刻の早い順 */
  function order(a, b) {
    var ta = a.ev.start || '', tb = b.ev.start || '';
    if (!ta !== !tb) return ta ? 1 : -1;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return U.cmp(a.ev.title || '', b.ev.title || '');
  }

  /* その月に掛かる予定を、日付順に一列で返す */
  function ofMonth(first, last) {
    var map = byDay(first, last);
    var out = [];
    U.rangeDays(first, last).forEach(function (d) {
      (map[d] || []).forEach(function (o) {
        // またがる予定は初日（か月初）だけ出す
        if (o.index === 0 || d === first) out.push(o);
      });
    });
    return out;
  }

  /* 時刻の表示（終日なら空） */
  function timeText(ev) {
    if (!ev.start) return '';
    return ev.end ? ev.start + '–' + ev.end : ev.start;
  }

  /* カレンダーのマスに出す小さな添え字。時刻があれば時刻、無ければ何日目か */
  function cellNote(o) {
    var t = timeText(o.ev);
    if (t) return o.ev.start;                  // マスは狭いので開始時刻だけ
    return o.span > 1 ? (o.index + 1) + '日目' : '';
  }

  /* 一覧に出す時間の説明 */
  function whenText(o) {
    var parts = [timeText(o.ev) || '終日'];
    // 初日は「3日間」、途中の日は何日目かで言う
    if (o.span > 1) {
      parts.push(o.index === 0 ? o.span + '日間' : (o.index + 1) + '日目 / 全' + o.span + '日');
    }
    return parts.join('　');
  }

  DL.events = {
    REPEATS: REPEATS, repeatLabel: repeatLabel, repeatNote: repeatNote,
    starts: starts, byDay: byDay, ofDay: ofDay, ofMonth: ofMonth, isDone: isDone,
    timeText: timeText, cellNote: cellNote, whenText: whenText
  };
})(window.DL);
