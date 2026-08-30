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
      qty: 20, memo: '', printings: [], color: S.pickColor(),
      // 新規は「いま見ている名義」→既定の名義 の順で初期選択する
      issuerId: S.scopeId() || S.settings.defaultIssuerId || ''
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
      var wd = sc.workdays(p, s, d).length;
      startNote.appendChild(el('div', { class: 'preview-main' }, [
        el('strong', { text: '作業できる日数 ' + wd + '日' }),
        el('span', { class: 'muted', text: '　' + U.fmtMD(s) + '〜' + U.fmtMD(d) +
          (wd ? '' : '（すべて休業日です。カレンダーから休みを見直してください）') })
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
    // 内容の選択肢（「デザイン」は仕事のときだけ出す）
    var catWrap = el('div');
    var catSeg;
    function renderCat() {
      U.clear(catWrap);
      var opts = [
        { value: 'manga', label: '漫画', icon: 'manga' },
        { value: 'illust', label: 'イラスト', icon: 'illust' }
      ];
      if (p.kind === 'work') opts.push({ value: 'design', label: 'デザイン', icon: 'design' });
      else if (p.category === 'design') p.category = 'illust';   // 仕事以外に切り替えたら戻す
      catSeg = ui.segmented(opts, p.category, function (v) {
        p.category = v; renderQty();
      });
      var hint = p.kind === 'support'
        ? '投稿ごとに漫画・イラストを選べます。選んだ内容に応じて基本タスクが変わります'
        : p.category === 'design'
          ? 'デザインは工程が案件ごとに違うため、基本タスクは用意していません（あとから追加できます）'
          : '選んだ内容に応じて基本タスクが変わります';
      catWrap.appendChild(ui.field('内容', catSeg, hint));
    }
    function renderCatHint() { renderCat(); }

    body.appendChild(ui.field('種別', kindSeg));

    // 名義（登録があるときだけ。切り替え表示と書類の初期値に使う）
    var issuerSel = null;
    if (S.issuers().length) {
      issuerSel = ui.select(
        [{ value: '', label: '（指定しない）' }].concat(S.issuers().map(function (x) {
          return { value: x.id, label: x.name || '(名称未設定)' };
        })),
        p.issuerId || ''
      );
      body.appendChild(ui.field('名義', issuerSel, 'この案件をどちらの名義の仕事として扱うか。書類の発行元の初期値にもなります'));
    }

    body.appendChild(ui.field('タイトル', titleInput));
    body.appendChild(catWrap);
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
    var QTY_FIELD = {
      manga: ['合計ページ数', '1日ごとのノルマ計算に使います', 20],
      illust: ['枚数（カット数）', '複数枚の依頼はまとめて枚数で指定できます', 1],
      design: ['点数', 'ロゴ案・バナーなどの制作点数。1日ごとのノルマ計算に使います', 1]
    };
    function renderQty() {
      U.clear(qtyWrap);
      var f2 = QTY_FIELD[p.category] || QTY_FIELD.manga;
      qtyInput = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: U.num(p.qty, f2[2]) });
      qtyWrap.appendChild(ui.field(f2[0], qtyInput, f2[1]));
      if (catSeg) renderCatHintText();
    }
    function renderCatHintText() {
      var hint = catWrap.querySelector('.field-hint');
      if (!hint) return;
      hint.textContent = p.kind === 'support'
        ? '投稿ごとに漫画・イラストを選べます。選んだ内容に応じて基本タスクが変わります'
        : p.category === 'design'
          ? 'デザインは工程が案件ごとに違うため、基本タスクは用意していません（あとから追加できます）'
          : '選んだ内容に応じて基本タスクが変わります';
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

        // 登録済みの取引先を選ぶと、名前は自動で入る（未登録なら下の欄に直接書ける）
        f.clientSel = clientSelect(p.clientId || '', function (id) {
          var c = id && S.getClient(id);
          if (c) f.client.value = c.name;
        });
        dynamic.appendChild(ui.field('取引先', f.clientSel,
          '登録しておくと、請求書の宛名・住所・支払期限が自動で入ります'));
        dynamic.appendChild(ui.field('クライアント名（表示用）', f.client,
          '取引先を選ぶと自動で入ります。登録せずにここだけ書いても構いません'));
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

    renderCat();
    renderQty();
    renderDynamic();

    function collect() {
      var data = {
        kind: p.kind, category: p.category, color: p.color,
        issuerId: issuerSel ? issuerSel.value : (p.issuerId || ''),
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
          clientId: f.clientSel.getValue(),
          client: f.client.value.trim(), deadline: f.deadline.value, fee: U.num(f.fee.value, 0)
        });
        if (!data.title && data.client) data.title = data.client + 'の依頼';
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
              if (np.tasks.length) {
                var r = sc.autoSchedule(np, { start: np.startDate, end: np.deadline });
                if (!r.ok) ui.toast(r.reason, 'warn');
              }
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
      name: '', unit: p.category === 'manga' ? 'page' : p.category === 'design' ? 'item' : 'cut',
      qty: U.num(p.qty, 0), start: U.today(), end: U.today(), weight: 10, note: ''
    };

    var nameI = ui.input({ value: t.name, placeholder: '例）下書き' });
    var unitSeg = ui.segmented([
      { value: 'page', label: 'ページ' }, { value: 'cut', label: '枚' },
      { value: 'item', label: '点' }, { value: 'none', label: 'なし' }
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
          el('span', { text: tmp.unit === 'none' ? '作業' : (sc.rangeText(tmp, d.from, d.to, { noUnit: true }) || '—') }),
          d.qty ? el('u', { text: d.qty + S.UNIT_LABEL[tmp.unit] }) : null
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
    var range = plan.rangeByDate[date] || {};
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
        el('div', { class: 'quota-box' }, [
          el('span', { text: 'この日のノルマ' + (quota ? '（' + quota + unit + '）' : '') }),
          el('b', { text: sc.rangeText(t, range.from, range.to) || (quota + unit) })
        ]),
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

  /* =============== 任意の日に実績を足す =============== */

  function addProgressSheet(pid, tid) {
    var p = S.getProject(pid), t = S.getTask(pid, tid);
    if (!p || !t) return;
    var unit = S.UNIT_LABEL[t.unit] || '';
    var dateI = ui.input({ type: 'date', value: U.today() });
    var step = ui.stepper({ value: 0 });
    var note = el('div', { class: 'preview' });

    function preview() {
      U.clear(note);
      var d = dateI.value;
      var cur = U.num(t.progress[d], 0);
      var plan = sc.taskPlan(p, t);
      var inRange = plan.byDate[d] !== undefined;
      note.appendChild(el('div', { class: 'preview-main' }, [
        el('strong', { text: cur ? 'この日の記録済み ' + cur + unit : 'この日の記録はまだありません' }),
        el('span', { class: 'muted', text: inRange ? '　予定に入っている日です' : '　予定外の日（前倒し・巻き返し）' })
      ]));
      step.setValue(cur);
    }
    dateI.addEventListener('change', preview);
    preview();

    var body = el('div', { class: 'form' }, [
      el('div', { class: 'prog-head' }, [
        el('div', { class: 'dot', style: { background: p.color } }),
        el('div', {}, [el('strong', { text: p.title }), el('div', { class: 'muted small', text: t.name })])
      ]),
      ui.field('日付', dateI, '予定に入っていない日でも記録できます'),
      note,
      ui.field('実績（' + (unit || '完了数') + '）', step)
    ]);

    var close = ui.sheet({
      title: '実績を追加', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('記録する', 'primary', function () {
          if (!U.isISO(dateI.value)) { ui.toast('日付を入れてください', 'warn'); return; }
          S.setProgress(pid, tid, dateI.value, step.getValue());
          close(); ui.toast(U.fmtMD(dateI.value) + ' に記録しました');
        })
      ]
    });
  }

  /* この日にできなかった分を翌日以降へ回す */
  function deferSheet(pid, tid, date) {
    var p = S.getProject(pid), t = S.getTask(pid, tid);
    if (!p || !t) return;
    var plan = sc.taskPlan(p, t);
    var quota = plan.byDate[date] || 0;
    var done = U.num(t.progress[date], 0);
    var unit = S.UNIT_LABEL[t.unit] || '';
    ui.confirm(
      U.fmtMDW(date) + ' の「' + t.name + '」を実績どおり（' + done + unit + '）で確定し、残り ' +
      Math.max(0, quota - done) + unit + ' を翌日以降に配分し直します。',
      { okText: '回す' }
    ).then(function (ok) {
      if (!ok) return;
      var r = sc.deferDay(p, t, date);
      ui.toast(r.ok
        ? (r.nextDate ? U.fmtMD(r.nextDate) + ' は ' + r.nextQty + unit + ' になりました' : '配分し直しました')
        : r.reason, r.ok ? '' : 'warn');
    });
  }

  /* =============== ノルマの手動調整 =============== */

  function planOverrideSheet(pid, tid, date) {
    var p = S.getProject(pid), t = S.getTask(pid, tid);
    if (!p || !t || t.unit === 'none') return;
    var plan = sc.taskPlan(p, t);
    var cur = plan.byDate[date] || 0;
    var step = ui.stepper({ value: cur });
    var rg = plan.rangeByDate[date] || {};
    var rt = sc.rangeText(t, rg.from, rg.to);
    var body = el('div', { class: 'form' }, [
      el('p', { class: 'muted small', text: U.fmtYMDW(date) + ' のノルマを固定します。残りの量は他の稼働日へ自動で配分し直されます。' }),
      rt ? el('div', { class: 'preview' }, el('div', { class: 'preview-main' }, [
        el('strong', { text: t.name + ' ' + rt }),
        el('span', { class: 'muted', text: '　現在 ' + cur + (S.UNIT_LABEL[t.unit] || '') })
      ])) : null,
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

  /* =============== 休みの変更にともなう組み直し =============== */

  // 変更前の「各タスクが使える稼働日数」を控えておく
  function planSnapshot() {
    var m = {};
    S.activeProjects().forEach(function (p) {
      (p.tasks || []).forEach(function (t) {
        if (sc.taskIsComplete(t)) return;
        m[p.id + '|' + t.id] = sc.taskPlan(p, t).dayCount;
      });
    });
    return m;
  }

  /**
   * 休みを増やして作業できる日が減った案件を見つけ、組み直しを提案する。
   * @param {object} before planSnapshot() の戻り値
   */
  function offerReschedule(before) {
    var hit = {};
    S.activeProjects().forEach(function (p) {
      (p.tasks || []).forEach(function (t) {
        if (sc.taskIsComplete(t)) return;
        var key = p.id + '|' + t.id;
        if (before[key] === undefined) return;
        if (sc.taskPlan(p, t).dayCount < before[key]) hit[p.id] = p;
      });
    });
    var ids = Object.keys(hit);
    if (!ids.length) return;

    var names = ids.map(function (id) { return hit[id].title; });
    ui.confirm(
      '休みの設定で ' + names.join('、') + ' の作業できる日が減りました。' +
      '今日から締切までの稼働日に、未完了の工程を割り振り直しますか？（そのままだと1日のノルマだけが増えます）',
      { title: 'スケジュールの組み直し', okText: '組み直す', cancelText: 'そのまま' }
    ).then(function (ok) {
      if (!ok) return;
      var done = 0, failed = [];
      ids.forEach(function (id) {
        var r = sc.rescheduleRemaining(S.getProject(id));
        if (r.ok) done++; else failed.push(hit[id].title + '：' + r.reason);
      });
      ui.toast(failed.length ? failed[0] : done + '件のスケジュールを組み直しました', failed.length ? 'warn' : '');
    });
  }

  /* =============== 自動スケジュール =============== */

  function autoScheduleSheet(pid) {
    var p = S.getProject(pid);
    if (!p) return;
    var startI = ui.input({ type: 'date', value: p.startDate || U.today() });
    var endI = ui.input({ type: 'date', value: p.deadline || '' });
    var bufI = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: U.num(S.settings.bufferDays, 1) });
    var scope = ui.segmented([
      { value: 'all', label: '全タスク' },
      { value: 'incomplete', label: '未完了のみ' },
      { value: 'empty', label: '未設定のみ' }
    ], 'all');

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
            buffer: U.num(bufI.value, 0), only: scope.dataset.value
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
      var per = (p.tasks || []).length && days ? Math.ceil(days / p.tasks.length) : 0;
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
    var catSeg = ui.segmented([
      { value: 'manga', label: '漫画', icon: 'manga' },
      { value: 'illust', label: 'イラスト', icon: 'illust' },
      { value: 'design', label: 'デザイン', icon: 'design' }
    ], p.category, function (v) { render(v); });
    var list = el('div', { class: 'tpl-list' });
    var picked = {};

    function render(cat) {
      U.clear(list); picked = {};
      var tpl = S.settings.templates[cat] || [];
      if (!tpl.length) {
        list.appendChild(el('p', { class: 'muted small', text: 'この内容にはテンプレートがありません。設定画面で自分の工程を登録するか、「タスクを追加」で1つずつ作れます。' }));
        return;
      }
      tpl.forEach(function (tp, i) {
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

  /* =============== 名義（発行元） =============== */

  function issuerSheet(id) {
    var existing = id ? S.getIssuer(id) : null;
    var x = existing ? U.clone(existing) : {
      name: '', ownerName: '', zip: '', address: '', tel: '', email: '', web: '',
      invoiceNo: '', bank: { name: '', branch: '', type: '普通', number: '', holder: '' },
      logo: '', seal: '', color: '', note: ''
    };
    if (!x.color) x.color = S.issuerColor(x.id) || S.PALETTE[S.issuers().length % S.PALETTE.length];

    function t(key, ph) {
      var i = ui.input({ value: x[key] || '', placeholder: ph || '' });
      i.addEventListener('input', function () { x[key] = i.value; });
      return i;
    }
    function bank(key, ph) {
      var i = ui.input({ value: x.bank[key] || '', placeholder: ph || '' });
      i.addEventListener('input', function () { x.bank[key] = i.value; });
      return i;
    }

    // ロゴ・印影の登録（縮小して保存する）
    function imageField(key, label, hint, maxSize) {
      var box = el('div', { class: 'imgfield' });
      var file = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      file.addEventListener('change', function () {
        var f = file.files[0];
        file.value = '';
        if (!f) return;
        U.readImage(f, maxSize || 480, 'image/png').then(function (url) {
          x[key] = url;
          render();
          ui.toast('読み込みました');
        }).catch(function (e) { ui.toast(e.message, 'danger'); });
      });
      function render() {
        U.clear(box);
        box.appendChild(x[key]
          ? el('img', { class: 'imgfield-prev' + (key === 'seal' ? ' seal' : ''), src: x[key], alt: '' })
          : el('div', { class: 'imgfield-empty' }, ui.icon('illust', 22)));
        box.appendChild(el('div', { class: 'row-wrap' }, [
          ui.btn(x[key] ? '選び直す' : '画像を選ぶ', 'ghost tiny', function () { file.click(); }, 'plus'),
          x[key] ? ui.btn('削除', 'ghost tiny', function () { x[key] = ''; render(); }) : null
        ]));
        box.appendChild(file);
      }
      render();
      return ui.field(label, box, hint);
    }

    // 名義の識別色（案件一覧や切り替えボタンで使う）
    var colorWrap = el('div', { class: 'colors' });
    S.PALETTE.forEach(function (c) {
      var b = el('button', {
        type: 'button', class: 'color' + (c === x.color ? ' on' : ''), style: { background: c },
        'aria-label': '色', onclick: function () {
          x.color = c;
          U.$$('.color', colorWrap).forEach(function (n) { n.classList.remove('on'); });
          b.classList.add('on');
        }
      });
      colorWrap.appendChild(b);
    });

    var body = el('div', { class: 'form' }, [
      ui.field('名義', t('name', '例）スタジオ○○'), '書類に大きく出る名前です'),
      ui.field('代表者名', t('ownerName', '例）山田 太郎')),
      ui.field('識別色', colorWrap, '案件一覧や名義の切り替えで、この色の目印が付きます'),
      el('div', { class: 'grid2' }, [
        ui.field('郵便番号', t('zip', '000-0000')),
        ui.field('電話番号', t('tel', '000-0000-0000'))
      ]),
      ui.field('住所', t('address', '例）東京都○○区○○ 1-2-3')),
      el('div', { class: 'grid2' }, [
        ui.field('メール', t('email')),
        ui.field('Web', t('web'))
      ]),
      ui.field('インボイス登録番号', t('invoiceNo', 'T1234567890123'), '登録している場合のみ。書類に記載されます'),
      imageField('logo', 'ロゴ', '書類の右上に入ります（長辺480pxに縮小して保存）'),
      imageField('seal', '印影', '発行元の右下に重ねて表示します（背景が白い画像でも構いません）', 300),
      ui.section('お振込先'),
      el('div', { class: 'grid2' }, [
        ui.field('金融機関', bank('name', '例）○○銀行')),
        ui.field('支店', bank('branch', '例）○○支店'))
      ]),
      el('div', { class: 'grid2' }, [
        ui.field('種別', bank('type', '普通')),
        ui.field('口座番号', bank('number', '1234567'))
      ]),
      ui.field('口座名義', bank('holder', 'ヤマダ タロウ')),
      ui.field('備考の既定値', t('note', '請求書の備考に初期表示したい文言'))
    ]);

    if (existing) {
      body.appendChild(ui.btn('この名義を削除', 'danger full mt', function () {
        ui.confirm('「' + (existing.name || '(名称未設定)') + '」を削除します。発行済みの書類の表示にも影響します。', { danger: true, okText: '削除' })
          .then(function (ok) {
            if (!ok) return;
            S.removeIssuer(existing.id); close(); ui.toast('削除しました');
          });
      }, 'trash'));
    }

    var close = ui.sheet({
      title: existing ? '名義を編集' : '名義を登録', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          if (!x.name.trim()) { ui.toast('名義を入れてください', 'warn'); return; }
          if (existing) S.updateIssuer(existing.id, x); else S.addIssuer(x);
          close(); ui.toast('保存しました');
        })
      ]
    });
  }

  /* =============== 取引先 =============== */

  /**
   * 取引先の登録・編集。
   * @param {string|null} id 既存なら取引先ID
   * @param {function} [onSaved] 保存後に呼ばれる（新規作成の直後に選択したいとき用）
   */
  function clientSheet(id, onSaved) {
    var existing = id ? S.getClient(id) : null;
    var c = existing ? U.clone(existing) : {
      name: '', honorific: '御中', contact: '', zip: '', address: '',
      tel: '', email: '', invoiceNo: '', paymentTermDays: 0,
      taxMode: 'exclusive', withholding: false, note: ''
    };

    function t(key, ph) {
      var i = ui.input({ value: c[key] || '', placeholder: ph || '' });
      i.addEventListener('input', function () { c[key] = i.value; });
      return i;
    }

    var honorific = ui.segmented(
      DL.docs.HONORIFICS.map(function (h) { return { value: h, label: h }; }),
      c.honorific, function (v) { c.honorific = v; }
    );
    var taxSeg = ui.segmented([
      { value: 'exclusive', label: '税抜' }, { value: 'inclusive', label: '税込' }, { value: 'none', label: '非課税' }
    ], c.taxMode, function (v) { c.taxMode = v; });

    var term = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: c.paymentTermDays });
    term.addEventListener('input', function () { c.paymentTermDays = U.num(term.value, 0); });

    var wh = el('input', { type: 'checkbox', class: 'check', checked: c.withholding });
    wh.addEventListener('change', function () { c.withholding = wh.checked; });

    var noteArea = ui.textarea({ value: c.note, placeholder: '担当者の連絡先、請求書の送り方など' });
    noteArea.addEventListener('input', function () { c.note = noteArea.value; });

    var body = el('div', { class: 'form' }, [
      ui.field('取引先名', t('name', '例）株式会社○○'), '請求書・領収書の宛名に入ります'),
      ui.field('敬称', honorific, '会社は「御中」、個人は「様」'),
      ui.field('担当者', t('contact', '例）編集部 山田さま')),
      el('div', { class: 'grid2' }, [
        ui.field('郵便番号', t('zip', '000-0000')),
        ui.field('電話番号', t('tel', '000-0000-0000'))
      ]),
      ui.field('住所', t('address', '例）東京都○○区○○ 1-2-3')),
      ui.field('メール', t('email')),
      ui.field('登録番号', t('invoiceNo', 'T1234567890123'), '先方のインボイス登録番号（控えとして保存するだけです）'),
      ui.section('書類の初期値'),
      ui.field('消費税', taxSeg, 'この取引先の書類を作るときの初期値になります'),
      ui.field('支払サイト（日）', term, '0 なら「翌月末」。30 と入れると発行日の30日後が支払期限になります'),
      el('label', { class: 'row-check' }, [wh, el('span', { text: 'いつも源泉徴収される取引先' })]),
      ui.field('メモ', noteArea)
    ]);

    if (existing) {
      var used = S.clientProjects(existing.id).length;
      body.appendChild(ui.btn('この取引先を削除', 'danger full mt', function () {
        ui.confirm('「' + (existing.name || '(名称未設定)') + '」を削除します。' +
          (used ? '紐づいている ' + used + '件の案件は残り、取引先の紐付けだけ外れます。' : ''),
          { danger: true, okText: '削除' })
          .then(function (ok) {
            if (!ok) return;
            S.removeClient(existing.id); close(); ui.toast('削除しました');
          });
      }, 'trash'));
    }

    var close = ui.sheet({
      title: existing ? '取引先を編集' : '取引先を登録', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          if (!c.name.trim()) { ui.toast('取引先名を入れてください', 'warn'); return; }
          var saved = existing ? S.updateClient(existing.id, c) : S.addClient(c);
          close(); ui.toast('保存しました');
          if (onSaved) onSaved(saved);
        })
      ]
    });
  }

  /**
   * 取引先の選択欄。「＋ 新規登録」を選ぶと登録シートが開く。
   * @param {string} value いま選ばれている取引先ID
   * @param {function} onChange 選択が変わったとき（取引先IDを受け取る）
   */
  function clientSelect(value, onChange) {
    var wrap = el('div');
    function render() {
      U.clear(wrap);
      var opts = [{ value: '', label: '（指定しない）' }]
        .concat(S.clients().map(function (c) { return { value: c.id, label: c.name }; }))
        .concat([{ value: '__new', label: '＋ 新しい取引先を登録' }]);
      var sel = ui.select(opts, value, function () {
        if (sel.value === '__new') {
          sel.value = value;
          clientSheet(null, function (c) { value = c.id; render(); onChange(value); });
          return;
        }
        value = sel.value;
        onChange(value);
      });
      wrap.appendChild(sel);
    }
    render();
    wrap.getValue = function () { return value; };
    return wrap;
  }

  /* =============== 書類の内容 =============== */

  function docSheet(pid, did) {
    var p = S.getProject(pid);
    var d = p && S.getDoc(pid, did);
    if (!d) return;
    var work = U.clone(d);
    var isInvoice = work.type === 'invoice';

    function bind(key, node, asNum) {
      node.addEventListener('input', function () { work[key] = asNum ? U.num(node.value, 0) : node.value; });
      node.addEventListener('change', function () { work[key] = asNum ? U.num(node.value, 0) : node.value; });
      return node;
    }
    function txt(key, ph) { return bind(key, ui.input({ value: work[key] || '', placeholder: ph || '' })); }
    function date(key) { return bind(key, ui.input({ type: 'date', value: work[key] || '' })); }

    /* 明細 */
    var itemsBox = el('div', { class: 'items' });
    var totalBox = el('div', { class: 'preview' });

    function renderTotals() {
      U.clear(totalBox);
      var c = DL.docs.calc(work);
      totalBox.appendChild(el('div', { class: 'preview-main' }, [
        el('strong', { text: (isInvoice ? 'ご請求金額 ' : '領収金額 ') + DL.docs.yen(isInvoice ? c.payable : c.total) })
      ]));
      totalBox.appendChild(el('div', { class: 'muted small', text:
        '小計 ' + DL.docs.yen(c.subtotal) +
        (work.taxMode === 'none' ? '' : '　消費税 ' + DL.docs.yen(c.tax)) +
        (work.withholding ? '　源泉 -' + DL.docs.yen(c.withholding) : '') }));
    }

    function renderItems() {
      U.clear(itemsBox);
      work.items.forEach(function (it, i) {
        var name = ui.input({ value: it.name, placeholder: '品目' });
        var qty = ui.input({ type: 'number', inputmode: 'decimal', value: it.qty, placeholder: '数量' });
        var unit = ui.input({ value: it.unit, placeholder: '単位' });
        var price = ui.input({ type: 'number', inputmode: 'numeric', value: it.price, placeholder: '単価' });
        [[name, 'name'], [unit, 'unit']].forEach(function (pair) {
          pair[0].addEventListener('input', function () { it[pair[1]] = pair[0].value; });
        });
        [[qty, 'qty'], [price, 'price']].forEach(function (pair) {
          pair[0].addEventListener('input', function () { it[pair[1]] = U.num(pair[0].value, 0); renderTotals(); });
        });
        var amount = el('span', { class: 'item-amount' });
        function renderAmount() {
          amount.textContent = DL.docs.yen(U.num(it.qty, 0) * U.num(it.price, 0));
        }
        [qty, price].forEach(function (n) { n.addEventListener('input', renderAmount); });
        renderAmount();

        itemsBox.appendChild(el('div', { class: 'item-row' }, [
          el('div', { class: 'item-head' }, [
            el('span', { class: 'field-label', text: '品目 ' + (i + 1) }),
            amount,
            el('button', {
              class: 'iconbtn small danger', 'aria-label': '削除',
              onclick: function () {
                work.items.splice(i, 1);
                if (!work.items.length) work.items.push({ name: '', qty: 1, unit: '式', price: 0 });
                renderItems(); renderTotals();
              }
            }, ui.icon('close', 16))
          ]),
          name,
          el('div', { class: 'grid3' }, [
            ui.field('数量', qty), ui.field('単位', unit), ui.field('単価', price)
          ])
        ]));
      });
      itemsBox.appendChild(ui.btn('明細を追加', 'ghost full', function () {
        work.items.push({ name: '', qty: 1, unit: '式', price: 0 });
        renderItems(); renderTotals();
      }, 'plus'));
    }
    renderItems();
    renderTotals();

    var taxSeg = ui.segmented([
      { value: 'exclusive', label: '税抜' }, { value: 'inclusive', label: '税込' }, { value: 'none', label: '非課税' }
    ], work.taxMode, function (v) { work.taxMode = v; renderTotals(); });

    var taxRate = ui.input({ type: 'number', inputmode: 'numeric', value: work.taxRate });
    taxRate.addEventListener('input', function () { work.taxRate = U.num(taxRate.value, 10); renderTotals(); });

    var wh = el('input', { type: 'checkbox', class: 'check', checked: work.withholding });
    wh.addEventListener('change', function () { work.withholding = wh.checked; renderTotals(); });
    var whRate = ui.input({ type: 'number', inputmode: 'decimal', step: '0.01', value: work.withholdingRate });
    whRate.addEventListener('input', function () { work.withholdingRate = Number(whRate.value) || 0; renderTotals(); });

    var honorific = ui.segmented(
      DL.docs.HONORIFICS.map(function (h) { return { value: h, label: h }; }),
      work.honorific, function (v) { work.honorific = v; }
    );

    // 取引先を選ぶと、宛名・住所・税区分・源泉・支払期限をまとめて入れ直す
    var nameInput = txt('clientName', '例）株式会社○○');
    var zipInput = txt('clientZip', '000-0000');
    var addrInput = txt('clientAddress');
    var dueInput = isInvoice ? date('dueDate') : null;
    var clientPick = clientSelect(work.clientId || '', function (id) {
      var c = id && S.getClient(id);
      if (!c) { work.clientId = ''; return; }
      DL.docs.applyClient(work, c);
      nameInput.value = work.clientName;
      zipInput.value = work.clientZip;
      addrInput.value = work.clientAddress;
      if (dueInput) dueInput.value = work.dueDate;
      U.$$('.seg', honorific).forEach(function (b) {
        b.classList.toggle('on', b.textContent === work.honorific);
      });
      U.$$('.seg', taxSeg).forEach(function (b, i) {
        b.classList.toggle('on', ['exclusive', 'inclusive', 'none'][i] === work.taxMode);
      });
      wh.checked = work.withholding;
      renderTotals();
      ui.toast(c.name + ' の登録内容を反映しました');
    });

    var body = el('div', { class: 'form' }, [
      ui.field('取引先', clientPick, '登録済みの取引先を選ぶと、宛名・住所・支払期限が入ります'),
      ui.field('宛名', nameInput),
      ui.field('敬称', honorific),
      el('div', { class: 'grid2' }, [
        ui.field('先方の郵便番号', zipInput),
        ui.field('発行日', date('issueDate'))
      ]),
      ui.field('先方の住所', addrInput),
      isInvoice ? ui.field('お支払期限', dueInput) : null,
      isInvoice ? ui.field('件名', txt('subject', '例）表紙イラスト制作')) : null,
      ui.section('明細'),
      itemsBox,
      totalBox,
      ui.field('消費税', taxSeg),
      ui.field('税率（%）', taxRate),
      el('label', { class: 'row-check' }, [wh, el('span', { text: '源泉徴収税を差し引く' })]),
      ui.field('源泉徴収税率（%）', whRate, '報酬が100万円以下の場合は 10.21% です'),
      !isInvoice ? ui.field('但し書き', txt('proviso', '例）イラスト制作費として')) : null,
      !isInvoice ? ui.field('お支払方法', txt('paymentMethod', '例）銀行振込')) : null,
      ui.field('備考', ui.textarea({ value: work.note, placeholder: '任意' }))
    ]);
    // 備考は textarea を直接ひもづける
    var noteEl = body.querySelector('textarea');
    noteEl.addEventListener('input', function () { work.note = noteEl.value; });

    var close = ui.sheet({
      title: DL.docs.TYPE_LABEL[work.type] + 'の内容', body: body, wide: true,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.updateDoc(pid, did, work);
          close(); ui.toast('保存しました');
        })
      ]
    });
  }

  DL.forms = {
    projectForm: projectForm, taskForm: taskForm, progressSheet: progressSheet,
    planOverrideSheet: planOverrideSheet, autoScheduleSheet: autoScheduleSheet,
    addProgressSheet: addProgressSheet, deferSheet: deferSheet,
    planSnapshot: planSnapshot, offerReschedule: offerReschedule,
    issuerSheet: issuerSheet, docSheet: docSheet,
    clientSheet: clientSheet, clientSelect: clientSelect,
    templateSheet: templateSheet, startDateSheet: startDateSheet
  };
})(window.DL);
