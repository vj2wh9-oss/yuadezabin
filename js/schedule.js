/* スケジュール計算：稼働日・ノルマ配分・進捗・自動割り当て */
(function (DL) {
  'use strict';
  var U = DL.util;

  /* 作業しない曜日／日 */
  function offDaysOf(project) {
    var s = DL.store.settings;
    var list = (project && project.offDays) ? project.offDays : (s.offDays || []);
    // 7曜日すべてが休みだと何も割り当てられなくなるので、その場合だけ無視する
    return list.length >= 7 ? [] : list;
  }
  function holidaysOf(project) {
    var s = DL.store.settings;
    return (s.holidays || []).concat((project && project.holidays) || []);
  }
  function isWorkday(project, iso) {
    if (offDaysOf(project).indexOf(U.dow(iso)) >= 0) return false;
    if (holidaysOf(project).indexOf(iso) >= 0) return false;
    return true;
  }

  // 期間内の稼働日一覧。全部が休みなら空を返す（勝手に休みへ割り当てない）
  function workdays(project, from, to) {
    return U.rangeDays(from, to).filter(function (d) { return isWorkday(project, d); });
  }

  /* 数量 qty を n 日に均等配分（合計は必ず qty と一致） */
  function distribute(qty, n) {
    var out = [];
    if (n <= 0) return out;
    qty = Math.max(0, Math.round(qty || 0));
    for (var i = 0; i < n; i++) {
      out.push(Math.floor((i + 1) * qty / n) - Math.floor(i * qty / n));
    }
    return out;
  }

  /**
   * タスクの1日ごとのノルマを算出する。
   * 手動調整（planOverride）がある日はその値を固定し、残量を残りの稼働日に配分する。
   * 戻り値: { days:[{date,qty,fixed}], byDate:{date:qty}, total, dayCount }
   */
  function taskPlan(project, task) {
    var empty = { days: [], byDate: {}, rangeByDate: {}, total: 0, dayCount: 0 };
    if (!U.isISO(task.start) || !U.isISO(task.end)) return empty;
    if (U.cmp(task.start, task.end) > 0) return empty;

    var days = workdays(project, task.start, task.end);
    if (!days.length) return empty;      // 期間内がすべて休み
    var byDate = {}, out = [];

    if (task.unit === 'none' || task.qty === null || task.qty === undefined) {
      days.forEach(function (d) { out.push({ date: d, qty: 0, fixed: false }); byDate[d] = 0; });
      return { days: out, byDate: byDate, rangeByDate: {}, total: 0, dayCount: days.length };
    }

    var ov = task.planOverride || {};
    var fixedDays = days.filter(function (d) { return ov[d] !== undefined; });
    var freeDays = days.filter(function (d) { return ov[d] === undefined; });
    var fixedTotal = U.sum(fixedDays, function (d) { return U.num(ov[d], 0); });
    var rest = Math.max(0, U.num(task.qty, 0) - fixedTotal);
    var spread = distribute(rest, freeDays.length);

    var i = 0, acc = 0;
    var rangeByDate = {};
    days.forEach(function (d) {
      var q = (ov[d] !== undefined) ? U.num(ov[d], 0) : spread[i++];
      byDate[d] = q;
      // その日に進める範囲（通し番号）。例：5〜8ページ目
      var from = q > 0 ? acc + 1 : null;
      var to = q > 0 ? acc + q : null;
      acc += q;
      rangeByDate[d] = { from: from, to: to };
      out.push({ date: d, qty: q, fixed: ov[d] !== undefined, from: from, to: to });
    });
    return {
      days: out, byDate: byDate, rangeByDate: rangeByDate,
      total: U.sum(out, function (x) { return x.qty; }), dayCount: days.length
    };
  }

  /* 「5〜8P」のような範囲の表示 */
  var UNIT_RANGE = { page: 'P', cut: '枚目', item: '点目', none: '' };
  function rangeText(task, from, to, opts) {
    opts = opts || {};
    if (!from || !to) return '';
    var u = opts.noUnit ? '' : (UNIT_RANGE[task.unit] || '');
    var sep = opts.sep || '〜';
    return from === to ? from + u : from + sep + to + u;
  }

  function taskDone(task) {
    return U.sum(Object.keys(task.progress || {}), function (k) { return U.num(task.progress[k], 0); });
  }

  function taskTotal(task) {
    return (task.unit === 'none' || task.qty === null) ? 0 : U.num(task.qty, 0);
  }

  function taskPct(task) {
    if (task.done) return 100;
    var tot = taskTotal(task);
    if (!tot) return 0;
    return Math.min(100, Math.round(taskDone(task) / tot * 100));
  }

  function taskIsComplete(task) {
    if (task.done) return true;
    var tot = taskTotal(task);
    return tot > 0 && taskDone(task) >= tot;
  }

  /**
   * 進み具合の評価（今日基準）
   * behind: 昨日までに終えているべき量に対する不足
   * perDay: 残りを残り稼働日で割った「これから必要な1日あたりの量」
   */
  function taskPace(project, task, today) {
    today = today || U.today();
    var plan = taskPlan(project, task);
    var total = taskTotal(task);
    var done = taskDone(task);
    var remaining = Math.max(0, total - done);

    var shouldBeDone = U.sum(plan.days.filter(function (d) { return U.cmp(d.date, today) < 0; }), function (d) { return d.qty; });
    var behind = Math.max(0, shouldBeDone - done);

    var left = plan.days.filter(function (d) { return U.cmp(d.date, today) >= 0; });
    var perDay = left.length ? Math.ceil(remaining / left.length) : remaining;

    return {
      plan: plan, total: total, done: done, remaining: remaining,
      behind: behind, remainingDays: left.length, perDay: perDay,
      overdue: U.isISO(task.end) && U.cmp(task.end, today) < 0 && remaining > 0 && !task.done,
      todayQty: plan.byDate[today] || 0
    };
  }

  /* プロジェクト全体の進捗（タスクの重み付き平均） */
  function projectProgress(project) {
    var tasks = project.tasks || [];
    if (!tasks.length) return { pct: 0, doneTasks: 0, total: 0 };
    var wsum = 0, acc = 0, doneTasks = 0;
    tasks.forEach(function (t) {
      var w = U.num(t.weight, 1) || 1;
      wsum += w;
      acc += w * (taskIsComplete(t) ? 100 : taskPct(t));
      if (taskIsComplete(t)) doneTasks++;
    });
    return { pct: wsum ? Math.round(acc / wsum) : 0, doneTasks: doneTasks, total: tasks.length };
  }

  /* 締切の状態 */
  function projectStatus(project, today) {
    today = today || U.today();
    if (project.status === 'done') return 'done';
    if (project.status === 'archived') return 'archived';
    if (!U.isISO(project.deadline)) return 'nodate';
    var d = U.diffDays(today, project.deadline);
    if (d < 0) return 'overdue';
    if (d <= 3) return 'urgent';
    if (d <= (DL.store.settings.warnDays || 14)) return 'soon';
    return 'ok';
  }

  /* 種別ごとの「締切」の呼び名 */
  var DEADLINE_LABEL = { event: '入稿締切', work: '納品日', support: '公開日' };
  var DEADLINE_SHORT = { event: '入稿', work: '納品', support: '公開' };
  function deadlineLabel(p) { return DEADLINE_LABEL[p.kind] || '締切'; }
  function deadlineShort(p) { return DEADLINE_SHORT[p.kind] || '締切'; }

  var STATUS_LABEL = {
    overdue: '締切超過', urgent: '直前', soon: '締切間近', ok: '進行中',
    done: '完了', archived: '保管', nodate: '日付未設定'
  };

  /* ある日のノルマ一覧 */
  function dayEntries(date, opts) {
    opts = opts || {};
    var out = [];
    DL.store.scopedProjects().forEach(function (p) {
      if (p.status === 'archived') return;
      if (p.status === 'done' && !opts.includeDone) return;
      (p.tasks || []).forEach(function (t) {
        var plan = taskPlan(p, t);
        if (plan.byDate[date] === undefined) return;
        var rg = plan.rangeByDate[date] || {};
        out.push({
          project: p, task: t,
          qty: plan.byDate[date],
          from: rg.from, to: rg.to,
          done: U.num((t.progress || {})[date], 0),
          isFirst: plan.days.length && plan.days[0].date === date,
          isLast: plan.days.length && plan.days[plan.days.length - 1].date === date
        });
      });
    });
    return out;
  }

  /* ある日のイベント／締切 */
  function dayMarks(date) {
    var marks = [];
    DL.store.scopedProjects().forEach(function (p) {
      if (p.status === 'archived') return;
      if (p.kind === 'event' && p.eventDate === date) {
        marks.push({ type: 'event', project: p, label: p.eventName || p.title });
      }
      if (p.deadline === date) {
        marks.push({ type: 'deadline', project: p, label: deadlineShort(p) + '：' + p.title });
      }
      (p.printings || []).forEach(function (pr) {
        if (pr.due === date && !(pr.primary && p.deadline === date)) {
          marks.push({ type: 'printing', project: p, label: (pr.label || '入稿') + '：' + p.title });
        }
      });
    });
    return marks;
  }

  /* 今後の締切（イベント・入稿・納品をまとめて時系列に） */
  function timeline(fromDate, days) {
    var from = fromDate || U.today();
    var to = U.addDays(from, days || 120);
    var out = [];
    DL.store.scopedProjects().forEach(function (p) {
      if (p.status === 'archived') return;
      function push(type, date, label) {
        if (!U.isISO(date)) return;
        if (U.cmp(date, from) < 0 || U.cmp(date, to) > 0) return;
        out.push({ type: type, date: date, project: p, label: label });
      }
      push('deadline', p.deadline, deadlineLabel(p));
      if (p.kind === 'event') push('event', p.eventDate, 'イベント当日');
      (p.printings || []).forEach(function (pr) {
        if (pr.due !== p.deadline) push('printing', pr.due, (pr.label || 'プラン') + '締切');
      });
    });
    out.sort(function (a, b) { return U.cmp(a.date, b.date); });
    return out;
  }

  /* 警告の一覧 */
  function alerts(today) {
    today = today || U.today();
    var out = [];

    // バックアップ忘れ
    var age = DL.store.backupAgeDays();
    if (DL.store.projects().length && (age === null || age >= 14)) {
      out.push({
        level: 'info', backup: true,
        text: age === null ? 'バックアップをまだ書き出していません' : '最後のバックアップから ' + age + '日 経ちました'
      });
    }

    // 1日の作業量が上限を超える日
    overloadedDays(today, 14).slice(0, 2).forEach(function (d) {
      out.push({
        level: 'warn', date: d.date,
        text: U.fmtMD(d.date) + ' は合計 ' + d.qty + '（上限 ' + d.limit + '）を超えています'
      });
    });

    DL.store.scopedProjects().forEach(function (p) {
      if (p.status !== 'active') return;
      var st = projectStatus(p, today);
      if (st === 'overdue') {
        out.push({ level: 'danger', project: p, text: '締切を ' + Math.abs(U.diffDays(today, p.deadline)) + '日 過ぎています' });
      } else if (st === 'urgent') {
        out.push({ level: 'warn', project: p, text: '締切まで ' + U.diffDays(today, p.deadline) + '日' });
      }
      (p.tasks || []).forEach(function (t) {
        if (taskIsComplete(t)) return;
        if (!U.isISO(t.start)) {
          out.push({ level: 'info', project: p, task: t, text: t.name + ' の期間が未設定です' });
          return;
        }
        var pace = taskPace(p, t, today);
        if (U.isISO(t.end) && !pace.plan.dayCount) {
          out.push({ level: 'danger', project: p, task: t, text: t.name + ' の期間内がすべて休みです' });
          return;
        }
        if (pace.overdue) {
          out.push({ level: 'danger', project: p, task: t, text: t.name + ' が期間を過ぎています（残り ' + pace.remaining + unit(t) + '）' });
        } else if (pace.behind > 0) {
          out.push({ level: 'warn', project: p, task: t, text: t.name + ' が ' + pace.behind + unit(t) + ' 遅れています' });
        }
      });
    });

    out = out.concat(moneyAlerts(today));

    // 重い順に並べる（ホームは先頭数件しか出さないため）。同じ重さなら元の順を保つ
    var ORDER = ['danger', 'warn', 'info'];
    function rank(level) {
      var i = ORDER.indexOf(level);
      return i < 0 ? ORDER.length : i;
    }
    return out.map(function (a, i) { return { a: a, i: i }; })
      .sort(function (x, y) {
        var d = rank(x.a.level) - rank(y.a.level);
        return d !== 0 ? d : x.i - y.i;
      })
      .map(function (x) { return x.a; });
  }

  /**
   * お金まわりの取りこぼし。
   *  - 納品が済んだのに請求書を作っていない仕事
   *  - 発行済みのまま支払期限を過ぎている請求書
   */
  function moneyAlerts(today) {
    today = today || U.today();
    var out = [];
    var yen = DL.docs ? DL.docs.yen : function (n) { return '¥' + n; };

    DL.store.scopedProjects().forEach(function (p) {
      if (p.status === 'archived') return;
      var docs = p.docs || [];

      // 請求漏れ：納品日を過ぎた仕事に請求書が1枚も無い
      if (p.kind === 'work' && U.isISO(p.deadline) && U.cmp(p.deadline, today) < 0) {
        var hasInvoice = docs.some(function (d) { return d.type === 'invoice'; });
        if (!hasInvoice) {
          out.push({
            level: 'warn', project: p, href: '#/docs/' + p.id,
            text: '納品日から ' + Math.abs(U.diffDays(today, p.deadline)) + '日、請求書がまだありません'
          });
        }
      }

      // 入金漏れ：発行済みのまま支払期限を過ぎている請求書
      docs.forEach(function (d) {
        if (d.type !== 'invoice' || d.status !== 'issued') return;
        if (!U.isISO(d.dueDate) || U.cmp(d.dueDate, today) >= 0) return;
        var amount = DL.docs ? DL.docs.calc(d).payable : 0;
        out.push({
          level: 'danger', project: p, href: '#/doc/' + p.id + '/' + d.id,
          text: '入金予定日を ' + Math.abs(U.diffDays(today, d.dueDate)) + '日 過ぎています（' + yen(amount) + '）'
        });
      });
    });
    return out;
  }

  function unit(task) { return DL.store.UNIT_LABEL[task.unit] || ''; }

  /**
   * タスクの期間を自動割り当てする。
   * 重み（weight）に応じて稼働日を配分し、順番に連続した期間を割り当てる。
   */
  function autoSchedule(project, opts) {
    opts = opts || {};
    var start = opts.start || U.today();
    var end = opts.end || project.deadline;
    if (!U.isISO(start) || !U.isISO(end)) return { ok: false, reason: '開始日と締切日が必要です' };
    if (U.num(opts.buffer, 0) > 0) end = U.addDays(end, -U.num(opts.buffer, 0));
    if (U.cmp(start, end) > 0) return { ok: false, reason: '期間が足りません（開始日が締切を過ぎています）' };

    var only = opts.only || (opts.onlyEmpty ? 'empty' : 'all');
    var targets = (project.tasks || []).filter(function (t) {
      if (only === 'empty') return !U.isISO(t.start) || !U.isISO(t.end);
      if (only === 'incomplete') return !taskIsComplete(t);
      return true;
    });
    if (!targets.length) return { ok: false, reason: '対象のタスクがありません' };

    var days = workdays(project, start, end);
    var n = days.length;
    if (!n) return { ok: false, reason: '期間内に作業できる日がありません（休みの設定を見直してください）' };

    if (n < targets.length) {
      // 日数がタスク数より少ない場合は1日ずつ（最終日に寄せる）
      targets.forEach(function (t, i) {
        var d = days[Math.min(i, n - 1)];
        t.start = d; t.end = d; t.planOverride = {};
      });
      DL.store.save();
      return { ok: true, tight: true };
    }

    var weights = targets.map(function (t) { return Math.max(1, U.num(t.weight, 1)); });
    var totalW = U.sum(weights);
    var raw = weights.map(function (w) { return w / totalW * n; });
    var counts = raw.map(function (r) { return Math.max(1, Math.floor(r)); });
    var used = U.sum(counts);

    // 余りを小数部の大きい順に配る／不足なら大きいものから削る
    var order = raw.map(function (r, i) { return { i: i, frac: r - Math.floor(r) }; })
      .sort(function (a, b) { return b.frac - a.frac; });
    var k = 0;
    while (used < n) { counts[order[k % order.length].i]++; used++; k++; }
    k = 0;
    while (used > n) {
      var idx = order[order.length - 1 - (k % order.length)].i;
      if (counts[idx] > 1) { counts[idx]--; used--; }
      k++;
      if (k > 1000) break;
    }

    var pos = 0;
    targets.forEach(function (t, i) {
      t.start = days[pos];
      t.end = days[Math.min(n - 1, pos + counts[i] - 1)];
      t.planOverride = {};
      pos += counts[i];
    });
    DL.store.save();
    return { ok: true };
  }

  /**
   * 実績から自分の作業ペースを出す。
   * 「作業した日」だけを母数にするので、休んだ日で薄まらない。
   */
  function actualPace(days, today) {
    today = today || U.today();
    var from = U.addDays(today, -(days || 60));
    var byDate = {};
    DL.store.scopedProjects().forEach(function (p) {
      (p.tasks || []).forEach(function (t) {
        Object.keys(t.progress || {}).forEach(function (d) {
          if (U.cmp(d, from) < 0 || U.cmp(d, today) > 0) return;
          byDate[d] = (byDate[d] || 0) + U.num(t.progress[d], 0);
        });
      });
    });
    var dates = Object.keys(byDate);
    var total = U.sum(dates, function (d) { return byDate[d]; });
    var best = dates.length ? Math.max.apply(null, dates.map(function (d) { return byDate[d]; })) : 0;
    return {
      total: total, activeDays: dates.length, best: best,
      perActiveDay: dates.length ? Math.round(total / dates.length * 10) / 10 : 0,
      spanDays: days || 60
    };
  }

  /* 1日の上限を超えている日か */
  function isOverloaded(date) {
    var limit = U.num(DL.store.settings.dailyLimit, 0);
    if (limit <= 0) return false;
    return loadOfDay(date).qty > limit;
  }

  /* これから上限を超える日（ホームの警告用） */
  function overloadedDays(today, days) {
    var limit = U.num(DL.store.settings.dailyLimit, 0);
    var out = [];
    if (limit <= 0) return out;
    for (var i = 0; i < (days || 14); i++) {
      var d = U.addDays(today || U.today(), i);
      var q = loadOfDay(d).qty;
      if (q > limit) out.push({ date: d, qty: q, limit: limit });
    }
    return out;
  }

  /**
   * その日にできなかった分を、翌日以降へ回す。
   * 過ぎた日と対象日は実績どおりに固定し、残量を残りの稼働日へ配分し直す。
   */
  function deferDay(project, task, date) {
    var plan = taskPlan(project, task);
    var idx = plan.days.findIndex(function (d) { return d.date === date; });
    if (idx < 0) return { ok: false, reason: 'この日はこのタスクの期間に入っていません' };
    if (idx === plan.days.length - 1) {
      return { ok: false, reason: '最終日なので、期間を延ばすか締切を見直してください' };
    }
    plan.days.slice(0, idx + 1).forEach(function (d) {
      task.planOverride[d.date] = U.num(task.progress[d.date], 0);
    });
    DL.store.save();
    var after = taskPlan(project, task);
    var next = after.days[idx + 1] || {};
    return { ok: true, nextDate: next.date, nextQty: next.qty };
  }

  /**
   * 未完了の工程を「今日（または作業開始日）〜締切」の稼働日へ割り振り直す。
   * 休みを増やしてタスクの枠内に収まらなくなったときに使う。
   */
  function rescheduleRemaining(project, today) {
    today = today || U.today();
    var from = U.maxDate(today, U.isISO(project.startDate) ? project.startDate : today);
    var to = project.deadline;
    if (!U.isISO(to)) return { ok: false, reason: '締切が未設定です' };
    if (U.cmp(from, to) > 0) return { ok: false, reason: '締切を過ぎているため組み直せません' };
    return autoSchedule(project, { start: from, end: to, only: 'incomplete' });
  }

  /* 今日／指定期間のノルマ合計 */
  function loadOfDay(date) {
    var entries = dayEntries(date);
    return {
      entries: entries,
      qty: U.sum(entries, function (e) { return e.qty; }),
      done: U.sum(entries, function (e) { return e.done; })
    };
  }

  /* iPhone のカレンダーに取り込むための ICS を生成 */
  var ICS_ALARMS = [
    { value: '', label: 'なし' },
    { value: 'PT0S', label: '前日の9時' },
    { value: 'P1D', label: '1日前の9時' },
    { value: 'P3D', label: '3日前の9時' },
    { value: 'P7D', label: '1週間前の9時' }
  ];

  function buildICS(opts) {
    opts = opts || {};
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shimekiri-calendar//JP', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:締切カレンダー'];
    function esc(s) { return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }
    function dt(iso) { return iso.replace(/-/g, ''); }
    // 終日予定なので、通知は「何日前の朝9時」という形にする
    var ALARMS = {
      'PT0S': { trigger: '-PT15H', label: '前日の9時' },
      'P1D': { trigger: '-P1DT15H', label: '1日前の9時' },
      'P3D': { trigger: '-P3DT15H', label: '3日前の9時' },
      'P7D': { trigger: '-P7DT15H', label: '1週間前の9時' }
    };
    var alarm = (opts.alarm === undefined) ? DL.store.settings.icsAlarm : opts.alarm;
    var al = ALARMS[alarm];

    function ev(uid, date, title, desc, withAlarm) {
      lines.push('BEGIN:VEVENT', 'UID:' + uid + '@shimekiri', 'DTSTAMP:' + dt(U.today()) + 'T000000Z',
        'DTSTART;VALUE=DATE:' + dt(date), 'DTEND;VALUE=DATE:' + dt(U.addDays(date, 1)),
        'SUMMARY:' + esc(title), 'DESCRIPTION:' + esc(desc || ''));
      if (al && withAlarm !== false) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title),
          'TRIGGER;VALUE=DURATION:' + al.trigger, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    }
    DL.store.scopedProjects().forEach(function (p) {
      if (p.status === 'archived') return;
      if (p.kind === 'event' && U.isISO(p.eventDate)) ev(p.id + '-event', p.eventDate, '[イベント] ' + (p.eventName || p.title), p.venue || '');
      if (U.isISO(p.deadline)) ev(p.id + '-dl', p.deadline, '[' + deadlineShort(p) + '] ' + p.title, p.memo || '');
      (p.printings || []).forEach(function (pr, i) {
        if (U.isISO(pr.due) && pr.due !== p.deadline) ev(p.id + '-pr' + i, pr.due, '[' + (pr.label || '入稿') + '] ' + p.title, pr.printer || '');
      });
      if (opts.withTasks) {
        (p.tasks || []).forEach(function (t) {
          var plan = taskPlan(p, t);
          plan.days.forEach(function (d) {
            if (!d.qty) return;
            var rt = rangeText(t, d.from, d.to);
            ev(p.id + '-' + t.id + '-' + d.date, d.date,
              '[作業] ' + p.title + '：' + t.name + (rt ? ' ' + rt : ''), '', false);
          });
        });
      }
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  DL.schedule = {
    isWorkday: isWorkday, workdays: workdays, distribute: distribute,
    taskPlan: taskPlan, taskDone: taskDone, taskTotal: taskTotal, taskPct: taskPct,
    rangeText: rangeText, UNIT_RANGE: UNIT_RANGE,
    taskIsComplete: taskIsComplete, taskPace: taskPace, unit: unit,
    projectProgress: projectProgress, projectStatus: projectStatus, STATUS_LABEL: STATUS_LABEL,
    deadlineLabel: deadlineLabel, deadlineShort: deadlineShort,
    dayEntries: dayEntries, dayMarks: dayMarks, timeline: timeline,
    alerts: alerts, moneyAlerts: moneyAlerts,
    actualPace: actualPace, isOverloaded: isOverloaded, overloadedDays: overloadedDays,
    deferDay: deferDay, rescheduleRemaining: rescheduleRemaining,
    autoSchedule: autoSchedule, loadOfDay: loadOfDay, buildICS: buildICS, ICS_ALARMS: ICS_ALARMS
  };
})(window.DL);
