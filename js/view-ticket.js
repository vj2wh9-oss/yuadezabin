/* チケット。

   案件は1件ずつではなく、チケット1枚の下に束ねて管理する。

     即売会 … 1つのイベントにつき1枚。原稿（新刊など）・頒布物・準備をまとめる
     仕事　 … 取引先ごとに1枚。その取引先からの依頼をまとめる
     支援　 … サイトごとに1枚。そのサイトへの投稿をまとめる

   案件そのものの作りは変えていないので、カレンダーも当日モードも
   今までどおり動く。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, K = DL.stock, el = U.el;

  var UNIT = { manga: 'P', illust: '枚', design: '点' };

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

    wrap.appendChild(hero(t, projects, today));

    /* ---- 原稿など ---- */
    /* 必要入稿総数は上の券に出してあるので、ここでは足すボタンだけ */
    wrap.appendChild(ui.section('原稿',
      ui.btn('足す', 'ghost tiny', function () { addProject(t); }, 'plus')));
    if (!projects.length) {
      wrap.appendChild(ui.empty('まだありません。'));
    } else {
      wrap.appendChild(el('div', { class: 'list' },
        projects.map(function (p) { return projectRow(p, today); })));
    }

    /* ---- 頒布物（即売会だけ） ---- */
    if (t.kind === 'event') {
      var tally = K.ticketTally(t, projects);
      var rows = tally.lines.concat(linked(t, projects, tally));
      wrap.appendChild(ui.section('頒布物', el('div', { class: 'row-wrap' }, [
        ui.btn('在庫から', 'ghost tiny', function () { bringSheet(t); }, 'books'),
        ui.btn('新しく', 'ghost tiny', function () { addItem(projects); }, 'plus')
      ])));
      if (!rows.length) {
        wrap.appendChild(ui.empty('まだありません。'));
      } else {
        wrap.appendChild(el('div', { class: 'list' }, rows.map(stockRow)));
      }
      if (tally.lines.length) {
        wrap.appendChild(ui.section('集計', tallyChip(tally)));
        wrap.appendChild(tallyCard(t, projects));
      }
    }

    /* ---- 準備 ---- */
    wrap.appendChild(ui.section('準備', prepCount(t)));
    wrap.appendChild(prepCard(t));

    /* ---- 当日モード（即売会だけ） ---- */
    var main = projects[0];
    if (t.kind === 'event' && main) {
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
  function hero(t, projects, today) {
    var date = S.ticketDate(t);
    var left = date ? U.diffDays(today, date) : null;
    return el('div', {
      class: 'tk-hero tk-' + t.kind + (left !== null && left < 0 ? ' past' : '')
    }, [
      el('div', { class: 'tk-body' }, [
        el('div', { class: 'tk-name' }, [
          ui.icon(ui.KIND_ICON[t.kind], 16),
          el('span', { text: t.name })
        ]),
        el('div', { class: 'tk-meta' }, metaChips(t, projects, date, left !== null && left < 0)),
        el('button', {
          type: 'button', class: 'btn ghost tiny tk-edit',
          onclick: function () { ticketForm(t); }
        }, [ui.icon('edit', 14), el('span', { text: '直す' })])
      ]),
      stub(left)
    ]);
  }

  /* 日付・会場・配置番号・必要入稿総数。一覧の札と同じ並びにする */
  function metaChips(t, projects, date, past) {
    var out = [];
    if (date) out.push(ui.iconChip('deadline', U.fmtMDW(date), past ? 'ghosty' : 'soft'));
    if (t.kind === 'event') {
      if (t.venue) out.push(ui.iconChip('event', t.venue, 'ghosty'));
      if (t.space) out.push(ui.chip(t.space, 'ghosty'));
    }
    var need = needChip(projects);
    if (need) out.push(need);
    var money = moneyChip(t, projects);
    if (money) out.push(money);
    return out;
  }

  /* 残り日数の半券 */
  function stub(left, cls) {
    return el('div', { class: cls || 'tk-stub' }, left === null ? [
      el('b', { class: 'tk-num', text: '—' })
    ] : [
      el('b', { class: 'tk-num', text: left > 0 ? String(left) : left === 0 ? '当日' : String(-left) }),
      el('span', { class: 'tk-unit', text: left > 0 ? '日' : left === 0 ? '' : '日前' })
    ]);
  }

  /**
   * 必要入稿総数。中の原稿のページ数（枚数）を足し上げる。
   * 漫画のページと、イラストの枚数は単位が違うので分けて数える。
   */
  function needTotal(projects) {
    var by = {};
    (projects || []).forEach(function (p) {
      if (p.status === 'archived') return;
      var n = S.pageTotal(p);
      if (!n) return;
      var u = UNIT[p.category] || 'P';
      by[u] = (by[u] || 0) + n;
    });
    return by;
  }

  function needLabel(projects) {
    var by = needTotal(projects);
    return ['P', '枚', '点'].filter(function (u) { return by[u]; })
      .map(function (u) { return by[u] + u; }).join('・');
  }

  function needChip(projects) {
    var label = needLabel(projects);
    return label ? ui.iconChip('manga', '入稿 ' + label, 'ghosty') : null;
  }

  /**
   * いくらの仕事か。請求まで済んでいれば、そちらの額のほうが確かなので
   * そちらを出す（見込みは請求前の目安）。取引先ごとに足し上げる。
   */
  function moneyChip(t, projects) {
    if (t.kind !== 'work') return null;
    var sum = { invoiced: 0, unpaid: 0, fee: 0 };
    projects.forEach(function (p) {
      var m = DL.docs.projectMoney(p);
      sum.invoiced += m.invoiced;
      sum.unpaid += m.unpaid;
      sum.fee += m.fee;
    });
    if (sum.invoiced) {
      return ui.chip(DL.docs.yen(sum.invoiced) + (sum.unpaid ? '（未入金）' : '（入金済）'),
        sum.unpaid ? 'warn' : 'ok');
    }
    return sum.fee ? ui.chip(DL.docs.yen(sum.fee) + '（見込み）', 'soft') : null;
  }

  /* 原稿の1行。進み具合まで出す */
  function projectRow(p, today) {
    var prog = sc.projectProgress(p);
    var st = sc.projectStatus(p, today);
    var unit = UNIT[p.category] || 'P';
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

  /* ---------------- 頒布物 ---------------- */

  /**
   * その案件に結びつけてあるのに、まだ持ち込む部数を入れていないもの。
   * 部数を入れる前でも一覧から消えないよう、続けて並べる。
   */
  function linked(t, projects, tally) {
    var ids = {};
    projects.forEach(function (p) { ids[p.id] = true; });
    var had = {};
    tally.lines.forEach(function (o) { had[o.item.id] = true; });
    return K.all({ withArchived: true }).filter(function (r) {
      return ids[r.item.projectId] && !had[r.item.id];
    }).map(function (r) {
      return {
        item: r.item, bring: 0, counted: false, back: 0, sold: 0,
        recorded: 0, rest: 0, revenue: 0, left: r.left, unset: true
      };
    });
  }

  /* 持っていく1つ。押すと頒布物そのものを開く */
  function stockRow(line) {
    var x = line.item;
    return el('button', {
      type: 'button', class: 'row tk-item',
      onclick: function () { DL.views.stock.openItem(x); }
    }, [
      x.cover ? el('img', { class: 'tk-cover', src: x.cover, alt: '' })
        : el('span', { class: 'tk-cover none' }, ui.icon(x.kind === 'goods' ? 'star' : 'manga', 16)),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title', text: x.title }),
        el('div', { class: 'row-sub' }, [
          ui.chip('持ち込み ' + (line.unset ? '—' : line.bring), line.unset ? 'ghosty' : 'soft'),
          line.counted ? ui.chip('持ち帰り ' + line.back, 'ghosty') : null,
          line.counted ? ui.chip('販売 ' + line.sold, line.sold ? 'ok' : 'ghosty') : null,
          x.price ? ui.chip(DL.docs.yen(x.price), 'ghosty') : null,
          ui.chip('在庫 ' + line.left, line.left > 0 ? 'ghosty' : 'warn')
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  function tallyChip(tally) {
    if (!tally.total.counted) return ui.chip('未集計', 'soft');
    return ui.chip('販売 ' + tally.total.sold, tally.total.sold ? 'ok' : 'soft');
  }

  /**
   * イベントが終わってからの集計。
   * 持ち帰った部数を入れると、販売数と売上が出る。
   * 記録すると、まだ記録していないぶんだけが頒布として在庫から引かれる。
   */
  function tallyCard(t, projects) {
    var box = el('div', { class: 'card tk-tally' });
    var rows = el('div', { class: 'tk-tally-list' });
    var foot = el('div', { class: 'tk-tally-foot' });
    var inputs = {};

    function nowTally() { return K.ticketTally(S.getTicket(t.id) || t, projects); }

    function drawRows() {
      U.clear(rows);
      Object.keys(inputs).forEach(function (k) { delete inputs[k]; });
      nowTally().lines.forEach(function (line) {
        var back = ui.input({
          type: 'number', inputmode: 'numeric', min: 0, max: line.bring,
          value: line.counted ? String(line.back) : '',
          placeholder: '0', class: 'input tk-back-in'
        });
        inputs[line.row.id] = back;
        var sold = el('b', { class: 'tk-sold', text: line.counted ? String(line.sold) : '—' });
        var put = function () {
          var v = back.value.trim();
          S.putTicketStock(t.id, {
            id: line.row.id, itemId: line.row.itemId, bring: line.bring,
            back: v === '' ? null : Math.min(line.bring, Math.max(0, U.num(v, 0)))
          });
          var fresh = nowTally().lines.filter(function (o) { return o.row.id === line.row.id; })[0];
          sold.textContent = fresh && fresh.counted ? String(fresh.sold) : '—';
          drawFoot();
        };
        back.addEventListener('change', put);
        back.addEventListener('blur', put);

        rows.appendChild(el('div', { class: 'tk-tally-row' }, [
          el('span', { class: 'tk-tally-name', text: line.item.title }),
          el('span', { class: 'tk-tally-num' }, [
            el('span', { class: 'tk-lbl', text: '持ち込み' }),
            el('b', { text: String(line.bring) })
          ]),
          el('span', { class: 'tk-tally-num' }, [
            el('span', { class: 'tk-lbl', text: '持ち帰り' }), back
          ]),
          el('span', { class: 'tk-tally-num' }, [
            el('span', { class: 'tk-lbl', text: '販売' }), sold
          ])
        ]));
      });
    }

    function drawFoot() {
      U.clear(foot);
      var tl = nowTally();
      foot.appendChild(el('div', { class: 'tk-tally-sum' }, [
        ui.chip('販売 ' + tl.total.sold + '部', tl.total.sold ? 'ok' : 'soft'),
        ui.chip(DL.docs.yen(tl.total.revenue), 'soft'),
        tl.total.recorded ? ui.chip('記録済み ' + tl.total.recorded + '部', 'ghosty') : null
      ]));
      foot.appendChild(ui.btn(
        tl.total.rest ? '頒布として記録（' + tl.total.rest + '部）' : '記録するぶんはありません',
        'primary full' + (tl.total.rest ? '' : ' disabled'),
        function () {
          if (!tl.total.rest) return;
          ui.confirm(tl.total.rest + '部を頒布として記録します。',
            { okText: '記録する' }).then(function (ok) {
            if (!ok) return;
            var r = K.recordTicketTally(S.getTicket(t.id) || t, projects);
            ui.toast(r.qty + '部を記録しました');
            DL.app.render();
          });
        }, 'check'));
    }

    box.appendChild(rows);
    box.appendChild(foot);
    drawRows();
    drawFoot();
    return box;
  }

  /**
   * 持ち込む部数を決める。登録してある在庫がそのまま並ぶので、
   * そこへ部数を入れる。0 か空にすると、そのチケットから外れる。
   */
  function bringSheet(t) {
    var list = K.all({ withArchived: false });
    var body = el('div', { class: 'form' });
    if (!list.length) {
      body.appendChild(ui.empty('登録してある頒布物がありません。',
        ui.btn('頒布物を登録する', 'primary', function () {
          close();
          DL.views.stock.addItem();
        }, 'plus')));
    }
    var now = S.getTicket(t.id) || t;
    var byItem = {};
    now.stock.forEach(function (r) { byItem[r.itemId] = r; });

    var inputs = [];
    list.forEach(function (s) {
      var x = s.item;
      var had = byItem[x.id];
      var inp = ui.input({
        type: 'number', inputmode: 'numeric', min: 0,
        value: had ? String(had.bring) : '', placeholder: '0', class: 'input tk-bring-in'
      });
      inputs.push({ item: x, input: inp, had: had });
      body.appendChild(el('div', { class: 'tk-pick' }, [
        x.cover ? el('img', { class: 'tk-cover', src: x.cover, alt: '' })
          : el('span', { class: 'tk-cover none' }, ui.icon(x.kind === 'goods' ? 'star' : 'manga', 16)),
        el('div', { class: 'tk-pick-main' }, [
          el('div', { class: 'tk-pick-name', text: x.title }),
          el('div', { class: 'row-sub' }, [
            ui.chip(K.kindLabel(x.kind), 'ghosty'),
            x.price ? ui.chip(DL.docs.yen(x.price), 'ghosty') : null,
            ui.chip('在庫 ' + s.left, s.left > 0 ? 'ghosty' : 'warn')
          ])
        ]),
        inp
      ]));
    });

    var close = ui.sheet({
      title: '持ち込む部数',
      body: body,
      actions: [
        ui.btn('やめる', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          inputs.forEach(function (o) {
            var n = Math.max(0, Math.round(U.num(o.input.value, 0)));
            if (!n) {
              if (o.had) S.removeTicketStock(t.id, o.had.id);
              return;
            }
            S.putTicketStock(t.id, {
              id: o.had ? o.had.id : null, itemId: o.item.id, bring: n,
              back: o.had ? o.had.back : null
            });
          });
          close();
          DL.app.render();
          ui.toast('保存しました');
        }, 'check')
      ]
    });
  }

  /* ---------------- 準備・メモ ---------------- */

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

  /* そのチケットの中身として案件を作る。束ねる手がかりは先に入れておく */
  function addProject(t) {
    var preset = { kind: t.kind, ticketId: t.id };
    if (t.kind === 'work') preset.client = t.name;
    else if (t.kind === 'support') preset.site = t.name;
    else {
      preset.eventName = t.name;
      preset.eventDate = t.date;
      preset.venue = t.venue;
      preset.space = t.space;
      preset.deadline = t.date ? U.addDays(t.date, -14) : '';
    }
    DL.forms.projectForm(null, { preset: preset });
  }

  function addItem(projects) {
    DL.views.stock.addItem(projects.length ? { projectId: projects[0].id } : {});
  }

  /** チケットを作る・直す */
  function ticketForm(t) {
    var isNew = !t;
    var v = t || { kind: 'event', name: '', date: '', venue: '', space: '' };
    var kind = v.kind || 'event';

    var name = ui.input({ value: v.name, maxlength: 80 });
    var date = ui.input({ type: 'date', value: v.date });
    var venue = ui.input({ value: v.venue, maxlength: 80, placeholder: '東京ビッグサイト' });
    var space = ui.input({ value: v.space, maxlength: 40, placeholder: 'あ-12b' });

    var dynamic = el('div');
    function drawDynamic() {
      U.clear(dynamic);
      if (kind === 'event') {
        name.placeholder = '例）コミックマーケット';
        dynamic.appendChild(ui.field('イベント名', name));
        dynamic.appendChild(ui.field('開催日', date));
        dynamic.appendChild(ui.field('会場', venue));
        dynamic.appendChild(ui.field('配置番号', space));
      } else if (kind === 'work') {
        name.placeholder = '例）○○出版';
        dynamic.appendChild(ui.field('取引先', name));
      } else {
        name.placeholder = '例）pixivFANBOX';
        dynamic.appendChild(ui.field('サイト', name));
      }
    }

    /* 券の顔になるロゴ。大きいままだと持ちきれないので、縮めて dataURL で持つ。
       透かしのように敷くので、背景の抜けた画像（PNG）がきれいに出る */
    var logo = v.logo || '';
    var logoBox = el('div', { class: 'imgfield' });
    var logoFile = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    logoFile.addEventListener('change', function () {
      var f = logoFile.files[0];
      logoFile.value = '';
      if (!f) return;
      U.readImage(f, 480, 'image/png').then(function (url) {
        // 抜けの無い写真だと PNG では重くなるので、そのときだけ JPEG に落とす
        if (url.length <= 380000) return url;
        return U.readImage(f, 480, 'image/jpeg', 0.85);
      }).then(function (url) {
        if (url.length > 380000) throw new Error('画像が大きすぎます');
        logo = url;
        drawLogo();
        ui.toast('読み込みました');
      }).catch(function (e) { ui.toast(e.message, 'danger'); });
    });
    function drawLogo() {
      U.clear(logoBox);
      logoBox.appendChild(logo
        ? el('img', { class: 'imgfield-prev', src: logo, alt: '' })
        : el('div', { class: 'imgfield-empty' }, ui.icon('illust', 22)));
      logoBox.appendChild(el('div', { class: 'row-wrap' }, [
        ui.btn(logo ? '選び直す' : '画像を選ぶ', 'ghost tiny', function () { logoFile.click(); }, 'plus'),
        logo ? ui.btn('削除', 'ghost tiny', function () { logo = ''; drawLogo(); }) : null
      ]));
      logoBox.appendChild(logoFile);
    }
    drawLogo();

    var body = el('div', { class: 'form' });
    if (isNew) {
      body.appendChild(ui.block('種別', ui.segmented(
        S.TICKET_KINDS.map(function (k) { return { value: k, label: ui.KIND_LABEL[k] }; }),
        kind, function (val) { kind = val; drawDynamic(); }
      )));
    }
    body.appendChild(dynamic);
    drawDynamic();
    body.appendChild(ui.field('ロゴ', logoBox,
      '一覧の券の右下に、うっすら大きく敷きます（長辺480pxに縮小して保存）'));

    var close = ui.sheet({
      title: isNew ? '新しいチケット' : 'チケットを直す',
      body: body,
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
          if (!name.value.trim()) { ui.toast('名前を入れてください', 'warn'); return; }
          var data = { kind: kind, name: name.value.trim(), logo: logo };
          if (kind === 'event') {
            data.date = date.value;
            data.venue = venue.value.trim();
            data.space = space.value.trim();
          }
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
   * 日付・会場・配置番号・必要入稿総数を、そのまま札の上に出す。
   * @param {object} t チケット
   * @param {string} today
   */
  function card(t, today) {
    var projects = S.ticketProjects(t.id);
    var date = S.ticketDate(t);
    var left = date ? U.diffDays(today, date) : null;
    var soon = left !== null && left >= 0 && left <= 14;
    var past = left !== null && left < 0;
    var done = projects.filter(function (p) { return sc.projectStatus(p, today) === 'done'; }).length;
    var prepLeft = t.prep.filter(function (x) { return !x.done; }).length;
    var sold = t.kind === 'event' ? K.ticketTally(t, projects).total : null;

    return el('a', {
      class: 'tk-card tk-' + t.kind + (soon ? ' soon' : '') + (past ? ' past' : ''),
      href: '#/ticket/' + t.id
    }, [
      el('div', { class: 'tk-card-main' }, [
        // 登録してあれば、券の地紋のようにロゴを右下へ敷く（いちばん奥）
        t.logo ? el('img', { class: 'tk-logo', src: t.logo, alt: '', 'aria-hidden': 'true' }) : null,
        el('div', { class: 'tk-card-head' }, [
          ui.icon(ui.KIND_ICON[t.kind], 15),
          el('span', { class: 'tk-card-name', text: t.name })
        ]),
        el('div', { class: 'tk-card-sub' }, metaChips(t, projects, date, past)),
        el('div', { class: 'tk-card-sub' }, [
          ui.chip('原稿 ' + done + ' / ' + projects.length,
            projects.length && done === projects.length ? 'ok' : 'ghosty'),
          prepLeft ? ui.chip('準備 のこり ' + prepLeft, 'warn') : null,
          sold && sold.sold ? ui.chip('販売 ' + sold.sold + '部', 'ok') : null
        ])
      ]),
      stub(left, 'tk-card-stub')
    ]);
  }

  DL.views = DL.views || {};
  DL.views.ticket = { render: render, card: card, form: ticketForm, needLabel: needLabel };
})(window.DL);
