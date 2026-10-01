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
        class: 'filter' + (filter === o.v ? ' on' : ''),
        onclick: function () { filter = o.v; DL.app.render(); }
      }, el('span', { class: 'filter-label', text: o.l })));
    });
    wrap.appendChild(tabs);

    var listBox = el('div');
    wrap.appendChild(listBox);

    function renderList() {
      U.clear(listBox);
      /* 案件は1件ずつではなく、チケットで並べる。
         即売会はイベントごと、仕事は取引先ごと、支援サイトはサイトごとに1枚。
         チケットの中に、その原稿（と即売会なら頒布物・準備）がまとまっている */
      var tk = tickets(today);
      var items = S.scopedProjects().filter(function (p) {
        // チケットに入っている案件は、チケットの中で見る（ここには並べない）
        if (p.ticketId) return false;
        // 進行中：作業開始日が来ていて、まだ終わっていないものだけ
        if (filter === 'active') return p.status === 'active' && sc.projectStatus(p, today) !== 'before';
        if (filter === 'done') return p.status === 'done';
        // 種別のタブは、完了したものを混ぜない（完了は「完了」タブで見る）
        if (filter === 'event') return p.kind === 'event' && p.status === 'active';
        if (filter === 'work') return p.kind === 'work' && p.status === 'active';
        if (filter === 'support') return p.kind === 'support' && p.status === 'active';
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

      if (tk.length || ['event', 'work', 'support'].indexOf(filter) >= 0) {
        listBox.appendChild(ui.section('チケット',
          ui.btn('作る', 'ghost tiny', function () { DL.views.ticket.form(null); }, 'plus')));
        /* 券は下から流れてきて、下のものから順に積み上がる。
           いちばん下を先に置き、上へ向かって少しずつ遅らせる */
        var cards = tk.map(function (t) { return DL.views.ticket.card(t, today); });
        cards.forEach(function (n, i) {
          n.style.animationDelay = ((cards.length - 1 - i) * 55) + 'ms';
        });
        listBox.appendChild(cards.length
          ? el('div', { class: 'tk-deck' }, cards)
          : ui.empty('まだありません。'));
      }

      if (!items.length) {
        if (tk.length) return;      // チケットだけ並んでいる。空の案内は出さない
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

  /* いま出すチケット。絞り込みと言葉の検索は、案件と同じように効かせる */
  function tickets(today) {
    var list = S.tickets().filter(function (t) {
      var ps = S.ticketProjects(t.id);
      // 名義で絞っているときは、その名義の原稿が入っているものだけ
      if (ps.length && !ps.some(S.inScope)) return false;
      if (filter === 'all') return true;
      if (['event', 'work', 'support'].indexOf(filter) >= 0) {
        return t.kind === filter && !ticketDone(t, ps, today);
      }
      if (filter === 'done') return ticketDone(t, ps, today);
      // 進行中。終わった即売会は出さない（当日までは出す。ticketDone が見ている）
      return !ticketDone(t, ps, today);
    });
    var k = keyword.trim().toLowerCase();
    if (k) {
      list = list.filter(function (t) {
        var ps = S.ticketProjects(t.id).map(function (p) { return p.title; }).join(' ');
        return [t.name, t.venue, t.space, t.memo, ps].join(' ').toLowerCase().indexOf(k) >= 0;
      });
    }
    return list;
  }

  /* そのチケットが終わったかどうか。

     即売会は、中の制作物が仕上がっても当日までは終わらない。
     頒布物・準備・当日モード・集計が、その日まで要るため。
     1つしか入っていない制作物を完了にした途端に券が消えてしまうと、
     当日そこへ行く手がかりごと見えなくなる。

     日付が入っていない即売会は、いつ終わるか決められないので、
     自分からは終わりにしない（捨てるか、日付を入れて決める）。
     仕事と支援サイトは、これまでどおり中身の進み具合で見る。 */
  function ticketDone(t, ps, today) {
    if (t.kind === 'event') return U.isISO(t.date) && U.cmp(t.date, today) < 0;
    if (!ps.length) return false;
    return ps.every(function (p) {
      return p.status === 'done' || sc.projectStatus(p, today) === 'done';
    });
  }

  function card(p, today) {
    var prog = sc.projectProgress(p);
    var st = sc.projectStatus(p, today);
    var unit = p.category === 'manga' ? 'P' : '枚';

    var sub = [ui.kindChip(p), ui.catChip(p)];
    var issuer = p.issuerId ? S.issuers().filter(function (x) { return x.id === p.issuerId; })[0] : null;
    if (issuer) sub.push(ui.iconChip('issuer', issuer.name || '名義', 'ghosty'));
    if (p.qty) sub.push(ui.chip(p.qty + unit, 'ghosty'));
    if (p.kind === 'event' && U.isISO(p.eventDate)) sub.push(ui.iconChip('event', U.fmtMD(p.eventDate), 'ghosty'));
    if (p.client) sub.push(ui.chip(p.client, 'ghosty'));
    if (p.site) sub.push(ui.chip(p.site, 'ghosty'));
    /* いくらの仕事か。請求まで済んでいれば、そちらの額のほうが確かなので
       そちらを出す（見込みは請求前の目安） */
    if (p.kind === 'work') {
      var m = DL.docs.projectMoney(p);
      if (m.invoiced) {
        sub.push(ui.chip(DL.docs.yen(m.invoiced) + (m.unpaid ? '（未入金）' : '（入金済）'),
          m.unpaid ? 'warn' : 'ok'));
      } else if (m.fee) {
        sub.push(ui.chip(DL.docs.yen(m.fee) + '（見込み）', 'soft'));
      }
    }

    var row = el('a', { class: 'row proj card-row st-' + st, href: '#/project/' + p.id }, [
      el('div', { class: 'row-bar', style: { background: p.color } }),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: p.title }),
          st === 'done' ? ui.chip('完了済', 'ok') : null,
          st === 'before' ? ui.chip('開始前', 'soft') : null,
          p.status === 'archived' ? ui.chip('保管', 'ghosty') : null
        ]),
        el('div', { class: 'row-sub' }, sub),
        el('div', { class: 'row-sub' }, [
          ui.iconChip('deadline', U.fmtMDW(p.deadline), st === 'overdue' ? 'danger' : st === 'urgent' ? 'warn' : 'soft'),
          // 終わった案件に「◯日超過」は出さない（残り日数はもう意味を持たない）
          ui.chip(st === 'done' ? '完了済'
            : st === 'before' ? U.fmtMD(p.startDate) + ' から'
            : U.untilLabel(p.deadline, today), st === 'done' ? 'ok' : 'ghosty')
        ]),
        ui.progress(prog.pct, p.color)
      ]),
      el('span', { class: 'pct', text: prog.pct + '%' })
    ]);

    // 仕事の案件は書類画面へワンタップで行けるようにする
    if (p.kind === 'work') {
      row.appendChild(el('a', {
        class: 'iconbtn small doc-shortcut', href: '#/docs/' + p.id, 'aria-label': '見積書・請求書・領収書',
        onclick: function (e) { e.stopPropagation(); }
      }, ui.icon('invoice', 18)));
    }
    return row;
  }

  DL.views = DL.views || {};
  DL.views.projects = { render: render };
})(window.DL);
