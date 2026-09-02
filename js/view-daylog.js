/* 1日の記録：その日に起きたことを1枚にまとめ、ひとこと書き添える */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, D = DL.docs, el = U.el;

  function render(root, params) {
    var date = U.isISO(params.date) ? params.date : U.today();
    var d = DL.daylog.of(date);
    var wrap = el('div', { class: 'page log-page' });

    // 今日ぶんは、正午の天気を記録に写しておく（あとから引けないため）。
    // 描いている最中に書き込むと描き直しが入れ子になるので、描き終えてから
    setTimeout(function () { DL.daylog.keepWeather(date); }, 0);

    /* ---- 日付の行 ---- */
    wrap.appendChild(el('div', { class: 'daynav' }, [
      el('a', { class: 'iconbtn', href: '#/log/' + U.addDays(date, -1), 'aria-label': '前の日' }, ui.icon('chevronLeft', 20)),
      el('div', { class: 'daytitle' }, [
        ui.dateHead(date),
        el('div', { class: 'today-sub', text: rel(date) })
      ]),
      el('a', { class: 'iconbtn', href: '#/log/' + U.addDays(date, 1), 'aria-label': '次の日' }, ui.icon('chevronRight', 20))
    ]));

    /* ---- その日の状態（天気・勤務・印） ---- */
    var chips = [];
    if (d.weather) {
      var wi = DL.weather.codeInfo(d.weather.code);
      chips.push(el('span', { class: 'log-chip' }, [
        ui.icon(wi.icon, 17),
        el('span', { text: wi.label + (d.weather.max !== null && d.weather.max !== undefined
          ? '　' + d.weather.max + '/' + d.weather.min + '°' : '') })
      ]));
    }
    if (d.duty) chips.push(el('span', { class: 'log-chip duty-' + d.duty }, [
      el('i', { class: 'duty-dot' }), el('span', { text: S.dutyLabel(d.duty) })
    ]));
    if (d.holiday) chips.push(el('span', { class: 'log-chip' }, [
      ui.icon('clock', 16), el('span', { text: d.stayHoliday ? '休業日（泊まり勤務）' : '休業日' })
    ]));
    d.marks.forEach(function (m) {
      chips.push(el('span', { class: 'log-chip mk-' + m.type }, [
        ui.icon(m.type === 'event' ? 'event' : m.type === 'printing' ? 'printer' : 'deadline', 16),
        el('span', { text: m.label })
      ]));
    });
    if (chips.length) wrap.appendChild(el('div', { class: 'log-chips' }, chips));

    /* ---- 書くところ ---- */
    wrap.appendChild(noteCard(d));

    /* ---- ひらめきメモ ---- */
    wrap.appendChild(ui.section('ひらめきメモ',
      el('span', { class: 'muted small', text: (d.log.ideas || []).length ? d.log.ideas.length + '件' : '' })));
    wrap.appendChild(ideaCard(d));

    /* ---- 進んだ作業 ---- */
    if (d.works.length) {
      var total = U.sum(d.works, function (w) { return w.done; });
      wrap.appendChild(ui.section('進めたこと', el('span', { class: 'muted small', text: total ? '合計 ' + total : '' })));
      var wl = el('div', { class: 'list' });
      d.works.forEach(function (w) { wl.appendChild(workRow(w, date)); });
      wrap.appendChild(wl);
    }

    /* ---- 日常の予定 ---- */
    if (d.plans.length) {
      wrap.appendChild(ui.section('予定'));
      var pl = el('div', { class: 'list' });
      d.plans.forEach(function (o) {
        pl.appendChild(el('button', {
          class: 'row log-row' + (o.done ? ' is-done' : ''),
          onclick: function () { DL.views.events.form(o.ev, { occurrence: o.occurrence }); }
        }, [
          el('div', { class: 'row-bar', style: { background: o.ev.color } }),
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title', text: o.ev.title }),
            el('div', { class: 'row-sub' }, [
              ui.chip(DL.events.whenText(o.occurrence), 'soft'),
              o.ev.important ? ui.iconChip('alert', '重要', 'warn') : null,
              o.done ? ui.chip('やった', 'ok') : null
            ])
          ])
        ]));
      });
      wrap.appendChild(pl);
    }

    /* ---- お金 ---- */
    if (d.money.expenses.length || d.docs.length) {
      wrap.appendChild(ui.section('お金'));
      var ml = el('div', { class: 'list' });
      d.money.expenses.forEach(function (x) {
        ml.appendChild(el('button', {
          class: 'row log-row', onclick: function () { DL.views.books.editExpense(x.id); }
        }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              ui.icon('books', 16),
              el('span', { text: x.vendor || x.category || '経費' })
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip(x.book === 'life' ? '日常' : '事業', x.book === 'life' ? 'ghosty' : 'soft'),
              x.category ? ui.chip(x.category, 'ghosty') : null,
              x.memo ? el('span', { class: 'muted small', text: x.memo }) : null
            ])
          ]),
          el('span', { class: 'log-amount', text: '-' + D.yen(x.amount) })
        ]));
      });
      d.docs.forEach(function (o) {
        var c = D.calc(o.doc);
        ml.appendChild(el('a', {
          class: 'row log-row', href: '#/doc/' + o.project.id + '/' + o.doc.id
        }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              ui.icon(D.TYPE_ICON[o.doc.type], 16),
              el('span', { text: D.TYPE_LABEL[o.doc.type] + (o.doc.number ? '　' + o.doc.number : '') })
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip(o.project.title, 'ghosty'),
              ui.chip(o.kind === 'due' ? '入金予定日' : '発行', o.kind === 'due' ? 'warn' : 'soft'),
              ui.chip(D.statusLabel(o.doc), D.statusTone(o.doc))
            ])
          ]),
          el('span', { class: 'log-amount plus', text: D.yen(o.doc.type === 'receipt' ? c.total : c.payable) })
        ]));
      });
      wrap.appendChild(ml);

      var sums = [];
      if (d.money.workTotal) sums.push('事業の経費 ' + D.yen(d.money.workTotal));
      if (d.money.lifeTotal) sums.push('日常の支出 ' + D.yen(d.money.lifeTotal));
      if (sums.length) wrap.appendChild(el('p', { class: 'muted small', text: sums.join('　') }));
    }

    /* ---- 頒布・在庫 ---- */
    if (d.stock.length) {
      wrap.appendChild(ui.section('頒布と在庫'));
      var sl = el('div', { class: 'list' });
      d.stock.forEach(function (x) {
        var n = DL.stock.delta(x.move);
        sl.appendChild(el('a', { class: 'row log-row', href: '#/stock' }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              ui.icon('books', 16),
              el('span', { text: (x.item ? x.item.title : '（消えた頒布物）') })
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip(x.def.label, 'ghosty'),
              x.move.place ? ui.chip(x.move.place, 'ghosty') : null,
              x.move.kind === 'sale' ? ui.chip(D.yen(DL.stock.money(x.move, x.item)), 'soft') : null
            ])
          ]),
          el('span', { class: 'move-qty' + (n < 0 ? ' minus' : ''), text: (n > 0 ? '+' : '') + n })
        ]));
      });
      wrap.appendChild(sl);
    }

    /* ---- 何もない日 ---- */
    if (!DL.daylog.has(d)) {
      wrap.appendChild(ui.empty('この日の記録はまだありません。'));
    }

    /* ---- 行き先 ---- */
    wrap.appendChild(el('div', { class: 'row-wrap mt' }, [
      ui.btn('この日のカレンダー', 'ghost', function () { location.hash = '#/day/' + date; }, 'calendar'),
      ui.btn('記録の一覧', 'ghost', function () { location.hash = '#/logs'; }, 'task')
    ]));

    root.appendChild(wrap);
    keepWriting(wrap);
  }

  /* ひらめきを足した直後は、続けて書けるように入力欄へ戻す */
  function keepWriting(wrap) {
    if (!refocus) return;
    refocus = false;
    var box = wrap.querySelector('.idea-in');
    if (box) box.focus();
  }

  /* ---------------- 書くところ ---------------- */

  function noteCard(d) {
    var text = ui.textarea({ value: d.log.text || '', placeholder: 'その日のこと、思ったこと', maxlength: 4000 });
    text.rows = 4;
    var mood = d.log.mood || 0;

    var moodRow = el('div', { class: 'mood-row' }, S.MOODS.map(function (m) {
      var b = el('button', {
        type: 'button', class: 'mood' + (mood === m.value ? ' on' : ''),
        'aria-label': m.label, title: m.label,
        onclick: function () {
          mood = (mood === m.value) ? 0 : m.value;     // もう一度押したら外す
          U.$$('.mood', moodRow).forEach(function (x) { x.classList.remove('on'); });
          if (mood) b.classList.add('on');
        }
      }, [
        // 目盛りの高さで「調子の段階」を出す（顔の絵は使わず、アプリの他と揃える）
        el('span', { class: 'mood-lv-box' }, el('i', { class: 'mood-lv' })),
        el('span', { text: m.label })
      ]);
      return b;
    }));

    var saved = el('span', { class: 'muted small' });
    if (d.log.updatedAt) saved.textContent = U.fmtMD(U.toISO(new Date(d.log.updatedAt))) + ' に書いた';

    return el('div', { class: 'card log-note' }, [
      ui.field('その日の調子', moodRow),
      ui.field('メモ', text),
      el('div', { class: 'log-note-foot' }, [
        saved,
        ui.btn('保存', 'primary', function () {
          S.setLog(d.date, { text: text.value, mood: mood });
          ui.toast('書きました');
        }, 'check')
      ])
    ]);
  }

  /* ---------------- ひらめきメモ ---------------- */

  // 続けて書けるように、足したあとは入力欄へ戻す（画面はまるごと描き直されるため）
  var refocus = false;
  var IDEA_MAX = 2000;

  /**
   * 書き足すところ。改行できるメモ形式にしてある。
   * @param {string} date 書き足す先の日
   */
  function ideaAdd(date) {
    var input = ui.textarea({ placeholder: '思いついたことを書く', maxlength: IDEA_MAX });
    input.rows = 2;
    input.classList.add('idea-in');

    function add() {
      var t = input.value.trim();
      if (!t) { input.focus(); return; }
      refocus = true;
      S.addIdea(date, t);      // ここで画面が描き直される
    }
    // 改行に使うので Enter では送らない。指を離さず送りたいとき用に ⌘/Ctrl+Enter
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
    });
    // 書いた行数に合わせて伸ばす（書いている途中で読み返せるように）
    input.addEventListener('input', function () { grow(input); });

    return el('div', { class: 'idea-add' }, [
      input,
      ui.btn('足す', 'primary', add, 'plus')
    ]);
  }

  function grow(t) {
    t.style.height = 'auto';
    t.style.height = Math.min(220, t.scrollHeight) + 'px';
  }

  /* ひらめき1件ぶん。押すと直せる */
  function ideaRow(date, x) {
    return el('div', { class: 'idea' }, [
      el('button', {
        class: 'idea-text', text: x.text, title: '押すと直せます',
        onclick: function () { editIdea(date, x); }
      }),
      el('button', {
        class: 'iconbtn small', 'aria-label': 'このひらめきを消す',
        onclick: function () {
          ui.confirm(x.text, { title: 'このひらめきを消しますか', okText: '消す', danger: true })
            .then(function (yes) { if (yes) S.removeIdea(date, x.id); });
        }
      }, ui.icon('trash', 16))
    ]);
  }

  function ideaCard(d) {
    var list = (d.log.ideas || []).slice().reverse();     // 新しいものを上に
    var box = el('div', { class: 'card idea-card' }, ideaAdd(d.date));

    if (!list.length) {
      box.appendChild(el('p', { class: 'muted small idea-hint', text: 'ネタ・構図・言い回しなど、あとで使いそうなことを。改行できます。' }));
      return box;
    }

    var ul = el('div', { class: 'idea-list' });
    list.forEach(function (x) { ul.appendChild(ideaRow(d.date, x)); });
    box.appendChild(ul);
    return box;
  }

  function editIdea(date, x) {
    var input = ui.textarea({ value: x.text, maxlength: IDEA_MAX });
    input.rows = 5;
    var close = ui.sheet({
      title: 'ひらめきを直す',
      body: el('div', { class: 'form' }, ui.field('内容', input)),
      actions: [
        ui.btn('やめる', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var t = input.value.trim();
          if (!t) { ui.toast('中身を書いてください', 'danger'); return; }
          close();
          S.updateIdea(date, x.id, t);
          ui.toast('直しました');
        }, 'check')
      ]
    });
  }

  function workRow(w, date) {
    var pct = w.qty ? Math.min(100, Math.round(w.done / w.qty * 100)) : (w.done ? 100 : 0);
    var range = DL.schedule.rangeText(w.task, w.from, w.to);
    return el('button', {
      class: 'row log-row', onclick: function () { DL.forms.progressSheet(w.project.id, w.task.id, date); }
    }, [
      el('div', { class: 'row-bar', style: { background: w.project.color } }),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: w.task.name }),
          range ? el('span', { class: 'range', text: range }) : null,
          el('span', { class: 'muted small', text: '　' + w.project.title })
        ]),
        el('div', { class: 'row-sub' }, [
          w.task.unit === 'none'
            ? ui.chip('作業日', 'soft')
            : ui.chip(w.done + ' / ' + (w.qty || 0) + w.unit, w.qty && w.done >= w.qty ? 'ok' : 'soft'),
          !w.planned ? ui.chip('予定外', 'ghosty') : null
        ]),
        w.qty ? ui.progress(pct, w.project.color) : null
      ])
    ]);
  }

  function rel(date) {
    var t = U.today();
    var n = U.diffDays(t, date);
    if (n === 0) return '今日';
    if (n === 1) return '明日';
    if (n === -1) return '昨日';
    return n > 0 ? n + '日後' : Math.abs(n) + '日前';
  }

  /* ---------------- ひらめきメモの一覧 ----------------
     上のバーの電球から開く。ここで書いたものは今日ぶんに入る。 */

  function renderIdeas(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page ideas-page' });
    var all = S.allIdeas();

    // まず書くところ。思いついてから書き出すまでを短くしたいので、いちばん上に置く
    wrap.appendChild(el('div', { class: 'card idea-card' }, [
      ideaAdd(today),
      el('p', { class: 'muted small idea-hint', text: '改行できます。書いたものは今日の記録に入ります。' })
    ]));

    if (!all.length) {
      wrap.appendChild(ui.empty('まだ何もありません。ネタ・構図・言い回しなど、思いついたら書いてください。'));
      root.appendChild(wrap);
      keepWriting(wrap);
      return;
    }

    wrap.appendChild(ui.section('書いたもの', el('span', { class: 'muted small', text: all.length + '件' })));

    // 日ごとにまとめる（新しい日が上、その日の中でも新しいものが上）
    var seen = '';
    var group = null;
    all.forEach(function (x) {
      if (x.date !== seen) {
        seen = x.date;
        wrap.appendChild(el('a', { class: 'idea-day', href: '#/log/' + x.date }, [
          el('span', { text: U.fmtYMDW(x.date) }),
          el('span', { class: 'muted small', text: rel(x.date) }),
          el('span', { class: 'chev' }, ui.icon('chevronRight', 14))
        ]));
        group = el('div', { class: 'idea-list' });
        wrap.appendChild(group);
      }
      group.appendChild(ideaRow(x.date, x.idea));
    });

    root.appendChild(wrap);
    keepWriting(wrap);
  }

  /* ---------------- 記録の一覧 ---------------- */

  function renderList(root) {
    var wrap = el('div', { class: 'page' });
    var dates = S.logDates();

    wrap.appendChild(ui.section('書いた日', el('span', { class: 'muted small', text: dates.length + '日' })));
    if (!dates.length) {
      wrap.appendChild(ui.empty('まだ何も書いていません。',
        ui.btn('今日のぶんを書く', 'primary', function () { location.hash = '#/log/' + U.today(); }, 'edit')));
      root.appendChild(wrap);
      return;
    }

    var list = el('div', { class: 'list' });
    dates.slice(0, 120).forEach(function (date) {
      var d = DL.daylog.of(date);
      var m = d.log.mood;
      list.appendChild(el('a', { class: 'row log-list-row', href: '#/log/' + date }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            el('span', { text: U.fmtYMDW(date) }),
            m ? el('span', { class: 'mood-dot m' + m, title: (S.MOODS[m - 1] || {}).label }) : null,
            d.weather ? ui.icon(DL.weather.codeInfo(d.weather.code).icon, 16) : null
          ]),
          d.log.text ? el('p', { class: 'log-excerpt', text: d.log.text }) : null,
          (d.log.ideas || []).length
            ? el('p', { class: 'log-excerpt idea-excerpt' }, [
              ui.icon('idea', 14),
              el('span', { text: d.log.ideas[d.log.ideas.length - 1].text })
            ])
            : null,
          el('div', { class: 'row-sub' }, [
            el('span', { class: 'muted small', text: DL.daylog.summary(d) })
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
    });
    wrap.appendChild(list);
    if (dates.length > 120) {
      wrap.appendChild(el('p', { class: 'muted small', text: 'ほか ' + (dates.length - 120) + '日' }));
    }
    root.appendChild(wrap);
  }

  DL.views = DL.views || {};
  DL.views.daylog = { render: render, renderList: renderList, renderIdeas: renderIdeas };
})(window.DL);
