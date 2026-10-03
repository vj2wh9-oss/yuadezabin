/* 家事の周期表（画面）。

   上に「いまやるもの」、下に全部。どちらも遅れている順。
   やった日を押すと、そこから周期ぶん先が次になる。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;
  var C = DL.chores;

  function render(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });
    var rows = C.all(today);

    if (!rows.length) {
      wrap.appendChild(ui.section('家事の周期表'));
      wrap.appendChild(el('div', { class: 'card' }, [
        el('p', { text: 'シーツ・排水口・換気扇・フィルター・布団のように、'
          + '「前にやった日から数えて次」で回すものをここに置きます。' }),
        el('p', { class: 'muted small',
          text: '繰り返しの予定とちがって、さぼってもずれていきません。'
            + '次はいつも「最後にやった日＋周期」です。' }),
        el('div', { class: 'row-wrap' }, [
          ui.btn('よく使うものから', 'primary', function () { presetSheet(); }, 'star'),
          ui.btn('自分で足す', 'ghost', function () { editSheet(null); }, 'plus')
        ])
      ]));
      root.appendChild(wrap);
      return;
    }

    var dueRows = rows.filter(function (st) { return st.due; });
    wrap.appendChild(ui.section('いまやるもの',
      dueRows.length ? ui.chip(dueRows.length + '件',
        dueRows.some(function (st) { return st.over; }) ? 'warn' : 'soft')
        : ui.chip('ありません', 'ok')));

    if (dueRows.length) {
      wrap.appendChild(el('div', { class: 'list' }, dueRows.map(function (st) {
        return row(st, today);
      })));
    } else {
      wrap.appendChild(el('div', { class: 'card muted small' },
        el('span', { text: 'いまやるものはありません。ひと息ついてください。' })));
    }

    var rest = rows.filter(function (st) { return !st.due; });
    if (rest.length) {
      wrap.appendChild(ui.section('そのほか',
        el('span', { class: 'muted small', text: rest.length + '件' })));
      wrap.appendChild(el('div', { class: 'list' }, rest.map(function (st) {
        return row(st, today);
      })));
    }

    wrap.appendChild(el('div', { class: 'row-wrap mt' }, [
      ui.btn('足す', 'primary', function () { editSheet(null); }, 'plus'),
      ui.btn('よく使うものから', 'ghost', function () { presetSheet(); }, 'star')
    ]));
    root.appendChild(wrap);
  }

  /** 1件ぶん。遅れぐあいを帯で出す */
  function row(st, today) {
    var c = st.c;
    var cls = 'row ch-row' + (st.over ? ' late' : st.due ? ' soon' : '');
    /* 帯は「周期のどこまで来たか」。過ぎていれば振り切る */
    var pct = st.never ? 100
      : Math.max(0, Math.min(100, Math.round((st.every - (st.left || 0)) / st.every * 100)));

    return el('div', { class: cls }, [
      el('div', { class: 'row-main', onclick: function () { editSheet(c); } }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: c.name }),
          c.active === false ? ui.chip('止めている', 'ghosty') : null
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(C.everyLabel(c.every), 'soft'),
          st.never ? ui.chip('まだ一度も', 'warn')
            : st.over ? ui.chip(st.late + '日 過ぎている', 'danger')
              : ui.chip('あと ' + st.left + '日', st.due ? 'warn' : 'ghosty'),
          c.lastAt ? ui.chip('最後 ' + U.fmtMD(c.lastAt), 'ghosty') : null,
          c.place ? ui.chip(c.place, 'ghosty') : null
        ]),
        el('div', { class: 'ch-rail' },
          el('i', { style: { width: pct + '%',
            background: st.over ? 'var(--danger)' : st.due ? 'var(--warn)' : 'var(--accent)' } }))
      ]),
      el('button', {
        class: 'checkbtn', 'aria-label': c.name + 'をやった',
        onclick: function () {
          C.done(c.id, today);
          ui.toast('「' + c.name + '」をやりました。次は '
            + U.fmtMD(U.addDays(today, c.every)));
        }
      }, ui.icon('check', 17))
    ]);
  }

  /* ---------------- 登録・編集 ---------------- */

  function editSheet(c, seed) {
    var isNew = !c;
    var v = c || Object.assign({ name: '', every: 7, lastAt: '', from: U.today(),
      place: '', memo: '', active: true }, seed || {});

    var nameIn = ui.input({ value: v.name === '(名称未設定)' ? '' : (v.name || '') });
    var everyIn = ui.input({ type: 'number', inputmode: 'numeric', value: String(v.every || 7) });
    var lastIn = ui.input({ type: 'date', value: v.lastAt || '' });
    var fromIn = ui.input({ type: 'date', value: v.from || U.today() });
    var placeIn = ui.input({ value: v.place || '' });
    var memoIn = ui.textarea({ value: v.memo || '' });
    var activeChk = el('input', { type: 'checkbox', class: 'check', checked: v.active !== false });

    /* よく使う周期は、押すだけで入るようにする */
    var quick = el('div', { class: 'row-wrap' }, [1, 7, 14, 30, 60, 90, 180, 365].map(function (n) {
      return ui.btn(C.everyLabel(n), 'ghost tiny', function () { everyIn.value = String(n); });
    }));

    var kp = c ? C.keep(c) : null;

    var close = ui.sheet({
      title: isNew ? '家事を足す' : '家事を直す',
      body: el('div', { class: 'form' }, [
        ui.field('何をするか', nameIn),
        ui.field('何日ごと', everyIn),
        ui.block('よく使う周期', quick),
        ui.field('最後にやった日', lastIn,
          '空なら「まだ一度も」。ここから数えて次が決まります'),
        !v.lastAt ? ui.field('いつから始めるか', fromIn) : null,
        ui.field('どこ', placeIn),
        ui.field('メモ', memoIn),
        kp ? el('p', { class: 'muted small',
          text: 'これまで ' + kp.times + '回。間はならして ' + kp.avg + '日'
            + (kp.slip > 0 ? '（決めた周期より ' + kp.slip + '日 長め）'
              : kp.slip < 0 ? '（決めた周期より ' + Math.abs(kp.slip) + '日 短め）' : '') }) : null,
        el('label', { class: 'row-check' }, [activeChk, el('span', { text: '周期表に出す' })]),
        !isNew ? el('div', { class: 'row-wrap' }, [
          c.lastAt ? ui.btn('やったのを取り消す', 'ghost', function () {
            C.undo(c.id); close(); ui.toast('取り消しました'); DL.app.render();
          }, 'refresh') : null
        ]) : null,
        !isNew ? ui.btn('これを削除', 'danger full mt', function () {
          ui.confirm('「' + c.name + '」を周期表から削除します。',
            { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeChore(c.id); close(); ui.toast('削除しました'); DL.app.render();
          });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var name = nameIn.value.trim();
          if (!name) { ui.toast('何をするかを入れてください', 'warn'); return; }
          if (!U.num(everyIn.value, 0)) { ui.toast('何日ごとかを入れてください', 'warn'); return; }
          var data = {
            name: name, every: U.num(everyIn.value, 7),
            lastAt: lastIn.value, from: fromIn.value,
            place: placeIn.value.trim(), memo: memoIn.value.trim(),
            active: activeChk.checked
          };
          if (isNew) S.addChore(data); else S.updateChore(c.id, data);
          close(); ui.toast(isNew ? '足しました' : '保存しました'); DL.app.render();
        })
      ]
    });
  }

  /* ---------------- よく使うもの ---------------- */

  function presetSheet() {
    var have = {};
    C.list({ all: true }).forEach(function (c) { have[c.name] = true; });

    var box = el('div', { class: 'list' }, C.PRESETS.map(function (p) {
      return el('button', {
        type: 'button', class: 'row' + (have[p.name] ? ' is-done' : ''),
        disabled: have[p.name] ? 'disabled' : null,
        onclick: have[p.name] ? null : function () { close(); editSheet(null, p); }
      }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            el('span', { text: p.name }),
            have[p.name] ? ui.chip('もうある', 'ghosty') : null
          ]),
          el('div', { class: 'row-sub' }, [
            ui.chip(C.everyLabel(p.every), 'soft'),
            p.place ? ui.chip(p.place, 'ghosty') : null
          ])
        ]),
        have[p.name] ? null : el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]);
    }));

    var close = ui.sheet({
      title: 'よく使うものから',
      body: el('div', {}, [
        el('p', { class: 'muted small pad',
          text: '周期は目安です。あとから直せます。' }),
        box,
        el('div', { class: 'pad' }, ui.btn('まとめて足す', 'primary full', function () {
          var n = 0;
          C.PRESETS.forEach(function (p) {
            if (have[p.name]) return;
            S.addChore(p); n++;
          });
          close(); ui.toast(n + '件 足しました'); DL.app.render();
        }, 'plus'))
      ])
    });
  }

  /* ---------------- ほかの画面から ---------------- */

  /** ホームの下に置く入口 */
  function entry() {
    var sm = C.summary();
    return el('a', { class: 'row', href: '#/chores' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('broom', 17), el('span', { text: '家事の周期表' })
        ]),
        sm.all ? el('div', { class: 'row-sub' }, [
          sm.due ? ui.chip('いまやるもの ' + sm.due + '件', sm.over ? 'warn' : 'soft')
            : ui.chip('ひと息つけます', 'ok'),
          sm.over ? ui.chip('遅れ ' + sm.over + '件', 'danger') : null
        ]) : null
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /** ホームの「今日やること」に出す行。遅れているものだけ、まとめて1行 */
  function todoRow(date) {
    var rows = C.due(date).filter(function (st) { return st.over; });
    if (!rows.length) return null;
    var title = el('span', { text: '家事　' + rows.length + '件' });

    var left = rows.length;

    var pills = el('div', { class: 'bd-dose flat' }, rows.slice(0, 6).map(function (st) {
      var box = el('button', {
        type: 'button', class: 'bd-pill',
        onclick: function () {
          if (box.classList.contains('on')) return;
          /* 描き直さない。描き直すと押した札がその場から消えて、
             押せたのか分からなくなる（くすりのチェックと同じ） */
          C.done(st.c.id, date, { noRender: true });
          box.classList.add('on');
          left--;
          title.textContent = left ? '家事　' + left + '件' : '家事　ぜんぶ終わった';
          ui.toast('「' + st.c.name + '」をやりました');
        }
      }, [
        el('span', { class: 'bd-pill-n', text: st.c.name }),
        el('span', { class: 'muted small', text: st.late + '日' })
      ]);
      return box;
    }));

    return el('div', { class: 'row home-chore' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [ui.icon('broom', 16), title]),
        pills
      ])
    ]);
  }

  DL.views = DL.views || {};
  DL.views.chores = { render: render, entry: entry, todoRow: todoRow, editSheet: editSheet };
})(window.DL);
