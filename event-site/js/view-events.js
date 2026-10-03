/* トップ：イベント（即売会の券）を選ぶ */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  function render(root) {
    var wrap = el('div', { class: 'page' });

    if (!DL.api.ready()) {
      wrap.appendChild(ui.section('はじめに'));
      wrap.appendChild(el('div', { class: 'card' }, [
        el('p', { text: 'METEO365 の 設定 →「イベント当日用サイト」で合鍵を作り、'
          + 'そこに出る URL をこの端末で開いてください。' }),
        el('p', { class: 'muted small',
          text: 'この合鍵でできるのは、即売会の券と頒布物を読むことと、'
            + '数えた在庫を預けることだけです。' })
      ]));
      root.appendChild(wrap);
      return;
    }

    wrap.appendChild(ui.section('イベント',
      S.state.events.length ? ui.chip(S.state.events.length + '件', 'ghosty') : null));

    if (!S.state.events.length) {
      wrap.appendChild(ui.empty('即売会のチケットがありません。',
        ui.btn('読み直す', 'primary', function () { DL.app.loadEvents(); }, 'refresh')));
      root.appendChild(wrap);
      return;
    }

    var today = U.today();
    var list = el('div', { class: 'ev-list' });
    S.state.events.forEach(function (ev) { list.appendChild(card(ev, today)); });
    wrap.appendChild(list);
    root.appendChild(wrap);
  }

  function card(ev, today) {
    var left = U.isISO(ev.date) ? U.diffDays(today, ev.date) : null;
    var logo = el('span', { class: 'ev-logo none' }, ui.icon('event', 22));
    if (ev.logo) {
      DL.api.pic(ev.logo).then(function (src) {
        if (!src) return;
        var img = el('img', { class: 'ev-logo', src: src, alt: '' });
        if (logo.parentNode) logo.parentNode.replaceChild(img, logo);
      });
    }
    return el('button', {
      type: 'button', class: 'ev-card' + (left === 0 ? ' today' : ''),
      onclick: function () { DL.app.open(ev.id); }
    }, [
      logo,
      el('div', { class: 'ev-main' }, [
        el('div', { class: 'ev-name', text: ev.name }),
        el('div', { class: 'ev-sub' }, [
          U.isISO(ev.date) ? ui.chip(U.fmtMD(ev.date), left === 0 ? 'ok' : 'ghosty') : null,
          left === 0 ? ui.chip('今日', 'ok') : null,
          left > 0 ? ui.chip('あと' + left + '日', 'ghosty') : null,
          left < 0 ? ui.chip(Math.abs(left) + '日前', 'ghosty') : null,
          ev.venue ? ui.chip(ev.venue, 'ghosty') : null,
          ev.space ? ui.chip(ev.space, 'soft') : null
        ])
      ]),
      el('span', { class: 'ev-chev' }, ui.icon('chevronRight', 18))
    ]);
  }

  DL.views = DL.views || {};
  DL.views.events = { render: render };
})(window.DL = window.DL || {});
