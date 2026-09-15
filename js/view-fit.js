/* 筋トレ。今日やること・体重・続きぐあいを1画面に。

   計画を考えるのは OpenAI。次に持つ重さを決めるのはこちら（fit.js）。
   この画面は、その2つを出して、やったことを書き留めるところ。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, F = DL.fit, el = U.el;

  var WDAY = ['日', '月', '火', '水', '木', '金', '土'];
  var DONE_LABEL = { full: 'やった', part: '途中まで', skip: 'できなかった' };

  function render(root, params) {
    var date = U.isISO(params && params.date) ? params.date : U.today();
    var wrap = el('div', { class: 'page fit-page' });
    /* ショートカットが預けてくれた体重を、開いた拍子に入れる。
       届いていれば描き直す（何も無ければ黙って終わる） */
    F.autoPull().then(function (r) { if (r && r.added) DL.app.render(); });

    wrap.appendChild(todayCard(date));
    wrap.appendChild(weekStrip(date));
    wrap.appendChild(ui.section('体重', el('span', { class: 'muted small', text: bodyLine() })));
    wrap.appendChild(weightCard());
    wrap.appendChild(ui.section('続きぐあい', el('span', { class: 'muted small', text: 'ここ4週' })));
    wrap.appendChild(keepCard());

    wrap.appendChild(el('div', { class: 'actions' }, [
      ui.btn('計画を作ってもらう', 'primary', function () { planSheet(date); }, 'idea'),
      ui.btn('体重を入れる', 'ghost', function () { weightSheet(U.today()); }, 'plus'),
      ui.btn('体重計から取り込む', 'ghost', function () { importSheet(); }, 'cloud'),
      ui.btn('からだと目標の設定', 'ghost', function () { profileSheet(); }, 'settings'),
      ui.btn('記録の一覧', 'ghost', function () { historySheet(); }, 'task')
    ]));

    root.appendChild(wrap);
  }

  /* 身長・BMI をひとことで */
  function bodyLine() {
    var p = S.fit().profile;
    var w = S.latestWeight();
    if (!w) return p.height ? p.height + 'cm' : '';
    var b = F.bmi(w.kg, p.height);
    return (p.height ? p.height + 'cm　' : '') + (b ? 'BMI ' + b : '');
  }

  /* ---------------- 今日 ---------------- */

  function todayCard(date) {
    var plan = S.fitPlan(date);
    var log = S.fitLog(date);
    var box = el('div', { class: 'card fit-today' });

    box.appendChild(el('div', { class: 'fit-head' }, [
      el('div', { class: 'fit-head-l' }, [
        el('span', { class: 'cd-label', text: U.fmtYMDW(date) + (date === U.today() ? '　今日' : '') }),
        el('b', { text: plan ? plan.title : 'まだ計画がありません' })
      ]),
      el('div', { class: 'row-sub' }, [
        plan && plan.kind === 'rest' ? ui.chip('休み', 'ghosty') : null,
        plan && plan.minutes ? ui.chip(plan.minutes + '分', 'soft') : null,
        log ? ui.chip(DONE_LABEL[log.done], log.done === 'skip' ? 'danger' : 'ok') : null
      ])
    ]));

    if (!plan) {
      box.appendChild(el('p', { class: 'muted small',
        text: '「計画を作ってもらう」を押すと、いまの体重と直近の記録から、'
          + '何日かぶんをまとめて組んでもらえます。' }));
      return box;
    }

    if (plan.focus) box.appendChild(el('p', { class: 'fit-focus', text: plan.focus }));
    if (plan.warmup.length) box.appendChild(listLine('準備', plan.warmup));

    if (plan.items.length) {
      var list = el('div', { class: 'fit-items' });
      plan.items.forEach(function (i) {
        var doneItem = log && log.items.filter(function (x) { return x.name === i.name; })[0];
        list.appendChild(el('div', { class: 'fit-item' + (doneItem ? ' is-done' : '') }, [
          el('div', { class: 'fit-item-h' }, [
            el('b', { text: i.name }),
            i.gear ? ui.chip(i.gear, 'ghosty') : null
          ]),
          el('div', { class: 'fit-set' }, [
            el('span', { class: 'fit-w', text: i.weight ? i.weight + 'kg' : '自重' }),
            el('span', { text: '×' + i.reps + '回　' + i.sets + 'セット' }),
            i.rest ? el('span', { class: 'muted', text: '休み' + i.rest + '秒' }) : null
          ]),
          i.note ? el('p', { class: 'muted small', text: i.note }) : null,
          doneItem ? el('p', { class: 'fit-did',
            text: '記録：' + doneItem.sets.map(function (s) {
              return (s.weight ? s.weight + 'kg×' : '') + s.reps;
            }).join('　') }) : null
        ]));
      });
      box.appendChild(list);
    }

    if (plan.cardio) {
      box.appendChild(el('div', { class: 'fit-cardio' }, [
        ui.icon('wSun', 15),
        el('span', { text: plan.cardio.kind
          + (plan.cardio.distance ? '　' + plan.cardio.distance + 'km' : '')
          + (plan.cardio.minutes ? '　' + plan.cardio.minutes + '分' : '')
          + (plan.cardio.pace ? '　' + plan.cardio.pace : '') }),
        plan.cardio.note ? el('span', { class: 'muted small', text: plan.cardio.note }) : null
      ]));
    }

    if (plan.cooldown.length) box.appendChild(listLine('整理', plan.cooldown));
    if (plan.note) box.appendChild(el('p', { class: 'muted small', text: plan.note }));

    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn(log ? '記録を直す' : '記録する', log ? 'ghost' : 'primary', function () {
        logSheet(date);
      }, 'check'),
      ui.btn('計画を直す', 'ghost tiny', function () { planEditSheet(date); }),
      ui.btn('この日の計画を消す', 'ghost tiny', function () {
        ui.confirm(U.fmtMD(date) + ' の計画を消します。', { danger: true, okText: '消す' })
          .then(function (ok) { if (ok) { S.removeFitPlan(date); ui.toast('消しました'); } });
      })
    ]));
    return box;
  }

  function listLine(label, arr) {
    return el('p', { class: 'fit-line' }, [
      el('span', { class: 'fit-line-k', text: label }),
      el('span', { text: arr.join('／') })
    ]);
  }

  /* ---------------- 1週間の並び ---------------- */

  function weekStrip(date) {
    var today = U.today();
    var from = U.addDays(today, -1);
    var box = el('div', { class: 'fit-week' });
    U.rangeDays(from, U.addDays(from, 8)).forEach(function (d) {
      var p = S.fitPlan(d), l = S.fitLog(d);
      var cls = 'fit-day';
      if (d === date) cls += ' on';
      if (d === today) cls += ' today';
      if (l && l.done !== 'skip') cls += ' done';
      else if (l) cls += ' miss';
      if (p && p.kind === 'rest') cls += ' rest';
      box.appendChild(el('button', {
        class: cls, 'aria-label': U.fmtMDW(d) + '　' + ((p && p.title) || '計画なし'),
        onclick: function () { location.hash = '#/fit/' + d; }
      }, [
        el('span', { class: 'fd-w', text: WDAY[U.parse(d).getDay()] }),
        el('b', { text: String(U.num(d.slice(8, 10), 0)) }),
        el('span', { class: 'fd-t', text: p ? shortTitle(p) : '—' })
      ]));
    });
    return box;
  }

  function shortTitle(p) {
    if (p.kind === 'rest') return '休';
    if (p.kind === 'run') return 'ラン';
    return String(p.title || 'ジム').slice(0, 4);
  }

  /* ---------------- 体重 ---------------- */

  function weightCard() {
    var box = el('div', { class: 'card' });
    var t = F.trend(28);
    var w = S.latestWeight();
    var pr = S.fit().profile;

    if (!w) {
      box.appendChild(ui.empty('体重をまだ入れていません。',
        ui.btn('体重を入れる', 'primary', function () { weightSheet(U.today()); })));
      return box;
    }

    var goal = pr.goalWeight;
    box.appendChild(el('div', { class: 'sum-grid' }, [
      el('div', { class: 'sum-box' }, [
        el('span', { text: U.fmtMD(w.date) }), el('b', { text: w.kg + 'kg' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: '4週で' }),
        el('b', { class: t && t.diff > 0 ? 'up' : t && t.diff < 0 ? 'down' : '',
          text: t ? (t.diff >= 0 ? '+' : '') + t.diff + 'kg' : '—' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: goal ? '目標まで' : '体脂肪' }),
        el('b', { text: goal ? Math.round((w.kg - goal) * 10) / 10 + 'kg'
          : (w.fat ? w.fat + '%' : '—') })
      ])
    ]));

    var chart = weightChart();
    if (chart) box.appendChild(chart);

    if (t && t.n >= 2) {
      box.appendChild(el('p', { class: 'muted small', text: paceLine(t, pr) }));
    }
    return box;
  }

  /* 増減の速さについて、ひとこと */
  function paceLine(t, pr) {
    var w = t.perWeek;
    if (pr.goal === 'cut') {
      if (w > 0) return '増えています。食べる量を少し見直してみてください。';
      if (w < -1) return '週 ' + (-w) + 'kg は落としすぎです。筋肉も落ちます。';
      return '週 ' + (-w) + 'kg。落とすならこのくらいがちょうどよい速さです。';
    }
    // 増やす方向。週 0.2〜0.5kg くらいが、脂肪をあまり付けずに増やせる目安
    if (w <= 0) return '増えていません。ガチムチを目指すなら、食べる量を少し増やしてください。';
    if (w > 0.6) return '週 +' + w + 'kg は速すぎます。脂肪が乗りやすいので、少し落としてください。';
    return '週 +' + w + 'kg。増やす速さとしてはちょうどよいところです。';
  }

  function weightChart() {
    var t = F.trend(56);
    if (!t || t.rows.length < 2) return null;
    var rows = t.rows;
    var pr = S.fit().profile;

    var vals = rows.map(function (r) { return r.kg; });
    if (pr.goalWeight) vals.push(pr.goalWeight);
    var lo = Math.floor(Math.min.apply(null, vals) - 1);
    var hi = Math.ceil(Math.max.apply(null, vals) + 1);
    if (hi - lo < 4) hi = lo + 4;

    var W = 320, H = 130, L = 34, R = 8, T = 10, B = 18;
    var iw = W - L - R, ih = H - T - B;
    var x = function (i) { return L + (rows.length === 1 ? iw / 2 : i * iw / (rows.length - 1)); };
    var y = function (v) { return T + ih - (v - lo) / (hi - lo) * ih; };

    var svg = svgEl('svg', {
      class: 'lchart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': '体重の推移'
    });
    for (var g = 0; g <= 2; g++) {
      var gv = lo + (hi - lo) / 2 * g;
      svg.appendChild(svgEl('line', { class: 'lc-grid', x1: L, x2: W - R, y1: y(gv), y2: y(gv) }));
      svg.appendChild(svgEl('text', {
        class: 'lc-ytick', x: L - 5, y: y(gv) + 3, 'text-anchor': 'end'
      }, String(Math.round(gv * 10) / 10)));
    }
    if (pr.goalWeight && pr.goalWeight >= lo && pr.goalWeight <= hi) {
      svg.appendChild(svgEl('line', {
        class: 'lc-goal', x1: L, x2: W - R, y1: y(pr.goalWeight), y2: y(pr.goalWeight)
      }));
    }
    svg.appendChild(svgEl('polyline', {
      class: 'lc-line is-used',
      points: rows.map(function (r, i) {
        return Math.round(x(i) * 10) / 10 + ',' + Math.round(y(r.kg) * 10) / 10;
      }).join(' ')
    }));
    // 端の日付だけ
    [0, rows.length - 1].forEach(function (i) {
      svg.appendChild(svgEl('text', {
        class: 'lc-xtick', x: x(i), y: H - 5,
        'text-anchor': i === 0 ? 'start' : 'end'
      }, U.fmtMD(rows[i].date)));
    });
    return el('div', { class: 'lchart-box' }, svg);
  }

  function svgEl(name, attrs, text) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------------- 続きぐあい ---------------- */

  function keepCard() {
    var r = F.recent(4);
    return el('div', { class: 'card sum-grid' }, [
      el('div', { class: 'sum-box' }, [
        el('span', { text: 'できた' }), el('b', { text: r.done + '/' + r.planned + '回' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: 'ジム' }), el('b', { text: r.gym + '回' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: '有酸素' }), el('b', { text: r.run + '回' })
      ]),
      el('div', { class: 'sum-box' }, [
        el('span', { text: '続けて' }), el('b', { text: r.streak + '回' })
      ])
    ]);
  }

  /* ---------------- 計画を作ってもらう ---------------- */

  function planSheet(date) {
    var pr = S.fit().profile;
    var daysSel = ui.select([
      { value: '7', label: '1週間ぶん' },
      { value: '14', label: '2週間ぶん' },
      { value: '3', label: '3日ぶん' }
    ], '7');
    var fromIn = ui.input({ type: 'date', value: U.today() });
    var noteIn = ui.textarea({ rows: 2,
      placeholder: '例）今週は腰が張っているのでデッドは軽めに／出張で火曜は行けない' });
    var out = el('div', { class: 'fit-out' });
    var busy = false;

    var goBtn = ui.btn('考えてもらう', 'primary full', function () { run(); }, 'idea');

    var body = el('div', { class: 'form' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'row-sub' }, [
          ui.chip(S.FIT_GOALS.filter(function (g) { return g.value === pr.goal; })
            .map(function (g) { return g.label; })[0] || '', 'soft'),
          ui.chip('週' + pr.days + '回', 'ghosty'),
          ui.chip('1回' + pr.minutes + '分', 'ghosty'),
          S.latestWeight() ? ui.chip(S.latestWeight().kg + 'kg', 'ghosty') : null
        ]),
        el('p', { class: 'muted small',
          text: 'いまの体重・直近の記録・種目ごとの重さを渡して組んでもらいます。' })
      ]),
      ui.field('いつから', fromIn),
      ui.field('どのくらい', daysSel),
      ui.field('足しておきたいこと', noteIn),
      goBtn,
      out
    ]);

    if (!F.ready()) {
      body.insertBefore(el('div', { class: 'alert warn' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: '同期の接続先がまだです。設定の「PC・iPhone の同期」からつないでください。' })
      ]), body.firstChild);
    }

    ui.sheet({ title: '計画を作ってもらう', body: body });

    function run() {
      if (busy) return;
      busy = true;
      goBtn.disabled = true;
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: '組んでいます…（30秒ほどかかります）' }));
      F.plan({ from: fromIn.value, days: U.num(daysSel.value, 7), note: noteIn.value })
        .then(function (r) {
          busy = false;
          goBtn.disabled = false;
          goBtn.querySelector('span').textContent = 'もう一度考えてもらう';
          U.clear(out);
          out.appendChild(planPreview(r));
        }).catch(function (e) {
          busy = false;
          goBtn.disabled = false;
          U.clear(out);
          out.appendChild(el('p', { class: 'mn-warn small' }, [
            ui.icon('alert', 14), el('span', { text: e.message })
          ]));
        });
    }
  }

  function planPreview(r) {
    var box = el('div', {});
    (r.plans || []).forEach(function (d) {
      box.appendChild(el('div', { class: 'card fit-prev' }, [
        el('div', { class: 'fit-item-h' }, [
          el('b', { text: U.fmtMDW(d.date) + '　' + d.title }),
          d.minutes ? ui.chip(d.minutes + '分', 'ghosty') : null
        ]),
        d.focus ? el('p', { class: 'muted small', text: d.focus }) : null,
        (d.items || []).length ? el('ul', { class: 'fit-prev-l' }, d.items.map(function (i) {
          return el('li', { text: i.name + '　' + (i.weight ? i.weight + 'kg' : '自重')
            + '×' + i.reps + '　' + i.sets + 'セット' });
        })) : null,
        d.cardio ? el('p', { class: 'muted small',
          text: d.cardio.kind + ' ' + (d.cardio.distance || 0) + 'km '
            + (d.cardio.minutes || 0) + '分' }) : null
      ]));
    });
    if (r.advice) {
      box.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'row-title', text: '食事と休養' }),
        el('p', { class: 'fit-advice', text: r.advice })
      ]));
    }
    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('この計画にする', 'primary', function () {
        var n = F.adopt(r.plans, { overwrite: false });
        ui.closeAllSheets();
        ui.toast(n + '日ぶん入れました');
      }, 'check'),
      ui.btn('前のぶんも置き換える', 'ghost', function () {
        var n = F.adopt(r.plans, { overwrite: true });
        ui.closeAllSheets();
        ui.toast(n + '日ぶん置き換えました');
      })
    ]));
    return box;
  }

  /* ---------------- 記録する ---------------- */

  function logSheet(date) {
    var plan = S.fitPlan(date);
    var prev = S.fitLog(date);
    var done = (prev && prev.done) || 'full';
    var items = [];

    var box = el('div', { class: 'form' });

    box.appendChild(ui.block('できたか', ui.segmented([
      { value: 'full', label: 'やった' },
      { value: 'part', label: '途中まで' },
      { value: 'skip', label: 'できなかった' }
    ], done, function (v) { done = v; })));

    // 種目ごとのセット。計画の回数と重さを最初から入れておく
    (plan ? plan.items : (prev ? prev.items : [])).forEach(function (pi) {
      var was = prev && prev.items.filter(function (x) { return x.name === pi.name; })[0];
      var nSets = Math.max(1, pi.sets || (was ? was.sets.length : 3));
      var rows = [];
      var wrapItem = el('div', { class: 'card fit-log-item' }, [
        el('div', { class: 'fit-item-h' }, [
          el('b', { text: pi.name }),
          pi.gear ? ui.chip(pi.gear, 'ghosty') : null
        ])
      ]);
      for (var i = 0; i < nSets; i++) {
        var w = was && was.sets[i] ? was.sets[i].weight : F.dec(pi.weight, 0);
        var rp = was && was.sets[i] ? was.sets[i].reps : F.repsGoal(pi.reps);
        var wIn = ui.input({ type: 'number', step: '0.5', min: 0, value: w, inputmode: 'decimal' });
        var rIn = ui.input({ type: 'number', min: 0, value: rp, inputmode: 'numeric' });
        rows.push({ w: wIn, r: rIn });
        wrapItem.appendChild(el('div', { class: 'fit-log-set' }, [
          el('span', { class: 'fit-log-n', text: (i + 1) + 'set' }),
          wIn, el('span', { class: 'muted', text: 'kg' }),
          rIn, el('span', { class: 'muted', text: '回' })
        ]));
      }
      items.push({ name: pi.name, rows: rows });
      box.appendChild(wrapItem);
    });

    // 有酸素
    var pc = (prev && prev.cardio) || (plan && plan.cardio) || null;
    var cKind = ui.select(F.CARDIO, (pc && pc.kind) || 'ラン');
    var cKm = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal',
      value: pc ? pc.distance : '' });
    var cMin = ui.input({ type: 'number', min: 0, inputmode: 'numeric',
      value: pc ? pc.minutes : '' });
    var cNote = ui.input({ maxlength: 60, value: pc ? pc.note : '',
      placeholder: '走った道（例）川沿い〜公園' });
    box.appendChild(ui.block('有酸素', el('div', { class: 'fit-cardio-in' }, [
      cKind,
      el('div', { class: 'grid2' }, [
        ui.field('距離(km)', cKm), ui.field('時間(分)', cMin)
      ]),
      cNote
    ])));

    var minIn = ui.input({ type: 'number', min: 0, inputmode: 'numeric',
      value: prev ? prev.minutes : (plan ? plan.minutes : 60) });
    var rpeIn = ui.input({ type: 'number', min: 0, max: 10, inputmode: 'numeric',
      value: prev ? prev.rpe : '' });
    box.appendChild(el('div', { class: 'grid2' }, [
      ui.field('かかった時間(分)', minIn),
      ui.field('きつさ(1〜10)', rpeIn)
    ]));

    var memoIn = ui.textarea({ rows: 2, value: prev ? prev.memo : '',
      placeholder: '例）ベンチ最後の1回が上がらなかった／腰に違和感' });
    box.appendChild(ui.field('メモ', memoIn));

    var close = ui.sheet({
      title: U.fmtMDW(date) + ' の記録',
      body: box,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () { save(); })
      ]
    });

    function save() {
      var km = F.dec(cKm.value, 0), cmin = U.num(cMin.value, 0);
      S.putFitLog(date, {
        date: date,
        done: done,
        minutes: U.num(minIn.value, 0),
        rpe: U.num(rpeIn.value, 0),
        memo: memoIn.value,
        items: items.map(function (it) {
          return {
            name: it.name,
            sets: it.rows.map(function (r) {
              return { weight: F.dec(r.w.value, 0), reps: U.num(r.r.value, 0) };
            }).filter(function (s) { return s.reps > 0; })
          };
        }).filter(function (i) { return i.sets.length; }),
        cardio: (km || cmin) ? { kind: cKind.value, distance: km, minutes: cmin, note: cNote.value } : null
      });
      var up = F.applyProgress(date);
      close();
      ui.toast(up.length
        ? '記録しました。' + up.length + '種目の重さを上げました'
        : '記録しました');
      if (up.length) upSheet(up);
    }
  }

  /* 上がった重さを見せる。次の計画からこの重さで組まれる */
  function upSheet(up) {
    ui.sheet({
      title: '次はこの重さで',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'list' }, up.map(function (u) {
          return el('div', { class: 'row' }, [
            el('div', { class: 'row-main' }, [
              el('div', { class: 'row-title', text: u.name }),
              el('div', { class: 'row-sub' }, [
                ui.chip((u.from || 0) + 'kg → ' + u.to + 'kg', 'ok'),
                el('span', { class: 'muted small', text: u.why })
              ])
            ])
          ]);
        })),
        el('p', { class: 'muted small',
          text: 'この重さは、次に計画を作ってもらうときの土台になります。' })
      ])
    });
  }

  /* ---------------- 計画を手で直す ---------------- */

  function planEditSheet(date) {
    var p = S.fitPlan(date) || { kind: 'gym', title: '', minutes: 60, items: [], warmup: [], cooldown: [] };
    var kind = p.kind;
    var titleIn = ui.input({ value: p.title || '', maxlength: 60 });
    var minIn = ui.input({ type: 'number', min: 0, inputmode: 'numeric', value: p.minutes });
    var noteIn = ui.textarea({ rows: 2, value: p.note || '' });

    var close = ui.sheet({
      title: U.fmtMDW(date) + ' の計画',
      body: el('div', { class: 'form' }, [
        ui.block('種類', ui.segmented([
          { value: 'gym', label: 'ジム' }, { value: 'run', label: 'ラン' }, { value: 'rest', label: '休み' }
        ], kind, function (v) { kind = v; })),
        ui.field('見出し', titleIn),
        ui.field('目安の時間(分)', minIn),
        ui.field('メモ', noteIn),
        el('p', { class: 'muted small',
          text: '種目の中身を大きく変えたいときは、「計画を作ってもらう」から組み直すほうが早いです。' })
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.putFitPlan(date, Object.assign({}, p, {
            kind: kind, title: titleIn.value, minutes: U.num(minIn.value, 0), note: noteIn.value
          }));
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- 体重を入れる ---------------- */

  function weightSheet(date) {
    var w = S.weightOf(date);
    var last = S.latestWeight();
    var dateIn = ui.input({ type: 'date', value: date });
    var kgIn = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal',
      value: w ? w.kg : (last ? last.kg : '') });
    var fatIn = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal',
      value: w && w.fat ? w.fat : '' });
    var musIn = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal',
      value: w && w.muscle ? w.muscle : '' });

    var close = ui.sheet({
      title: '体重',
      body: el('div', { class: 'form' }, [
        ui.field('日付', dateIn),
        ui.field('体重(kg)', kgIn),
        el('div', { class: 'grid2' }, [
          ui.field('体脂肪(%)', fatIn), ui.field('筋肉量(kg)', musIn)
        ]),
        w ? ui.btn('この日の記録を消す', 'danger full mt', function () {
          S.removeWeight(w.date);
          close();
          ui.toast('消しました');
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var kg = F.dec(kgIn.value, 0);
          if (!(kg > 0)) { ui.toast('体重を入れてください', 'danger'); return; }
          S.putWeight({
            date: U.isISO(dateIn.value) ? dateIn.value : date,
            kg: kg,
            fat: fatIn.value === '' ? null : F.dec(fatIn.value, 0),
            muscle: musIn.value === '' ? null : F.dec(musIn.value, 0),
            from: 'manual'
          });
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- 体重計から取り込む ---------------- */

  function importSheet() {
    var out = el('div', {});
    var csv = ui.textarea({ rows: 4,
      placeholder: 'EufyLife アプリから書き出した CSV を、ここに貼り付け' });

    var body = el('div', { class: 'form' }, [
      shortcutCard(),
      el('div', { class: 'card' }, [
        el('div', { class: 'row-title', text: '預かっているぶんを取り込む' }),
        el('p', { class: 'muted small',
          text: 'ショートカットや体重計のスクリプトが預けてくれたぶんを入れます。'
            + 'この画面を開いたときにも、そっと取り込んでいます。' }),
        el('div', { class: 'row-wrap' }, [
          ui.btn('いま取り込む', 'primary', function () { pull(); }, 'cloud'),
          ui.btn('送り先を試す', 'ghost tiny', function () { check(); })
        ]),
        el('p', { class: 'muted small',
          text: 'ショートカットが通らないときは「送り先を試す」を押すと、'
            + 'どこで止まっているか分かります。押しても何も書き換えません。' })
      ]),
      out,
      fitbitCard(),
      ui.field('CSV を貼り付けて入れる', csv,
        'EufyLife アプリ →「データのエクスポート」で出した CSV が読めます'),
      ui.btn('CSV から入れる', 'ghost full', function () { fromCSV(); }, 'plus'),
      el('p', { class: 'muted small',
        text: 'PC やラズパイがあるなら、tools/eufy-weight.py で体重計から直に読むこともできます'
          + '（乗るだけで入ります。立て方は sync/README.md）。' })
    ]);

    ui.sheet({ title: '体重の取り込み', body: body });

    /* Fitbit から読む道。
       EufyLife → Fitbit までつないであれば、あとは Worker が読むだけ。

       ただし Fitbit 側の窓口は閉じつつある。開発者の新規登録は終わっていて、
       いまから鍵を作ることはできない。Web API そのものも 2026年9月で終わり、
       後継の Google Health API は審査が要るので、ひとりの持ち物には重すぎる。
       すでに鍵があるときだけ使える道として残しておく。 */
    var FB_OVER = 'Fitbit 側の新規登録は終了しました。いまから鍵を作ることはできません。'
      + 'Web API そのものも 2026年9月で終わります。'
      + '上の「ショートカット」の道を使ってください。';

    function fitbitCard() {
      var box = el('div', { class: 'card fb-card' }, [
        el('div', { class: 'row-title', text: 'Fitbit から読む（終了しました）' }),
        el('p', { class: 'muted small', text: '見に行っています…' })
      ]);
      F.fitbit.status().then(function (st) {
        U.clear(box);
        box.appendChild(el('div', { class: 'row-title' }, [
          el('span', { text: st.linked ? 'Fitbit から読む' : 'Fitbit から読む（終了しました）' }),
          st.linked ? ui.chip('つながっています', 'ok') : null
        ]));
        if (!st.ready) {
          box.appendChild(el('p', { class: 'mn-warn small' }, [
            ui.icon('alert', 14), el('span', { text: FB_OVER })
          ]));
          box.appendChild(el('p', { class: 'muted small',
            text: '（もし前に作った Fitbit の鍵が手元にあるなら、sync/setup.sh で '
              + 'FITBIT_CLIENT_ID と FITBIT_CLIENT_SECRET を入れれば、ここは使えるようになります。）' }));
          if (st.redirect) {
            box.appendChild(el('div', { class: 'fit-url', text: st.redirect }));
          }
          return;
        }
        if (!st.linked) {
          box.appendChild(el('p', { class: 'muted small',
            text: 'Fitbit の Web API は 2026年9月で終わります。それまでの間だけ使えます。' }));
        }
        box.appendChild(el('p', { class: 'muted small',
          text: st.linked
            ? 'この画面を開くたびに、Fitbit から新しいぶんを取り込みます。'
            : 'EufyLife アプリ → 設定 → Fitbit 連携をオンにしてから、下の「つなぐ」を押してください。' }));
        box.appendChild(el('div', { class: 'row-wrap' }, [
          st.linked ? ui.btn('Fitbit から取り込む', 'primary', function () { fbPull(); }, 'cloud')
            : ui.btn('Fitbit とつなぐ', 'primary', function () { fbLink(); }, 'cloud'),
          st.linked ? ui.btn('つなぎを外す', 'ghost tiny', function () {
            ui.confirm('Fitbit とのつなぎを外します。体重の記録はそのまま残ります。',
              { danger: true, okText: '外す' }).then(function (yes) {
              if (!yes) return;
              F.fitbit.unlink().then(function () {
                ui.toast('外しました');
                DL.app.render();
              }).catch(function (e) { ui.toast(e.message, 'danger'); });
            });
          }) : null
        ]));
      });
      return box;
    }

    function fbLink() {
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: '入口を用意しています…' }));
      F.fitbit.start().then(function (r) {
        U.clear(out);
        out.appendChild(el('p', { class: 'muted small',
          text: 'Fitbit の画面が開きます。許可したら、この画面に戻って'
            + '「Fitbit から取り込む」を押してください。' }));
        // 別のタブで開く（アプリの画面はそのまま残す）
        window.open(r.url, '_blank');
      }).catch(function (e) {
        U.clear(out);
        out.appendChild(el('p', { class: 'mn-warn small' }, [
          ui.icon('alert', 14), el('span', { text: e.message })
        ]));
      });
    }

    function fbPull() {
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: 'Fitbit に聞いています…' }));
      F.fitbit.pull(30).then(function (r) {
        U.clear(out);
        out.appendChild(el('p', { class: 'muted small',
          text: r.found
            ? r.found + '件のうち ' + r.added + '件を入れました'
            : 'Fitbit にまだ体重の記録がありませんでした' }));
        if (r.added) DL.app.render();
      }).catch(function (e) {
        U.clear(out);
        out.appendChild(el('p', { class: 'mn-warn small' }, [
          ui.icon('alert', 14), el('span', { text: e.message })
        ]));
      });
    }

    /* iPhone だけで完結する道。
       EufyLife → Apple のヘルスケア → ショートカット → この受け口。
       ブラウザからヘルスケアは読めないので、iPhone 側から送ってもらう */
    function shortcutCard() {
      var url = F.postUrl();
      var paste = url ? url + '?kg=' : '';
      var steps = [
        'EufyLife アプリ →「プロフィール」→ ヘルスケアへの同期をオンにする。'
          + '一度 体重計に乗って、ヘルスケア App の「体重」に数字が入るのを見ておく',
        'ショートカット App →「＋」→「アクションを追加」',
        '「ヘルスケアのサンプルを検索」を足す。'
          + 'タイプ＝体重／並べ替え＝終了日／順序＝降順／上限＝1',
        '「テキスト」を足して、下の送り先を貼り付ける。そのうしろに手順3の'
          + '「ヘルスケアのサンプル」を入れ、それを押して「値」に変える'
          + '（「サンプル」のままだと「81.2 kg」のような文になってしまいます）',
        '「URL の内容を取得」を足す。URL は手順4の「テキスト」。'
          + '「詳しく表示」を開いて、方法＝POST、ヘッダの ＋ で'
          + 'キー＝Authorization ／ 値＝Bearer と合鍵（間に半角スペース1つ）',
        '右下の ▶ で試す。{"ok":true,"added":1} が返れば通っています',
        '名前を付けて保存する',
        'ショートカット App →「オートメーション」→「＋」→「時刻」→ 毎日 7:00 →'
          + 'このショートカットを実行（「実行前に尋ねる」はオフ）'
      ];
      var traps = [
        '404 が返る … Worker がまだ古いです。上の「送り先を試す」を押してください',
        '401 が返る … 合鍵が違います。ヘッダの「Bearer 」を消していないか見てください',
        '{"error":"no_weight"} … ヘルスケアに体重が入っていないか、手順3の上限が 0 です',
        '数字が入らない … 手順4の変数が「値」ではなく「サンプル」のままです'
      ];
      return el('div', { class: 'card' }, [
        el('div', { class: 'row-title', text: 'iPhone だけで自動にする（ショートカット）' }),
        el('p', { class: 'muted small',
          text: 'EufyLife は Apple の「ヘルスケア」へ体重を送れます。ブラウザからヘルスケアは'
            + '読めないので、ショートカットに「ヘルスケアから読んで、ここへ送る」を'
            + 'やってもらいます。PC もラズパイも要りません。' }),
        el('ol', { class: 'fit-steps' }, steps.map(function (t) { return el('li', { text: t }); })),
        paste ? el('div', { class: 'fit-url', text: paste }) : el('p', { class: 'mn-warn small' }, [
          ui.icon('alert', 14), el('span', { text: '先に設定で同期の接続先を入れてください。' })
        ]),
        el('div', { class: 'row-wrap' }, [
          paste ? ui.btn('送り先をコピー', 'ghost tiny', function () {
            U.copy(paste).then(function (ok) { ui.toast(ok ? 'コピーしました' : 'コピーできませんでした', ok ? '' : 'warn'); });
          }) : null,
          S.settings.sync && S.settings.sync.token ? ui.btn('合鍵をコピー', 'ghost tiny', function () {
            U.copy(S.settings.sync.token).then(function (ok) {
              ui.toast(ok ? 'コピーしました。人に見せないでください' : 'コピーできませんでした', ok ? '' : 'warn');
            });
          }) : null
        ]),
        el('p', { class: 'muted small',
          text: '体脂肪も送るなら &fat= を、日付を指定するなら &date=2026-09-15 を'
            + 'うしろに足します。日付を付けなければ、送った日のぶんになります。'
            + '合鍵は URL には付けず、ヘッダに入れてください。' }),
        el('div', { class: 'row-title', text: 'つまずきやすいところ' }),
        el('ul', { class: 'fit-traps' }, traps.map(function (t) { return el('li', { text: t }); }))
      ]);
    }

    /* 受け口が生きているかを見て、そのまま言葉で返す */
    function check() {
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: '送り先を見ています…' }));
      F.checkInbox().then(function (r) {
        U.clear(out);
        out.appendChild(r.ok
          ? el('p', { class: 'muted small' }, [ui.icon('check', 14), el('span', { text: ' ' + r.text })])
          : el('p', { class: 'mn-warn small' }, [ui.icon('alert', 14), el('span', { text: r.text })]));
      });
    }

    function pull() {
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small', text: '取りに行っています…' }));
      F.pull().then(function (r) {
        U.clear(out);
        if (r.off) {
          out.appendChild(el('p', { class: 'mn-warn small' }, [
            ui.icon('alert', 14),
            el('span', { text: 'サーバー側が未対応です。Worker を新しくして deploy し直してください。' })
          ]));
          return;
        }
        out.appendChild(el('p', { class: 'muted small',
          text: r.added ? r.added + '件 入れました' : '新しいぶんはありませんでした' }));
        if (r.added) DL.app.render();
      }).catch(function (e) {
        U.clear(out);
        out.appendChild(el('p', { class: 'mn-warn small' }, [
          ui.icon('alert', 14), el('span', { text: e.message })
        ]));
      });
    }

    function fromCSV() {
      var rows = F.parseCSV(csv.value);
      if (!rows.length) { ui.toast('日付と体重の列が見つかりませんでした', 'danger'); return; }
      var n = 0;
      rows.forEach(function (r) {
        if (S.putWeight({ date: r.date, kg: r.kg, fat: r.fat, muscle: r.muscle, from: 'csv' })) n++;
      });
      U.clear(out);
      out.appendChild(el('p', { class: 'muted small',
        text: rows.length + '件のうち ' + n + '件を入れました' }));
      DL.app.render();
    }
  }

  /* ---------------- からだと目標 ---------------- */

  function profileSheet() {
    var p = S.fit().profile;
    var hIn = ui.input({ type: 'number', min: 0, inputmode: 'numeric', value: p.height || '' });
    var aIn = ui.input({ type: 'number', min: 0, inputmode: 'numeric', value: p.age || '' });
    var gwIn = ui.input({ type: 'number', step: '0.1', min: 0, inputmode: 'decimal', value: p.goalWeight || '' });
    var goalSel = ui.select(S.FIT_GOALS, p.goal);
    var lvSel = ui.select(S.FIT_LEVELS, p.level);
    var daysIn = ui.input({ type: 'number', min: 1, max: 7, inputmode: 'numeric', value: p.days });
    var minIn = ui.input({ type: 'number', min: 15, max: 180, inputmode: 'numeric', value: p.minutes });
    var gymIn = ui.input({ value: p.gym, maxlength: 40 });
    var noteIn = ui.textarea({ rows: 2, value: p.note,
      placeholder: '例）右肩を痛めたことがある／腰は無理をしない' });

    var picked = p.weekdays.slice();
    var wdBox = el('div', { class: 'fit-wd' }, WDAY.map(function (w, i) {
      var b = ui.btn(w, 'ghost' + (picked.indexOf(i) >= 0 ? ' on' : ''), function () {
        var at = picked.indexOf(i);
        if (at >= 0) picked.splice(at, 1); else picked.push(i);
        b.classList.toggle('on', picked.indexOf(i) >= 0);
      });
      return b;
    }));

    var close = ui.sheet({
      title: 'からだと目標',
      body: el('div', { class: 'form' }, [
        el('div', { class: 'grid2' }, [
          ui.field('身長(cm)', hIn), ui.field('年齢', aIn)
        ]),
        ui.field('目指す体型', goalSel),
        ui.field('目標体重(kg)', gwIn, '決めていなければ空のままで大丈夫です'),
        ui.field('経験', lvSel),
        ui.field('通うジム', gymIn),
        el('div', { class: 'grid2' }, [
          ui.field('週に何回', daysIn), ui.field('1回の分数', minIn)
        ]),
        ui.block('行く曜日', wdBox, '決めておくと、その曜日に計画が入ります'),
        ui.field('気をつけること', noteIn)
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.updateFitProfile({
            height: U.num(hIn.value, 0), age: U.num(aIn.value, 0),
            goalWeight: F.dec(gwIn.value, 0), goal: goalSel.value, level: lvSel.value,
            gym: gymIn.value, days: U.num(daysIn.value, 4), minutes: U.num(minIn.value, 60),
            weekdays: picked.slice().sort(), note: noteIn.value
          });
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- 記録の一覧 ---------------- */

  function historySheet() {
    var logs = S.fitLogs();
    var dates = Object.keys(logs).sort().reverse().slice(0, 60);
    var body = el('div', { class: 'form' });
    if (!dates.length) {
      body.appendChild(ui.empty('まだ記録がありません。'));
    } else {
      body.appendChild(el('div', { class: 'list' }, dates.map(function (d) {
        var l = logs[d], p = S.fitPlan(d);
        return el('button', { class: 'row', onclick: function () {
          ui.closeAllSheets();
          location.hash = '#/fit/' + d;
        } }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title', text: U.fmtMDW(d) + '　' + ((p && p.title) || '') }),
            el('div', { class: 'row-sub' }, [
              ui.chip(DONE_LABEL[l.done], l.done === 'skip' ? 'danger' : 'ok'),
              l.minutes ? ui.chip(l.minutes + '分', 'ghosty') : null,
              l.items.length ? ui.chip(l.items.length + '種目', 'ghosty') : null,
              l.cardio ? ui.chip((l.cardio.distance || 0) + 'km', 'soft') : null,
              l.rpe ? ui.chip('きつさ' + l.rpe, 'ghosty') : null
            ])
          ]),
          el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
        ]);
      })));
    }
    ui.sheet({ title: '記録の一覧', body: body });
  }

  DL.views = DL.views || {};
  DL.views.fit = { render: render, logSheet: logSheet, weightSheet: weightSheet };
})(window.DL);
