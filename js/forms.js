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
      client: '', fee: '', site: '', plan: '', deadline: '', startDate: U.today(),
      qty: 20, memo: '', printings: [], color: S.pickColor()
    };

    var body = el('div', { class: 'form' });
    var dynamic = el('div');           // 種別で切り替わる部分
    var qtyWrap = el('div');           // 数量（ページ数／枚数）
    var startWrap = el('div');         // 作業開始日
    var autoWrap = el('div');

    /* --- 作業開始日（スケジュール算出の起点） --- */
    var startInput = ui.input({ type: 'date', value: p.startDate || U.today() });
    var startNote = el('div', { class: 'preview' });
    function updateStartNote() {
      U.clear(startNote);
      var s = startInput.value, d = (f && f.deadline) ? f.deadline.value : '';
      if (!U.isISO(s) || !U.isISO(d)) {
        startNote.appendChild(el('span', { class: 'muted small', text: '開始日と締切日を入れると、作業できる日数を表示します。' }));
        return;
      }
      if (U.cmp(s, d) > 0) {
        startNote.appendChild(el('span', { class: 'muted small', text: '開始日が締切より後になっています。' }));
        return;
      }
      startNote.appendChild(el('div', { class: 'preview-main' }, [
        el('strong', { text: '作業できる日数 ' + sc.workdays(p, s, d).length + '日' }),
        el('span', { class: 'muted', text: '　' + U.fmtMD(s) + '〜' + U.fmtMD(d) })
      ]));
    }
    startInput.addEventListener('change', updateStartNote);
    startWrap.appendChild(ui.field('作業開始日', startInput, 'ここを起点に各タスクの期間と1日のノルマを計算します'));
    startWrap.appendChild(startNote);

    var titleInput = ui.input({ value: p.title, placeholder: '例）夏の新刊 / 表紙イラスト', maxlength: 60 });
    var memoInput = ui.textarea({ value: p.memo, placeholder: 'サイズ・仕様・連絡事項など' });

    var kindSeg = ui.segmented(
      [
        { value: 'event', label: '即売会', icon: 'event' },
        { value: 'work', label: '仕事', icon: 'work' },
        { value: 'support', label: '支援サイト', icon: 'support' }
      ],
      p.kind, function (v) { p.kind = v; renderDynamic(); }
    );
    var catSeg = ui.segmented(
      [{ value: 'manga', label: '漫画', icon: 'manga' }, { value: 'illust', label: 'イラスト', icon: 'illust' }],
      p.category, function (v) { p.category = v; renderQty(); renderCatHint(); }
    );
    var catField = ui.field('内容', catSeg, '選んだ内容に応じて基本タスクが変わります');
    var catHint = catField.querySelector('.field-hint');
    function renderCatHint() {
      catHint.textContent = p.kind === 'support'
        ? '投稿ごとに漫画・イラストを選べます。選んだ内容に応じて基本タスクが変わります'
        : '選んだ内容に応じて基本タスクが変わります';
    }

    body.appendChild(ui.field('種別', kindSeg));
    body.appendChild(ui.field('タイトル', titleInput));
    body.appendChild(catField);
    body.appendChild(qtyWrap);
    body.appendChild(dynamic);
    body.appendChild(startWrap);
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
    var f = { onDeadlineChange: updateStartNote };
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
                updateStartNote();
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
      } else if (p.kind === 'support') {
        f.site = ui.input({ value: p.site, placeholder: '例）FANBOX / Fantia / Ci-en' });
        f.plan = ui.input({ value: p.plan, placeholder: '例）500円プラン向け' });
        f.deadline = ui.input({ type: 'date', value: p.deadline || '' });

        var sitePresets = el('div', { class: 'presets' },
          S.SUPPORT_SITES.map(function (name) {
            return el('button', {
              type: 'button', class: 'preset', text: name,
              onclick: function () { f.site.value = name; }
            });
          })
        );

        dynamic.appendChild(ui.field('サイト', f.site));
        dynamic.appendChild(el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'よく使うサイト' }), sitePresets
        ]));
        dynamic.appendChild(ui.field('プラン・支援者向け', f.plan));
        dynamic.appendChild(ui.field('公開日（締切）', f.deadline, 'この日までに投稿できるようスケジュールを組みます'));
      } else {
        f.client = ui.input({ value: p.client, placeholder: '例）○○出版 / 個人依頼' });
        f.deadline = ui.input({ type: 'date', value: p.deadline || '' });
        f.fee = ui.input({ type: 'number', inputmode: 'numeric', value: p.fee || '', placeholder: '任意' });
        dynamic.appendChild(ui.field('クライアント', f.client));
        dynamic.appendChild(ui.field('納品日（締切）', f.deadline));
        dynamic.appendChild(ui.field('報酬（円）', f.fee));
      }
      f.deadline.addEventListener('change', updateStartNote);
      updateStartNote();
      renderCatHint();
      renderAuto();
    }

    /* --- タスクの自動割り当て --- */
    var autoCheck;
    function renderAuto() {
      U.clear(autoWrap);
      autoCheck = el('input', { type: 'checkbox', class: 'check', checked: true });
      autoWrap.appendChild(el('div', { class: 'panel' }, [
        el('label', { class: 'row-check' }, [
          autoCheck,
          el('span', { text: isNew ? '基本タスクを自動生成してスケジュールを割り振る' : '開始日・締切を変えたらタスクを再計算する' })
        ]),
        el('span', {
          class: 'field-hint',
          text: '作業開始日〜締切の稼働日に、各タスクの期間と1日のノルマを配分し直します'
        })
      ]));
    }

    renderQty();
    renderDynamic();

    function collect() {
      var data = {
        kind: p.kind, category: p.category, color: p.color,
        title: titleInput.value.trim(), memo: memoInput.value,
        startDate: startInput.value, qty: U.num(qtyInput.value, 0)
      };
      if (p.kind === 'event') {
        Object.assign(data, {
          eventName: f.eventName.value.trim(), eventDate: f.eventDate.value,
          venue: f.venue.value.trim(), space: f.space.value.trim(),
          deadline: f.deadline.value, printings: p.printings
        });
        if (!data.title) data.title = data.eventName ? data.eventName + 'の新刊' : '';
      } else if (p.kind === 'support') {
        Object.assign(data, {
          site: f.site.value.trim(), plan: f.plan.value.trim(), deadline: f.deadline.value
        });
        if (!data.title && data.site) data.title = data.site + 'の投稿';
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
          if (!U.isISO(data.startDate)) { ui.toast('作業開始日を入れてください', 'warn'); return; }
          if (U.cmp(data.startDate, data.deadline) > 0) {
            ui.toast('作業開始日は締切より前にしてください', 'warn'); return;
          }

          if (isNew) {
            var np = S.createProject(data);
            if (autoCheck && autoCheck.checked) {
              np.tasks = S.templateTasks(np.category, np.qty);
              var r = sc.autoSchedule(np, { start: np.startDate, end: np.deadline });
              if (!r.ok) ui.toast(r.reason, 'warn');
            }
            S.save();
            close();
            location.hash = '#/project/' + np.id;
            ui.toast('案件を作成しました');
          } else {
            var beforeQty = U.num(existing.qty, 0);
            var scheduleChanged = existing.startDate !== data.startDate || existing.deadline !== data.deadline;
            S.updateProject(existing.id, data);
            var saved = S.getProject(existing.id);

            // 作業開始日／締切が変わったら、タスクの期間とノルマを計算し直す
            if (scheduleChanged && autoCheck && autoCheck.checked && (saved.tasks || []).length) {
              var r2 = sc.autoSchedule(saved, { start: data.startDate, end: data.deadline });
              ui.toast(r2.ok ? '開始日に合わせてタスクを再計算しました' : r2.reason, r2.ok ? '' : 'warn');
            } else {
              ui.toast('保存しました');
            }
            if (beforeQty !== data.qty) syncTaskQty(existing.id, data.qty);
            close();
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
            if (U.isISO(pr.due) && f.deadline) {
              f.deadline.value = pr.due;
              if (f.onDeadlineChange) f.onDeadlineChange();
            }
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
        type: 'button', class: 'btn ghost full', text: '印刷プランを追加',
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
    var startI = ui.input({ type: 'date', value: p.startDate || U.today() });
    var endI = ui.input({ type: 'date', value: p.deadline || '' });
    var bufI = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: U.num(S.settings.bufferDays, 1) });
    var scope = ui.segmented([{ value: 'all', label: '全タスク' }, { value: 'empty', label: '未設定のみ' }], 'all');

    var body = el('div', { class: 'form' }, [
      el('p', { class: 'muted small', text: '重みに応じて稼働日を配分し、各タスクの期間を順番に割り当てます。ここで指定した開始日は案件の「作業開始日」として保存されます。' }),
      el('div', { class: 'grid2' }, [ui.field('作業開始日', startI), ui.field('締切日', endI)]),
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
          S.updateProject(p.id, { startDate: startI.value, deadline: endI.value });
          close();
          ui.toast(r.tight ? '日数が足りないため詰めて配置しました' : 'スケジュールを割り当てました');
        })
      ]
    });
  }

  /* =============== 作業開始日の変更 =============== */

  function startDateSheet(pid) {
    var p = S.getProject(pid);
    if (!p) return;
    var startI = ui.input({ type: 'date', value: p.startDate || U.today() });
    var note = el('div', { class: 'preview' });
    var recalc = el('input', { type: 'checkbox', class: 'check', checked: true });

    function preview() {
      U.clear(note);
      var s = startI.value;
      if (!U.isISO(s) || !U.isISO(p.deadline)) {
        note.appendChild(el('span', { class: 'muted small', text: '締切日が未設定です。' }));
        return;
      }
      if (U.cmp(s, p.deadline) > 0) {
        note.appendChild(el('span', { class: 'muted small', text: '開始日が締切より後になっています。' }));
        return;
      }
      var days = sc.workdays(p, s, p.deadline).length;
      var per = (p.tasks || []).length ? Math.ceil(days / p.tasks.length) : 0;
      note.appendChild(el('div', { class: 'preview-main' }, [
        el('strong', { text: '作業できる日数 ' + days + '日' }),
        el('span', { class: 'muted', text: '　' + U.fmtMD(s) + '〜' + U.fmtMD(p.deadline) + (per ? '（1タスクあたり約' + per + '日）' : '') })
      ]));
    }
    startI.addEventListener('change', preview);
    preview();

    var body = el('div', { class: 'form' }, [
      ui.field('作業開始日', startI, 'ここを起点に各タスクの期間と1日のノルマを計算します'),
      note,
      el('label', { class: 'row-check' }, [recalc, el('span', { text: 'タスクの期間とノルマを計算し直す' })]),
      el('p', { class: 'muted small', text: '計算し直すと、手動で固定したノルマは自動配分に戻ります。記録済みの実績はそのまま残ります。' })
    ]);

    var close = ui.sheet({
      title: '作業開始日', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          if (!U.isISO(startI.value)) { ui.toast('日付を入れてください', 'warn'); return; }
          if (U.isISO(p.deadline) && U.cmp(startI.value, p.deadline) > 0) {
            ui.toast('作業開始日は締切より前にしてください', 'warn'); return;
          }
          S.updateProject(pid, { startDate: startI.value });
          if (recalc.checked && (p.tasks || []).length) {
            var r = sc.autoSchedule(S.getProject(pid), { start: startI.value, end: p.deadline });
            ui.toast(r.ok ? '開始日に合わせてタスクを再計算しました' : r.reason, r.ok ? '' : 'warn');
          } else {
            ui.toast('作業開始日を変更しました');
          }
          close();
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
    templateSheet: templateSheet, startDateSheet: startDateSheet
  };
})(window.DL);
