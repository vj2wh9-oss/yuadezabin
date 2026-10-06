/* 出ていくお金の年表。

   固定費（recurring）は「毎月きまって出るもの」だった。
   こちらは、その反対——年払いの保険、住民税の4期、国保、年金、予定納税、
   ドメイン、年会費、車検、免許の更新。忘れたころに、まとまって出ていくもの。

   困るのは、来た月にいきなり家計が崩れることなので、
   ここでは2つを出す。

     いつ出ていくか（年表）
     毎月いくら取りのけておけば足りるか（積立）

   積立のぶんは、1日の予算から先に引く（固定費と同じ扱い）。
   そうしておけば、保険料の月だけ食費を削る、ということにならない。

   出かたは3通りだけ持つ。
     cycle … n ヶ月ごと（毎年の保険料、2年ごとの更新料）
     dates … 年の決まった日（住民税の4期のように、間が等しくないもの）
     once  … 一度きり（車検、引っ越し） */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var SOON = 14;        // 何日前から知らせるか
  var MONTHS = 24;      // 年表に並べる月数
  /* 払い残しを拾う範囲。これより古いものは、もう催促しない
     （次の回が来ているのに前の回を出し続けても、邪魔になるだけ） */
  var LATE_MAX = 3;

  /** 周期の選べるもの */
  var CYCLES = [
    { months: 1, label: '毎月' },
    { months: 2, label: '2ヶ月ごと' },
    { months: 3, label: '3ヶ月ごと' },
    { months: 4, label: '4ヶ月ごと' },
    { months: 6, label: '半年ごと' },
    { months: 12, label: '毎年' },
    { months: 24, label: '2年ごと' },
    { months: 36, label: '3年ごと' }
  ];

  /** よく使うものの下ごしらえ。登録のシートから選べる */
  var PRESETS = [
    { name: '住民税', book: 'life', category: '税金', kind: 'dates',
      dates: ['06-30', '08-31', '10-31', '01-31'] },
    { name: '国民健康保険', book: 'life', category: '保険', kind: 'cycle', months: 1 },
    { name: '国民年金', book: 'life', category: '保険', kind: 'cycle', months: 1 },
    { name: '予定納税', book: 'work', category: '税金', kind: 'dates',
      dates: ['07-31', '11-30'] },
    { name: '所得税の納付', book: 'work', category: '税金', kind: 'cycle', months: 12 },
    { name: '消費税の納付', book: 'work', category: '税金', kind: 'cycle', months: 12 },
    { name: '火災保険', book: 'life', category: '保険', kind: 'cycle', months: 12 },
    { name: 'ドメイン', book: 'work', category: '通信費', kind: 'cycle', months: 12 },
    { name: '年会費', book: 'life', category: 'その他', kind: 'cycle', months: 12 },
    { name: '車検', book: 'life', category: 'その他', kind: 'cycle', months: 24 },
    { name: '免許の更新', book: 'life', category: 'その他', kind: 'cycle', months: 36 }
  ];

  function list(book) { return S.outgo(book); }

  function live(x) { return !!x && x.active !== false; }

  /** 年に何回出ていくか。一度きりのものは 0 */
  function timesPerYear(x) {
    if (!x) return 0;
    if (x.kind === 'once') return 0;
    if (x.kind === 'dates') return (x.dates || []).length;
    return 12 / Math.max(1, x.months);
  }

  /** 1年あたり、いくら出ていくか */
  function yearly(x) { return Math.round(U.num(x && x.amount, 0) * timesPerYear(x)); }

  /** 払った印の合鍵 */
  function key(x, date) { return (x && x.id) + '|' + date; }

  function isPaid(x, date) { return !!S.outgoPaid()[key(x, date)]; }

  /**
   * 入れた日。
   * at は世界時で持っているので、そのまま頭を切ると日本では前の日になる。
   * いちど日付に直してから見る。
   */
  function addedOn(x) {
    var at = new Date(String((x && x.at) || ''));
    return isFinite(at.getTime()) ? U.toISO(at) : '';
  }

  /* 'MM-DD' を、その年の日付に。2/29 のような無い日は、その月の末日に寄せる */
  function dayOfYear(year, md) {
    var p = String(md).split('-');
    return U.clampDay(year + '-' + p[0], U.num(p[1], 1));
  }

  /**
   * その1件が、いつ出ていくか。
   *
   * 期間より前のぶんは、まだ払っていないものだけ拾う（催促のため）。
   * いくら古くても出し続けるとうるさいので、直近の数回までにする。
   *
   * @param {object} x 年表の1件
   * @param {string} from
   * @param {string} to
   * @returns {Array<{x, date, amount, paid, late}>} 古い順
   */
  function occurrencesOf(x, from, to, o) {
    if (!live(x)) return [];
    o = o || {};
    var raw = [];
    var guard = 0;

    if (x.kind === 'dates') {
      var y0 = U.num(from.slice(0, 4), 2000) - 1, y1 = U.num(to.slice(0, 4), 2000) + 1;
      for (var y = y0; y <= y1; y++) {
        (x.dates || []).forEach(function (md) { raw.push(dayOfYear(String(y), md)); });
      }
    } else if (x.kind === 'once') {
      if (U.isISO(x.next)) raw.push(x.next);
    } else {
      var d = x.next;
      if (!U.isISO(d)) return [];
      // next より前には出ていかない（next が「次に出ていく日」そのもの）
      while (U.cmp(d, to) <= 0 && guard++ < 600) {
        raw.push(d);
        d = U.addMonths(d, Math.max(1, x.months));
      }
    }

    raw.sort(U.cmp);

    /* 年の決まった日（dates）には、「次はここ」という目印が無い。
       入れた年より前の回まで数えると、去年の住民税をいつまでも
       催促することになるので、登録より前の回は初めから見ない。
       周期（cycle）のほうは next が目印そのものなので、この断りは要らない */
    var since = x.kind === 'dates' ? addedOn(x) : '';
    if (since && U.isISO(since)) {
      raw = raw.filter(function (dt) { return U.cmp(dt, since) >= 0; });
    }

    /* 期間より前の払い残しは、頼まれたときだけ拾う。
       月ごとの山や、カレンダーの日割りで拾ってしまうと、
       どの月にも同じものが何度も現れて、数が合わなくなる。
       いくら古くても出し続けるとうるさいので、直近の数回まで */
    var late = o.late ? raw.filter(function (dt) {
      return U.cmp(dt, from) < 0 && !isPaid(x, dt);
    }).slice(-LATE_MAX) : [];
    var within = raw.filter(function (dt) {
      return U.cmp(dt, from) >= 0 && U.cmp(dt, to) <= 0;
    });

    return late.concat(within).map(function (dt) {
      return {
        x: x, id: x.id, date: dt, name: x.name,
        amount: Math.max(0, U.num(x.amount, 0)),
        book: x.book, category: x.category, vendor: x.vendor,
        paid: isPaid(x, dt), late: U.cmp(dt, from) < 0, key: key(x, dt)
      };
    });
  }

  /**
   * その期間に出ていくもの、ぜんぶ。日付の古い順。
   * @param {string} from
   * @param {string} to
   * @param {object} [o] {book, includePaid, late（期間より前の払い残しも拾う）}
   */
  function between(from, to, o) {
    o = o || {};
    var out = [];
    list(o.book).forEach(function (x) {
      occurrencesOf(x, from, to, o).forEach(function (oc) {
        if (oc.paid && !o.includePaid) return;
        out.push(oc);
      });
    });
    return out.sort(function (a, b) {
      return U.cmp(a.date, b.date) || (b.amount - a.amount) || U.cmp(a.name, b.name);
    });
  }

  /** これから出ていくもの。近い順に n 件 */
  function upcoming(date, n, o) {
    var today = U.isISO(date) ? date : U.today();
    var rows = between(today, U.addMonths(today, MONTHS), o);
    return n ? rows.slice(0, n) : rows;
  }

  /** 日ごとに束ねる（カレンダーに出すため） */
  function byDay(from, to, o) {
    var map = {};
    between(from, to, o).forEach(function (oc) {
      (map[oc.date] || (map[oc.date] = [])).push(oc);
    });
    return map;
  }

  /** その日に出ていくもの */
  function ofDay(date, o) {
    return U.isISO(date) ? between(date, date, o) : [];
  }

  /** その月に出ていくもの */
  function ofMonth(ym, o) {
    if (!/^\d{4}-\d{2}$/.test(String(ym))) return [];
    return between(ym + '-01', U.monthEnd(ym + '-01'), o);
  }

  /* 今日から、その日まで何ヶ月あるか（今月を1と数える）。
     月は会計月（締め日で区切ったぶん） */
  function monthsUntil(from, to) {
    var a = DL.expenses.cycleOf(from).split('-');
    var b = DL.expenses.cycleOf(to).split('-');
    return (U.num(b[0], 0) - U.num(a[0], 0)) * 12 + (U.num(b[1], 0) - U.num(a[1], 0)) + 1;
  }

  /**
   * 毎月いくら取りのけておけば足りるか。
   *
   *   n ヶ月ごと … 1回ぶん ÷ n
   *   年の決まった日 … 1回ぶん × 回数 ÷ 12
   *   一度きり … 残り月数で割る（その日が近いほど、取りのける額は増える）
   *
   * @param {string} [date]
   * @returns {{total:number, rows:Array}}
   */
  function perMonth(date) {
    var today = U.isISO(date) ? date : U.today();
    var rows = [];
    list().forEach(function (x) {
      if (!live(x) || x.saveUp === false) return;
      var per = 0;
      if (x.kind === 'once') {
        if (!U.isISO(x.next) || U.cmp(x.next, today) < 0) return;
        per = U.num(x.amount, 0) / Math.max(1, monthsUntil(today, x.next));
      } else if (x.kind === 'dates') {
        if (!(x.dates || []).length) return;
        per = U.num(x.amount, 0) * x.dates.length / 12;
      } else {
        if (!U.isISO(x.next)) return;
        per = U.num(x.amount, 0) / Math.max(1, x.months);
      }
      if (per <= 0) return;
      rows.push({ x: x, per: Math.round(per) });
    });
    rows.sort(function (a, b) { return b.per - a.per; });
    return {
      total: Math.round(rows.reduce(function (n, r) { return n + r.per; }, 0)),
      rows: rows
    };
  }

  /* その1件の、前回と次回。取りのけ具合を見るのに使う */
  function span(x, today) {
    if (x.kind === 'once') {
      if (!U.isISO(x.next)) return null;
      var from = addedOn(x) || today;
      return { prev: U.cmp(from, x.next) < 0 ? from : x.next, next: x.next };
    }
    if (x.kind === 'dates') {
      var all = [];
      var y = U.num(today.slice(0, 4), 2000);
      [y - 1, y, y + 1].forEach(function (yy) {
        (x.dates || []).forEach(function (md) { all.push(dayOfYear(String(yy), md)); });
      });
      all.sort(U.cmp);
      var nx = all.filter(function (d) { return U.cmp(d, today) >= 0; })[0];
      var pv = all.filter(function (d) { return U.cmp(d, today) < 0; }).pop();
      return (nx && pv) ? { prev: pv, next: nx } : null;
    }
    if (!U.isISO(x.next)) return null;
    return { prev: U.addMonths(x.next, -Math.max(1, x.months)), next: x.next };
  }

  /**
   * いま、いくら取りのけてあるべきか。
   *
   * 前回からの日数ぶんだけ積み上がっている、という見かた。
   * 「貯金のうち、これだけは手を付けられない」と分かるように出す。
   *
   * @param {string} [date]
   * @returns {{total:number, rows:Array}}
   */
  function reserve(date) {
    var today = U.isISO(date) ? date : U.today();
    var rows = [];
    list().forEach(function (x) {
      if (!live(x) || x.saveUp === false) return;
      var sp = span(x, today);
      if (!sp) return;
      var all = Math.max(1, U.diffDays(sp.prev, sp.next));
      var done = Math.min(all, Math.max(0, U.diffDays(sp.prev, today)));
      var need = Math.round(U.num(x.amount, 0) * done / all);
      if (need <= 0) return;
      rows.push({ x: x, need: need, on: sp.next });
    });
    rows.sort(function (a, b) { return b.need - a.need; });
    return {
      total: Math.round(rows.reduce(function (n, r) { return n + r.need; }, 0)),
      rows: rows
    };
  }

  /**
   * ホームの警告。近いものと、払い残し。
   * @param {string} [date]
   * @param {number} [days] 何日前から出すか
   */
  function alerts(date, days) {
    var D = DL.docs;
    var today = U.isISO(date) ? date : U.today();
    var within = U.num(days, SOON);
    return between(U.addMonths(today, -2), U.addDays(today, within), { late: true })
      .filter(function (oc) { return !oc.paid; })
      .map(function (oc) {
        var left = U.diffDays(today, oc.date);
        return {
          level: left < 0 ? 'danger' : left <= 3 ? 'danger' : left <= 7 ? 'warn' : 'info',
          overdue: left < 0,
          href: '#/outgo',
          text: oc.name + 'の支払いが' + U.untilLabel(oc.date, today)
            + '（' + D.yen(oc.amount) + '）'
        };
      });
  }

  /**
   * 払った印を付けて、次の回へ送る。
   *
   * 記録そのもの（経費）は呼ぶ側で作り、その id をここへ渡す。
   * 周期のものは next を次へ送り、一度きりのものは終わりにする。
   *
   * @param {string} id 年表の id
   * @param {string} date その回の日付
   * @param {object} [o] {amount, expenseId}
   */
  function markPaid(id, date, o) {
    var x = S.getOutgo(id);
    if (!x || !U.isISO(date)) return null;
    o = o || {};
    S.setOutgoPaid(key(x, date), {
      amount: U.num(o.amount, x.amount), expenseId: o.expenseId || ''
    });
    if (x.kind === 'cycle' && x.next === date) {
      S.updateOutgo(x.id, { next: U.addMonths(date, Math.max(1, x.months)) });
    } else if (x.kind === 'once' && x.next === date) {
      S.updateOutgo(x.id, { active: false });
    }
    return S.getOutgo(x.id);
  }

  /** 払った印を外して、前の回へ戻す（押し間違えたとき） */
  function unmarkPaid(id, date) {
    var x = S.getOutgo(id);
    if (!x || !U.isISO(date)) return null;
    S.setOutgoPaid(key(x, date), null);
    if (x.kind === 'cycle' && U.cmp(date, x.next) < 0) {
      S.updateOutgo(x.id, { next: date });
    } else if (x.kind === 'once') {
      S.updateOutgo(x.id, { active: true });
    }
    return S.getOutgo(x.id);
  }

  /**
   * 払ったことにして、経費にも記録する。
   * @param {string} id
   * @param {string} date
   * @param {object} [o] {amount, on 実際に払った日}
   */
  function pay(id, date, o) {
    var x = S.getOutgo(id);
    if (!x) return null;
    o = o || {};
    var amount = Math.max(0, Math.round(U.num(o.amount, x.amount)));
    var on = U.isISO(o.on) ? o.on : (U.cmp(date, U.today()) > 0 ? U.today() : date);
    var ex = S.addExpense({
      book: x.book, date: on, amount: amount,
      category: x.category, vendor: x.vendor || x.name,
      memo: x.name + '（年表）'
    });
    markPaid(id, date, { amount: amount, expenseId: ex ? ex.id : '' });
    return ex;
  }

  /** 出かたの言いかた */
  function cycleLabel(x) {
    if (!x) return '';
    if (x.kind === 'once') return '一度きり';
    if (x.kind === 'dates') return '年' + (x.dates || []).length + '回';
    var c = CYCLES.filter(function (o) { return o.months === x.months; })[0];
    return c ? c.label : x.months + 'ヶ月ごと';
  }

  DL.outgo = {
    SOON: SOON, MONTHS: MONTHS, CYCLES: CYCLES, PRESETS: PRESETS,
    list: list, yearly: yearly, timesPerYear: timesPerYear, cycleLabel: cycleLabel,
    key: key, isPaid: isPaid,
    occurrencesOf: occurrencesOf, between: between, upcoming: upcoming,
    byDay: byDay, ofDay: ofDay, ofMonth: ofMonth,
    perMonth: perMonth, reserve: reserve, alerts: alerts,
    markPaid: markPaid, unmarkPaid: unmarkPaid, pay: pay
  };
})(window.DL);
