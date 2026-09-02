/* 1日の記録：その日に起きたことを、あちこちのデータから集めてくる。
   ここは集めるだけで、新しく持つのは本文と気分だけ（store の logs）。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store, sc = DL.schedule;

  /**
   * その日ぶんをまとめる。
   * 名義の絞り込みは効かせない（記録は全部そろっていてほしいため）。
   * @param {string} date 'YYYY-MM-DD'
   */
  function of(date) {
    date = U.isISO(date) ? date : U.today();
    var log = S.getLog(date) || {};
    return {
      date: date,
      log: log,
      weather: weatherOf(date, log),
      duty: S.duty(date),
      holiday: (S.settings.holidays || []).indexOf(date) >= 0,
      stayHoliday: S.isStayHoliday(date),
      marks: sc.dayMarks(date),
      works: works(date),
      plans: plans(date),
      money: money(date),
      stock: stock(date),
      docs: docs(date)
    };
  }

  /* 天気。記録に写してあればそれを、無ければいま持っている予報から */
  function weatherOf(date, log) {
    if (log && log.weather) return log.weather;
    return (DL.weather && DL.weather.noonOf(date)) || null;
  }

  /**
   * その日の正午の天気を、記録に写しておく。
   * 過去の天気はあとから引けないので、その日のうちに残す。
   * 今日ぶんは開くたびに写し直す（朝は予報、夕方には実績に近づくため）。
   */
  function keepWeather(date) {
    date = U.isISO(date) ? date : U.today();
    if (date !== U.today()) return null;       // 過ぎた日は上書きしない
    var w = DL.weather && DL.weather.noonOf(date);
    if (!w) return null;
    var had = (S.getLog(date) || {}).weather;
    if (had && had.code === w.code && had.max === w.max && had.min === w.min) return had;
    S.setLog(date, { weather: w }, { quiet: true });    // 天気の写しで「変更あり」にしない
    return w;
  }

  /**
   * その日に進めた作業。
   * 予定に入っていた日はもちろん、前倒しで進めた日も拾う。
   */
  function works(date) {
    var out = [];
    S.projects().forEach(function (p) {
      if (p.status === 'archived') return;
      (p.tasks || []).forEach(function (t) {
        var plan = sc.taskPlan(p, t);
        var qty = plan.byDate[date];
        var done = U.num((t.progress || {})[date], 0);
        if (qty === undefined && !done) return;      // その日と関わりがない
        var rg = plan.rangeByDate[date] || {};
        out.push({
          project: p, task: t,
          qty: qty === undefined ? 0 : qty,
          done: done,
          from: rg.from, to: rg.to,
          planned: qty !== undefined,
          unit: sc.unit(t)
        });
      });
    });
    return out.sort(function (a, b) { return (b.done - a.done) || (b.qty - a.qty); });
  }

  function plans(date) {
    return (DL.events.ofDay(date) || []).map(function (o) {
      return { occurrence: o, ev: o.ev, done: DL.events.isDone(o) };
    });
  }

  /* お金。経費（事業・日常）と、その日に動いた書類 */
  function money(date) {
    var ex = S.expenses().filter(function (x) { return x.date === date; });
    var work = ex.filter(function (x) { return x.book !== 'life'; });
    var life = ex.filter(function (x) { return x.book === 'life'; });
    return {
      expenses: ex,
      workTotal: U.sum(work, function (x) { return U.num(x.amount, 0); }),
      lifeTotal: U.sum(life, function (x) { return U.num(x.amount, 0); })
    };
  }

  /* その日に出した書類と、その日が入金予定日の請求書 */
  function docs(date) {
    var out = [];
    S.projects().forEach(function (p) {
      (p.docs || []).forEach(function (d) {
        if (d.issueDate === date) out.push({ project: p, doc: d, kind: 'issued' });
        else if (d.type === 'invoice' && d.dueDate === date) out.push({ project: p, doc: d, kind: 'due' });
      });
    });
    return out;
  }

  /* 頒布・入庫などの出入り */
  function stock(date) {
    return S.stockMoves().filter(function (m) { return m.date === date; }).map(function (m) {
      return { move: m, item: S.getItem(m.itemId), def: DL.stock.moveDef(m.kind) };
    });
  }

  /* その日に何かあったか（記録として残す値があるか） */
  function has(d) {
    return !!(d.log.text || d.log.mood || (d.log.ideas || []).length
      || d.duty || d.works.length || d.plans.length
      || d.money.expenses.length || d.stock.length || d.docs.length || d.marks.length);
  }

  /* 一覧に出す一行ぶんの要約 */
  function summary(d) {
    var parts = [];
    var pages = U.sum(d.works, function (w) { return w.done; });
    if (pages) parts.push('進み ' + pages);
    if ((d.log.ideas || []).length) parts.push('ひらめき ' + d.log.ideas.length + '件');
    if (d.plans.length) parts.push('予定 ' + d.plans.length + '件');
    if (d.money.expenses.length) parts.push('経費 ' + d.money.expenses.length + '件');
    var sold = U.sum(d.stock.filter(function (x) { return x.move.kind === 'sale'; }),
      function (x) { return x.move.qty; });
    if (sold) parts.push('頒布 ' + sold + '部');
    if (d.docs.length) parts.push('書類 ' + d.docs.length + '件');
    return parts.join('　');
  }

  DL.daylog = { of: of, has: has, summary: summary, keepWeather: keepWeather };
})(window.DL);
