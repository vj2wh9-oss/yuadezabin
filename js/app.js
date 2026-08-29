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
    if (name === 'docs') params.id = parts[1];
    if (name === 'doc') { params.id = parts[1]; params.docId = parts[2]; }
    if (name === 'day') params.date = parts[1];
    if (name === 'calendar' && parts[1]) params.month = parts[1] + '-01';
    return { name: name, params: params };
  }

  function render() {
    if (!S.state) return;      // 読み込みが終わるまでは描かない
    route = parseHash();
    var key = location.hash;
    var scroll = window.scrollY;

    U.clear(view);
    U.clear(actionsEl);
    view.className = 'view view-' + route.name;

    var titles = {
      home: '締切カレンダー', calendar: 'カレンダー', projects: '案件',
      settings: '設定', day: '日別', project: '案件の詳細',
      docs: '請求書・領収書', doc: '書類', sales: '売上'
    };
    titleEl.textContent = titles[route.name] || '締切カレンダー';

    var tab = { home: 'home', calendar: 'calendar', day: 'calendar', projects: 'projects', project: 'projects', docs: 'projects', doc: 'projects', sales: 'projects', settings: 'settings' }[route.name];
    U.$$('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === tab); });

    var showBack = ['project', 'day', 'docs', 'doc', 'sales'].indexOf(route.name) >= 0;
    backBtn.hidden = !showBack;

    // 屋号の切り替え（2つ以上登録しているときだけ出す）
    if (S.issuers().length > 1 && SCOPE_VIEWS.indexOf(route.name) >= 0) {
      actionsEl.appendChild(scopeBtn());
    }

    switch (route.name) {
      case 'calendar': DL.views.calendar.render(view, route.params); break;
      case 'day': DL.views.calendar.renderDay(view, route.params); break;
      case 'projects': DL.views.projects.render(view); break;
      case 'project': DL.views.detail.render(view, route.params); break;
      case 'docs': DL.views.doc.renderList(view, route.params); break;
      case 'doc': DL.views.doc.renderDoc(view, route.params); break;
      case 'sales': DL.views.sales.render(view); break;
      case 'settings': DL.views.settings.render(view); break;
      default: DL.views.home.render(view);
    }

    // 同じ画面の再描画ではスクロール位置を保つ
    if (key === lastKey) window.scrollTo(0, scroll);
    else window.scrollTo(0, 0);
    lastKey = key;

    updateFab();
  }

  /* ---------------- 屋号の切り替え ---------------- */

  var SCOPE_VIEWS = ['home', 'calendar', 'day', 'projects', 'project', 'sales'];

  function scopeBtn() {
    var cur = S.scopeIssuer();
    var name = cur ? (cur.name || '(名称未設定)') : 'すべての屋号';
    if (name.length > 9) name = name.slice(0, 8) + '…';
    return el('button', {
      class: 'scopebtn' + (cur ? ' on' : ''), 'aria-label': '屋号を切り替える',
      onclick: scopeSheet
    }, [
      cur ? el('span', { class: 'scope-dot', style: { background: S.issuerColor(cur.id) } }) : DL.icons.icon('issuer', 15),
      el('span', { text: name }),
      DL.icons.icon('chevronDown', 13)
    ]);
  }

  function scopeSheet() {
    var cur = S.scopeId();
    var list = el('div', { class: 'menu' });

    function opt(id, label, note, color) {
      return el('button', { class: 'menu-item' + (cur === id ? ' on' : ''), onclick: function () {
        S.setScope(id);
        close();
        ui.toast(id ? label + ' に切り替えました' : 'すべての屋号を表示します');
      } }, [
        color ? el('span', { class: 'scope-dot big', style: { background: color } }) : DL.icons.icon('issuer', 18),
        el('span', {}, [
          el('span', { text: label }),
          note ? el('span', { class: 'muted small', text: '　' + note }) : null
        ]),
        cur === id ? el('span', { class: 'menu-check' }, DL.icons.icon('check', 16)) : null
      ]);
    }

    var all = S.projects().filter(function (p) { return p.status !== 'archived'; }).length;
    list.appendChild(opt('', 'すべての屋号', all + '件の案件'));
    S.issuers().forEach(function (x) {
      var n = S.projects().filter(function (p) { return p.issuerId === x.id && p.status !== 'archived'; }).length;
      list.appendChild(opt(x.id, x.name || '(名称未設定)', n + '件の案件', S.issuerColor(x.id)));
    });

    var un = S.unassignedCount();
    var body = el('div', {}, [
      list,
      el('p', { class: 'muted small pad', text: un
        ? '屋号を割り当てていない案件が ' + un + '件あります。どの屋号を選んでいても表示します。'
        : '選んだ屋号の案件だけをホーム・カレンダー・案件一覧に表示します。' })
    ]);

    var close = ui.sheet({ title: '屋号の切り替え', body: body });
  }

  function updateFab() {
    // カレンダーは画面いっぱいに出すので、重なるボタンは置かない
    if (['settings', 'calendar', 'docs', 'doc', 'sales'].indexOf(route.name) >= 0) { fab.hidden = true; return; }
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
    mountIcons();
    if (!location.hash) location.hash = '#/home';

    // 本体は IndexedDB。読み込みが終わってから描画する
    S.init().then(function () {
      render();
      return S.autoBackupIfDue();
    }).catch(function (e) {
      console.error('読み込みに失敗しました', e);
      S.load();
      render();
    });

    // 日付が変わったら再描画して、その日ぶんの自動バックアップを取る
    var day = U.today();
    setInterval(function () {
      var t = U.today();
      if (t !== day) { day = t; render(); S.autoBackupIfDue(); }
    }, 60000);

    // 復帰したときも（日をまたいでアプリを開きっぱなしにしていた場合）
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') S.autoBackupIfDue();
      else S.flush();
    });
    window.addEventListener('pagehide', function () { S.flush(); });

    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secure) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 失敗しても通常動作 */ });
    }
  }

  DL.app = { render: render, init: init, get route() { return route; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.DL);
