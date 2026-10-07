/* 原稿のページ管理表 ----------------------------------------------

   1ページごとに「ネーム／下書き／線画／仕上げ …」のどこまで終わったかを
   マス目で持つ。マスを押すと、その工程の実績（その日にやったぶん）に
   1つ足す。だから遅れの判定も1日のノルマも、今までどおりそのまま動く。

   列になるのは、ページ（枚）で数える工程だけ。プロットのように
   数えない工程は表に出さない。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  var filter = 'all';    // all（すべて）| left（残り）| late（遅れ）| note（メモ）
  var lastId = '';       // 別の案件を開いたら絞り込みは戻す

  var FILTERS = [
    { value: 'all', label: 'すべて' },
    { value: 'left', label: '残り' },
    { value: 'late', label: '遅れ' },
    { value: 'note', label: 'メモ' }
  ];

  function render(root, params) {
    var p = S.getProject(params.id);
    if (!p) {
      root.appendChild(ui.empty('案件が見つかりません。',
        ui.btn('一覧へ', 'primary', function () { location.hash = '#/projects'; })));
      return;
    }
    if (lastId !== p.id) { filter = 'all'; lastId = p.id; }
    var today = U.today();
    var word = sc.pageWord(p);
    var tasks = sc.pageTasks(p);
    var total = S.pageTotal(p);
    var wrap = el('div', { class: 'page pg-page' });

    /* ---- 見出し ---- */
    wrap.appendChild(el('a', { class: 'pg-title', href: '#/project/' + p.id }, [
      el('span', { class: 'dot', style: { background: p.color } }),
      el('span', { text: p.title }),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 15))
    ]));

    /* ---- 表紙 ----
       本文はページごとに数えるが、表紙は1枚なので同じ表に載せられない。
       工程に重みを持たせて、割合で追う */
    wrap.appendChild(coverCard(p, today));

    if (!tasks.length) {
      wrap.appendChild(ui.empty(
        word + 'で数える工程がありません。ネームや線画のように「' + word + '」で進める工程を作ると、ここに表が出ます。',
        ui.btn('基本タスクを追加', 'primary', function () { DL.forms.templateSheet(p.id); })));
      root.appendChild(wrap);
      return;
    }

    /* ---- 総ページ数 ---- */
    wrap.appendChild(el('button', { class: 'pg-total', onclick: function () { totalSheet(p); } }, [
      el('span', { class: 'cd-label', text: '総' + word + '数' }),
      el('b', { text: total ? total + word : '未設定' }),
      el('span', { class: 'chev' }, ui.icon('edit', 15))
    ]));

    if (!total) {
      wrap.appendChild(ui.empty('総' + word + '数を入れると、1' + word + 'ずつの表になります。',
        ui.btn('総' + word + '数を入れる', 'primary', function () { totalSheet(p); })));
      root.appendChild(wrap);
      return;
    }

    /* ---- 工程ごとの下ごしらえ ---- */
    var cols = tasks.map(function (t) {
      var pace = sc.taskPace(p, t, today);
      var marked = S.markedPages(p, t.id);
      var set = {};
      marked.forEach(function (n) { set[n] = true; });
      return {
        t: t, pace: pace, set: set, count: marked.length,
        // 昨日までに終えているはずの数（ここまでの未印が「遅れ」）
        due: Math.min(total, Math.round(pace.shouldBeDone)),
        /* 遅れは「昨日までに付けた印」と比べる。今日付けたぶんは
           今日のノルマに入るので、過去の遅れを消してはいけない。
           ただし今日のノルマを超えて付けたぶんは、取り返したものとして引く */
        countBefore: S.markedCountBefore(p, t.id, today),
        todayQty: Math.round(pace.todayQty || 0),
        range: pace.plan.rangeByDate[today] || {}
      };
    });

    /* ---- まとめ ---- */
    wrap.appendChild(summary(p, cols, total, word, today));

    /* ---- 絞り込み ---- */
    var rows = pageList(p, cols, total);
    wrap.appendChild(el('div', { class: 'pg-filter' }, [
      ui.segmented(FILTERS.map(function (f) {
        return { value: f.value, label: f.label + ' ' + pageList(p, cols, total, f.value).length };
      }), filter, function (v) { filter = v; DL.app.render(); })
    ]));

    /* ---- 表 ---- */
    if (!rows.length) {
      wrap.appendChild(ui.empty(filter === 'late' ? '遅れている' + word + 'はありません。'
        : filter === 'left' ? 'すべての' + word + 'が終わっています。'
        : 'メモを付けた' + word + 'はありません。'));
    } else {
      wrap.appendChild(table(p, cols, rows, total, word, today));
      wrap.appendChild(el('p', { class: 'muted small pg-help',
        text: 'マスを押すと、その日にやったぶんとして記録します。'
          + '番号を押すと、その' + word + 'のメモを書けます。'
          + '工程名を押すと、まとめて印を付けられます。' }));
    }

    root.appendChild(wrap);
  }

  /**
   * その工程の遅れ。schedule.js の taskPace と同じ見方をする。
   * 昨日までに終えているはずの数から、昨日までに付けた印を引く。
   * 今日ノルマを超えて付けたぶんは、取り返したものとしてさらに引く。
   * 残っている数より大きくはしない。
   */
  function colBehind(c, total) {
    var caughtUp = Math.max(0, (c.count - c.countBefore) - c.todayQty);
    var left = Math.max(0, total - c.count);
    return Math.max(0, Math.min(c.due - c.countBefore - caughtUp, left));
  }

  /* ---------------- 表紙 ----------------

     ラフ10 → 下書き20 → 線画30 → 塗り30 → 仕上げ10 で合わせて100。
     終えたぶんの重みを足したのが進みぐあい。
     工程の名前も重みも、案件ごとに変えられる。 */

  function coverCard(p, today) {
    var c = sc.coverPace(p);

    if (!c.on) {
      return el('div', { class: 'card cv-off' }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            ui.icon('illust', 16), el('span', { text: '表紙' })
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip('ラフ→下書き→線画→塗り→仕上げ', 'ghosty')
          ])
        ]),
        ui.btn('表紙も進める', 'ghost', function () {
          S.setCoverOn(p.id, true);
          ui.toast('表紙の工程を出しました');
        }, 'plus')
      ]);
    }

    var box = el('div', { class: 'card cv-card' + (c.finished ? ' done' : '') });

    box.appendChild(el('div', { class: 'cv-head' }, [
      el('div', { class: 'row-title' }, [
        ui.icon('illust', 16), el('span', { text: '表紙' }),
        c.finished ? ui.chip('仕上がり', 'ok') : null
      ]),
      el('b', { class: 'cv-pct', text: c.pct + '%' })
    ]));

    box.appendChild(el('div', { class: 'cv-rail' },
      el('i', { style: { width: c.pct + '%' } })));

    /* 工程の札。押すと、その工程を終えた／戻す。
       前の工程がまだでも押せる——やる順は人それぞれなので */
    box.appendChild(el('div', { class: 'cv-steps' }, c.steps.map(function (st) {
      return el('button', {
        type: 'button', class: 'cv-step' + (st.done ? ' on' : ''),
        'aria-label': st.label + (st.done ? 'を戻す' : 'を終える'),
        onclick: function () {
          S.setCoverDone(p.id, st.key, !st.done, today);
          ui.toast(st.done ? st.label + 'を戻しました' : st.label + 'まで終わりました');
        }
      }, [
        el('span', { class: 'cv-step-i' }, st.done ? ui.icon('check', 13) : null),
        el('span', { class: 'cv-step-n', text: st.label }),
        el('span', { class: 'cv-step-w', text: st.weight + '%' })
      ]);
    })));

    box.appendChild(el('div', { class: 'cv-foot' }, [
      el('span', { class: 'muted small', text: c.finished ? '仕上げまで終わりました'
        : c.next ? '次は ' + c.next.label + '（' + c.next.weight + '%）'
          : '工程がありません' }),
      el('div', { class: 'row-wrap' }, [
        (p.pages.cover && p.pages.cover.memo)
          ? ui.chip(p.pages.cover.memo, 'ghosty') : null,
        ui.btn('工程を直す', 'ghost tiny', function () { coverSheet(p); }, 'settings')
      ])
    ]));
    return box;
  }

  /* 工程の名前と重み、メモ。表紙をやめることもここから */
  function coverSheet(p) {
    var steps = S.coverSteps(p).map(function (x) {
      return { key: x.key, label: x.label, weight: x.weight };
    });
    var memoIn = ui.input({ value: (p.pages.cover || {}).memo || '',
      placeholder: '例）カラー・B5・背表紙あり' });

    var list = el('div', { class: 'cv-edit' });
    var sum = el('p', { class: 'muted small' });

    function drawSum() {
      var n = steps.reduce(function (a, x) { return a + U.num(x.weight, 0); }, 0);
      sum.textContent = '合わせて ' + n + '%'
        + (n === 100 ? '' : '（100 でなくても構いません。割合で数えます）');
    }

    function draw() {
      U.clear(list);
      steps.forEach(function (st, i) {
        var nameIn = ui.input({ value: st.label, maxlength: 20 });
        nameIn.addEventListener('input', function () { st.label = nameIn.value; });
        var wIn = ui.input({ type: 'number', inputmode: 'numeric', min: 0, max: 100,
          value: String(st.weight) });
        wIn.addEventListener('input', function () {
          st.weight = Math.max(0, Math.min(100, U.num(wIn.value, 0)));
          drawSum();
        });
        list.appendChild(el('div', { class: 'cv-edit-row' }, [
          nameIn, wIn,
          el('span', { class: 'muted small', text: '%' }),
          el('button', {
            type: 'button', class: 'iconbtn small', 'aria-label': (st.label || '工程') + 'を外す',
            onclick: function () { steps.splice(i, 1); draw(); }
          }, ui.icon('close', 16))
        ]));
      });
      drawSum();
    }
    draw();

    var close = ui.sheet({
      title: '表紙の工程',
      body: el('div', { class: 'form' }, [
        el('p', { class: 'muted small',
          text: '終えた工程の重みを足したものが、表紙の進みぐあいになります。' }),
        list, sum,
        ui.btn('工程を足す', 'ghost', function () {
          steps.push({ key: 's' + U.uid(), label: '', weight: 10 });
          draw();
        }, 'plus'),
        ui.field('メモ', memoIn),
        ui.btn('はじめの5つに戻す', 'ghost full mt', function () {
          steps = U.clone(S.COVER_STEPS);
          draw();
        }, 'refresh'),
        ui.btn('表紙を出さない', 'danger full mt', function () {
          S.setCoverOn(p.id, false); close(); ui.toast('表紙を下げました');
        }, 'eyeOff')
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var keep = steps.filter(function (x) { return String(x.label || '').trim(); });
          if (!keep.length) { ui.toast('工程を1つ以上入れてください', 'warn'); return; }
          S.setCoverSteps(p.id, keep);
          S.setCoverMemo(p.id, memoIn.value);
          close(); ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- まとめ（工程ごとの進み） ---------------- */

  function summary(p, cols, total, word, today) {
    var box = el('div', { class: 'card pg-sum' });
    cols.forEach(function (c) {
      var left = Math.max(0, total - c.count);
      var behind = colBehind(c, total);
      box.appendChild(el('button', {
        class: 'pg-sum-row' + (left ? '' : ' done'),
        onclick: function () { colSheet(p, c, total, word, today); }
      }, [
        el('div', { class: 'pg-sum-head' }, [
          el('b', { text: c.t.name }),
          el('span', { class: 'pg-sum-n', text: c.count + '/' + total + word }),
          behind ? ui.chip('遅れ' + behind, 'danger')
            : (left ? null : ui.chip('完了', 'ok'))
        ]),
        ui.progress(total ? Math.round(c.count / total * 100) : 0, p.color),
        // 表の数と実績がずれていたら、そっと知らせる（手で実績を直したときなど）
        /* 記録の入口は表ひとつに絞ってあるので、ふだんは出ない。
           昔の手入力が残っているときだけ出る。押すと直せる */
        c.pace.done !== c.count
          ? el('span', { class: 'muted small',
              text: '実績が表と違います（実績 ' + c.pace.done + word + '）。押すと合わせられます' })
          : (c.range.from ? el('span', { class: 'muted small',
              text: '今日のぶん ' + sc.rangeText(c.t, c.range.from, c.range.to) }) : null)
      ]));
    });
    return box;
  }

  /* ---------------- 表 ---------------- */

  /* 表に出すページ番号。絞り込みに合わせて間引く */
  function pageList(p, cols, total, which) {
    which = which || filter;
    var out = [];
    for (var n = 1; n <= total; n++) {
      if (which === 'left' && cols.every(function (c) { return c.set[n]; })) continue;
      /* 遅れている◯ページ。取り返したぶんだけ、見る範囲を手前に縮める
         （まとめの「遅れ◯」と食い違わないように） */
      if (which === 'late' && !cols.some(function (c) {
        return !c.set[n] && n <= c.due - Math.max(0, (c.count - c.countBefore) - c.todayQty);
      })) continue;
      if (which === 'note' && !S.pageNote(p, n)) continue;
      out.push(n);
    }
    return out;
  }

  function table(p, cols, rows, total, word, today) {
    // 工程が多いときだけ横に送れるようにする（そのときは見出しは貼り付かない）
    var box = el('div', { class: 'pg-wrap' + (cols.length > 6 ? ' scroll' : '') });
    var grid = el('div', { class: 'pg-table', style: { '--cols': cols.length } });

    grid.appendChild(el('div', { class: 'pg-head' }, [
      el('span', { class: 'pg-cap', text: word === 'ページ' ? 'P' : '枚' })
    ].concat(cols.map(function (c) {
      return el('button', {
        class: 'pg-col', onclick: function () { colSheet(p, c, total, word, today); }
      }, [
        el('span', { class: 'pg-col-name', text: c.t.name }),
        el('span', { class: 'pg-col-n', text: c.count + '/' + total })
      ]);
    }))));

    rows.forEach(function (n) {
      var note = S.pageNote(p, n);
      var row = el('div', { class: 'pg-row' }, [
        el('button', {
          class: 'pg-no' + (note ? ' has-note' : ''),
          'aria-label': n + word + 'を開く',
          onclick: function () { pageSheet(p, n, word); }
        }, [
          el('b', { text: String(n) }),
          note ? ui.icon('edit', 11) : null
        ])
      ].concat(cols.map(function (c) { return cell(p, c, n, word); })));
      grid.appendChild(row);
    });

    box.appendChild(grid);
    return box;
  }

  function cell(p, c, n, word) {
    var on = !!c.set[n];
    var late = !on && n <= c.due;
    var now = !on && c.range.from && n >= c.range.from && n <= c.range.to;
    var b = el('button', {
      class: 'pg-cell' + (on ? ' on' : '') + (late ? ' late' : '') + (now ? ' now' : ''),
      style: on ? { background: p.color, borderColor: p.color } : null,
      'aria-label': c.t.name + '　' + n + word + (on ? '　済み' : late ? '　遅れ' : ''),
      'aria-pressed': on ? 'true' : 'false',
      onclick: function () { S.togglePageMark(p.id, c.t.id, n); }
    }, on ? ui.icon('check', 15) : null);
    return b;
  }

  /* ---------------- 総ページ数 ---------------- */

  function totalSheet(p) {
    var word = sc.pageWord(p);
    var step = ui.stepper({ value: S.pageTotal(p), max: S.MAX_PAGES });
    var close = ui.sheet({
      title: '総' + word + '数',
      body: el('div', { class: 'form' }, [
        ui.field('本文の' + word + '数', step)
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var n = step.getValue();
          S.setPageTotal(p.id, n);
          close();
          // 工程の数量（1日のノルマの元になる数）がずれていたら、そろえるか聞く
          var off = n ? sc.pageTasks(S.getProject(p.id)).filter(function (t) {
            return sc.taskTotal(t) !== n;
          }) : [];
          if (!off.length) { ui.toast('保存しました'); return; }
          ui.confirm('「' + off.map(function (t) { return t.name; }).join('・')
            + '」の数量も ' + n + word + 'にそろえますか？（1日のノルマの計算に使います）',
          { okText: 'そろえる', cancelText: 'このまま' }).then(function (ok) {
            if (!ok) { ui.toast('保存しました'); return; }
            off.forEach(function (t) { S.updateTask(p.id, t.id, { qty: n }); });
            ui.toast('そろえました');
          });
        })
      ]
    });
  }

  /* ---------------- 1ページぶんのシート ---------------- */

  function pageSheet(p, n, word) {
    var box = el('div', { class: 'form' });
    var note = ui.textarea({ rows: 2, value: S.pageNote(p, n),
      placeholder: '例）3コマ目を描き直す／トーン濃いめ' });

    // 押すたびにその場で付け外しする（シートは開いたまま。書きかけのメモを消さない）
    box.appendChild(ui.block('工程', el('div', { class: 'pg-toggles' },
      sc.pageTasks(p).map(function (t) {
        var b = ui.btn(t.name, 'ghost' + (S.isPageMarked(p, t.id, n) ? ' on' : ''), function () {
          S.togglePageMark(p.id, t.id, n);
          b.classList.toggle('on', S.isPageMarked(S.getProject(p.id), t.id, n));
        }, 'check');
        return b;
      }))));

    box.appendChild(ui.field('この' + word + 'のメモ', note));

    var close = ui.sheet({
      title: n + word + '目',
      body: box,
      actions: [
        ui.btn('閉じる', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          S.setPageNote(p.id, n, note.value);
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* ---------------- 工程ごとのまとめ操作 ---------------- */

  function colSheet(p, c, total, word, today) {
    var t = c.t;
    var box = el('div', { class: 'form' });
    var behind = colBehind(c, total);

    box.appendChild(el('div', { class: 'row-sub' }, [
      ui.chip(c.count + '/' + total + word, c.count >= total ? 'ok' : 'ghosty'),
      behind ? ui.chip('遅れ' + behind + word, 'danger') : null,
      c.pace.remainingDays > 0 ? ui.chip('要' + c.pace.perDay + sc.unit(t) + '/日', 'warn') : null,
      U.isISO(t.start) ? ui.chip(U.fmtMD(t.start) + '〜' + U.fmtMD(t.end), 'soft') : null
    ]));

    // 「◯ページまで終わった」。ここまでの未印にまとめて印を付ける
    var upto = ui.stepper({ value: Math.min(total, c.count || 1), max: total });
    box.appendChild(ui.field('ここまで終わった', upto, '1〜この' + word + 'の、まだ印のないところに付けます。'));
    box.appendChild(ui.btn('ここまでに印を付ける', 'primary full', function () {
      var to = upto.getValue();
      var list = [];
      for (var i = 1; i <= to; i++) list.push(i);
      var n = S.markPages(p.id, t.id, list, true, today);
      ui.closeAllSheets();
      ui.toast(n ? n + word + 'に印を付けました' : '変わりはありませんでした');
    }, 'check'));

    var acts = [];
    if (c.range.from) {
      acts.push(ui.btn('今日のぶん（' + sc.rangeText(t, c.range.from, c.range.to) + '）に印', 'ghost', function () {
        var list = [];
        for (var i = c.range.from; i <= c.range.to && i <= total; i++) list.push(i);
        var n = S.markPages(p.id, t.id, list, true, today);
        ui.closeAllSheets();
        ui.toast(n ? n + word + 'に印を付けました' : 'もう終わっています');
      }));
    }
    acts.push(ui.btn('全部に印', 'ghost', function () {
      var list = [];
      for (var i = 1; i <= total; i++) list.push(i);
      var n = S.markPages(p.id, t.id, list, true, today);
      ui.closeAllSheets();
      ui.toast(n ? n + word + 'に印を付けました' : 'もう全部終わっています');
    }));
    acts.push(ui.btn('この工程の印を全部外す', 'ghost', function () {
      ui.confirm('「' + t.name + '」の印を全部外します。実績もそのぶん戻します。',
        { danger: true, okText: '外す' }).then(function (ok) {
        if (!ok) return;
        var list = [];
        for (var i = 1; i <= S.MAX_PAGES; i++) list.push(i);
        var n = S.markPages(p.id, t.id, list, false);
        ui.closeAllSheets();
        ui.toast(n + word + 'の印を外しました');
      });
    }));
    // 表と実績がずれているときだけ、そろえる道を出す
    if (c.pace.done !== c.count) {
      acts.push(ui.btn('実績を表に合わせる', 'ghost', function () {
        ui.confirm('「' + t.name + '」の実績を、表の印だけから数え直します（' + c.pace.done
          + ' → ' + c.count + '）。印のない日の実績は消えます。', { okText: '合わせる' }).then(function (ok) {
          if (!ok) return;
          S.syncProgressFromPages(p.id, t.id);
          ui.closeAllSheets();
          ui.toast('そろえました');
        });
      }, 'refresh'));
    }
    acts.push(ui.btn('この工程を開く', 'ghost', function () {
      ui.closeAllSheets();
      location.hash = '#/project/' + p.id;
    }, 'task'));

    box.appendChild(el('div', { class: 'actions' }, acts));

    ui.sheet({ title: t.name, body: box });
  }

  DL.views = DL.views || {};
  DL.views.pages = { render: render };
})(window.DL);
