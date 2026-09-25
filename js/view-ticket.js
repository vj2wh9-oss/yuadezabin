/* 即売会のチケット。

   即売会だけは、ほかの案件と扱いを変えている。
   1つの即売会につきチケットを1枚。その下に

     ・原稿（新刊など）… これまでどおりの案件。1件ずつ中で進める
     ・頒布物（グッズ・ポスターなど）… 在庫のほうに入っているもの
     ・準備 … 当日までに済ませる、こまごまとしたこと

   をまとめて置く。案件そのものの作りは変えていないので、
   カレンダーも当日モードも今までどおり動く。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, K = DL.stock, el = U.el;

  /* ---------------- チケット1枚 ---------------- */

  function render(root, params) {
    var t = S.getTicket(params && params.id);
    var wrap = el('div', { class: 'page ticket-page' });
    if (!t) {
      wrap.appendChild(ui.empty('このチケットはありません。',
        ui.btn('案件へ戻る', 'primary', function () { location.hash = '#/projects'; })));
      root.appendChild(wrap);
      return;
    }
    var today = U.today();
    var projects = S.ticketProjects(t.id);

    wrap.appendChild(hero(t, today));

    /* ---- 原稿など ---- */
    wrap.appendChild(ui.section('原稿',
      ui.btn('足す', 'ghost tiny', function () { addProject(t); }, 'plus')));
    if (!projects.length) {
      wrap.appendChild(ui.empty('まだありません。'));
    } else {
      wrap.appendChild(el('div', { class: 'list' },
        projects.map(function (p) { return projectRow(p, today); })));
    }

    /* ---- 頒布物 ---- */
    var items = itemsOf(projects);
    wrap.appendChild(ui.section('頒布物',
      ui.btn('足す', 'ghost tiny', function () { addItem(t, projects); }, 'plus')));
    if (!items.length) {
      wrap.appendChild(ui.empty('まだありません。'));
    } else {
      wrap.appendChild(el('div', { class: 'list' }, items.map(itemRow)));
    }

    /* ---- 準備 ---- */
    wrap.appendChild(ui.section('準備', prepCount(t)));
    wrap.appendChild(prepCard(t));

    /* ---- 当日モード ---- */
    var main = projects[0];
    if (main) {
      wrap.appendChild(el('a', { class: 'row tk-onsite', href: '#/onsite/' + main.id }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            ui.icon('sales', 17), el('span', { text: '当日モード' })
          ])
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
    }

    /* ---- メモ ---- */
    wrap.appendChild(ui.section('メモ'));
    wrap.appendChild(memoBox(t));

    root.appendChild(wrap);
  }

  /* 上のチケットそのもの。押すと中身を直せる */
  function hero(t, today) {
    var left = t.date ? U.diffDays(today, t.date) : null;
    return el('div', { class: 'tk-hero' + (left !== null && left < 0 ? ' past' : '') }, [
      el('div', { class: 'tk-body' }, [
        el('div', { class: 'tk-name', text: t.name }),
        el('div', { class: 'tk-meta' }, [
          t.date ? ui.chip(U.fmtMDW(t.date), 'soft') : null,
          t.venue ? ui.chip(t.venue, 'ghosty') : null,
          t.space ? ui.chip(t.space, 'ghosty') : null
        ]),
        el('button', {
          type: 'button', class: 'btn ghost tiny tk-edit',
          onclick: function () { ticketForm(t); }
        }, [ui.icon('edit', 14), el('span', { text: '直す' })])
      ]),
      el('div', { class: 'tk-stub' }, left === null ? [
        el('b', { class: 'tk-num', text: '—' })
      ] : [
        el('b', { class: 'tk-num', text: left > 0 ? String(left) : left === 0 ? '当日' : String(-left) }),
        el('span', { class: 'tk-unit', text: left > 0 ? '日' : left === 0 ? '' : '日前' })
      ])
    ]);
  }

  /* 原稿の1行。進み具合まで出す */
  function projectRow(p, today) {
    var prog = sc.projectProgress(p);
    var st = sc.projectStatus(p, today);
    var unit = p.category === 'manga' ? 'P' : '枚';
    return el('a', { class: 'row proj card-row st-' + st, href: '#/project/' + p.id }, [
      el('div', { class: 'row-bar', style: { background: p.color } }),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: p.title }),
          st === 'done' ? ui.chip('完了済', 'ok') : null
        ]),
        el('div', { class: 'row-sub' }, [
          ui.catChip(p),
          p.qty ? ui.chip(p.qty + unit, 'ghosty') : null,
          ui.iconChip('deadline', U.fmtMDW(p.deadline),
            st === 'overdue' ? 'danger' : st === 'urgent' ? 'warn' : 'soft')
        ]),
        ui.progress(prog.pct, p.color)
      ]),
      el('span', { class: 'pct', text: prog.pct + '%' })
    ]);
  }

  /* そのチケットの案件に結びついている頒布物 */
  function itemsOf(projects) {
    var ids = {};
    projects.forEach(function (p) { ids[p.id] = true; });
    return K.all({ withArchived: true }).filter(function (r) {
      return ids[r.item.projectId];
    });
  }

  function itemRow(r) {
    var x = r.item;
    return el('button', {
      type: 'button', class: 'row tk-item',
      onclick: function () { DL.views.stock.openItem(x); }
    }, [
      x.cover ? el('img', { class: 'tk-cover', src: x.cover, alt: '' })
        : el('span', { class: 'tk-cover none' }, ui.icon(x.kind === 'goods' ? 'star' : 'manga', 16)),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title', text: x.title }),
        el('div', { class: 'row-sub' }, [
          ui.chip(K.kindLabel(x.kind), 'ghosty'),
          x.price ? ui.chip(DL.docs.yen(x.price), 'soft') : null,
          ui.chip('在庫 ' + r.left, r.left > 0 ? 'ghosty' : 'warn')
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  function prepCount(t) {
    if (!t.prep.length) return null;
    var done = t.prep.filter(function (x) { return x.done; }).length;
    return ui.chip(done + ' / ' + t.prep.length, done === t.prep.length ? 'ok' : 'soft');
  }

  /* 当日までの準備。押して消し込む */
  function prepCard(t) {
    var box = el('div', { class: 'card tk-prep' });
    var list = el('div', { class: 'tk-prep-list' });

    function draw() {
      U.clear(list);
      var now = S.getTicket(t.id) || t;
      now.prep.forEach(function (x) {
        list.appendChild(el('div', { class: 'tk-prep-row' + (x.done ? ' on' : '') }, [
          el('button', {
            type: 'button', class: 'tk-check', 'aria-label': x.name,
            onclick: function () { S.toggleTicketPrep(t.id, x.id); draw(); }
          }, x.done ? ui.icon('check', 15) : null),
          el('span', { class: 'tk-prep-name', text: x.name }),
          el('button', {
            type: 'button', class: 'iconbtn small', 'aria-label': x.name + 'を消す',
            onclick: function () { S.removeTicketPrep(t.id, x.id); draw(); }
          }, ui.icon('close', 15))
        ]));
      });
      if (!now.prep.length) {
        list.appendChild(el('p', { class: 'muted small', text: 'まだありません。' }));
      }
    }

    var input = ui.input({ placeholder: '例）おつり両替', maxlength: 60, enterkeyhint: 'done' });
    var push = function () {
      var v = input.value.trim();
      if (!v) return;
      S.putTicketPrep(t.id, { name: v });
      input.value = '';
      draw();
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); push(); }
    });

    box.appendChild(list);
    box.appendChild(el('div', { class: 'tk-prep-add' }, [
      input, ui.btn('足す', 'ghost', push, 'plus')
    ]));
    draw();
    return box;
  }

  /* メモ。打っているそばから残す（手が離れないよう、描き直しはしない） */
  function memoBox(t) {
    var area = ui.textarea({ value: t.memo, rows: 3, maxlength: 2000,
      placeholder: '搬入・打ち上げ・持ち物など' });
    var timer = null;
    var put = function () {
      var cur = S.getTicket(t.id);
      if (!cur || cur.memo === area.value) return;
      S.updateTicket(t.id, { memo: area.value });
    };
    area.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(put, 600);
    });
    area.addEventListener('blur', function () {
      if (timer) clearTimeout(timer);
      put();
    });
    return el('div', { class: 'card' }, area);
  }

  /* ---------------- 足す・直す ---------------- */

  function addProject(t) {
    DL.forms.projectForm(null, {
      preset: {
        kind: 'event', ticketId: t.id,
        eventName: t.name, eventDate: t.date, venue: t.venue, space: t.space,
        deadline: t.date ? U.addDays(t.date, -14) : ''
      }
    });
  }

  function addItem(t, projects) {
    if (!projects.length) {
      ui.toast('先に原稿を1つ作ってください', 'warn');
      return;
    }
    DL.views.stock.addItem({ projectId: projects[0].id });
  }

  /** チケットを作る・直す */
  function ticketForm(t) {
    var isNew = !t;
    var v = t || { name: '', date: '', venue: '', space: '' };
    var name = ui.input({ value: v.name, maxlength: 80, placeholder: '例）コミックマーケット' });
    var date = ui.input({ type: 'date', value: v.date });
    var venue = ui.input({ value: v.venue, maxlength: 80, placeholder: '東京ビッグサイト' });
    var space = ui.input({ value: v.space, maxlength: 40, placeholder: 'あ-12b' });

    var close = ui.sheet({
      title: isNew ? '新しいチケット' : 'チケットを直す',
      body: el('div', { class: 'form' }, [
        ui.field('イベント名', name),
        ui.field('開催日', date),
        ui.field('会場', venue),
        ui.field('スペース', space)
      ]),
      actions: [
        isNew ? ui.btn('やめる', 'ghost', function () { close(); })
          : ui.btn('捨てる', 'ghost danger', function () {
            ui.confirm('チケットを捨てます。中の原稿と頒布物は残ります。',
              { okText: '捨てる', danger: true }).then(function (ok) {
              if (!ok) return;
              S.removeTicket(t.id);
              close();
              location.hash = '#/projects';
              ui.toast('捨てました');
            });
          }, 'trash'),
        ui.btn('保存', 'primary', function () {
          if (!name.value.trim()) { ui.toast('イベント名を入れてください', 'warn'); return; }
          var data = {
            name: name.value.trim(), date: date.value,
            venue: venue.value.trim(), space: space.value.trim()
          };
          if (isNew) {
            var made = S.createTicket(data);
            close();
            location.hash = '#/ticket/' + made.id;
            ui.toast('作りました');
          } else {
            S.updateTicket(t.id, data);
            close();
            DL.app.render();
            ui.toast('保存しました');
          }
        }, 'check')
      ]
    });
  }

  /* ---------------- 案件一覧に出すチケットのカード ---------------- */

  /**
   * 一覧に並べる1枚。もぎり線の入った、チケットらしい見た目にする。
   * @param {object} t チケット
   * @param {string} today
   */
  function card(t, today) {
    var projects = S.ticketProjects(t.id);
    var left = t.date ? U.diffDays(today, t.date) : null;
    var soon = left !== null && left >= 0 && left <= 14;
    var past = left !== null && left < 0;
    var done = projects.length
      ? projects.filter(function (p) { return sc.projectStatus(p, today) === 'done'; }).length
      : 0;
    var prepLeft = t.prep.filter(function (x) { return !x.done; }).length;

    return el('a', {
      class: 'tk-card' + (soon ? ' soon' : '') + (past ? ' past' : ''),
      href: '#/ticket/' + t.id
    }, [
      el('div', { class: 'tk-card-main' }, [
        el('div', { class: 'tk-card-head' }, [
          ui.icon('event', 15),
          el('span', { class: 'tk-card-name', text: t.name })
        ]),
        el('div', { class: 'tk-card-sub' }, [
          t.date ? ui.chip(U.fmtMDW(t.date), past ? 'ghosty' : 'soft') : null,
          t.space ? ui.chip(t.space, 'ghosty') : null
        ]),
        el('div', { class: 'tk-card-sub' }, [
          ui.chip('原稿 ' + done + ' / ' + projects.length, done === projects.length && projects.length ? 'ok' : 'ghosty'),
          prepLeft ? ui.chip('準備 のこり ' + prepLeft, 'warn') : null
        ])
      ]),
      el('div', { class: 'tk-card-stub' }, left === null ? [
        el('b', { class: 'tk-num', text: '—' })
      ] : [
        el('b', { class: 'tk-num', text: left > 0 ? String(left) : left === 0 ? '当日' : String(-left) }),
        el('span', { class: 'tk-unit', text: left > 0 ? '日' : left === 0 ? '' : '日前' })
      ])
    ]);
  }

  DL.views = DL.views || {};
  DL.views.ticket = { render: render, card: card, form: ticketForm };
})(window.DL);
