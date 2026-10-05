/* ゴミの日（画面）。

   見たいのは「次はいつ・何を出すか」だけなので、それを上に大きく出す。
   下は曜日の表。どの曜日に何があるか、一目で分かるように並べる。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;
  var T = DL.trash;

  function render(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });
    var list = T.list({ all: true });

    if (!list.length) {
      wrap.appendChild(ui.section('ゴミの日'));
      wrap.appendChild(el('div', { class: 'card' }, [
        el('p', { text: '燃えるゴミ・資源・不燃などを曜日で入れておくと、'
          + '前の晩にホームと通知で知らせます。' }),
        el('p', { class: 'muted small',
          text: '「第2・第4月曜」のような月に何度かのものも入れられます。' }),
        el('div', { class: 'row-wrap' }, [
          ui.btn('よく使うものから', 'primary', function () { presetSheet(); }, 'star'),
          ui.btn('自分で足す', 'ghost', function () { editSheet(null); }, 'plus')
        ])
      ]));
      root.appendChild(wrap);
      return;
    }

    /* ---- 次の日 ---- */
    wrap.appendChild(ui.section('次に出すもの'));
    wrap.appendChild(nextCard(today));

    /* ---- 曜日の表 ---- */
    wrap.appendChild(ui.section('曜日の表',
      el('span', { class: 'muted small', text: list.length + '種類' })));
    wrap.appendChild(weekTable(today));

    /* ---- 一覧 ---- */
    wrap.appendChild(ui.section('登録してあるもの'));
    wrap.appendChild(el('div', { class: 'list' }, list.map(function (t) {
      return el('button', {
        type: 'button', class: 'row' + (t.active === false ? ' is-done' : ''),
        onclick: function () { editSheet(t); }
      }, [
        el('span', { class: 'dot', style: { background: t.color } }),
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            el('span', { text: t.name }),
            t.active === false ? ui.chip('止めている', 'ghosty') : null
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip(T.whenLabel(t) || '曜日が未設定', 'soft'),
            t.memo ? ui.chip(t.memo, 'ghosty') : null
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]);
    })));

    wrap.appendChild(el('div', { class: 'row-wrap mt' }, [
      ui.btn('足す', 'primary', function () { editSheet(null); }, 'plus'),
      ui.btn('よく使うものから', 'ghost', function () { presetSheet(); }, 'star')
    ]));
    root.appendChild(wrap);
  }

  /* ---------------- 次の日 ---------------- */

  function nextCard(today) {
    var nx = T.next(today);
    var box = el('div', { class: 'card' });
    if (!nx) {
      box.appendChild(el('p', { class: 'muted small', text: '出すものがありません。' }));
      return box;
    }

    box.appendChild(el('div', { class: 'tr-next' + (nx.left === 0 ? ' today' : '') }, [
      el('div', { class: 'tr-next-d' }, [
        el('b', { text: nx.left === 0 ? '今日' : nx.left === 1 ? '明日' : U.fmtMD(nx.date) }),
        el('span', { class: 'muted small', text: U.fmtYMDW(nx.date) })
      ]),
      el('div', { class: 'tr-next-n' }, nx.rows.map(function (t) {
        return el('span', { class: 'tr-pill', style: { background: t.color } },
          el('span', { text: t.name }));
      }))
    ]));

    // 今日ぶんは、出したら印を付けられる
    var mine = T.ofDay(today);
    if (mine.length) {
      box.appendChild(el('div', { class: 'list tight' }, mine.map(function (t) {
        var done = T.isDone(today, t.id);
        var row = el('label', { class: 'bd-pill' + (done ? ' on' : '') }, [
          el('input', {
            type: 'checkbox', class: 'mn-chk', checked: done,
            'aria-label': t.name + 'を出した',
            onchange: function (e) {
              var on = e.target.checked;
              T.setDone(today, t.id, on, { noRender: true });
              row.classList.toggle('on', on);
            }
          }),
          el('span', { class: 'bd-pill-n', text: t.name + 'を出した' })
        ]);
        return row;
      })));
    }
    return box;
  }

  /* ---------------- 曜日の表 ---------------- */

  function weekTable(today) {
    var box = el('div', { class: 'card tr-week' });
    for (var d = 0; d < 7; d++) {
      (function (dow) {
        var rows = T.list().filter(function (t) {
          return (t.weekdays || []).indexOf(dow) >= 0;
        });
        box.appendChild(el('div', { class: 'tr-week-row' + (U.dow(today) === dow ? ' today' : '') }, [
          el('span', { class: 'tr-week-d' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''),
            text: U.wdName(dow) }),
          el('div', { class: 'tr-week-n' }, rows.length ? rows.map(function (t) {
            return el('span', { class: 'tr-pill', style: { background: t.color } }, [
              el('span', { text: t.name }),
              (t.weeks || []).length
                ? el('i', { text: '第' + t.weeks.join('・') }) : null
            ]);
          }) : el('span', { class: 'muted small', text: '—' }))
        ]));
      })(d);
    }
    return box;
  }

  /* ---------------- 登録・編集 ---------------- */

  var COLORS = ['#d9534f', '#e08b2a', '#b07a2a', '#2f8f4e', '#2f7fd4', '#8a62c8', '#7a8aa0'];

  function editSheet(t, seed) {
    var isNew = !t;
    var v = t || Object.assign({ name: '', color: COLORS[0], weekdays: [], weeks: [],
      memo: '', active: true }, seed || {});

    var nameIn = ui.input({ value: v.name === '(名称未設定)' ? '' : (v.name || '') });
    var memoIn = ui.input({ value: v.memo || '' });
    var activeChk = el('input', { type: 'checkbox', class: 'check', checked: v.active !== false });

    var color = v.color || COLORS[0];
    var colorBox = el('div', { class: 'row-wrap' }, COLORS.map(function (c) {
      var b = el('button', {
        type: 'button', class: 'tr-color' + (c === color ? ' on' : ''),
        style: { background: c }, 'aria-label': '色',
        onclick: function () {
          color = c;
          U.$$('.tr-color', colorBox).forEach(function (n) { n.classList.remove('on'); });
          b.classList.add('on');
        }
      });
      return b;
    }));

    var wd = (v.weekdays || []).slice();
    var wdBox = el('div', { class: 'row-wrap' }, [0, 1, 2, 3, 4, 5, 6].map(function (d) {
      var b = el('button', {
        type: 'button', class: 'chip pick' + (wd.indexOf(d) >= 0 ? ' on' : ''),
        onclick: function () {
          var at = wd.indexOf(d);
          if (at >= 0) wd.splice(at, 1); else wd.push(d);
          b.classList.toggle('on', wd.indexOf(d) >= 0);
        }
      }, el('span', { text: U.wdName(d) }));
      return b;
    }));

    var wk = (v.weeks || []).slice();
    var wkBox = el('div', { class: 'row-wrap' }, [1, 2, 3, 4, 5].map(function (n) {
      var b = el('button', {
        type: 'button', class: 'chip pick' + (wk.indexOf(n) >= 0 ? ' on' : ''),
        onclick: function () {
          var at = wk.indexOf(n);
          if (at >= 0) wk.splice(at, 1); else wk.push(n);
          b.classList.toggle('on', wk.indexOf(n) >= 0);
        }
      }, el('span', { text: '第' + n }));
      return b;
    }));

    var close = ui.sheet({
      title: isNew ? 'ゴミの日を足す' : 'ゴミの日を直す',
      body: el('div', { class: 'form' }, [
        ui.field('名前', nameIn),
        ui.block('色', colorBox),
        ui.block('曜日', wdBox),
        ui.block('第何週', wkBox, '何も選ばなければ毎週'),
        ui.field('メモ', memoIn, '出す場所や、袋の決まりなど'),
        el('label', { class: 'row-check' }, [activeChk, el('span', { text: '出す' })]),
        !isNew ? ui.btn('これを削除', 'danger full mt', function () {
          ui.confirm('「' + t.name + '」を削除します。', { danger: true, okText: '削除' })
            .then(function (ok) {
              if (!ok) return;
              S.removeTrash(t.id); close(); ui.toast('削除しました'); DL.app.render();
            });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var name = nameIn.value.trim();
          if (!name) { ui.toast('名前を入れてください', 'warn'); return; }
          if (!wd.length) { ui.toast('曜日を選んでください', 'warn'); return; }
          var data = { name: name, color: color, weekdays: wd, weeks: wk,
            memo: memoIn.value.trim(), active: activeChk.checked };
          if (isNew) S.addTrash(data); else S.updateTrash(t.id, data);
          close(); ui.toast(isNew ? '足しました' : '保存しました'); DL.app.render();
        })
      ]
    });
  }

  function presetSheet() {
    var have = {};
    T.list({ all: true }).forEach(function (t) { have[t.name] = true; });
    var box = el('div', { class: 'list' }, T.PRESETS.map(function (p) {
      return el('button', {
        type: 'button', class: 'row' + (have[p.name] ? ' is-done' : ''),
        disabled: have[p.name] ? 'disabled' : null,
        onclick: have[p.name] ? null : function () { close(); editSheet(null, p); }
      }, [
        el('span', { class: 'dot', style: { background: p.color } }),
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            el('span', { text: p.name }),
            have[p.name] ? ui.chip('もうある', 'ghosty') : null
          ]),
          el('div', { class: 'row-sub' }, [ui.chip(T.whenLabel(p), 'soft')])
        ])
      ]);
    }));
    var close = ui.sheet({
      title: 'よく使うものから',
      body: el('div', {}, [
        el('p', { class: 'muted small pad',
          text: '曜日は地域で違います。選んだあとの画面で直してください。' }),
        box
      ])
    });
  }

  /* ---------------- ほかの画面から ---------------- */

  function entry() {
    var nx = T.next();
    return el('a', { class: 'row', href: '#/trash' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('trash', 17), el('span', { text: 'ゴミの日' })
        ]),
        el('div', { class: 'row-sub' }, nx ? [
          ui.chip(nx.left === 0 ? '今日' : nx.left === 1 ? '明日' : U.fmtMD(nx.date),
            nx.left <= 1 ? 'warn' : 'soft'),
          el('span', { class: 'muted small',
            text: nx.rows.map(function (t) { return t.name; }).join('・') })
        ] : [ui.chip('まだ入っていません', 'ghosty')])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  DL.views = DL.views || {};
  DL.views.trash = { render: render, entry: entry, editSheet: editSheet };
})(window.DL);
