/* 発注（yuadezabin.com の発注フォームから届いたもの）

   ここでやること
     1. 届いた発注を見る
     2. 発注社名を取引先と照らし合わせる（候補は出すが、決めるのは自分）
     3. 結果を控え、お客様への返事の下書きをメールアプリに渡す

   照合そのものはこのアプリの中で完結する。発注ページ側には
   取引先の一覧を一切置かないので、お客様の情報がそちらへ出ることはない。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  var filter = 'todo';

  function render(root) {
    var wrap = el('div', { class: 'page' });

    if (!DL.orders.ready()) {
      wrap.appendChild(ui.empty(
        '同期につないでいないため、発注を受け取れません。',
        ui.btn('同期の設定を開く', 'primary', function () { location.hash = '#/settings'; })
      ));
      root.appendChild(wrap);
      return;
    }

    var tabs = el('div', { class: 'filters' });
    [{ v: 'todo', l: '未対応' }, { v: 'all', l: 'すべて' }].forEach(function (o) {
      tabs.appendChild(el('button', {
        class: 'filter' + (filter === o.v ? ' on' : ''), text: o.l,
        onclick: function () { filter = o.v; DL.app.render(); }
      }));
    });
    wrap.appendChild(tabs);

    var listBox = el('div');
    wrap.appendChild(listBox);
    draw(listBox);

    wrap.appendChild(el('div', { class: 'pad' },
      ui.btn('届いていないか確かめる', 'ghost full', function () {
        DL.orders.check(true).then(function () {
          ui.toast(DL.orders.list().length ? '受け取りました' : '届いている発注はありません');
          DL.app.render();
        });
      }, 'refresh')
    ));

    root.appendChild(wrap);

    // 開いたときは、いつでも最新を見に行く
    DL.orders.check(true).then(function () { draw(listBox); });
  }

  function draw(box) {
    U.clear(box);

    // 届けそこねたぶんは後から入ってくるので、受付の新しい順に並べ直す
    var all = DL.orders.list().slice().sort(function (a, b) { return U.cmp(b.at || '', a.at || ''); });
    var items = filter === 'todo'
      ? all.filter(function (o) { return o.status === 'new' || o.status === 'unmatched'; })
      : all;

    if (!items.length) {
      box.appendChild(ui.empty(all.length
        ? '未対応の発注はありません。'
        : 'まだ発注は届いていません。'));
      return;
    }

    var list = el('div', { class: 'list' });
    items.forEach(function (o) { list.appendChild(row(o)); });
    box.appendChild(list);
  }

  function row(o) {
    var st = DL.orders.statusOf(o);
    var late = o.deadline && U.isISO(o.deadline) && U.diffDays(U.today(), o.deadline) <= 7;

    return el('button', {
      class: 'row order-row' + (o.status === 'new' ? ' is-new' : ''),
      onclick: function () { detail(o); }
    }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { text: o.company }),
          ui.chip(st.label, st.chip)
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(o.serviceLabel || o.service || '—', 'soft'),
          ui.chip(o.formatLabel || o.format || '—', 'ghosty')
        ]),
        el('div', { class: 'row-sub' }, [
          ui.iconChip('deadline', o.deadline ? U.fmtMDW(o.deadline) : '納期未指定', late ? 'warn' : 'ghosty'),
          ui.chip('受付 ' + atLabel(o.at), 'ghosty')
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* ---------------- 1件を開く ---------------- */

  function detail(o) {
    var body = el('div', { class: 'form' });
    var close = ui.sheet({
      title: o.company,
      body: body,
      wide: true,
      actions: [ui.btn('閉じる', 'ghost', function () { close(); })]
    });

    var st = DL.orders.statusOf(o);
    body.appendChild(el('div', { class: 'info-row' }, [
      el('span', { class: 'info-k', text: '状態' }),
      el('span', { class: 'info-v' }, ui.chip(st.label, st.chip))
    ]));
    kv(body, '受付番号', o.id);
    kv(body, '受付日時', atLabel(o.at, true));
    kv(body, 'ご担当者', o.person || '（未記入）');
    kv(body, '連絡先', o.email || '—');
    kv(body, 'サービス種目', o.serviceLabel || o.service || '—');
    kv(body, 'ご希望納期', o.deadline ? U.fmtYMDW(o.deadline) : '—');
    kv(body, '納品形式', o.formatLabel || o.format || '—');
    if (o.note) kv(body, 'ご要望', o.note);   // .info-v は改行をそのまま出す

    // 案件にしてあれば、そこへ飛べるようにする
    var pj = o.projectId ? S.getProject(o.projectId) : null;
    if (pj) {
      body.appendChild(el('a', { class: 'info-row', href: '#/project/' + pj.id,
        onclick: function () { close(); } }, [
        el('span', { class: 'info-k', text: '案件' }),
        el('span', { class: 'info-v' }, [
          ui.iconChip('deadline', pj.title + '（締切 ' + U.fmtMDW(pj.deadline) + '）', 'ok'),
          el('span', { class: 'chev' }, ui.icon('chevronRight', 14))
        ])
      ]));
    }

    /* ---- 取引先との照らし合わせ ---- */
    body.appendChild(ui.section('取引先の照合'));
    body.appendChild(matchCard(o));

    /* ---- 照合の結果 ---- */
    body.appendChild(ui.section('照合の結果'));
    var res = el('div', { class: 'card' });
    body.appendChild(res);

    res.appendChild(el('p', { class: 'muted small', text:
      '結果を控えると、PC でも iPhone でも同じ状態が見えます。'
      + 'お客様への返事は、下のボタンでメールアプリに下書きが入ります。' }));

    res.appendChild(ui.btn('照合できた（受領のご連絡）', 'primary full', function () {
      answer(o, 'matched', 'ok', close);
    }, 'check'));

    res.appendChild(ui.btn('照合できない（お名前の確認）', 'ghost full', function () {
      answer(o, 'unmatched', 'ng', close);
    }, 'alert'));

    if (o.status !== 'done') {
      res.appendChild(ui.btn('対応済みにする', 'ghost full', function () {
        mark(o, 'done', close);
      }, 'check'));
      if (U.isISO(o.deadline)) {
        res.appendChild(el('span', { class: 'field-hint',
          text: '押すと案件を作り、' + U.fmtMDW(o.deadline) + ' を締切にします' }));
      }
    }

    body.appendChild(el('div', { class: 'pad' },
      ui.btn('この発注を消す', 'danger full', function () {
        ui.confirm('この発注を消します。メールの控えは残ります。', { okText: '消す', danger: true })
          .then(function (ok) {
            if (!ok) return;
            DL.orders.remove(o.id).then(function () {
              close();
              ui.toast('消しました');
              DL.app.render();
            }).catch(function (e) { ui.toast(e.message, 'danger'); });
          });
      }, 'trash')
    ));
  }

  /* 発注社名に近い取引先を並べる。決めるのは人なので、押しても選ばせるだけ */
  function matchCard(o) {
    var card = el('div', { class: 'card' });
    var hits = DL.orders.candidates(o.company);

    if (!S.clients().length) {
      card.appendChild(el('div', { class: 'alert warn' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: '取引先がまだ登録されていません。設定 →「取引先」から入れておくと、ここに候補が出ます。' })
      ]));
      return card;
    }

    card.appendChild(el('div', { class: 'info-row' }, [
      el('span', { class: 'info-k', text: '発注社名' }),
      el('span', { class: 'info-v', text: o.company })
    ]));

    if (!hits.length) {
      card.appendChild(el('div', { class: 'alert warn' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: '同じ名前の取引先は見つかりませんでした（' + S.clients().length + '件を照らしました）。'
          + '表記ゆれの可能性もあるので、下の一覧も確かめてください。' })
      ]));
    } else {
      hits.forEach(function (h) {
        card.appendChild(el('div', { class: 'info-row' }, [
          el('span', { class: 'info-k' }, ui.icon('client', 15)),
          el('span', { class: 'info-v' }, [
            el('span', { text: h.client.name }),
            ui.chip(h.how === 'same' ? '一致' : '一部一致', h.how === 'same' ? 'ok' : 'warn')
          ])
        ]));
      });
    }

    card.appendChild(ui.btn('取引先の一覧を開いて確かめる', 'ghost full', function () {
      location.hash = '#/settings';
      ui.toast('設定の「取引先」で確かめられます');
    }, 'client'));
    return card;
  }

  /* 結果を控えて、返事の下書きをメールアプリに渡す */
  function answer(o, status, kind, close) {
    if (!o.email) {
      mark(o, status, close);
      ui.toast('連絡先が無いため、控えだけ残しました', 'warn');
      return;
    }
    var m = DL.orders.replyMail(o, kind);
    // 先に控えてから開く（メールアプリへ移ると、この画面は止まるため）
    DL.orders.setStatus(o.id, status).then(function () {
      close();
      DL.app.render();
      location.href = DL.orders.mailtoUrl(m);
    }).catch(function (e) { ui.toast('控えられませんでした：' + e.message, 'danger'); });
  }

  /**
   * 結果を控える。対応済みにしたときは、その発注を案件として起こす。
   *
   * 先に案件を作ってから控えるのは、控えるときに案件の id を一緒に渡すため。
   * 控えられなかったときは、作った案件も戻す（印の無い案件が残ると、
   * もう一度押したときに二重にできてしまう）。
   */
  function mark(o, status, close) {
    var pj = status === 'done' ? DL.orders.makeProject(o) : null;

    DL.orders.setStatus(o.id, status, pj ? { projectId: pj.id } : null).then(function () {
      close();
      ui.toast(pj ? '案件にしました（締切 ' + U.fmtMD(pj.deadline) + '）' : '控えました');
      DL.app.render();
    }).catch(function (e) {
      if (pj) S.removeProject(pj.id);
      ui.toast('控えられませんでした：' + e.message, 'danger');
    });
  }

  /* ---------------- 小物 ---------------- */

  function kv(box, k, v) {
    box.appendChild(el('div', { class: 'info-row' }, [
      el('span', { class: 'info-k', text: k }),
      el('span', { class: 'info-v', text: v })
    ]));
  }

  function atLabel(iso, withTime) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var day = U.toISO(d);
    if (!withTime) return U.fmtMD(day);
    return U.fmtYMDW(day) + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  DL.views = DL.views || {};
  DL.views.orders = { render: render };
})(window.DL);
