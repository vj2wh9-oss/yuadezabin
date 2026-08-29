/* 案件一覧 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  var filter = 'active';
  var keyword = '';

  function render(root) {
    var today = U.today();
    var wrap = el('div', { class: 'page' });

    var search = ui.input({ value: keyword, placeholder: 'タイトル・イベント名・クライアント・サイトで検索' });
    search.addEventListener('input', function () {
      keyword = search.value;
      renderList();
    });
    wrap.appendChild(el('div', { class: 'searchbox' }, [ui.icon('search', 17), search]));

    var tabs = el('div', { class: 'filters' });
    [
      { v: 'active', l: '進行中' }, { v: 'event', l: '即売会' }, { v: 'work', l: '仕事' },
      { v: 'support', l: '支援サイト' }, { v: 'done', l: '完了' }, { v: 'all', l: 'すべて' }
    ].forEach(function (o) {
      tabs.appendChild(el('button', {
        class: 'filter' + (filter === o.v ? ' on' : ''), text: o.l,
        onclick: function () { filter = o.v; DL.app.render(); }
      }));
    });
    wrap.appendChild(tabs);

    var listBox = el('div');
    wrap.appendChild(listBox);

    function renderList() {
      U.clear(listBox);
      var items = S.projects().filter(function (p) {
        if (filter === 'active') return p.status === 'active';
        if (filter === 'done') return p.status === 'done';
        if (filter === 'event') return p.kind === 'event' && p.status !== 'archived';
        if (filter === 'work') return p.kind === 'work' && p.status !== 'archived';
        if (filter === 'support') return p.kind === 'support' && p.status !== 'archived';
        return true;
      });
      if (keyword.trim()) {
        var k = keyword.trim().toLowerCase();
        items = items.filter(function (p) {
          return [p.title, p.eventName, p.client, p.venue, p.site, p.plan, p.memo].join(' ').toLowerCase().indexOf(k) >= 0;
        });
      }
      items.sort(function (a, b) {
        var sa = a.status === 'active' ? 0 : 1, sb = b.status === 'active' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return U.cmp(a.deadline || '9999-99-99', b.deadline || '9999-99-99');
      });

      if (!items.length) {
        listBox.appendChild(ui.empty(
          S.projects().length ? '該当する案件はありません。' : 'まだ案件がありません。',
          ui.btn('案件を作成', 'primary', function () { DL.forms.projectForm(); })
        ));
        if (!S.projects().length) {
          listBox.appendChild(el('div', { class: 'pad' },
            ui.btn('サンプルデータを入れて試す', 'ghost full', function () {
              S.seedSample(); ui.toast('サンプルを作成しました');
            })
          ));
        }
        return;
      }

      var list = el('div', { class: 'list' });
      items.forEach(function (p) { list.appendChild(card(p, today)); });
      listBox.appendChild(list);
    }

    renderList();
    root.appendChild(wrap);
  }

  function card(p, today) {
    var prog = sc.projectProgress(p);
    var st = sc.projectStatus(p, today);
    var unit = p.category === 'manga' ? 'P' : '枚';

    var sub = [ui.kindChip(p), ui.catChip(p)];
    if (p.qty) sub.push(ui.chip(p.qty + unit, 'ghosty'));
    if (p.kind === 'event' && U.isISO(p.eventDate)) sub.push(ui.iconChip('event', U.fmtMD(p.eventDate), 'ghosty'));
    if (p.client) sub.push(ui.chip(p.client, 'ghosty'));
    if (p.site) sub.push(ui.chip(p.site, 'ghosty'));

    var row = el('a', { class: 'row proj card-row st-' + st, href: '#/project/' + p.id }, [
      el('div', { class: 'row-bar', style: { background: p.color } }),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: p.title }),
          p.status === 'done' ? ui.chip('完了', 'ok') : null,
          p.status === 'archived' ? ui.chip('保管', 'ghosty') : null
        ]),
        el('div', { class: 'row-sub' }, sub),
        el('div', { class: 'row-sub' }, [
          ui.iconChip('deadline', U.fmtMDW(p.deadline), st === 'overdue' ? 'danger' : st === 'urgent' ? 'warn' : 'soft'),
          ui.chip(U.untilLabel(p.deadline, today), 'ghosty')
        ]),
        ui.progress(prog.pct, p.color)
      ]),
      el('span', { class: 'pct', text: prog.pct + '%' })
    ]);

    // 仕事の案件は書類画面へワンタップで行けるようにする
    if (p.kind === 'work') {
      row.appendChild(el('a', {
        class: 'iconbtn small doc-shortcut', href: '#/docs/' + p.id, 'aria-label': '請求書・領収書',
        onclick: function (e) { e.stopPropagation(); }
      }, ui.icon('invoice', 18)));
    }
    return row;
  }

  DL.views = DL.views || {};
  DL.views.projects = { render: render };
})(window.DL);
