/* 印刷所の締切を、営業日で数えて出す。

   土日と祝日は非営業日。イベント当日から営業日をさかのぼって数える。
   「N営業日前」は、当日より前にある N 番目の営業日のこと
   （当日そのものは数えない）。

   早割・割増の決まりはラック出版のもの。ここを直せば全部の画面に効く。 */
(function (DL) {
  'use strict';
  var U = DL.util;

  /* back … イベント当日から何営業日前か
     at   … その日の締切時刻
     cover… 表紙の先行入稿が要るもの（何営業日前か）
     rate … 料金の増減（％。マイナスが割引） */
  var PLANS = [
    { id: 'early20', label: '20%早割', back: 6, at: '11:00', rate: -20 },
    { id: 'early10', label: '10%早割', back: 5, at: '11:00', rate: -10 },
    { id: 'normal', label: '通常', back: 4, at: '09:00', rate: 0 },
    { id: 'late10', label: '10%割増', back: 3, at: '09:00', rate: 10, cover: 4, book: true },
    { id: 'late20', label: '20%割増', back: 2, at: '09:00', rate: 20, cover: 4, book: true }
  ];

  /* 割増は、通常締切の時刻までにメールで予約しておく必要がある */
  function needsBooking(id) {
    return PLANS.some(function (p) { return p.id === id && p.book; });
  }

  function get(id) {
    return PLANS.filter(function (p) { return p.id === id; })[0] || null;
  }

  /* ---------------- 営業日 ---------------- */

  /** 土日でも祝日でもない日か */
  function isWorkday(date) {
    var d = U.dow(date);
    if (d === 0 || d === 6) return false;
    return !DL.holidays.is(date);
  }

  /**
   * その日より前の、n 番目の営業日。
   * 当日は数えない（当日が営業日でも、1営業日前は前の営業日になる）。
   */
  function workdaysBefore(date, n) {
    if (!U.isISO(date)) return '';
    var at = date;
    var left = Math.max(0, Math.round(n));
    var guard = 0;
    while (left > 0) {
      at = U.addDays(at, -1);
      if (isWorkday(at)) left--;
      if (++guard > 400) return '';      // 祝日の計算が壊れても止まらないように
    }
    return at;
  }

  /* ---------------- 締切を出す ---------------- */

  /**
   * イベント当日から、各プランの締切を出す。
   * @param {string} eventDate 'YYYY-MM-DD'
   * @returns {Array<{id,label,due,at,rate,cover,coverDue,book}>} 早い順
   */
  function schedule(eventDate) {
    if (!U.isISO(eventDate)) return [];
    return PLANS.map(function (p) {
      return {
        id: p.id, label: p.label, rate: p.rate, at: p.at, book: !!p.book,
        due: workdaysBefore(eventDate, p.back),
        cover: p.cover || 0,
        coverDue: p.cover ? workdaysBefore(eventDate, p.cover) : ''
      };
    }).sort(function (a, b) { return U.cmp(a.due, b.due); });
  }

  /** そのプラン1つぶん */
  function planFor(eventDate, id) {
    return schedule(eventDate).filter(function (p) { return p.id === id; })[0] || null;
  }

  /** 通常締切（割増の予約はこの時刻まで） */
  function normalDue(eventDate) { return planFor(eventDate, 'normal'); }

  /**
   * その締切の瞬間。時刻まで含めて比べたいときに使う。
   * @returns {Date|null}
   */
  function dueAt(plan) {
    if (!plan || !U.isISO(plan.due)) return null;
    var p = plan.due.split('-');
    var t = String(plan.at || '09:00').split(':');
    return new Date(+p[0], +p[1] - 1, +p[2], U.num(t[0], 9), U.num(t[1], 0), 0, 0);
  }

  /** もう過ぎているか */
  function passed(plan, now) {
    var at = dueAt(plan);
    return !!at && (now || new Date()).getTime() > at.getTime();
  }

  /** '9/26(金) 9:00' のように読める形にする */
  function label(plan) {
    if (!plan || !U.isISO(plan.due)) return '—';
    return U.fmtMDW(plan.due) + ' ' + String(plan.at).replace(/^0/, '');
  }

  /* ---------------- 割増の予約メール ----------------

     割増（10%・20%）は、通常締切の時刻までにメールで予約しておく必要がある。
     宛先も名乗りも決まっているので、ここで文面まで組み立てる。
     送るのは手元のメールアプリ（下書きを開くだけで、勝手には送らない）。 */

  var MAIL = {
    from: 'datemaki.bansoko@gmail.com',      // どの差出人で出すかの目安
    to: 'luck@luck-pb.jp',
    name: '山田啓輔',
    set: '定番カラーセット',
    option: '表紙仕様：PPマット加工　その他オプションなし'
  };

  var SIZES = ['B5', 'A5'];

  /** 冊数の選び口。50から500まで、50きざみ */
  function copyChoices() {
    var out = [];
    for (var n = 50; n <= 500; n += 50) out.push(n);
    return out;
  }

  /** 'YYYY-MM-DD' → '2026年09月26日' */
  function ymdJa(iso) {
    if (!U.isISO(iso)) return '—';
    return iso.slice(0, 4) + '年' + iso.slice(5, 7) + '月' + iso.slice(8, 10) + '日';
  }

  /**
   * 予約メールの下書きを組み立てる。
   * @param {object} o {eventDate, planId:'late10'|'late20', size, copies, pages}
   * @returns {{to,from,subject,body,plan,normal}}
   */
  function bookingMail(o) {
    o = o || {};
    var plan = planFor(o.eventDate, o.planId);
    var normal = normalDue(o.eventDate);
    var rate = plan ? Math.abs(plan.rate) : 0;

    var body = [
      'ラック出版　ご担当者様',
      '',
      'お世話になっております。',
      MAIL.name + 'と申します。',
      '',
      rate + '%割増の予約をさせていただきたくメール致しました。',
      '',
      '注文の詳細は以下です。',
      '---------------------------------',
      '■本文入稿予定日　' + ymdJa(plan && plan.due),
      '■イベント参加日　' + ymdJa(o.eventDate),
      '■氏名　' + MAIL.name,
      '■本のサイズ　' + (o.size || ''),
      '■セット名　' + MAIL.set,
      '■ページ数　' + U.num(o.pages, 0),
      '■冊数　' + U.num(o.copies, 0),
      '■オプション ' + MAIL.option,
      '---------------------------------',
      '',
      '通常締切日の午前9時までに表紙の先行入稿を致します。',
      '',
      '以上でございます。',
      '',
      '大変恐れ入りますが、よろしくお願いいたします。'
    ].join('\n');

    return {
      to: MAIL.to, from: MAIL.from,
      subject: rate + '%割増の予約のお願い（' + MAIL.name + '）',
      body: body, plan: plan, normal: normal
    };
  }

  /** メールアプリに渡す形。ここでは開くだけで、送信はしない */
  function mailtoUrl(m) {
    return 'mailto:' + encodeURIComponent(m.to)
      + '?subject=' + encodeURIComponent(m.subject)
      + '&body=' + encodeURIComponent(String(m.body).replace(/\r?\n/g, '\r\n'));
  }

  DL.printing = {
    MAIL: MAIL, SIZES: SIZES, copyChoices: copyChoices, ymdJa: ymdJa,
    bookingMail: bookingMail, mailtoUrl: mailtoUrl,
    PLANS: PLANS, get: get, needsBooking: needsBooking,
    isWorkday: isWorkday, workdaysBefore: workdaysBefore,
    schedule: schedule, planFor: planFor, normalDue: normalDue,
    dueAt: dueAt, passed: passed, label: label
  };
})(window.DL);
