/* ルーティングとアプリ全体の制御 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  var view = U.$('#view');
  var titleEl = U.$('#appTitle');
  var actionsEl = U.$('#appActions');
  var backBtn = U.$('#backBtn');
  var fab = U.$('#fab');

  var route = { name: 'home', params: {} };
  var lastKey = '';

  function parseHash() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    var name = parts[0] || 'home';
    var params = {};
    if (name === 'project') params.id = parts[1];
    if (name === 'day') params.date = parts[1];
    if (name === 'calendar' && parts[1]) params.month = parts[1] + '-01';
    return { name: name, params: params };
  }

  function render() {
    route = parseHash();
    var key = location.hash;
    var scroll = window.scrollY;

    U.clear(view);
    U.clear(actionsEl);

    var titles = {
      home: '締切カレンダー', calendar: 'カレンダー', projects: '案件',
      settings: '設定', day: '日別', project: '案件の詳細'
    };
    titleEl.textContent = titles[route.name] || '締切カレンダー';

    var tab = { home: 'home', calendar: 'calendar', day: 'calendar', projects: 'projects', project: 'projects', settings: 'settings' }[route.name];
    U.$$('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === tab); });

    var showBack = route.name === 'project' || route.name === 'day';
    backBtn.hidden = !showBack;

    switch (route.name) {
      case 'calendar': DL.views.calendar.render(view, route.params); break;
      case 'day': DL.views.calendar.renderDay(view, route.params); break;
      case 'projects': DL.views.projects.render(view); break;
      case 'project': DL.views.detail.render(view, route.params); break;
      case 'settings': DL.views.settings.render(view); break;
      default: DL.views.home.render(view);
    }

    // 同じ画面の再描画ではスクロール位置を保つ
    if (key === lastKey) window.scrollTo(0, scroll);
    else window.scrollTo(0, 0);
    lastKey = key;

    updateFab();
  }

  function updateFab() {
    if (route.name === 'settings') { fab.hidden = true; return; }
    fab.hidden = false;
    fab.onclick = function () {
      if (route.name === 'project') {
        var p = S.getProject(route.params.id);
        if (p) { addMenu(p); return; }
      }
      DL.forms.projectForm();
    };
  }

  function addMenu(p) {
    var close = ui.sheet({
      title: '追加',
      body: el('div', { class: 'menu' }, [
        menuItem('plus', 'タスクを追加', function () { close(); DL.forms.taskForm(p.id); }),
        menuItem('task', '基本タスクをまとめて追加', function () { close(); DL.forms.templateSheet(p.id); }),
        menuItem('refresh', '自動スケジュールを実行', function () { close(); DL.forms.autoScheduleSheet(p.id); }),
        menuItem('projects', '新しい案件を作る', function () { close(); DL.forms.projectForm(); })
      ])
    });
  }

  function menuItem(iconName, text, onclick) {
    return el('button', { class: 'menu-item', onclick: onclick }, [
      DL.icons.icon(iconName, 18), el('span', { text: text })
    ]);
  }

  backBtn.addEventListener('click', function () {
    if (history.length > 1) history.back();
    else location.hash = '#/home';
  });

  window.addEventListener('hashchange', render);

  // データが変わったら再描画（シートは開いたまま）
  S.subscribe(function () { render(); });

  // data-icon が付いた要素にアイコンを流し込む
  function mountIcons() {
    U.$$('[data-icon]').forEach(function (n) {
      if (n.querySelector('svg')) return;
      n.appendChild(DL.icons.icon(n.dataset.icon, U.num(n.dataset.size, 22)));
    });
  }

  function init() {
    S.load();
    mountIcons();
    if (!location.hash) location.hash = '#/home';
    render();

    // 日付が変わったら自動で更新
    var day = U.today();
    setInterval(function () {
      var t = U.today();
      if (t !== day) { day = t; render(); }
    }, 60000);

    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secure) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 失敗しても通常動作 */ });
    }
  }

  DL.app = { render: render, init: init, get route() { return route; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.DL);
