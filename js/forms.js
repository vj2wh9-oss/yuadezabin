/* 入力フォーム：案件・タスク・進捗・自動スケジュール */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  /* =============== 案件（イベント／仕事） =============== */

  function projectForm(existing) {
    var isNew = !existing;
    var p = existing ? U.clone(existing) : {
      kind: 'event', category: 'manga', title: '', status: 'active',
      eventName: '', eventDate: '', venue: '', space: '',
      client: '', fee: '', deadline: '', qty: 20, memo: '',
      printings: [], color: S.pickColor()
    };

    var body = el('div', { class: 'form' });
    var dynamic = el('div');           // 種別で切り替わる部分
    var qtyWrap = el('div');           // 数量（ページ数／枚数）
    var autoWrap = el('div');

    var titleInput = ui.input({ value: p.title, placeholder: '例）夏の新刊 / 表紙イラスト', maxlength: 60 });
    var memoInput = ui.textarea({ value: p.memo, placeholder: 'サイズ・仕様・連絡事項など' });

    var kindSeg = ui.segmented(
      [{ value: 'event', label: '🎪 即売会' }, { value: 'work', label: '💼 仕事' }],
      p.kind, function (v) { p.kind = v; renderDynamic(); }
    );
    var catSeg = ui.segmented(
      [{ value: 'manga', label: '📕 漫画' }, { value: 'illust', label: '🎨 イラスト' }],
      p.category, function (v) { p.category = v; renderQty(); }
    );

    body.appendChild(ui.field('種別', kindSeg));
    body.appendChild(ui.field('タイトル', titleInput));
    body.appendChild(ui.field('内容', catSeg, '選んだ内容に応じて基本タスクが変わります'));
    body.appendChild(qtyWrap);
    body.appendChild(dynamic);
    body.appendChild(ui.field('メモ', memoInput));

    // 色
    var colorWrap = el('div', { class: 'colors' });
    S.PALETTE.forEach(function (c) {
      var b = el('button', {
        type: 'button', class: 'color' + (c === p.color ? ' on' : ''), style: { background: c },
        'aria-label': '色', onclick: function () {
          p.color = c;
          U.$$('.color', colorWrap).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        }
      });
      colorWrap.appendChild(b);
    });
    body.appendChild(ui.field('色', colorWrap));
    body.appendChild(autoWrap);

    /* --- 数量欄 --- */
    var qtyInput;
    function renderQty() {
      U.clear(qtyWrap);
      var isManga = p.category === 'manga';
      qtyInput = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: U.num(p.qty, isManga ? 20 : 1) });
      qtyWrap.appendChild(ui.field(
        isManga ? '合計ページ数' : '枚数（カット数）',
        qtyInput,
        isManga ? '1日ごとのノルマ計算に使います' : '複数枚の依頼はまとめて枚数で指定できます'
      ));
    }

    /* --- 種別ごとの欄 --- */
    var f = {};
    function renderDynamic() {
      U.clear(dynamic);
      if (p.kind === 'event') {
        f.eventName = ui.input({ value: p.eventName, placeholder: '例）コミックマーケット' });
        f.eventDate = ui.input({ type: 'date', value: p.eventDate || '' });
        f.venue = ui.input({ value: p.venue, placeholder: '会場' });
        f.space = ui.input({ value: p.space, placeholder: 'スペース番号' });
        f.deadline = ui.input({ type: 'date', value: p.deadline || '' });

        var presets = el('div', { class: 'presets' },
          S.PRINT_PRESETS.map(function (pr) {
            return el('button', {
              type: 'button', class: 'preset', text: pr.label + '(' + pr.days + '日前)',
              onclick: function () {
                if (!U.isISO(f.eventDate.value)) { ui.toast('先に開催日を入れてください', 'warn'); return; }
                f.deadline.value = U.addDays(f.eventDate.value, -pr.days);
                ui.toast(pr.label + '＝' + U.fmtMDW(f.deadline.value) + ' に設定');
              }
            });
          })
        );

        dynamic.appendChild(ui.field('イベント名', f.eventName));
        dynamic.appendChild(ui.field('開催日', f.eventDate));
        dynamic.appendChild(ui.field('会場', f.venue));
        dynamic.appendChild(ui.field('スペース', f.space));
        dynamic.appendChild(ui.field('入稿締切（メイン）', f.deadline, '印刷所の締切。ここがタスクのゴールになります'));
        dynamic.appendChild(el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: '開催日から逆算' }), presets
        ]));
        dynamic.appendChild(printingsEditor(p, f));
      } else {
        f.client = ui.input({ value: p.client, placeholder: '例）○○出版 / 個人依頼' });
        f.deadline = ui.input({ type: 'date', value: p.deadline || '' });
        f.fee = ui.input({ type: 'number', inputmode: 'numeric', value: p.fee || '', placeholder: '任意' });
        dynamic.appendChild(ui.field('クライアント', f.client));
        dynamic.appendChild(ui.field('納品日（締切）', f.deadline));
        dynamic.appendChild(ui.field('報酬（円）', f.fee));
      }
      renderAuto();
    }

    /* --- 新規作成時の自動タスク生成 --- */
    var autoCheck, autoStart;
    function renderAuto() {
      U.clear(autoWrap);
      if (!isNew) return;
      autoCheck = el('input', { type: 'checkbox', class: 'check', checked: true });
      autoStart = ui.input({ type: 'date', value: U.today() });
      autoWrap.appendChild(el('div', { class: 'panel' }, [
        el('label', { class: 'row-check' }, [autoCheck, el('span', { text: '基本タスクを自動生成してスケジュールを割り振る' })]),
        ui.field('作業開始日', autoStart, '開始日〜締切の稼働日に、各タスクを自動配分します')
      ]));
    }

    renderQty();
    renderDynamic();

    function collect() {
      var data = {
        kind: p.kind, category: p.category, color: p.color,
        title: titleInput.value.trim(), memo: memoInput.value,
        qty: U.num(qtyInput.value, 0)
      };
      if (p.kind === 'event') {
        Object.assign(data, {
          eventName: f.eventName.value.trim(), eventDate: f.eventDate.value,
          venue: f.venue.value.trim(), space: f.space.value.trim(),
          deadline: f.deadline.value, printings: p.printings
        });
        if (!data.title) data.title = data.eventName ? data.eventName + 'の新刊' : '';
      } else {
        Object.assign(data, {
          client: f.client.value.trim(), deadline: f.deadline.value, fee: U.num(f.fee.value, 0)
        });
      }
      return data;
    }

    var close = ui.sheet({
      title: isNew ? '新しい案件' : '案件を編集',
      body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var data = collect();
          if (!data.title) { ui.toast('タイトルを入れてください', 'warn'); return; }
          if (!U.isISO(data.deadline)) { ui.toast('締切日を入れてください', 'warn'); return; }

          if (isNew) {
            var np = S.createProject(data);
            if (autoCheck && autoCheck.checked) {
              np.tasks = S.templateTasks(np.category, np.qty);
              var r = sc.autoSchedule(np, { start: autoStart.value || U.today(), end: np.deadline });
              if (!r.ok) ui.toast(r.reason, 'warn');
            }
            S.save();
            close();
            location.hash = '#/project/' + np.id;
            ui.toast('案件を作成しました');
          } else {
            var before = U.num(existing.qty, 0);
            S.updateProject(existing.id, data);
            if (before !== data.qty) syncTaskQty(existing.id, data.qty);
            close();
            ui.toast('保存しました');
          }
        })
      ]
    });
  }

  // 総ページ数（枚数）を変更したとき、数量つきタスクへ反映するか確認
  function syncTaskQty(pid, qty) {
    var p = S.getProject(pid);
    var targets = (p.tasks || []).filter(function (t) { return t.unit !== 'none'; });
    if (!targets.length) return;
    ui.confirm('数量が変わりました。各タスクの数量も ' + qty + ' に合わせますか？', { okText: '合わせる' })
      .then(function (ok) {
        if (!ok) return;
        targets.forEach(function (t) { t.qty = qty; });
        S.save();
        ui.toast('タスクの数量を更新しました');
      });
  }

  /* --- 印刷所プランの編集（早割・通常など複数の締切） --- */
  function printingsEditor(p, f) {
    var list = el('div', { class: 'plans' });

    function render() {
      U.clear(list);
      if (!p.printings.length) {
        list.appendChild(el('p', { class: 'muted small', text: '印刷所のプランを追加すると、締切の候補をまとめて管理できます。' }));
      }
      p.printings.forEach(function (pr, i) {
        var labelI = ui.input({ value: pr.label || '', placeholder: 'プラン名（早割など）' });
        var printerI = ui.input({ value: pr.printer || '', placeholder: '印刷所名' });
        var dueI = ui.input({ type: 'date', value: pr.due || '' });
        var copiesI = ui.input({ type: 'number', inputmode: 'numeric', value: pr.copies || '', placeholder: '部数' });
        labelI.addEventListener('input', function () { pr.label = labelI.value; });
        printerI.addEventListener('input', function () { pr.printer = printerI.value; });
        dueI.addEventListener('change', function () { pr.due = dueI.value; });
        copiesI.addEventListener('input', function () { pr.copies = U.num(copiesI.value, 0); });

        var useBtn = el('button', {
          type: 'button', class: 'btn tiny' + (pr.primary ? ' primary' : ' ghost'),
          text: pr.primary ? 'メイン締切' : 'メインにする',
          onclick: function () {
            p.printings.forEach(function (x) { x.primary = false; });
            pr.primary = true;
            if (U.isISO(pr.due) && f.deadline) f.deadline.value = pr.due;
            render();
          }
        });
        var delBtn = el('button', {
          type: 'button', class: 'btn tiny danger', text: '削除',
          onclick: function () { p.printings.splice(i, 1); render(); }
        });

        list.appendChild(el('div', { class: 'plan-row' }, [
          el('div', { class: 'grid2' }, [labelI, printerI]),
          el('div', { class: 'grid2' }, [dueI, copiesI]),
          el('div', { class: 'row-end' }, [useBtn, delBtn])
        ]));
      });

      var add = el('button', {
        type: 'button', class: 'btn ghost full', text: '＋ 印刷プランを追加',
        onclick: function () {
          var ev = f.eventDate ? f.eventDate.value : '';
          var preset = S.PRINT_PRESETS[Math.min(p.printings.length, S.PRINT_PRESETS.length - 1)];
          p.printings.push({
            id: U.uid(), label: preset.label,
            printer: (p.printings[0] || {}).printer || '',
            due: U.isISO(ev) ? U.addDays(ev, -preset.days) : '',
            copies: (p.printings[0] || {}).copies || 0,
            primary: p.printings.length === 0
          });
          render();
        }
      });
      list.appendChild(add);
    }
    render();
    return el('div', { class: 'field' }, [el('span', { class: 'field-label', text: '印刷所の締切' }), list]);
  }

  /* =============== タスク =============== */

  function taskForm(pid, taskId) {
    var p = S.getProject(pid);
    if (!p) return;
    var existing = taskId ? S.getTask(pid, taskId) : null;
    var t = existing ? U.clone(existing) : {
      name: '', unit: p.category === 'manga' ? 'page' : 'cut',
      qty: U.num(p.qty, 0), start: U.today(), end: U.today(), weight: 10, note: ''
    };

    var nameI = ui.input({ value: t.name, placeholder: '例）下書き' });
    var unitSeg = ui.segmented([
      { value: 'page', label: 'ページ' }, { value: 'cut', label: '枚' }, { value: 'none', label: '数量なし' }
    ], t.unit, function (v) { t.unit = v; renderQty(); renderPreview(); });
    var qtyBox = el('div');
    var startI = ui.input({ type: 'date', value: t.start || '' });
    var endI = ui.input({ type: 'date', value: t.end || '' });
    var weightI = ui.input({ type: 'number', inputmode: 'numeric', min: 1, value: U.num(t.weight, 10) });
    var noteI = ui.input({ value: t.note, placeholder: 'メモ（任意）' });
    var preview = el('div', { class: 'preview' });

    var qtyI;
    function renderQty() {
      U.clear(qtyBox);
      if (t.unit === 'none') return;
      qtyI = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: U.num(t.qty, 0) });
      qtyI.addEventListener('input', renderPreview);
      qtyBox.appendChild(ui.field('数量（' + S.UNIT_LABEL[t.unit] + '）', qtyI));
    }

    // 1日ごとのノルマをその場でプレビュー
    function renderPreview() {
      U.clear(preview);
      var tmp = {
        unit: t.unit, qty: qtyI ? U.num(qtyI.value, 0) : null,
        start: startI.value, end: endI.value, planOverride: {}, progress: {}
      };
      if (!U.isISO(tmp.start) || !U.isISO(tmp.end) || U.cmp(tmp.start, tmp.end) > 0) {
        preview.appendChild(el('p', { class: 'muted small', text: '期間を指定すると1日ごとのノルマを計算します。' }));
        return;
      }
      var plan = sc.taskPlan(p, tmp);
      var qs = plan.days.map(function (d) { return d.qty; });
      var lo = Math.min.apply(null, qs), hi = Math.max.apply(null, qs);
      var per = tmp.unit === 'none' ? '—' : (lo === hi ? lo + S.UNIT_LABEL[tmp.unit] : lo + '〜' + hi + S.UNIT_LABEL[tmp.unit]);
      preview.appendChild(el('div', { class: 'preview-main' }, [
        el('strong', { text: '1日あたり ' + per }),
        el('span', { class: 'muted', text: '　稼働 ' + plan.dayCount + '日（' + U.fmtMD(tmp.start) + '〜' + U.fmtMD(tmp.end) + '）' })
      ]));
      var strip = el('div', { class: 'daystrip' });
      plan.days.slice(0, 31).forEach(function (d) {
        strip.appendChild(el('div', { class: 'daychip' }, [
          el('b', { text: U.fmtMD(d.date) }),
          el('span', { text: tmp.unit === 'none' ? '作業' : d.qty + S.UNIT_LABEL[tmp.unit] })
        ]));
      });
      preview.appendChild(strip);
    }

    startI.addEventListener('change', renderPreview);
    endI.addEventListener('change', renderPreview);

    var body = el('div', { class: 'form' }, [
      ui.field('タスク名', nameI),
      ui.field('単位', unitSeg),
      qtyBox,
      el('div', { class: 'grid2' }, [ui.field('開始日', startI), ui.field('終了日', endI)]),
      preview,
      ui.field('重み', weightI, '自動スケジュールで日数を配分する比率'),
      ui.field('メモ', noteI)
    ]);

    if (existing) {
      body.appendChild(el('button', {
        type: 'button', class: 'btn danger full mt', text: 'このタスクを削除',
        onclick: function () {
          ui.confirm('「' + existing.name + '」を削除しますか？', { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeTask(pid, taskId); close(); ui.toast('削除しました');
          });
        }
      }));
    }

    renderQty();
    renderPreview();

    var close = ui.sheet({
      title: existing ? 'タスクを編集' : 'タスクを追加',
      body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var data = {
            name: nameI.value.trim() || 'タスク',
            unit: unitSeg.dataset.value,
            qty: qtyI ? U.num(qtyI.value, 0) : null,
            start: startI.value, end: endI.value,
            weight: U.num(weightI.value, 10), note: noteI.value
          };
          if (U.isISO(data.start) && U.isISO(data.end) && U.cmp(data.start, data.end) > 0) {
            ui.toast('終了日は開始日より後にしてください', 'warn'); return;
          }
          if (existing) S.updateTask(pid, taskId, data);
          else S.addTask(pid, data);
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* =============== 進捗の入力 =============== */

  function progressSheet(pid, tid, date) {
    var p = S.getProject(pid), t = S.getTask(pid, tid);
    if (!p || !t) return;
    var plan = sc.taskPlan(p, t);
    var quota = plan.byDate[date] || 0;
    var unit = S.UNIT_LABEL[t.unit] || '';
    var pace = sc.taskPace(p, t);

    var step = ui.stepper({ value: U.num(t.progress[date], 0) });
    var body = el('div', { class: 'form' }, [
      el('div', { class: 'prog-head' }, [
        el('div', { class: 'dot', style: { background: p.color } }),
        el('div', {}, [
          el('strong', { text: p.title }),
          el('div', { class: 'muted small', text: t.name + '　' + U.fmtMDW(date) })
        ])
      ]),
      el('div', { class: 'quota-row' }, t.unit === 'none' ? [
        el('div', { class: 'quota-box' }, [el('span', { text: 'この日' }), el('b', { text: '作業日' })]),
        el('div', { class: 'quota-box' }, [el('span', { text: '期間' }), el('b', { text: U.fmtMD(t.start) + '〜' + U.fmtMD(t.end) })]),
        el('div', { class: 'quota-box' }, [el('span', { text: '残り日数' }), el('b', { text: pace.remainingDays + '日' })])
      ] : [
        el('div', { class: 'quota-box' }, [el('span', { text: 'この日のノルマ' }), el('b', { text: quota + unit })]),
        el('div', { class: 'quota-box' }, [el('span', { text: '残り' }), el('b', { text: pace.remaining + unit })]),
        el('div', { class: 'quota-box' }, [el('span', { text: '必要ペース' }), el('b', { text: pace.perDay + unit + '/日' })])
      ]),
      ui.field('今日の実績（' + (unit || '完了数') + '）', step),
      el('div', { class: 'row-wrap' }, [
        ui.btn(quota ? 'ノルマ達成' : 'やった', 'ghost', function () { step.setValue(quota || 1); }),
        ui.btn('0にする', 'ghost', function () { step.setValue(0); }),
        ui.btn(t.done ? '未完了に戻す' : 'タスク完了にする', 'ghost', function () {
          S.updateTask(pid, tid, { done: !t.done });
          close(); ui.toast(t.done ? '未完了に戻しました' : 'タスクを完了にしました');
        })
      ])
    ]);

    var close = ui.sheet({
      title: '進捗を記録', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('記録する', 'primary', function () {
          S.setProgress(pid, tid, date, step.getValue());
          close(); ui.toast('記録しました');
        })
      ]
    });
  }

  /* =============== ノルマの手動調整 =============== */

  function planOverrideSheet(pid, tid, date) {
    var p = S.getProject(pid), t = S.getTask(pid, tid);
    if (!p || !t || t.unit === 'none') return;
    var plan = sc.taskPlan(p, t);
    var cur = plan.byDate[date] || 0;
    var step = ui.stepper({ value: cur });
    var body = el('div', { class: 'form' }, [
      el('p', { class: 'muted small', text: U.fmtYMDW(date) + ' のノルマを固定します。残りの量は他の稼働日へ自動で配分し直されます。' }),
      ui.field('この日のノルマ', step)
    ]);
    var close = ui.sheet({
      title: 'ノルマを調整', body: body,
      actions: [
        ui.btn('自動に戻す', 'ghost', function () {
          delete t.planOverride[date]; S.save(); close(); ui.toast('自動配分に戻しました');
        }),
        ui.btn('固定する', 'primary', function () {
          t.planOverride[date] = step.getValue(); S.save(); close(); ui.toast('ノルマを固定しました');
        })
      ]
    });
  }

  /* =============== 自動スケジュール =============== */

  function autoScheduleSheet(pid) {
    var p = S.getProject(pid);
    if (!p) return;
    var startI = ui.input({ type: 'date', value: U.today() });
    var endI = ui.input({ type: 'date', value: p.deadline || '' });
    var bufI = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: U.num(S.settings.bufferDays, 1) });
    var scope = ui.segmented([{ value: 'all', label: '全タスク' }, { value: 'empty', label: '未設定のみ' }], 'all');

    var body = el('div', { class: 'form' }, [
      el('p', { class: 'muted small', text: '重みに応じて稼働日を配分し、各タスクの期間を順番に割り当てます。' }),
      el('div', { class: 'grid2' }, [ui.field('開始日', startI), ui.field('締切日', endI)]),
      ui.field('締切前の予備日', bufI, 'この日数だけ手前で作業を終える計画にします'),
      ui.field('対象', scope)
    ]);

    var close = ui.sheet({
      title: '自動スケジュール', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('割り当てる', 'primary', function () {
          var r = sc.autoSchedule(p, {
            start: startI.value, end: endI.value,
            buffer: U.num(bufI.value, 0), onlyEmpty: scope.dataset.value === 'empty'
          });
          if (!r.ok) { ui.toast(r.reason, 'warn'); return; }
          close();
          ui.toast(r.tight ? '日数が足りないため詰めて配置しました' : 'スケジュールを割り当てました');
        })
      ]
    });
  }

  /* =============== テンプレートからタスク追加 =============== */

  function templateSheet(pid) {
    var p = S.getProject(pid);
    if (!p) return;
    var catSeg = ui.segmented([{ value: 'manga', label: '漫画' }, { value: 'illust', label: 'イラスト' }], p.category, function (v) { render(v); });
    var list = el('div', { class: 'tpl-list' });
    var picked = {};

    function render(cat) {
      U.clear(list); picked = {};
      (S.settings.templates[cat] || []).forEach(function (tp, i) {
        var cb = el('input', { type: 'checkbox', class: 'check', checked: true });
        picked[i] = { def: tp, cb: cb };
        list.appendChild(el('label', { class: 'row-check' }, [
          cb, el('span', { text: tp.name }),
          el('span', { class: 'muted small', text: tp.unit === 'none' ? '数量なし' : '数量あり' })
        ]));
      });
    }
    render(p.category);

    var body = el('div', { class: 'form' }, [
      ui.field('テンプレート', catSeg),
      list,
      el('p', { class: 'muted small', text: '追加後に「自動スケジュール」で期間を割り当てられます。' })
    ]);

    var close = ui.sheet({
      title: '基本タスクを追加', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('追加', 'primary', function () {
          var n = 0;
          Object.keys(picked).forEach(function (k) {
            if (!picked[k].cb.checked) return;
            var tp = picked[k].def;
            S.addTask(pid, {
              name: tp.name, weight: tp.weight, unit: tp.unit,
              qty: tp.unit === 'none' ? null : U.num(p.qty, 0)
            });
            n++;
          });
          close();
          ui.toast(n + '件のタスクを追加しました');
        })
      ]
    });
  }

  DL.forms = {
    projectForm: projectForm, taskForm: taskForm, progressSheet: progressSheet,
    planOverrideSheet: planOverrideSheet, autoScheduleSheet: autoScheduleSheet,
    templateSheet: templateSheet
  };
})(window.DL);
