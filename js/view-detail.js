/* 案件の詳細 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  var expanded = {};   // タスクIDごとの開閉状態

  function render(root, params) {
    var p = S.getProject(params.id);
    var today = U.today();
    if (!p) {
      root.appendChild(ui.empty('案件が見つかりません。', ui.btn('一覧へ', 'primary', function () { location.hash = '#/projects'; })));
      return;
    }
    var wrap = el('div', { class: 'page' });
    var unit = p.category === 'manga' ? 'P' : '枚';
    var prog = sc.projectProgress(p);
    var st = sc.projectStatus(p, today);

    /* ---- ヘッダー ---- */
    wrap.appendChild(el('div', { class: 'phead st-' + st, style: { '--pc': p.color } }, [
      el('div', { class: 'phead-top' }, [
        el('h2', { class: 'phead-title', text: p.title }),
        el('button', { class: 'iconbtn', 'aria-label': '編集', onclick: function () { DL.forms.projectForm(p); } }, ui.icon('edit', 19))
      ]),
      el('div', { class: 'row-sub' }, [
        ui.kindChip(p), ui.catChip(p),
        p.qty ? ui.chip(p.qty + unit, 'ghosty') : null,
        p.status !== 'active' ? ui.chip(sc.STATUS_LABEL[p.status] || p.status, 'ok') : null
      ]),
      el('div', { class: 'countdown' }, [
        el('div', { class: 'cd-main' }, [
          el('span', { class: 'cd-label', text: sc.deadlineLabel(p) }),
          el('b', { text: U.fmtYMDW(p.deadline) })
        ]),
        el('div', { class: 'cd-left ' + st, text: U.untilLabel(p.deadline, today) })
      ]),
      el('button', {
        class: 'workspan', onclick: function () { DL.forms.startDateSheet(p.id); }
      }, [
        el('span', { class: 'cd-label', text: '作業開始日' }),
        el('span', { class: 'workspan-main' }, [
          el('b', { text: U.isISO(p.startDate) ? U.fmtMDW(p.startDate) : '未設定' }),
          el('span', { class: 'muted', text: ' → ' + U.fmtMD(p.deadline) }),
          U.isISO(p.startDate) && U.isISO(p.deadline) && U.cmp(p.startDate, p.deadline) <= 0
            ? ui.chip('稼働' + sc.workdays(p, p.startDate, p.deadline).length + '日', 'ghosty')
            : null
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]),
      el('div', { class: 'phead-prog' }, [
        ui.progress(prog.pct, p.color),
        el('span', { class: 'pct', text: prog.pct + '%' })
      ])
    ]));

    /* ---- 基本情報 ---- */
    var info = [];
    if (p.kind === 'event') {
      if (p.eventName) info.push(['イベント', p.eventName]);
      if (U.isISO(p.eventDate)) info.push(['開催日', U.fmtYMDW(p.eventDate) + '（' + U.untilLabel(p.eventDate, today) + '）']);
      if (p.venue) info.push(['会場', p.venue]);
      if (p.space) info.push(['スペース', p.space]);
    } else if (p.kind === 'support') {
      if (p.site) info.push(['サイト', p.site]);
      if (p.plan) info.push(['プラン', p.plan]);
    } else {
      if (p.client) info.push(['クライアント', p.client]);
      if (p.fee) info.push(['報酬', '¥' + Number(p.fee).toLocaleString('ja-JP')]);
    }
    if (p.memo) info.push(['メモ', p.memo]);
    if (info.length) {
      wrap.appendChild(el('div', { class: 'card info' }, info.map(function (r) {
        return el('div', { class: 'info-row' }, [el('span', { class: 'info-k', text: r[0] }), el('span', { class: 'info-v', text: r[1] })]);
      })));
    }

    /* ---- 印刷所プラン ---- */
    if (p.kind === 'event' && (p.printings || []).length) {
      wrap.appendChild(ui.section('印刷所の締切'));
      var pl = el('div', { class: 'list' });
      p.printings.slice().sort(function (a, b) { return U.cmp(a.due || '9999', b.due || '9999'); }).forEach(function (pr) {
        var left = U.isISO(pr.due) ? U.diffDays(today, pr.due) : null;
        pl.appendChild(el('div', { class: 'row plan' + (pr.primary ? ' is-primary' : '') }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              ui.icon('printer', 16), el('span', { text: pr.label || 'プラン' }),
              pr.primary ? ui.chip('メイン', 'ok') : null
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip(U.fmtMDW(pr.due), left !== null && left < 0 ? 'danger' : 'soft'),
              left !== null ? ui.chip(U.untilLabel(pr.due, today), 'ghosty') : null,
              pr.printer ? ui.chip(pr.printer, 'ghosty') : null,
              pr.copies ? ui.chip(pr.copies + '部', 'ghosty') : null
            ])
          ]),
          pr.primary ? null : el('button', {
            class: 'btn tiny ghost', text: 'これに変更',
            onclick: function () {
              p.printings.forEach(function (x) { x.primary = false; });
              pr.primary = true;
              S.updateProject(p.id, { deadline: pr.due, printings: p.printings });
              ui.toast('メイン締切を ' + U.fmtMD(pr.due) + ' に変更しました');
            }
          })
        ]));
      });
      wrap.appendChild(pl);
    }

    /* ---- ガント ---- */
    var scheduled = (p.tasks || []).filter(function (t) { return U.isISO(t.start) && U.isISO(t.end); });
    if (scheduled.length) {
      wrap.appendChild(ui.section('スケジュール'));
      wrap.appendChild(gantt(p, scheduled, today));
    }

    /* ---- タスク ---- */
    wrap.appendChild(ui.section('タスク', el('span', { class: 'muted small', text: prog.doneTasks + ' / ' + prog.total + ' 完了' })));
    if (!(p.tasks || []).length) {
      wrap.appendChild(ui.empty('タスクがありません。', ui.btn('基本タスクを追加', 'primary', function () { DL.forms.templateSheet(p.id); })));
    } else {
      var tl = el('div', { class: 'list' });
      p.tasks.forEach(function (t, i) { tl.appendChild(taskRow(p, t, i, today)); });
      wrap.appendChild(tl);
    }

    /* ---- 操作 ---- */
    wrap.appendChild(el('div', { class: 'actions' }, [
      ui.btn('タスクを追加', 'ghost', function () { DL.forms.taskForm(p.id); }, 'plus'),
      ui.btn('基本タスクを追加', 'ghost', function () { DL.forms.templateSheet(p.id); }, 'task'),
      ui.btn('自動スケジュール', 'primary', function () { DL.forms.autoScheduleSheet(p.id); }, 'refresh'),
      ui.btn('未完了の工程を今日から組み直す', 'ghost', function () {
        ui.confirm('未完了の工程を、今日から締切までの稼働日に割り振り直します。完了済みの工程はそのままです。', { okText: '組み直す' })
          .then(function (ok) {
            if (!ok) return;
            var r = sc.rescheduleRemaining(p);
            ui.toast(r.ok ? '組み直しました' : r.reason, r.ok ? '' : 'warn');
          });
      }, 'arrowRight'),
      ui.btn(p.status === 'done' ? '進行中に戻す' : '案件を完了にする', 'ghost', function () {
        S.updateProject(p.id, { status: p.status === 'done' ? 'active' : 'done' });
        ui.toast(p.status === 'done' ? '完了にしました' : '進行中に戻しました');
      }),
      ui.btn(p.status === 'archived' ? '保管を解除' : '保管する（一覧から隠す）', 'ghost', function () {
        S.updateProject(p.id, { status: p.status === 'archived' ? 'active' : 'archived' });
        ui.toast('変更しました');
      }),
      ui.btn('案件を削除', 'danger', function () {
        ui.confirm('「' + p.title + '」を削除します。元に戻せません。', { danger: true, okText: '削除' }).then(function (ok) {
          if (!ok) return;
          S.removeProject(p.id);
          location.hash = '#/projects';
          ui.toast('削除しました');
        });
      }, 'trash')
    ]));

    root.appendChild(wrap);
  }

  /* ---------------- タスク行 ---------------- */

  function taskRow(p, t, index, today) {
    var unit = sc.unit(t);
    var pace = sc.taskPace(p, t, today);
    var complete = sc.taskIsComplete(t);
    var pct = complete ? 100 : sc.taskPct(t);
    var open = !!expanded[t.id];

    var chips = [];
    if (U.isISO(t.start)) chips.push(ui.chip(U.fmtMD(t.start) + '〜' + U.fmtMD(t.end), 'soft'));
    else chips.push(ui.chip('期間未設定', 'warn'));
    if (t.unit !== 'none') chips.push(ui.chip(pace.done + '/' + pace.total + unit, complete ? 'ok' : 'ghosty'));
    if (pace.plan.dayCount) chips.push(ui.chip(pace.plan.dayCount + '日', 'ghosty'));
    else if (U.isISO(t.start)) chips.push(ui.chip('期間内がすべて休み', 'danger'));
    if (!complete && pace.behind > 0) chips.push(ui.chip('遅れ' + pace.behind + unit, 'danger'));
    if (!complete && pace.overdue) chips.push(ui.chip('期間超過', 'danger'));
    if (!complete && pace.remainingDays > 0 && t.unit !== 'none') {
      var real = sc.actualPace(60, today);
      // 必要ペースが実績の平均を上回っていたら強めに出す
      var tough = real.activeDays >= 3 && pace.perDay > real.perActiveDay;
      chips.push(ui.chip('要' + pace.perDay + unit + '/日', tough ? 'danger' : 'warn'));
      if (tough) chips.push(ui.chip('実績平均 ' + real.perActiveDay + '/日', 'ghosty'));
    }

    var head = el('div', { class: 'row-main', onclick: function () { expanded[t.id] = !open; DL.app.render(); } }, [
      el('div', { class: 'row-title' }, [
        el('span', { class: 'tnum', text: String(index + 1) }),
        el('span', { text: t.name }),
        complete ? ui.chip('完了', 'ok') : null
      ]),
      el('div', { class: 'row-sub' }, chips),
      ui.progress(pct, p.color)
    ]);

    var row = el('div', { class: 'row task' + (complete ? ' is-done' : '') }, [
      el('div', { class: 'row-bar', style: { background: p.color } }),
      head,
      el('span', { class: 'chev' }, ui.icon(open ? 'chevronDown' : 'chevronRight', 16))
    ]);

    if (!open) return row;

    /* 展開部：日別ノルマと操作 */
    var detail = el('div', { class: 'task-detail' });

    if (t.note) detail.appendChild(el('p', { class: 'muted small', text: t.note }));

    if (pace.plan.days.length) {
      var strip = el('div', { class: 'daystrip' });
      pace.plan.days.forEach(function (d) {
        var done = U.num(t.progress[d.date], 0);
        var cls = 'daychip';
        if (d.date === today) cls += ' today';
        if (d.qty > 0 && done >= d.qty) cls += ' ok';
        else if (U.cmp(d.date, today) < 0 && d.qty > 0 && done < d.qty) cls += ' miss';
        if (d.fixed) cls += ' fixed';
        var rt = sc.rangeText(t, d.from, d.to, { noUnit: true });
        strip.appendChild(el('button', {
          class: cls, onclick: function () { DL.forms.progressSheet(p.id, t.id, d.date); }
        }, [
          el('b', { text: U.fmtMD(d.date) }),
          el('span', { text: t.unit === 'none' ? '作業' : (rt || '—') }),
          d.qty ? el('u', { text: d.qty + sc.unit(t) + (done ? '／済' + done : '') }) : null
        ]));
      });
      detail.appendChild(strip);
    } else {
      detail.appendChild(el('p', { class: 'muted small', text: '期間が未設定です。編集または自動スケジュールで割り当ててください。' }));
    }

    detail.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('今日の進捗', 'ghost tiny', function () { DL.forms.progressSheet(p.id, t.id, today); }),
      ui.btn('実績を追加', 'ghost tiny', function () { DL.forms.addProgressSheet(p.id, t.id); }),
      ui.btn('編集', 'ghost tiny', function () { DL.forms.taskForm(p.id, t.id); }),
      ui.btn(t.done ? '未完了に戻す' : '完了にする', 'ghost tiny', function () { S.updateTask(p.id, t.id, { done: !t.done }); }),
      (t.unit !== 'none' && pace.remainingDays > 0)
        ? ui.btn('残りを再配分', 'ghost tiny', function () { reschedule(p, t, today); })
        : null,
      ui.btn('↑', 'ghost tiny', function () { S.moveTask(p.id, t.id, -1); }),
      ui.btn('↓', 'ghost tiny', function () { S.moveTask(p.id, t.id, 1); })
    ]));

    row.appendChild(detail);
    return row;
  }

  /**
   * 遅れたぶんを今日以降にならし直す。
   * 過去の日は実績どおりに固定し、残量を残りの稼働日へ配分する。
   */
  function reschedule(p, t, today) {
    var plan = sc.taskPlan(p, t);
    var past = plan.days.filter(function (d) { return U.cmp(d.date, today) < 0; });
    if (!past.length) { ui.toast('まだ過ぎた日がありません'); return; }
    past.forEach(function (d) { t.planOverride[d.date] = U.num(t.progress[d.date], 0); });
    S.save();
    var after = sc.taskPace(p, t, today);
    var real = sc.actualPace(60, today);
    var msg = '今日から1日あたり ' + after.perDay + sc.unit(t) + ' に組み直しました';
    if (real.activeDays >= 3 && after.perDay > real.perActiveDay) {
      msg += '（実績平均は ' + real.perActiveDay + '/日）';
    }
    ui.toast(msg);
  }

  /* ---------------- ガントチャート ---------------- */

  function gantt(p, tasks, today) {
    var starts = tasks.map(function (t) { return t.start; }).concat([today]);
    var ends = tasks.map(function (t) { return t.end; });
    if (U.isISO(p.deadline)) ends.push(p.deadline);
    if (p.kind === 'event' && U.isISO(p.eventDate)) ends.push(p.eventDate);
    var from = starts.sort(U.cmp)[0];
    var to = ends.sort(U.cmp)[ends.length - 1];
    var span = Math.max(1, U.diffDays(from, to) + 1);

    function pos(d) { return U.diffDays(from, d) / span * 100; }

    var rows = tasks.map(function (t) {
      var left = pos(t.start);
      var w = Math.max(2, (U.diffDays(t.start, t.end) + 1) / span * 100);
      var pct = sc.taskIsComplete(t) ? 100 : sc.taskPct(t);
      return el('div', { class: 'g-row' }, [
        el('span', { class: 'g-name', text: t.name }),
        el('div', { class: 'g-track' }, [
          el('div', {
            class: 'g-bar', style: { left: left + '%', width: w + '%', background: p.color },
            onclick: function () { expanded[t.id] = true; DL.app.render(); }
          }, el('i', { style: { width: pct + '%' } }))
        ])
      ]);
    });

    var marks = el('div', { class: 'g-marks' }, [
      el('span', { class: 'g-today', style: { left: pos(today) + '%' } }),
      U.isISO(p.deadline) ? el('span', { class: 'g-dl', style: { left: pos(p.deadline) + '%' } }) : null
    ]);

    return el('div', { class: 'card gantt' }, [
      el('div', { class: 'g-scale' }, [
        el('span', { text: U.fmtMD(from) }),
        el('span', { text: U.fmtMD(to) })
      ]),
      el('div', { class: 'g-body' }, [marks].concat(rows)),
      el('div', { class: 'g-legend muted small', text: '縦線＝今日 / 赤線＝締切　バーをタップでタスクを開きます' })
    ]);
  }

  DL.views = DL.views || {};
  DL.views.detail = { render: render };
})(window.DL);
