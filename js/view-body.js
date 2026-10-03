/* からだの台帳（画面）。

   上から、今日のくすり → 次の通院 → 健診の数値 → 今年の医療費 → 通院の記録。
   毎日さわるのは いちばん上だけなので、そこを軽くしてある。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;
  var B = DL.body, D = DL.docs, E = DL.expenses;

  /* 健診の推移で、いまどの数値を見ているか */
  var watch = '';

  function render(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });

    /* ---- 今日のくすり ---- */
    var pr = B.progress(today);
    /* 押すたびに画面を描き直さないので、数のところだけ差し替える */
    var medCount = pr.all ? ui.chip(pr.done + ' / ' + pr.all, pr.left ? 'soft' : 'ok') : null;
    wrap.appendChild(ui.section('今日のくすり', medCount));
    wrap.appendChild(medCard(today, function (p) {
      if (!medCount) return;
      medCount.textContent = p.done + ' / ' + p.all;
      medCount.className = 'chip ' + (p.left ? 'soft' : 'ok');
    }));

    /* ---- 次の通院 ---- */
    wrap.appendChild(ui.section('通院'));
    wrap.appendChild(visitCard(today));

    /* ---- 健診 ---- */
    wrap.appendChild(ui.section('健診の数値',
      el('span', { class: 'muted small',
        text: B.checkups().length ? B.checkups().length + '回ぶん' : '' })));
    wrap.appendChild(checkupCard());

    /* ---- 医療費 ---- */
    wrap.appendChild(ui.section(U.today().slice(0, 4) + '年の医療費',
      el('span', { class: 'muted small', text: '医療費控除の目安' })));
    wrap.appendChild(costCard());

    root.appendChild(wrap);
  }

  /* ---------------- くすり ---------------- */

  function medCard(date, after) {
    var rows = B.dose(date);
    var box = el('div', { class: 'card' });

    if (!rows.length) {
      box.appendChild(el('p', { class: 'muted small',
        text: B.meds({ all: true }).length
          ? '今日飲むものはありません。'
          : 'くすりを登録しておくと、飲んだかどうかをここで押せます。'
            + 'ホームの「今日やること」にも並びます。' }));
    } else {
      var lastSlot = '';
      var list = el('div', { class: 'bd-dose' });
      rows.forEach(function (r) {
        if (r.slot !== lastSlot) {
          lastSlot = r.slot;
          list.appendChild(el('div', { class: 'bd-slot', text: r.label }));
        }
        list.appendChild(doseRow(date, r, after));
      });
      box.appendChild(list);

      var kp = B.keep(date, 14);
      if (kp.all) {
        box.appendChild(el('p', { class: 'muted small',
          text: 'ここ2週間は ' + kp.pct + '%（' + kp.done + ' / ' + kp.all + '回）'
            + (kp.missed.length ? '　飲み忘れ ' + kp.missed.length + '日' : '') }));
      }
    }

    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('くすりを登録', 'ghost', function () { medSheet(null); }, 'plus'),
      B.meds({ all: true }).length
        ? ui.btn('くすりの一覧', 'ghost', function () { medListSheet(); }, 'task') : null
    ]));
    return box;
  }

  /**
   * くすり1回ぶん。
   *
   * 押しても画面は描き直さない。描き直すと、いま押した行が
   * その場から消えてしまい、押せたのかどうか分からなくなる
   * （買い物リストのチェックと同じ考えかた）。
   * 数の出ているところだけ、after で直す。
   */
  function doseRow(date, r, after) {
    var box = el('label', { class: 'bd-pill' + (r.taken ? ' on' : '') }, [
      el('input', {
        type: 'checkbox', class: 'mn-chk', checked: r.taken,
        'aria-label': r.med.name + 'を飲んだ',
        onchange: function (e) {
          var on = e.target.checked;
          B.take(date, r.med.id, r.slot, on);
          box.classList.toggle('on', on);
          if (after) after(B.progress(date));
        }
      }),
      el('span', { class: 'bd-pill-n', text: r.med.name }),
      r.med.dose ? el('span', { class: 'muted small', text: r.med.dose }) : null
    ]);
    return box;
  }

  function medSheet(m) {
    var isNew = !m;
    var v = m || { name: '', dose: '', times: ['morning'], weekdays: [], from: '', until: '',
      memo: '', active: true };

    var nameIn = ui.input({ value: v.name === '(名称未設定)' ? '' : (v.name || '') });
    var doseIn = ui.input({ value: v.dose || '', placeholder: '1錠' });
    var fromIn = ui.input({ type: 'date', value: v.from || '' });
    var untilIn = ui.input({ type: 'date', value: v.until || '' });
    var memoIn = ui.textarea({ value: v.memo || '' });
    var activeChk = el('input', { type: 'checkbox', class: 'check', checked: v.active !== false });

    var times = (v.times || []).slice();
    var timesBox = el('div', { class: 'row-wrap' }, B.SLOTS.map(function (sl) {
      var on = times.indexOf(sl.key) >= 0;
      var b = el('button', {
        type: 'button', class: 'chip pick' + (on ? ' on' : ''),
        onclick: function () {
          var at = times.indexOf(sl.key);
          if (at >= 0) times.splice(at, 1); else times.push(sl.key);
          b.classList.toggle('on', times.indexOf(sl.key) >= 0);
        }
      }, el('span', { text: sl.label }));
      return b;
    }));

    var wd = (v.weekdays || []).slice();
    var wdBox = el('div', { class: 'row-wrap' }, [0, 1, 2, 3, 4, 5, 6].map(function (d) {
      var on = wd.indexOf(d) >= 0;
      var b = el('button', {
        type: 'button', class: 'chip pick' + (on ? ' on' : ''),
        onclick: function () {
          var at = wd.indexOf(d);
          if (at >= 0) wd.splice(at, 1); else wd.push(d);
          b.classList.toggle('on', wd.indexOf(d) >= 0);
        }
      }, el('span', { text: U.wdName(d) }));
      return b;
    }));

    var close = ui.sheet({
      title: isNew ? 'くすりを登録' : 'くすりを編集',
      body: el('div', { class: 'form' }, [
        ui.field('名前', nameIn),
        ui.field('1回の量', doseIn),
        ui.block('いつ飲むか', timesBox),
        ui.block('曜日', wdBox, '何も選ばなければ毎日'),
        el('div', { class: 'grid2' }, [
          ui.field('いつから', fromIn),
          ui.field('いつまで', untilIn)
        ]),
        ui.field('メモ', memoIn),
        el('label', { class: 'row-check' }, [activeChk, el('span', { text: '飲んでいる' })]),
        !isNew ? ui.btn('このくすりを削除', 'danger full mt', function () {
          ui.confirm('「' + m.name + '」を削除します。飲んだ記録も一緒に消えます。',
            { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeMed(m.id); close(); ui.toast('削除しました'); DL.app.render();
          });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var name = nameIn.value.trim();
          if (!name) { ui.toast('名前を入れてください', 'warn'); return; }
          if (!times.length) { ui.toast('いつ飲むかを選んでください', 'warn'); return; }
          var data = {
            name: name, dose: doseIn.value.trim(), times: times, weekdays: wd,
            from: fromIn.value, until: untilIn.value, memo: memoIn.value.trim(),
            active: activeChk.checked
          };
          if (isNew) S.addMed(data); else S.updateMed(m.id, data);
          close(); ui.toast(isNew ? '登録しました' : '保存しました'); DL.app.render();
        })
      ]
    });
  }

  function medListSheet() {
    var box = el('div', { class: 'list' }, B.meds({ all: true }).map(function (m) {
      return el('button', {
        type: 'button', class: 'row', onclick: function () { close(); medSheet(m); }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            el('span', { text: m.name }),
            m.active === false ? ui.chip('やめた', 'ghosty') : null
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip((m.times || []).map(B.slotLabel).join('・'), 'soft'),
            m.dose ? ui.chip(m.dose, 'ghosty') : null,
            (m.weekdays || []).length
              ? ui.chip(m.weekdays.map(U.wdName).join('・'), 'ghosty') : null,
            m.until ? ui.chip('〜' + U.fmtMD(m.until), 'ghosty') : null
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]);
    }));
    var close = ui.sheet({ title: 'くすりの一覧', body: box });
  }

  /* ---------------- 通院 ---------------- */

  function visitCard(today) {
    var box = el('div', { class: 'card' });
    var nx = B.nextVisit(today);

    if (nx) {
      var left = U.diffDays(today, nx.date);
      box.appendChild(el('div', { class: 'bd-next' + (left <= 1 ? ' soon' : '') }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            ui.icon('clock', 16),
            el('span', { text: '次の予約　' + U.fmtYMDW(nx.date)
              + (nx.from.nextTime ? ' ' + nx.from.nextTime : '') })
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip(U.untilLabel(nx.date, today), left <= 1 ? 'warn' : 'soft'),
            nx.place ? ui.chip(nx.place, 'ghosty') : null,
            nx.dept ? ui.chip(nx.dept, 'ghosty') : null
          ])
        ])
      ]));
    } else {
      box.appendChild(el('p', { class: 'muted small', text: '次の予約は入っていません。' }));
    }

    var list = B.visits().slice(0, 3);
    if (list.length) {
      box.appendChild(el('div', { class: 'list tight' }, list.map(function (v) {
        return el('button', {
          type: 'button', class: 'row flat', onclick: function () { visitSheet(v); }
        }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              el('span', { text: v.place || '通院' })
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip(U.fmtMD(v.date), 'soft'),
              v.dept ? ui.chip(v.dept, 'ghosty') : null,
              v.reason ? ui.chip(v.reason, 'ghosty') : null
            ])
          ]),
          v.cost ? el('b', { class: 'fx-v', text: D.yen(v.cost) }) : null,
          el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
        ]);
      })));
    }

    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('通院を記録', 'primary', function () { visitSheet(null); }, 'plus'),
      B.visits().length > 3
        ? ui.btn('ぜんぶ見る（' + B.visits().length + '件）', 'ghost',
          function () { visitListSheet(); }, 'task') : null
    ]));
    return box;
  }

  function visitSheet(v) {
    var isNew = !v;
    var x = v || { date: U.today(), time: '', place: '', dept: '', reason: '',
      cost: 0, memo: '', next: '', nextTime: '' };

    var dateIn = ui.input({ type: 'date', value: x.date });
    var timeIn = ui.input({ type: 'time', value: x.time || '' });
    var placeIn = ui.input({ value: x.place || '' });
    var deptIn = ui.input({ value: x.dept || '', placeholder: '内科' });
    var reasonIn = ui.input({ value: x.reason || '' });
    var costIn = ui.input({ type: 'number', inputmode: 'numeric',
      value: x.cost ? String(x.cost) : '' });
    var memoIn = ui.textarea({ value: x.memo || '' });
    var nextIn = ui.input({ type: 'date', value: x.next || '' });
    var nextTimeIn = ui.input({ type: 'time', value: x.nextTime || '' });
    // すでに経費に入っているものは、二度入れない
    var hasExpense = !!(x.expenseId && S.getExpense(x.expenseId));
    var recChk = el('input', { type: 'checkbox', class: 'check', checked: !hasExpense });

    var close = ui.sheet({
      title: isNew ? '通院を記録' : '通院の記録',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'grid2' }, [
          ui.field('日付', dateIn),
          ui.field('時刻', timeIn)
        ]),
        ui.field('どこ', placeIn),
        el('div', { class: 'grid2' }, [
          ui.field('科', deptIn),
          ui.field('かかった額（円）', costIn)
        ]),
        ui.field('何で', reasonIn),
        ui.field('メモ', memoIn),
        el('div', { class: 'grid2' }, [
          ui.field('次の予約', nextIn),
          ui.field('時刻', nextTimeIn)
        ]),
        hasExpense
          ? el('p', { class: 'muted small', text: 'この通院は、もう経費に入っています。' })
          : el('label', { class: 'row-check' }, [recChk,
            el('span', { text: '経費にも記録する（日常・' + B.MEDICAL_CATEGORY + '）' })]),
        !isNew ? ui.btn('この記録を削除', 'danger full mt', function () {
          ui.confirm('この通院の記録を削除します。経費に入れたぶんはそのまま残ります。',
            { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeVisit(v.id); close(); ui.toast('削除しました'); DL.app.render();
          });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var cost = Math.max(0, Math.round(U.num(costIn.value, 0)));
          var data = {
            date: dateIn.value || U.today(), time: timeIn.value,
            place: placeIn.value.trim(), dept: deptIn.value.trim(),
            reason: reasonIn.value.trim(), cost: cost, memo: memoIn.value.trim(),
            next: nextIn.value, nextTime: nextTimeIn.value
          };
          /* 医療費は確定申告に効くので、経費にも同じものを入れておく。
             二重に数えないよう、入れた経費の id を覚えておく */
          if (!hasExpense && recChk.checked && cost > 0) {
            var ex = S.addExpense({
              book: 'life', date: data.date, amount: cost,
              category: B.MEDICAL_CATEGORY,
              vendor: data.place || '病院',
              memo: data.reason || '通院'
            });
            data.expenseId = ex ? ex.id : '';
          }
          if (isNew) S.addVisit(data); else S.updateVisit(v.id, data);
          close(); ui.toast(isNew ? '記録しました' : '保存しました'); DL.app.render();
        })
      ]
    });
  }

  function visitListSheet() {
    var box = el('div', { class: 'list' }, B.visits().map(function (v) {
      return el('button', {
        type: 'button', class: 'row', onclick: function () { close(); visitSheet(v); }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [el('span', { text: v.place || '通院' })]),
          el('div', { class: 'row-sub' }, [
            ui.chip(U.fmtYMD(v.date), 'soft'),
            v.dept ? ui.chip(v.dept, 'ghosty') : null,
            v.reason ? ui.chip(v.reason, 'ghosty') : null
          ])
        ]),
        v.cost ? el('b', { class: 'fx-v', text: D.yen(v.cost) }) : null
      ]);
    }));
    var close = ui.sheet({ title: '通院の記録', body: box });
  }

  /* ---------------- 健診 ---------------- */

  function checkupCard() {
    var all = B.checkups();
    var box = el('div', { class: 'card' });

    if (!all.length) {
      box.appendChild(el('p', { class: 'muted small',
        text: '健診の数値を入れておくと、前回とくらべられます。' }));
      box.appendChild(el('div', { class: 'row-wrap' }, [
        ui.btn('健診を入れる', 'primary', function () { checkupSheet(null); }, 'plus')
      ]));
      return box;
    }

    var last = all[0], prev = all[1];
    box.appendChild(el('div', { class: 'row-sub' }, [
      ui.chip(U.fmtYMD(last.date), 'soft'),
      ui.chip(last.name, 'ghosty'),
      prev ? ui.chip('前回 ' + U.fmtYMD(prev.date), 'ghosty') : null
    ]));

    var keys = Object.keys(last.values || {});
    if (!keys.length) {
      box.appendChild(el('p', { class: 'muted small', text: '数値がまだ入っていません。' }));
    } else {
      var grid = el('div', { class: 'bd-vitals' });
      keys.forEach(function (k) {
        var v = B.vital(k) || { label: k, unit: '' };
        var now = last.values[k];
        var was = prev ? (prev.values || {})[k] : undefined;
        var j = B.judge(k, now);
        var diff = (was === undefined || was === null) ? null : Math.round((now - was) * 100) / 100;
        grid.appendChild(el('button', {
          type: 'button', class: 'bd-vital' + (j && j.how !== 'ok' ? ' out' : ''),
          onclick: function () { watch = k; trendSheet(k); }
        }, [
          el('span', { class: 'bd-vital-k', text: v.label }),
          el('b', { class: 'bd-vital-v', text: String(now) + (v.unit ? ' ' + v.unit : '') }),
          el('span', { class: 'bd-vital-d' }, [
            j ? ui.chip(j.label, j.how === 'ok' ? 'ok' : 'warn') : null,
            diff !== null && diff !== 0
              ? el('span', { class: 'muted small', text: (diff > 0 ? '＋' : '−') + Math.abs(diff) })
              : null
          ])
        ]));
      });
      box.appendChild(grid);
    }

    var out = B.outliers();
    if (out.length) {
      box.appendChild(el('div', { class: 'alert warn' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: '基準から外れているもの：'
          + out.map(function (o) { return o.label; }).join('・') })
      ]));
    }

    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('健診を入れる', 'ghost', function () { checkupSheet(null); }, 'plus'),
      ui.btn('この回を直す', 'ghost', function () { checkupSheet(last); }, 'edit'),
      all.length > 1 ? ui.btn('これまで（' + all.length + '回）', 'ghost',
        function () { checkupListSheet(); }, 'chartLine') : null
    ]));
    return box;
  }

  function checkupSheet(c) {
    var isNew = !c;
    var x = c || { date: U.today(), name: '健診', memo: '', values: {} };
    var dateIn = ui.input({ type: 'date', value: x.date });
    var nameIn = ui.input({ value: x.name || '健診' });
    var memoIn = ui.textarea({ value: x.memo || '' });

    var ins = {};
    var grid = el('div', { class: 'bd-input-grid' }, B.VITALS.map(function (v) {
      var val = (x.values || {})[v.key];
      ins[v.key] = ui.input({ type: 'number', inputmode: 'decimal', step: 'any',
        value: (val === undefined || val === null) ? '' : String(val) });
      return el('label', { class: 'bd-input' }, [
        el('span', { class: 'bd-input-k' }, [
          el('span', { text: v.label }),
          v.unit ? el('i', { text: v.unit }) : null
        ]),
        ins[v.key],
        B.rangeLabel(v.key)
          ? el('span', { class: 'bd-input-r', text: B.rangeLabel(v.key) }) : null
      ]);
    }));

    var close = ui.sheet({
      title: isNew ? '健診を入れる' : '健診を直す',
      wide: true,
      body: el('div', { class: 'form' }, [
        el('div', { class: 'grid2' }, [
          ui.field('日付', dateIn),
          ui.field('名前', nameIn)
        ]),
        el('p', { class: 'muted small', text: '入れたものだけ残ります。空のままで構いません。' }),
        grid,
        ui.field('メモ', memoIn),
        !isNew ? ui.btn('この回を削除', 'danger full mt', function () {
          ui.confirm('この健診の記録を削除します。', { danger: true, okText: '削除' })
            .then(function (ok) {
              if (!ok) return;
              S.removeCheckup(c.id); close(); ui.toast('削除しました'); DL.app.render();
            });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var values = {};
          Object.keys(ins).forEach(function (k) {
            var s = String(ins[k].value || '').trim();
            // 小数のまま持つ（store が丸めかたを決める）
            if (s !== '') values[k] = s;
          });
          var data = { date: dateIn.value || U.today(), name: nameIn.value.trim() || '健診',
            memo: memoIn.value.trim(), values: values };
          if (isNew) S.addCheckup(data); else S.updateCheckup(c.id, data);
          close(); ui.toast(isNew ? '入れました' : '保存しました'); DL.app.render();
        })
      ]
    });
  }

  /** ひとつの数値の推移 */
  function trendSheet(key) {
    var v = B.vital(key) || { label: key, unit: '' };
    var rows = B.series(key);
    var body = el('div', {});

    if (rows.length < 2) {
      body.appendChild(el('p', { class: 'muted small pad', text: 'まだ1回ぶんしかありません。' }));
    } else {
      var vals = rows.map(function (r) { return r.value; });
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      var span = (hi - lo) || 1;
      body.appendChild(el('div', { class: 'bd-trend' }, rows.map(function (r) {
        var j = B.judge(key, r.value);
        return el('div', { class: 'bd-trend-row' }, [
          el('span', { class: 'bd-trend-d', text: U.fmtYMD(r.date) }),
          el('span', { class: 'bd-trend-rail' },
            el('i', { style: {
              width: Math.round((r.value - lo) / span * 80 + 20) + '%',
              background: j && j.how !== 'ok' ? 'var(--warn)' : 'var(--accent)'
            } })),
          el('b', { class: 'bd-trend-v', text: String(r.value) })
        ]);
      })));
    }

    body.appendChild(el('p', { class: 'muted small pad',
      text: B.rangeLabel(key) ? 'ふつうの範囲：' + B.rangeLabel(key) + (v.unit ? ' ' + v.unit : '')
        : '基準は決めていません' }));
    ui.sheet({ title: v.label + 'の推移', body: body });
  }

  function checkupListSheet() {
    var box = el('div', { class: 'list' }, B.checkups().map(function (c) {
      return el('button', {
        type: 'button', class: 'row', onclick: function () { close(); checkupSheet(c); }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [el('span', { text: c.name })]),
          el('div', { class: 'row-sub' }, [
            ui.chip(U.fmtYMD(c.date), 'soft'),
            ui.chip(Object.keys(c.values || {}).length + '項目', 'ghosty')
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]);
    }));
    var close = ui.sheet({ title: '健診のこれまで', body: box });
  }

  /* ---------------- 医療費 ---------------- */

  function costCard() {
    var c = B.cost();
    var box = el('div', { class: 'card' });
    box.appendChild(el('div', { class: 'sum-grid' }, [
      el('div', { class: 'sum-box' }, [el('span', { text: '今年の医療費' }), el('b', { text: D.yen(c.total) })]),
      el('div', { class: 'sum-box' }, [el('span', { text: '控除の対象' }), el('b', { text: D.yen(c.over) })]),
      el('div', { class: 'sum-box' }, [el('span', { text: '10万円まで' }), el('b', { text: D.yen(c.left) })])
    ]));
    box.appendChild(el('p', { class: 'muted small',
      text: c.over
        ? '10万円を超えたぶん（' + D.yen(c.over) + '）が医療費控除の対象になります。'
          + '領収書は残しておいてください。'
        : 'あと ' + D.yen(c.left) + ' で医療費控除の目安（10万円）に届きます。' }));
    box.appendChild(el('p', { class: 'muted small',
      text: '通院に入れた額と、経費（日常・' + B.MEDICAL_CATEGORY + '）を合わせて数えています。' }));
    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('経理を見る', 'ghost', function () { location.hash = '#/books'; }, 'books')
    ]));
    return box;
  }

  /* ---------------- ほかの画面から ---------------- */

  /** ホームの下に置く入口 */
  function entry() {
    var today = U.today();
    var pr = B.progress(today);
    var nx = B.nextVisit(today);
    return el('a', { class: 'row', href: '#/body' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('heart', 17), el('span', { text: 'からだの台帳' })
        ]),
        (pr.all || nx) ? el('div', { class: 'row-sub' }, [
          pr.all ? ui.chip('くすり ' + pr.done + '/' + pr.all, pr.left ? 'soft' : 'ok') : null,
          nx ? ui.chip('次の通院 ' + U.fmtMD(nx.date), 'ghosty') : null
        ]) : null
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /** ホームの「今日やること」に出す、くすりの行 */
  function todoRow(date) {
    var pr = B.progress(date);
    if (!pr.all || !pr.left) return null;
    var rows = B.dose(date).filter(function (r) { return !r.taken; });
    var title = el('span', { text: 'くすり　あと ' + pr.left + '回' });
    /* 押しても消さず、そのまま残して線を引く。
       「押したのに手応えが無い」のを避けるため（買い物リストと同じ） */
    var after = function (p) {
      title.textContent = p.left ? 'くすり　あと ' + p.left + '回' : 'くすり　ぜんぶ飲んだ';
    };
    return el('div', { class: 'row home-med' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [ui.icon('heart', 16), title]),
        el('div', { class: 'bd-dose flat' }, rows.map(function (r) {
          return doseRow(date, r, after);
        }))
      ])
    ]);
  }

  DL.views = DL.views || {};
  DL.views.body = { render: render, entry: entry, todoRow: todoRow,
    medSheet: medSheet, visitSheet: visitSheet };
})(window.DL);
