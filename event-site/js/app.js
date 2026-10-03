/* だてメテオ －イベント当日用－

   METEO365（締切管理アプリ）の即売会チケットを、会場で開くための小さなサイト。
   トップでイベントを選び、持っていく頒布物を出して、
   終わってから在庫を数え、「在庫締め」で METEO365 へ送る。

   持っているのはこのサイト専用の合鍵だけで、
   本物の合鍵（読み書き全部）はこちらには渡ってこない。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  var view, title, tag, backBtn, syncBtn;
  var busy = false;

  function render() {
    U.clear(view);
    var one = S.state.eventId && S.state.one;
    backBtn.hidden = !S.state.eventId;
    title.textContent = 'だてメテオ';
    tag.textContent = one ? (one.event.name || '') : 'イベント当日用';
    if (S.state.eventId) DL.views.items.render(view);
    else DL.views.events.render(view);
  }

  /** イベントの一覧を読み直す */
  function loadEvents() {
    if (!DL.api.ready()) { render(); return Promise.resolve(); }
    busy = true;
    syncBtn.classList.add('busy');
    return DL.api.events().then(function (b) {
      busy = false;
      syncBtn.classList.remove('busy');
      S.state.events = (b && b.events) || [];
      render();
    }, function (e) {
      busy = false;
      syncBtn.classList.remove('busy');
      render();
      ui.toast(e.message, 'danger');
    });
  }

  /** そのイベントを開く */
  function open(id) {
    S.state.eventId = id;
    S.state.one = null;
    busy = true;
    syncBtn.classList.add('busy');
    render();
    return DL.api.one(id).then(function (b) {
      busy = false;
      syncBtn.classList.remove('busy');
      S.state.one = b;
      render();
      window.scrollTo(0, 0);
    }, function (e) {
      busy = false;
      syncBtn.classList.remove('busy');
      render();
      ui.toast(e.message, 'danger');
    });
  }

  function back() {
    S.state.eventId = '';
    S.state.one = null;
    render();
    window.scrollTo(0, 0);
  }

  function init() {
    view = U.$('#view');
    title = U.$('#title');
    tag = U.$('#tag');
    backBtn = U.$('#backBtn');
    syncBtn = U.$('#syncBtn');

    backBtn.appendChild(ui.icon('chevronLeft', 20));
    syncBtn.appendChild(ui.icon('refresh', 19));
    backBtn.addEventListener('click', back);
    syncBtn.addEventListener('click', function () {
      if (busy) return;
      if (S.state.eventId) open(S.state.eventId);
      else loadEvents();
    });

    render();
    loadEvents();
  }

  DL.app = { render: render, loadEvents: loadEvents, open: open, back: back };
  document.addEventListener('DOMContentLoaded', init);
})(window.DL = window.DL || {});
