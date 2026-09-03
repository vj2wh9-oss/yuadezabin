/* ルーティングとアプリ全体の制御 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  var view = U.$('#view');
  var titleEl = U.$('#appTitle');
  var actionsEl = U.$('#appActions');
  var backBtn = U.$('#backBtn');
  var gearBtn = U.$('#gearBtn');
  var searchBtn = U.$('#searchBtn');
  var ideaBtn = U.$('#ideaBtn');
  var modeBtn = U.$('#modeBtn');
  var fab = U.$('#fab');

  var route = { name: 'home', params: {} };
  var lastKey = '';
  var prevRoute = '';

  function parseHash() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    var name = parts[0] || 'home';
    var params = {};
    if (name === 'project') params.id = parts[1];
    if (name === 'docs') params.id = parts[1];
    if (name === 'doc') { params.id = parts[1]; params.docId = parts[2]; }
    if (name === 'onsite') params.id = parts[1];
    if (name === 'day') params.date = parts[1];
    if (name === 'log') params.date = parts[1];
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
      home: 'METEO365', calendar: 'カレンダー', projects: '案件',
      settings: '設定', day: '日別', project: '案件の詳細',
      docs: '書類', doc: '書類', sales: '売上', files: 'ファイル', books: '経理',
      search: '検索', stock: '頒布と在庫', onsite: '当日モード',
      log: '1日の記録', logs: '記録', ideas: 'ひらめきメモ', orders: '発注'
    };
    setTitle(titles[route.name] || 'METEO365');

    var tab = { home: 'home', calendar: 'calendar', day: 'calendar', log: 'calendar', logs: 'calendar', projects: 'projects', project: 'projects', docs: 'projects', doc: 'projects', sales: 'sales', stock: 'sales', onsite: 'sales', books: 'books', files: 'files' }[route.name];
    U.$$('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === tab); });
    // 設定は下のタブから外し、題名の右の歯車から開く。
    // 歯車を出すのはホームだけにして、ほかのタブでは邪魔をしない
    // （設定の画面でも出しておかないと、開いた先で行き場が分からなくなる）
    gearBtn.hidden = ['home', 'settings'].indexOf(route.name) < 0;
    gearBtn.classList.toggle('on', route.name === 'settings');

    // ひらめきメモ。思いついたときにすぐ開けるよう、検索と同じところに出しておく
    ideaBtn.hidden = IDEA_VIEWS.indexOf(route.name) < 0;
    ideaBtn.classList.toggle('on', route.name === 'ideas');

    // 横断検索。書類の中身まで探すので、データのあるタブからは常に開けるようにする
    searchBtn.hidden = SEARCH_VIEWS.indexOf(route.name) < 0;
    searchBtn.classList.toggle('on', route.name === 'search');

    // カレンダーの切替（案件 / 日常）。効くのはカレンダーの画面だけなので、そこにだけ出す
    var onCal = CAL_VIEWS.indexOf(route.name) >= 0;
    var life = S.calMode() === 'life';
    modeBtn.hidden = !onCal;
    if (onCal) drawModeBtn(life);

    // 売上は下のタブから直接開くので、戻るボタンは要らない
    var showBack = ['project', 'day', 'docs', 'doc', 'search', 'stock', 'onsite', 'log', 'logs', 'ideas', 'orders'].indexOf(route.name) >= 0;
    backBtn.hidden = !showBack;

    // 画面が切り替わった瞬間を、同期のきっかけにする
    if (route.name !== prevRoute) {
      // 当日モードを離れたら、画面を消さない設定は返す
      if (prevRoute === 'onsite') DL.views.onsite.left();
      prevRoute = route.name;
      // 別の画面へ移ったら、開きっぱなしのシートは畳む。
      // （検索から経費を開いたあと戻る、のように画面をまたぐ移動があるため）
      ui.closeAllSheets();
      if (route.name === 'files') DL.views.files.entered();
      DL.sync.touch().then(function (r) {
        if (r.status === 'pulled' || r.status === 'merged') render();
      });
      // 通知の予定表も預け直す（予定を直したぶんを反映するため）
      queueNotify();
      // FANBOX から送られてきたものが無いか見に行く
      if (['home', 'sales', 'settings'].indexOf(route.name) >= 0) checkFanbox();
      // 発注フォームから届いていないか見に行く
      if (['home', 'settings', 'orders'].indexOf(route.name) >= 0) checkOrders();
    }

    // 同期ボタン（つないでいるときだけ）
    if (DL.sync.active()) actionsEl.appendChild(syncBtn());

    // 名義の切り替え（2つ以上登録しているときだけ出す）。
    // 日常のカレンダーは名義と関わらないので、そこでは出さない
    if (S.issuers().length > 1 && SCOPE_VIEWS.indexOf(route.name) >= 0 && !(onCal && life)) {
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
      case 'books': DL.views.books.render(view); break;
      case 'files': DL.views.files.render(view); break;
      case 'stock': DL.views.stock.render(view); break;
      case 'onsite': DL.views.onsite.render(view, route.params); break;
      case 'log': DL.views.daylog.render(view, route.params); break;
      case 'logs': DL.views.daylog.renderList(view); break;
      case 'ideas': DL.views.daylog.renderIdeas(view); break;
      case 'orders': DL.views.orders.render(view); break;
      case 'search': DL.views.search.render(view); break;
      case 'settings': DL.views.settings.render(view); break;
      default: DL.views.home.render(view);
    }

    // 同じ画面の再描画ではスクロール位置を保つ
    if (key === lastKey) window.scrollTo(0, scroll);
    else window.scrollTo(0, 0);
    lastKey = key;

    updateFab();
  }

  /* アプリの名前のところだけロゴの組みにする。ほかの画面は画面名の文字のまま */
  function setTitle(text) {
    U.clear(titleEl);
    var isLogo = text === 'METEO365';
    titleEl.classList.toggle('is-logo', isLogo);
    if (isLogo) {
      titleEl.appendChild(el('span', { class: 'logo-word' }, [
        el('b', { text: 'METEO' }), el('i', { text: '365' })
      ]));
    } else {
      titleEl.textContent = text;
    }
  }

  /* ---------------- 同期ボタン ---------------- */

  /**
   * 画面上部の同期ボタン。
   * 送っていない変更があるときは印を付け、実行中は回す。
   */
  function syncBtn() {
    var pending = S.changedSinceSync();
    var b = el('button', {
      class: 'syncbtn' + (pending ? ' pending' : ''),
      'aria-label': pending ? '同期する（未送信の変更あり）' : '同期する',
      onclick: function () {
        if (b.classList.contains('busy')) return;
        b.classList.add('busy');
        DL.sync.run({ force: true }).then(function (r) {
          b.classList.remove('busy');
          if (r.status === 'error' || r.status === 'conflict') return;   // それぞれ側で知らせる
          ui.toast(r.status === 'pushed' ? '送りました'
            : r.status === 'pulled' ? '受け取りました'
            : r.status === 'merged' ? '統合しました' : '最新です');
          // 手で同期したときは、外から届いていないかも聞き直す
          checkFanbox(true);
          checkOrders(true);
          render();
        });
      }
    }, DL.icons.icon('refresh', 19));
    return b;
  }

  /* ---------------- カレンダーの切り替え（案件 / 日常） ---------------- */

  var CAL_VIEWS = ['calendar', 'day'];

  /* いま見ている側を出す。押すともう一方に移る */
  function drawModeBtn(life) {
    U.clear(modeBtn);
    modeBtn.classList.toggle('life', life);
    modeBtn.setAttribute('aria-label', 'カレンダーを切り替える（いまは' + (life ? '日常' : '案件') + '）');
    modeBtn.appendChild(DL.icons.icon('swap', 14));
    modeBtn.appendChild(el('span', { text: life ? '日常' : '案件' }));
  }

  modeBtn.addEventListener('click', function () {
    var next = S.calMode() === 'life' ? 'work' : 'life';
    S.setCalMode(next);      // 保存すると購読側で描き直される
    ui.toast(next === 'life' ? '日常のカレンダーに切り替えました' : '案件のカレンダーに切り替えました');
  });

  /* ---------------- 名義の切り替え ---------------- */

  // ホームには出さない（名義を切り替えるのは案件・カレンダー・売上を見ているとき）
  var SCOPE_VIEWS = ['calendar', 'day', 'projects', 'project', 'sales'];

  /* 虫めがねを出す画面。検索の画面自身にも出して、押せば戻れるようにする */
  var SEARCH_VIEWS = ['home', 'projects', 'sales', 'stock', 'books', 'files', 'search', 'logs'];

  /* 電球（ひらめきメモ）を出す画面。思いついたときにすぐ書けるよう、広めに出す */
  var IDEA_VIEWS = SEARCH_VIEWS.concat(['settings', 'ideas', 'log', 'calendar', 'day']);

  function scopeBtn() {
    var cur = S.scopeIssuer();
    var name = cur ? (cur.name || '(名称未設定)') : 'すべての名義';
    if (name.length > 9) name = name.slice(0, 8) + '…';
    return el('button', {
      class: 'scopebtn' + (cur ? ' on' : ''), 'aria-label': '名義を切り替える',
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
        ui.toast(id ? label + ' に切り替えました' : 'すべての名義を表示します');
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
    list.appendChild(opt('', 'すべての名義', all + '件の案件'));
    S.issuers().forEach(function (x) {
      var n = S.projects().filter(function (p) { return p.issuerId === x.id && p.status !== 'archived'; }).length;
      list.appendChild(opt(x.id, x.name || '(名称未設定)', n + '件の案件', S.issuerColor(x.id)));
    });

    var un = S.unassignedCount();
    var body = el('div', {}, [
      list,
      el('p', { class: 'muted small pad', text: un
        ? '名義を割り当てていない案件が ' + un + '件あります。どの名義を選んでいても表示します。'
        : '選んだ名義の案件だけをホーム・カレンダー・案件一覧に表示します。' })
    ]);

    var close = ui.sheet({ title: '名義の切り替え', body: body });
  }

  /* FANBOX のページから送られてきた表を、届いていないか見に行く。
     新しく届いたときだけ知らせる（画面を開くたびに言われても邪魔になるため） */
  var lastInboxAt = '';
  function checkFanbox(force) {
    if (!DL.fanbox.ready()) return;
    DL.fanbox.checkInbox(force).then(function (r) {
      if (!r) { lastInboxAt = ''; return; }
      if (r.at === lastInboxAt) return;
      lastInboxAt = r.at;
      ui.toast('FANBOX からデータが届いています（売上タブで取り込めます）');
      render();
    });
  }

  /* 発注フォームから届いた発注が無いか見に行く。
     新しく増えたときだけ知らせる（画面を開くたびに言われても邪魔になるため） */
  var lastOrderCount = -1;
  function checkOrders(force) {
    if (!DL.orders.ready()) return;
    DL.orders.check(force).then(function (list) {
      var n = list.filter(function (o) { return o.status === 'new'; }).length;
      if (n === lastOrderCount) return;
      var grew = lastOrderCount >= 0 && n > lastOrderCount;
      lastOrderCount = n;
      if (grew) ui.toast('新しい発注が届いています（' + n + '件）');
      render();
    });
  }

  /* 通知の予定表を預け直す。連続して呼ばれても1回にまとめる */
  var notifyTimer = null;
  function queueNotify() {
    if (!DL.notify || !DL.notify.settings().enabled) return;
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () {
      notifyTimer = null;
      DL.notify.sync().catch(function () { /* つながらないときは次の機会に */ });
    }, 3000);
  }

  function updateFab() {
    // カレンダーは画面いっぱいに出すので、重なるボタンは置かない
    if (['settings', 'calendar', 'docs', 'doc', 'sales', 'search', 'onsite', 'log', 'logs', 'ideas', 'orders'].indexOf(route.name) >= 0) { fab.hidden = true; return; }
    fab.hidden = false;
    fab.onclick = function () {
      // 日常のカレンダーの日別画面では、ここが予定の追加口になる
      if (route.name === 'day' && S.calMode() === 'life') {
        DL.views.events.form(null, { date: route.params.date || U.today() });
        return;
      }
      // ファイル画面では、ここがファイルの追加口になる
      if (route.name === 'files') { DL.views.files.pickFiles(); return; }
      // 経理画面では、ここが経費の追加口になる
      if (route.name === 'books') { DL.views.books.addExpense(); return; }
      // 在庫画面では、ここが頒布物の追加口になる
      if (route.name === 'stock') { DL.views.stock.addItem(); return; }
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

  /* 開いている画面のタブをもう一度押したときの動き。
     ファイルはフォルダを開いていればひとつ上へ戻す（いちばん上なら何もしない）。
     同じ hash への移動では hashchange が起きないので、ここで拾う。 */
  U.$$('.tab').forEach(function (t) {
    t.addEventListener('click', function (e) {
      if (t.dataset.tab !== 'files' || route.name !== 'files') return;
      e.preventDefault();
      DL.views.files.up();
    });
  });

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
    // 自動同期の最中もボタンを回す
    DL.sync.on(function (ev) {
      var b = U.$('.syncbtn');
      if (!b) return;
      b.classList.toggle('busy', ev.phase === 'start');
    });

    S.init().then(function () {
      render();
      DL.sync.start();
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
      if (document.visibilityState === 'visible') {
        S.autoBackupIfDue();
        DL.sync.run({ silent: true }).then(function (r) {
          if (r.status === 'pulled' || r.status === 'merged') render();
        });
      } else {
        S.flush();
        DL.sync.flush();
      }
    });
    window.addEventListener('pagehide', function () { S.flush(); DL.sync.flush(); });

    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secure) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 失敗しても通常動作 */ });
    }
  }

  DL.app = { render: render, init: init, get route() { return route; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.DL);
