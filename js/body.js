/* からだの台帳。

   体重と Fitbit とトレーニングは前からあるのに、
   通院・服薬・健診だけが抜けていた。ここで埋める。

   持つのは3つ。

     くすり   いつ飲むか（朝・昼・夜・寝る前）と、飲んだかどうか
     通院     いつ・どこ・何で・いくら、そして次の予約
     健診     数値の推移（血圧、HbA1c、γ-GTP、…）

   医療費は確定申告にも効くので、通院に金額を入れたら
   日常の経費（医療・健康）にも同じものを記録する。
   年ごとの合計と、医療費控除（10万円）までの残りも出す。

   くすりは「飲んだか」をその日ごとに持つ。
   さかのぼって付けられるようにしておく（寝る前のぶんは、たいてい翌朝に思い出す）。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  /* いつ飲むか。並び順がそのまま1日の流れになる */
  var SLOTS = [
    { key: 'morning', label: '朝', time: '08:00' },
    { key: 'noon', label: '昼', time: '12:30' },
    { key: 'night', label: '夜', time: '19:00' },
    { key: 'bed', label: '寝る前', time: '22:30' }
  ];

  var VISIT_SOON = 7;      // 次の通院を何日前から知らせるか
  var DEDUCT = 100000;     // 医療費控除の目安（この額を超えたぶんが対象）
  var MEDICAL_CATEGORY = '医療・健康';

  /* 健診でよく見る数値。基準の内か外かを、同じ物差しで言えるように持つ。
     lo / hi は「このあいだなら ふつう」。片側しか無いものもある */
  var VITALS = [
    { key: 'weight', label: '体重', unit: 'kg' },
    { key: 'bmi', label: 'BMI', unit: '', lo: 18.5, hi: 25 },
    { key: 'waist', label: '腹囲', unit: 'cm', hi: 85 },
    { key: 'bpHigh', label: '血圧（上）', unit: 'mmHg', hi: 130 },
    { key: 'bpLow', label: '血圧（下）', unit: 'mmHg', hi: 85 },
    { key: 'pulse', label: '脈拍', unit: '/分', lo: 50, hi: 100 },
    { key: 'glucose', label: '空腹時血糖', unit: 'mg/dL', hi: 100 },
    { key: 'hba1c', label: 'HbA1c', unit: '%', hi: 5.6 },
    { key: 'ldl', label: 'LDL', unit: 'mg/dL', hi: 120 },
    { key: 'hdl', label: 'HDL', unit: 'mg/dL', lo: 40 },
    { key: 'tg', label: '中性脂肪', unit: 'mg/dL', hi: 150 },
    { key: 'ast', label: 'AST(GOT)', unit: 'U/L', hi: 30 },
    { key: 'alt', label: 'ALT(GPT)', unit: 'U/L', hi: 30 },
    { key: 'ggt', label: 'γ-GTP', unit: 'U/L', hi: 50 },
    { key: 'ua', label: '尿酸', unit: 'mg/dL', hi: 7 },
    { key: 'cre', label: 'クレアチニン', unit: 'mg/dL', hi: 1.1 },
    { key: 'hb', label: 'ヘモグロビン', unit: 'g/dL', lo: 13.1, hi: 16.6 }
  ];

  function vital(key) {
    return VITALS.filter(function (v) { return v.key === key; })[0] || null;
  }

  function slot(key) {
    return SLOTS.filter(function (s) { return s.key === key; })[0] || null;
  }

  function slotLabel(key) { var s = slot(key); return s ? s.label : key; }

  /* ---------------- くすり ---------------- */

  function meds(o) {
    o = o || {};
    var list = S.meds();
    return o.all ? list : list.filter(function (m) { return m.active !== false; });
  }

  /** その日に飲むものか。曜日と、いつからいつまでを見る */
  function onDay(m, date) {
    if (!m || m.active === false) return false;
    if (m.from && U.cmp(date, m.from) < 0) return false;
    if (m.until && U.cmp(date, m.until) > 0) return false;
    if (m.weekdays && m.weekdays.length) {
      return m.weekdays.indexOf(U.dow(date)) >= 0;
    }
    return true;
  }

  function takenKey(medId, slotKey) { return medId + '|' + slotKey; }

  /** 飲んだか */
  function isTaken(date, medId, slotKey) {
    return !!(S.medLog(date) || {})[takenKey(medId, slotKey)];
  }

  /** 飲んだ印を付け外しする */
  function take(date, medId, slotKey, on) {
    return S.setMedTaken(date, takenKey(medId, slotKey), on !== false);
  }

  /**
   * その日に飲むもの。1回ぶんずつ並べる（朝・昼・夜・寝る前の順）。
   * @returns {Array<{med, slot, label, taken}>}
   */
  function dose(date) {
    date = U.isISO(date) ? date : U.today();
    var out = [];
    SLOTS.forEach(function (sl) {
      meds().forEach(function (m) {
        if (!onDay(m, date)) return;
        if ((m.times || []).indexOf(sl.key) < 0) return;
        out.push({
          med: m, slot: sl.key, label: sl.label, time: m.time || sl.time,
          taken: isTaken(date, m.id, sl.key)
        });
      });
    });
    return out;
  }

  /** その日の飲みぐあい */
  function progress(date) {
    var rows = dose(date);
    var done = rows.filter(function (r) { return r.taken; }).length;
    return { all: rows.length, done: done, left: rows.length - done,
      pct: rows.length ? Math.round(done / rows.length * 100) : 0 };
  }

  /**
   * そのくすりを飲みはじめた日。決めていなければ、登録した日。
   *
   * 登録した日（at）は世界時で持っているので、そのまま頭を切ると
   * 日本では前の日になってしまう。いちど日付に直してから見る。
   */
  function startOf(m) {
    if (m && U.isISO(m.from)) return m.from;
    var at = new Date(String((m && m.at) || ''));
    return isFinite(at.getTime()) ? U.toISO(at) : '';
  }

  /**
   * ここ何日か、きちんと飲めているか。
   *
   * 今日は途中なので数えない（夜のぶんがまだなのを「飲み忘れ」とは言わない）。
   * 飲みはじめる前の日も数えない。今日入れたばかりのくすりを
   * 「2週間さぼった」と言われても、どうしようもないため。
   */
  function keep(date, days) {
    var today = U.isISO(date) ? date : U.today();
    var n = Math.max(1, U.num(days, 14));
    var all = 0, done = 0, missed = [];
    for (var i = 1; i <= n; i++) {
      var d = U.addDays(today, -i);
      var rows = dose(d).filter(function (r) {
        var from = startOf(r.med);
        return !from || U.cmp(d, from) >= 0;
      });
      if (!rows.length) continue;
      var took = rows.filter(function (r) { return r.taken; }).length;
      all += rows.length;
      done += took;
      if (rows.length - took) {
        missed.push({ date: d, left: rows.length - took, all: rows.length });
      }
    }
    return { days: n, all: all, done: done,
      pct: all ? Math.round(done / all * 100) : 0,
      missed: missed.sort(function (a, b) { return U.cmp(b.date, a.date); }) };
  }

  /* ---------------- 通院 ---------------- */

  function visits(o) {
    o = o || {};
    var list = S.visits().slice().sort(function (a, b) { return U.cmp(b.date, a.date); });
    if (o.year) {
      list = list.filter(function (v) { return v.date.slice(0, 4) === String(o.year); });
    }
    return list;
  }

  /** 次の予約。いちばん近い、まだ来ていないもの */
  function nextVisit(date) {
    var today = U.isISO(date) ? date : U.today();
    var cand = [];
    S.visits().forEach(function (v) {
      if (U.isISO(v.next) && U.cmp(v.next, today) >= 0) {
        cand.push({ date: v.next, place: v.place, dept: v.dept, from: v });
      }
    });
    cand.sort(function (a, b) { return U.cmp(a.date, b.date); });
    return cand[0] || null;
  }

  /** その年の医療費。通院のぶんと、経費に入れた医療費を合わせる */
  function cost(year) {
    var y = String(year || U.today().slice(0, 4));
    /* 通院に入れた金額は、記録したときに経費へも入れている。
       二重に数えないよう、経費に相手がいるものは通院のほうを数えない */
    var byVisit = 0;
    S.visits().forEach(function (v) {
      if (v.date.slice(0, 4) !== y) return;
      if (v.expenseId && S.getExpense(v.expenseId)) return;   // 経費のほうで数える
      byVisit += Math.max(0, U.num(v.cost, 0));
    });
    var byExpense = 0;
    (S.settings.expenses || []).forEach(function (x) {
      if (x.book !== 'life' || x.category !== MEDICAL_CATEGORY) return;
      if (String(x.date).slice(0, 4) !== y) return;
      byExpense += Math.max(0, U.num(x.amount, 0));
    });
    var total = Math.round(byVisit + byExpense);
    return {
      year: y, total: total, byVisit: Math.round(byVisit), byExpense: Math.round(byExpense),
      deduct: DEDUCT,
      over: Math.max(0, total - DEDUCT),      // 控除の対象になるぶん
      left: Math.max(0, DEDUCT - total)       // 控除に届くまで
    };
  }

  /* ---------------- 健診 ---------------- */

  function checkups() {
    return S.checkups().slice().sort(function (a, b) { return U.cmp(b.date, a.date); });
  }

  /** その数値の推移。古い順 */
  function series(key, o) {
    o = o || {};
    var out = [];
    checkups().forEach(function (c) {
      var v = (c.values || {})[key];
      if (v === undefined || v === null || v === '') return;
      var n = parseFloat(v);
      if (!isFinite(n)) return;
      out.push({ date: c.date, value: n, name: c.name });
    });
    out.sort(function (a, b) { return U.cmp(a.date, b.date); });
    return o.days ? out.slice(-o.days) : out;
  }

  /**
   * 基準の内か外か。
   * @returns {{how:'ok'|'high'|'low', label:string}|null} 基準の無い数値は null
   */
  function judge(key, value) {
    var v = vital(key);
    if (!v || (v.lo === undefined && v.hi === undefined)) return null;
    // 健診の数値は小数を持つので、整数に丸める U.num は使わない
    var n = parseFloat(value);
    if (!isFinite(n)) return null;
    if (v.hi !== undefined && n > v.hi) return { how: 'high', label: '高い' };
    if (v.lo !== undefined && n < v.lo) return { how: 'low', label: '低い' };
    return { how: 'ok', label: 'ふつう' };
  }

  /** 基準の言いかた（「18.5〜25」「85 まで」「40 以上」） */
  function rangeLabel(key) {
    var v = vital(key);
    if (!v) return '';
    if (v.lo !== undefined && v.hi !== undefined) return v.lo + '〜' + v.hi;
    if (v.hi !== undefined) return v.hi + ' まで';
    if (v.lo !== undefined) return v.lo + ' 以上';
    return '';
  }

  /** いちばん新しい健診で、基準から外れていたもの */
  function outliers() {
    var last = checkups()[0];
    if (!last) return [];
    var out = [];
    Object.keys(last.values || {}).forEach(function (k) {
      var j = judge(k, last.values[k]);
      if (j && j.how !== 'ok') {
        out.push({ key: k, label: (vital(k) || {}).label || k,
          value: last.values[k], how: j.how, date: last.date });
      }
    });
    return out;
  }

  /* ---------------- 知らせ ---------------- */

  /** ホームの警告。次の通院が近いときだけ */
  function alerts(date) {
    var today = U.isISO(date) ? date : U.today();
    var nx = nextVisit(today);
    if (!nx) return [];
    var left = U.diffDays(today, nx.date);
    if (left > VISIT_SOON) return [];
    return [{
      level: left <= 1 ? 'warn' : 'info',
      href: '#/body',
      text: (nx.place || '通院') + 'の予約が' + U.untilLabel(nx.date, today)
    }];
  }

  DL.body = {
    SLOTS: SLOTS, VITALS: VITALS, DEDUCT: DEDUCT, VISIT_SOON: VISIT_SOON,
    MEDICAL_CATEGORY: MEDICAL_CATEGORY,
    vital: vital, slot: slot, slotLabel: slotLabel, startOf: startOf,
    meds: meds, onDay: onDay, isTaken: isTaken, take: take,
    dose: dose, progress: progress, keep: keep,
    visits: visits, nextVisit: nextVisit, cost: cost,
    checkups: checkups, series: series, judge: judge, rangeLabel: rangeLabel,
    outliers: outliers, alerts: alerts
  };
})(window.DL);
