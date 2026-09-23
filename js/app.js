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
  var fabOrders = U.$('#fabOrders');
  var fabCrm = U.$('#fabCrm');
  var appbar = U.$('#appbar');
  var tabbar = U.$('#tabbar');
  var dueTick = U.$('#dueTick');

  var route = { name: 'home', params: {} };
  var lastKey = '';
  var prevRoute = '';
  /* 上の帯と下のタブの置き場所を見に行く。中身は watchBars で入れる */
  var checkBars = function () {};

  function parseHash() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    var name = parts[0] || 'home';
    var params = {};
    if (name === 'project') params.id = parts[1];
    if (name === 'docs') params.id = parts[1];
    if (name === 'doc') { params.id = parts[1]; params.docId = parts[2]; }
    if (name === 'onsite') params.id = parts[1];
    if (name === 'pages') params.id = parts[1];
    if (name === 'fit') params.date = parts[1];
    if (name === 'day') params.date = parts[1];
    if (name === 'log') params.date = parts[1];
    if (name === 'time') params.date = parts[1];
    if (name === 'crm') params.id = parts[1];
    if (name === 'calendar' && parts[1]) params.month = parts[1] + '-01';
    return { name: name, params: params };
  }

  function render() {
    if (!S.state) return;      // 読み込みが終わるまでは描かない

    /* 筋トレのタブに入るときは、いまの明るい画面の上に黒い幕を降ろしてから
       中身を入れ替える。先に入れ替えると、幕が降りる前に真っ黒になってしまい、
       幕の意味がなくなる。降りきったら、ここへ戻ってきて描き直す */
    var next = parseHash();
    if (next.name === 'fit' && prevRoute !== 'fit'
      && DL.views.fit.dropCurtain(render)) return;

    route = next;
    var key = location.hash;
    var scroll = window.scrollY;

    /* 画面が入れ物そのものに掛けた見張り（1日の時間のスワイプなど）を外す。
       中身を消すだけでは残ってしまい、別の画面でも効いてしまう */
    if (view._dayNav) view._dayNav();

    U.clear(view);
    U.clear(actionsEl);
    view.className = 'view view-' + route.name;

    var titles = {
      home: 'METEO365', calendar: 'カレンダー', projects: '案件',
      settings: '設定', day: '日別', project: '案件の詳細',
      docs: '書類', doc: '書類', sales: '売上', files: 'ファイル', books: '経理',
      search: '検索', stock: '頒布と在庫', onsite: '当日モード', pages: '原稿のページ',
      fit: '筋トレ',
      log: '1日の記録', logs: '記録', ideas: 'ひらめきメモ', time: '1日の時間', orders: '発注',
      crm: '顧客管理'
    };
    setTitle(titles[route.name] || 'METEO365');

    var tab = { home: 'home', fit: 'fit', calendar: 'calendar', day: 'calendar', log: 'calendar', logs: 'calendar', time: 'calendar', projects: 'projects', project: 'projects', pages: 'projects', docs: 'projects', doc: 'projects', crm: 'projects', sales: 'sales', stock: 'sales', onsite: 'sales', books: 'books', files: 'files' }[route.name];
    U.$$('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === tab); });

    /* 筋トレのタブだけ、黄と黒の見た目に切り替える。
       シートは .view の外（#sheetRoot）に出るので、body に付ける */
    document.body.classList.toggle('fit-theme', route.name === 'fit');
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
    var showBack = ['project', 'pages', 'day', 'docs', 'doc', 'search', 'stock', 'onsite', 'log', 'logs', 'ideas', 'time', 'orders', 'crm'].indexOf(route.name) >= 0
      // 筋トレは、日付が付いているとき（その日の中身）だけ戻れるようにする
      || (route.name === 'fit' && !!route.params.date);
    backBtn.hidden = !showBack;

    // 画面が切り替わった瞬間を、同期のきっかけにする
    if (route.name !== prevRoute) {
      // 当日モードを離れたら、画面を消さない設定は返す
      if (prevRoute === 'onsite') DL.views.onsite.left();
      /* 筋トレは黒、ほかのタブは明るい。そのまま切り替えると目に刺さるので、
         あいだに黒い幕をはさむ。入るときは降ろしてから溜め、出るときは上げる。
         中で日付を行き来するあいだは出さない（route の名前は fit のまま） */
      if (route.name === 'fit') DL.views.fit.intro();
      else if (prevRoute === 'fit') DL.views.fit.outro();
      else DL.views.fit.closeFx();
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
      /* カードの決済通知。預かっているぶんを、そっと取り込んでおく。
         経費に入れるかどうかは、経理の画面で決める（勝手には入れない） */
      if (['home', 'books'].indexOf(route.name) >= 0) checkCards();
    }

    // ROOM RESERVE の取り込み。日常のカレンダーでだけ、更新ボタンの左に置く
    if (onCal && life && DL.roomreserve.ready()) actionsEl.appendChild(roomBtn());

    // 顧客管理を閉じるボタン
    if (route.name === 'crm') DL.views.crm.actions(actionsEl);

    /* 同期ボタン（つないでいるときだけ）。
       ホームでは出さない——上から引き下げれば同期がかかるので、
       そのぶんの場所を「次の締切まであと何日」に譲る */
    if (DL.sync.active() && route.name !== 'home') actionsEl.appendChild(syncBtn());

    // 次の締切まであと何日。ホームでだけ、検索の右に出す
    drawDueTick(route.name === 'home');
    // 引きかけたまま画面が移ったときに、輪が残らないようにする
    if (route.name !== 'home') restPull();

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
      case 'pages': DL.views.pages.render(view, route.params); break;
      case 'fit': DL.views.fit.render(view, route.params); break;
      case 'docs': DL.views.doc.renderList(view, route.params); break;
      case 'doc': DL.views.doc.renderDoc(view, route.params); break;
      case 'sales': DL.views.sales.render(view); break;
      case 'books': DL.views.books.render(view); break;
      case 'files': DL.views.files.render(view); break;
      case 'stock': DL.views.stock.render(view); break;
      case 'onsite': DL.views.onsite.render(view, route.params); break;
      case 'log': DL.views.daylog.render(view, route.params); break;
      case 'time': DL.views.time.render(view, route.params); break;
      case 'logs': DL.views.daylog.renderList(view); break;
      case 'ideas': DL.views.daylog.renderIdeas(view); break;
      case 'orders': DL.views.orders.render(view); break;
      case 'crm': DL.views.crm.render(view, route.params); break;
      case 'search': DL.views.search.render(view); break;
      case 'settings': DL.views.settings.render(view); break;
      default: DL.views.home.render(view);
    }

    // 同じ画面の再描画ではスクロール位置を保つ
    var entered = key !== lastKey;      // 画面を開いたところ（保存による描き直しではない）
    if (entered) window.scrollTo(0, 0);
    else window.scrollTo(0, scroll);
    lastKey = key;

    updateFab();

    // 金額の数え上げや、グラフの描き出し。開いたときだけで、
    // 保存のたびの描き直しでは動かさない
    if (entered) ui.introduce(view);

    // 上の帯と下のタブが浮いたままになっていないか、ついでに見ておく
    checkBars();
  }

  /* アプリの名前のところだけロゴの組みにする。ほかの画面は画面名の文字のまま。
     ロゴはそのまま置かず、最初の一枚（splash）と同じように 365 を回して止める。
     ホームに入ったときだけ回し、保存のたびの描き直しでは動かさない
     （組み直すと、そのたびに回ってしまうので、すでにロゴなら触らない） */
  function setTitle(text) {
    var isLogo = text === 'METEO365';
    if (isLogo && titleEl.classList.contains('is-logo')) return;
    U.clear(titleEl);
    titleEl.classList.toggle('is-logo', isLogo);
    if (!isLogo) { titleEl.textContent = text; return; }
    titleEl.appendChild(logoWord());
    /* 起動の一枚が出ているあいだは、その裏で回っても見えない。
       そのときは回さず、幕が開くとき（startSplash）に回す */
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('out')) spinTitle();
  }

  /* 止まる先の数字と、そこまでに回る周数。
     左ほど短く回るので、3 → 6 → 5 と1つずつ止まる。
     どれも「ちょうど何周」にしてあり、帯のはじめと終わりが同じ数字になる。
     回る・止まる・また回りだす、の時間の割り振りは assets/style.css の側 */
  var LOGO_REELS = [
    { n: 3, turns: 3, spin: 'logoSpin1' },
    { n: 6, turns: 4, spin: 'logoSpin2' },
    { n: 5, turns: 6, spin: 'logoSpin3' }
  ];

  /**
   * ロゴの組み。METEO はそのまま、365 は1桁ずつ窓に入れて回す。
   * 押すともう一度回る（押せることは文字では出さない。触れば分かる程度の遊び）
   */
  function logoWord() {
    var node = el('span', { class: 'logo-word', role: 'img', 'aria-label': 'METEO365' }, [
      el('b', { text: 'METEO', 'aria-hidden': 'true' }),
      el('span', { class: 'logo-num', 'aria-hidden': 'true' }, LOGO_REELS.map(reel))
    ]);
    node.addEventListener('click', function () { spinLogo(node); });
    return node;

    /* 数字1桁ぶんの窓。止まる先の数字から始めて 0〜9 を何周ぶんも並べ、
       land 番目まで送って止める。ちょうど何周ぶんなので、いちばん上と
       いちばん下は同じ数字になる。繰り返すとき、戻るところが見えない */
    function reel(r) {
      var land = r.turns * 10;
      var strip = el('span', {
        class: 'logo-strip',
        style: { '--land': String(land), '--spin': r.spin }
      });
      for (var k = 0; k <= land; k++) strip.appendChild(el('i', { text: String((r.n + k) % 10) }));
      return el('span', { class: 'logo-reel' }, strip);
    }
  }

  /* いまヘッダーに出ているロゴを回す。ロゴでなければ何もしない */
  function spinTitle() {
    var w = titleEl.querySelector('.logo-word');
    if (w) spinLogo(w);
  }

  /* もう一度回す。付けっぱなしだと2度目が動かないので、
     いったん外し、そこで一度measureして（ブラウザに気づかせて）から入れ直す */
  function spinLogo(node) {
    node.classList.remove('spin');
    void node.offsetWidth;
    node.classList.add('spin');
  }

  /* ---------------- 同期ボタン ---------------- */

  /**
   * ROOM RESERVE の取り込み。押したときだけ取りに行き、
   * いまの日常カレンダーに無いものだけを足す。
   */
  function roomBtn() {
    var b = el('button', {
      class: 'syncbtn roombtn', 'aria-label': 'ROOM RESERVE 同期', title: 'ROOM RESERVE 同期',
      onclick: function () {
        if (b.classList.contains('busy')) return;
        b.classList.add('busy');
        DL.roomreserve.pull().then(function (r) {
          b.classList.remove('busy');
          ui.toast(DL.roomreserve.pullText(r));
          render();
        }).catch(function (e) {
          b.classList.remove('busy');
          ui.toast(e.message, 'danger');
        });
      }
    }, DL.icons.icon('roomIn', 19));
    return b;
  }

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

  /* ---------------- 次の締切まであと何日 ----------------

     入稿・締切・イベント当日のうち、いちばん近い日を出す。
     どれを拾うかは、案件のカレンダーに出ている印とそろえてある
     （schedule.upcomingMarks）。カレンダーのどこにも無い締切が
     ここにだけ出てくる、ということが起きないようにするため。

     見た目は駅の発車標のような細長い一本。同じ日にいくつも重なっていれば、
     右から左へ流して順に見せる。名前が長くて入りきらないときは、
     出しているあいだにゆっくり左へ送って、終わりまで読めるようにする。

     数えるのは日付だけなので、時計より軽い。日が変わったときに
     render() から呼び直される（app.js の1分ごとの見張り）。 */

  var TICK_MS = 4200;        // 1つを出しておく時間
  var TICK_OUT = 340;        // 送り出すのにかかる時間
  var tickTimer = 0;
  var tickList = [];
  var tickAt = 0;
  var tickKey = '';          // いま出している顔ぶれ。変わらなければ流しを続ける

  function dueItems(today) {
    // カレンダーに出るのと同じ印だけ（印刷所のプランはメインのみ）
    var all = DL.schedule.upcomingMarks(today, 400);
    if (!all.length) return [];
    // いちばん近い日ぶん。同じ日に重なっているものは、まとめて流す
    var first = all[0].date;
    return all.filter(function (it) { return it.date === first; }).slice(0, 6);
  }

  /**
   * その1件の出しかた。発車標のように1行にまとめる。
   * あと何日かは、いちばん知りたいところなので右に固定して必ず見えるようにし、
   * 流すのはその左（種別と案件名）だけにする。
   * 狭い画面では名前が入りきらないので、そこだけ送って読ませる。
   */
  function tickFace(it, today) {
    var left = U.diffDays(today, it.date);
    var name = it.type === 'event' ? 'イベント'
      : it.type === 'printing' ? (it.label || '入稿')
        : DL.schedule.deadlineShort(it.project);
    return el('span', { class: 'due-face' }, [
      el('span', { class: 'due-scroll' },
        el('span', { class: 'due-line' }, [
          el('i', { class: 'due-dot', style: { background: it.project.color } }),
          el('span', { class: 'due-what', text: name }),
          el('span', { class: 'due-name', text: it.project.title })
        ])),
      el('b', { class: 'due-left' + (left <= 0 ? ' now' : left <= 3 ? ' near' : ''),
        text: left <= 0 ? 'TODAY' : left + '日' })
    ]);
  }

  /* 入りきらないぶんを、出しているあいだにゆっくり左へ送る。
     ぴったり収まっているときは、動かさない */
  function panTick(face) {
    var box = face.querySelector('.due-scroll');
    var line = box && box.firstElementChild;
    if (!line) return;
    var over = line.scrollWidth - box.clientWidth + 4;
    if (over <= 4) return;
    line.style.setProperty('--pan', '-' + Math.round(over) + 'px');
    line.classList.add('pan');
  }

  function drawDueTick(on) {
    clearTimeout(tickTimer);
    tickTimer = 0;
    var off = function () {
      dueTick.hidden = true;
      appbar.classList.remove('has-tick');
      tickKey = '';
      U.clear(dueTick);
    };
    if (!on) { off(); return; }

    var today = U.today();
    var list = dueItems(today);
    if (!list.length) { off(); return; }

    var key = today + '|' + list.map(function (it) {
      return it.type + ':' + it.date + ':' + it.project.id;
    }).join(',');
    // 顔ぶれが同じなら、いま流れているところを止めずに続ける
    if (key === tickKey && dueTick.firstChild) { queueTick(); return; }
    tickKey = key;
    tickList = list;
    tickAt = 0;
    dueTick.hidden = false;
    appbar.classList.add('has-tick');
    dueTick.setAttribute('href', '#/day/' + list[0].date);
    dueTick.setAttribute('aria-label', '次の締切を見る');
    showTick(false);
  }

  /* いまの1件を出す。slide=true なら、右から流し込む */
  function showTick(slide) {
    var it = tickList[tickAt];
    if (!it) return;
    U.clear(dueTick);
    var face = tickFace(it, U.today());
    if (slide) face.classList.add('in');
    dueTick.appendChild(face);
    dueTick.setAttribute('href', '#/day/' + it.date);
    // 幅は置いてからでないと測れない
    panTick(face);
    queueTick();
  }

  /* 2つ以上あるときだけ、次のものへ送る */
  function queueTick() {
    clearTimeout(tickTimer);
    if (tickList.length < 2) return;
    tickTimer = setTimeout(function () {
      var face = dueTick.firstElementChild;
      if (!face) return;
      // いま出ているものを左へ送り出してから、次を右から入れる
      face.classList.remove('in');
      face.classList.add('out');
      setTimeout(function () {
        tickAt = (tickAt + 1) % tickList.length;
        showTick(true);
      }, TICK_OUT);
    }, TICK_MS);
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

  /* 案件 ⇔ 日常。切り替えたことは画面の中身と上のボタンで分かるので、
     わざわざ知らせない */
  function flipCalMode() {
    S.setCalMode(S.calMode() === 'life' ? 'work' : 'life');   // 保存すると購読側で描き直される
  }

  modeBtn.addEventListener('click', flipCalMode);

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

  /* カードの決済通知を取りに行く。
     届いていたらその場で知らせ、ホームのお知らせにも出す（経費には入れない）。
     force は引き下げて更新したときだけ（ふだんは 2分に1回に控える） */
  function checkCards(force) {
    if (!DL.card || !DL.card.ready()) return;
    (force ? DL.card.pull() : DL.card.autoPull()).then(function (r) {
      if (!r || !r.added) return;
      ui.toast('カードの決済通知を ' + r.added + '件 受け取りました');
      render();
    }).catch(function () { /* つながらないときは、次に開いたときに */ });
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
    updateOrderFab();
    updateCrmFab();
    /* カレンダーは画面いっぱいに出すので、重なるボタンは置かない。
       筋トレには案件を作る用がないので、ここも出さない。
       ホームは眺める場所で、案件を作るなら案件タブの＋を使うので、ここも出さない */
    if (['home', 'settings', 'calendar', 'docs', 'doc', 'sales', 'search', 'onsite', 'log', 'logs', 'ideas', 'time', 'orders', 'crm', 'fit'].indexOf(route.name) >= 0) { fab.hidden = true; return; }
    fab.hidden = false;
    fab.onclick = function () {
      /* 日別画面では、ここがその日の予定の追加口になる。
         この画面は日常と案件の両方を出すので、どちらを見ていても同じにする */
      if (route.name === 'day') {
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

  /**
   * 発注の入口。案件タブでだけ、＋の左に同じ大きさで出す。
   * 押すと、設定の「発注の一覧を開く」と同じ画面へ行く。
   */
  function updateOrderFab() {
    if (!fabOrders) return;
    fabOrders.hidden = route.name !== 'projects';
    if (fabOrders.hidden) return;
    var n = DL.orders.unread();
    fabOrders.classList.toggle('has-new', n > 0);
    fabOrders.setAttribute('aria-label', n ? '発注の一覧を開く（未確認 ' + n + '件）' : '発注の一覧を開く');
    fabOrders.setAttribute('data-count', n > 9 ? '9+' : String(n || ''));
    fabOrders.onclick = function () { location.hash = '#/orders'; };
  }

  /**
   * 顧客管理の入口。案件タブでだけ、発注ボタンの左に同じ大きさで出す。
   * 合言葉を決めていなければ、まずそれを決めてもらう。
   */
  function updateCrmFab() {
    if (!fabCrm) return;
    fabCrm.hidden = route.name !== 'projects';
    if (fabCrm.hidden) return;
    fabCrm.onclick = function () {
      if (!DL.crm.hasPass()) { DL.views.crm.passSheet(function () { location.hash = '#/crm'; }); return; }
      location.hash = '#/crm';
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
     カレンダーは案件と日常を切り替える（上の切替ボタンと同じ）。
     同じ hash への移動では hashchange が起きないので、ここで拾う。 */
  U.$$('.tab').forEach(function (t) {
    t.addEventListener('click', function (e) {
      if (t.dataset.tab === 'files' && route.name === 'files') {
        e.preventDefault();
        DL.views.files.up();
        return;
      }
      // 月表示を見ているときだけ。日別や1日の時間からは、いつもどおり月表示へ戻す
      if (t.dataset.tab === 'calendar' && route.name === 'calendar') {
        e.preventDefault();
        flipCalMode();
        return;
      }
      // ホームを見ているときにホームを押したら、いちばん上まで戻す
      if (t.dataset.tab === 'home' && route.name === 'home') {
        e.preventDefault();
        var soft = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        window.scrollTo({ top: 0, behavior: soft ? 'smooth' : 'auto' });
      }
    });
  });

  backBtn.addEventListener('click', function () {
    if (history.length > 1) history.back();
    else location.hash = '#/home';
  });

  window.addEventListener('hashchange', render);

  // データが変わったら再描画（シートは開いたまま）
  /* 保存されたら描き直す。ただし noRender を付けた保存は、そのままにしておく
     （打っている最中の欄で手が離れてしまうため）*/
  S.subscribe(function (st, opts) { if (opts && opts.noRender) return; render(); });

  // data-icon が付いた要素にアイコンを流し込む
  function mountIcons() {
    U.$$('[data-icon]').forEach(function (n) {
      if (n.querySelector('svg')) return;
      n.appendChild(DL.icons.icon(n.dataset.icon, U.num(n.dataset.size, 22)));
    });
  }

  /* 文字を打っているあいだ、下のタブが浮き上がるのを止める。

     iPhone では、キーボードが出ると見えている高さだけが縮み、
     ページの高さは変わらない。下タブは position:fixed で
     「ページのいちばん下」に貼り付いているので、キーボードに
     押し上げられて画面の途中に浮いて見えてしまう。

     キーボードが出ているあいだは、下タブと＋ボタンをしまう。
     打ち終われば元に戻る。 */
  function watchKeyboard() {
    var vv = window.visualViewport;
    if (!vv) return;                       // 古い端末では何もしない
    var open = false;
    var check = function () {
      // 下がどれだけ隠れているか。アドレスバーの出入りでは、ここまで動かない
      var hidden = window.innerHeight - vv.height - vv.offsetTop;
      var next = hidden > 120;
      if (next === open) return;
      open = next;
      document.body.classList.toggle('kb-open', open);
    };
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
    check();
  }

  /* ---------------- 引き下げて更新 ----------------

     ホームのいちばん上で、上から下へ引くと同期がかかる。
     ボタンを押すのではなく、指の動きそのものが「もう一度見に行く」になる。
     引いているあいだは輪が付いてきて、離すところまで引けば回りだす。

     ホームの上にいるときだけ。横に振ったぶんは見送る（左右のスワイプを邪魔しない）。 */

  var PULL_NEED = 72;        // ここまで引いたら更新する
  var PULL_MAX = 110;        // これ以上は付いてこない
  /* 引きかけたまま画面が移ったとき用の片づけ。中身は watchPull で入れる */
  var restPull = function () {};

  function watchPull() {
    var ring = el('div', { class: 'ptr', 'aria-hidden': 'true' },
      el('div', { class: 'ptr-ring' }, DL.icons.icon('refresh', 20)));
    document.body.appendChild(ring);

    var y0 = 0, x0 = 0, dist = 0;
    var tracking = false, pulling = false, busy = false;

    var set = function (d) {
      dist = d;
      ring.style.setProperty('--ptr', d + 'px');
      ring.classList.toggle('ready', d >= PULL_NEED);
    };
    var rest = function () {
      pulling = false;
      tracking = false;
      ring.classList.remove('on', 'ready');
      ring.style.removeProperty('--ptr');
      dist = 0;
    };

    document.addEventListener('touchstart', function (e) {
      if (busy || route.name !== 'home' || e.touches.length !== 1) return;
      // いちばん上にいるときだけ。少しでも巻き上がっていれば、ふつうのスクロール
      if (window.scrollY > 0) return;
      // シートが開いているあいだは、そちらの操作
      if (document.body.classList.contains('no-scroll')) return;
      tracking = true;
      pulling = false;
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!tracking || busy) return;
      var t = e.touches[0];
      var dy = t.clientY - y0;
      var dx = t.clientX - x0;
      if (!pulling) {
        // 下へ、まっすぐ引いたときだけ受ける
        if (dy < 8) { if (dy < -4) tracking = false; return; }
        if (Math.abs(dx) > Math.abs(dy)) { tracking = false; return; }
        pulling = true;
        ring.classList.add('on');
      }
      if (window.scrollY > 0) { rest(); return; }
      // 引くほど重くなる。ずっと付いてくると、どこまでも伸びてしまう
      set(Math.min(PULL_MAX, dy * 0.55));
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    var done = function () {
      if (!pulling) { tracking = false; return; }
      if (dist < PULL_NEED) { rest(); return; }
      busy = true;
      ring.classList.add('busy');
      set(PULL_NEED);
      DL.sync.run({ force: true }).then(function (r) {
        busy = false;
        ring.classList.remove('busy');
        rest();
        if (r.status === 'error' || r.status === 'conflict') return;  // それぞれ側で知らせる
        ui.toast(r.status === 'pushed' ? '送りました'
          : r.status === 'pulled' ? '受け取りました'
          : r.status === 'merged' ? '統合しました' : '最新です');
        checkFanbox(true);
        checkOrders(true);
        checkCards(true);
        render();
      }).catch(function () {
        busy = false;
        ring.classList.remove('busy');
        rest();
      });
    };
    document.addEventListener('touchend', done, { passive: true });
    document.addEventListener('touchcancel', function () { rest(); }, { passive: true });
    restPull = function () { if (!busy) rest(); };
  }

  /* 上の帯と下のタブは position:fixed で画面に貼り付けている。
     iOS はキーボードが出入りしたあとに、この貼り付け先を取りこぼすことがある。
     そうなると、タブが画面のまん中あたりに浮いたまま残り、上の帯も消える。
     ずれていないか見張って、ずれていたら貼り直す。 */
  function watchBars() {
    var timer = 0;
    var tries = 0;      // 同じずれを押し続けないための回数
    var later = function () { clearTimeout(timer); timer = setTimeout(fix, 150); };
    // キーボードの出入りなど、ずれが起きうる変わり目。ここでは数え直す
    var fresh = function () { tries = 0; later(); };

    /* いちばん上・いちばん下から外れていないか。
       キーボードが出ているあいだはタブを畳んでいるので、そこは見ない */
    function astray() {
      var h = window.innerHeight;
      if (!h || document.body.classList.contains('kb-open')) return false;
      var t = tabbar.getBoundingClientRect();
      if (!t.height) return false;
      var a = appbar.getBoundingClientRect();
      return Math.abs(t.bottom - h) > 2 || Math.abs(a.top) > 2;
    }

    /* いったん消して、もう一度置く。これで貼り付け先を取り直してくれる。
       それでも直らなければ、画面を1pxだけ動かして気づかせる。
       直らないものを押し続けても仕方がないので、続けての試みは3回まで。
       うまく付いたか、次の変わり目が来たら、また数え直す */
    function fix() {
      if (!astray()) { tries = 0; return; }
      if (tries >= 3) return;
      var first = tries === 0;
      tries++;
      [appbar, tabbar].forEach(function (n) {
        n.style.display = 'none';
        void n.offsetHeight;
        n.style.display = '';
      });
      if (!first || !astray()) return;
      var y = window.scrollY;
      window.scrollTo(0, y + (y > 0 ? -1 : 1));
      window.scrollTo(0, y);
    }

    var vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', fresh);
      vv.addEventListener('scroll', later);
    }
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('orientationchange', fresh);
    window.addEventListener('pageshow', fresh);
    // 入力欄から手が離れる＝キーボードが引っ込むところ。いちばん起きやすい
    document.addEventListener('focusout', fresh);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') fresh();
    });
    checkBars = fresh;
  }

  /* 起動の一枚を、そろそろ開ける。

     絵と回りだしは CSS と index.html の側にあるので、ここは幕を引くだけ。
     読み込みが終わるのを待つが、数字が止まるまでは開けない。
     押せば飛ばせるし、読み込みでつまずいても必ず開く。
     @returns {function} 読み込みが終わったときに呼ぶ */
  function startSplash() {
    var box = U.$('#splash');
    if (!box) return function () {};
    var soft = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var least = soft ? 1150 : 450;      // 数字が止まって、ひと呼吸おくまで
    var t0 = Date.now();
    var gone = false;

    var leave = function () {
      if (gone) return;
      gone = true;
      /* 幕の裏で描き終わってしまっているので、もう一度動かす。
         空にするのは幕が下りているいまのうちに済ませ、動きだすのは
         幕が開ききるころ。あとから空にすると、埋まった状態が
         幕ごしに一瞬見えてしまう */
      ui.introduce(view, 220);
      box.classList.add('out');
      // ヘッダーのロゴは、幕の裏では見えない。開きだすいま回す
      spinTitle();
      setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 320);
    };

    box.addEventListener('click', leave);          // 押せば飛ばせる
    setTimeout(leave, soft ? 3000 : 1400);         // 何があっても開く

    return function () {
      setTimeout(leave, Math.max(0, least - (Date.now() - t0)));
    };
  }

  function init() {
    mountIcons();
    watchKeyboard();
    watchBars();
    watchPull();
    var splashDone = startSplash();
    if (!location.hash) location.hash = '#/home';

    // 本体は IndexedDB。読み込みが終わってから描画する
    // 自動同期の最中もボタンを回す
    DL.sync.on(function (ev) {
      var b = U.$('.syncbtn:not(.roombtn)');
      if (!b) return;
      b.classList.toggle('busy', ev.phase === 'start');
    });

    S.init().then(function () {
      render();
      splashDone();
      DL.sync.start();
      return S.autoBackupIfDue();
    }).catch(function (e) {
      console.error('読み込みに失敗しました', e);
      S.load();
      render();
      splashDone();
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
