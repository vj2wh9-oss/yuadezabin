/* データ層：localStorage への保存・読み込みと CRUD */
(function (DL) {
  'use strict';
  var U = DL.util;

  var KEY = 'shimekiri-calendar.v1';
  var PREV_KEY = KEY + '.prev';   // 読み込み前の状態を1世代だけ退避しておく
  var SCHEMA = 1;

  /* ------- 既定のタスクテンプレート ------- */
  // weight は自動スケジュール時の日数配分の重み
  var TEMPLATES = {
    manga: [
      { name: 'プロット', weight: 10, unit: 'none' },
      { name: 'ネーム', weight: 22, unit: 'page' },
      { name: '下書き', weight: 18, unit: 'page' },
      { name: '線画', weight: 26, unit: 'page' },
      { name: '仕上げ', weight: 24, unit: 'page' }
    ],
    illust: [
      { name: 'ラフ', weight: 15, unit: 'cut' },
      { name: '下書き', weight: 15, unit: 'cut' },
      { name: '線画', weight: 20, unit: 'cut' },
      { name: '下塗り', weight: 12, unit: 'cut' },
      { name: '塗り', weight: 25, unit: 'cut' },
      { name: '仕上げ', weight: 13, unit: 'cut' }
    ],
    // デザインは案件ごとに工程が違うため、初期テンプレートは空にしておく
    design: []
  };

  var UNIT_LABEL = { page: 'P', cut: '枚', item: '点', none: '' };

  // 支援サイトのよく使う投稿先
  var SUPPORT_SITES = ['pixivFANBOX', 'Fantia', 'Ci-en', 'Patreon'];

  // 早割プリセット（イベント日から逆算する日数）
  var PRINT_PRESETS = [
    { label: '超早割', days: 35 },
    { label: '早割', days: 28 },
    { label: '通常', days: 14 },
    { label: '割増', days: 7 }
  ];

  var DEFAULT_SETTINGS = {
    offDays: [],           // 作業しない曜日 0=日〜6=土
    holidays: [],          // 作業しない個別日 'YYYY-MM-DD'
    bufferDays: 1,         // 締切の何日前までに終わらせるか
    warnDays: 14,          // 締切が近いと警告する日数
    weekStart: 0,          // 0=日曜はじまり 1=月曜はじまり
    dailyLimit: 0,         // 1日の作業量の上限（0で無効）
    icsAlarm: 'P1D',       // .ics に入れる通知のタイミング
    lastBackupAt: '',      // 最後にバックアップを書き出した日
    issuers: [],           // 屋号（発行元）
    defaultIssuerId: '',   // 既定の屋号
    docSeq: { invoice: 0, receipt: 0 },   // 書類番号の連番
    taxRate: 10,           // 消費税率(%)
    withholdingRate: 10.21,// 源泉徴収税率(%)
    templates: U.clone(TEMPLATES)
  };

  var state = null;
  var listeners = [];

  function defaultState() {
    return { schema: SCHEMA, settings: U.clone(DEFAULT_SETTINGS), projects: [] };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* プライベートモード等 */ }
    if (!raw) { state = defaultState(); return state; }
    try {
      var data = JSON.parse(raw);
      state = migrate(data);
    } catch (e) {
      console.error('データの読み込みに失敗しました', e);
      state = defaultState();
    }
    return state;
  }

  function migrate(data) {
    var s = data || {};
    s.schema = SCHEMA;
    s.settings = Object.assign(U.clone(DEFAULT_SETTINGS), s.settings || {});
    s.settings.templates = Object.assign(U.clone(TEMPLATES), s.settings.templates || {});
    s.projects = (s.projects || []).map(normalizeProject);
    return s;
  }

  function normalizeProject(p) {
    p = p || {};
    p.id = p.id || U.uid();
    p.kind = (p.kind === 'work' || p.kind === 'support') ? p.kind : 'event';
    p.category = (p.category === 'illust' || p.category === 'design') ? p.category : 'manga';
    p.title = p.title || '(無題)';
    p.status = p.status || 'active';
    p.startDate = p.startDate || '';   // 作業開始日（スケジュール算出の起点）
    p.color = p.color || pickColor();
    var oldIdx = OLD_PALETTE.indexOf(p.color);
    if (oldIdx >= 0) p.color = PALETTE[oldIdx];   // 旧配色は青系へ置き換える
    p.tasks = (p.tasks || []).map(normalizeTask);
    p.printings = p.printings || [];
    p.offDays = p.offDays || null;      // null = 全体設定を継承
    p.holidays = p.holidays || [];
    p.memo = p.memo || '';
    p.site = p.site || '';     // 支援サイト名
    p.plan = p.plan || '';     // 支援プラン
    p.docs = (p.docs || []).map(normalizeDoc);   // 請求書・領収書
    p.createdAt = p.createdAt || new Date().toISOString();
    // 作業開始日が未設定の既存データは、一番早いタスクの開始日で補う
    if (!p.startDate) {
      var starts = p.tasks.map(function (t) { return t.start; }).filter(U.isISO).sort();
      if (starts.length) p.startDate = starts[0];
    }
    return p;
  }

  function normalizeTask(t) {
    t = t || {};
    t.id = t.id || U.uid();
    t.name = t.name || 'タスク';
    t.unit = t.unit || 'none';
    t.qty = t.unit === 'none' ? null : U.num(t.qty, 0);
    t.progress = t.progress || {};
    t.planOverride = t.planOverride || {};
    t.done = !!t.done;
    t.note = t.note || '';
    return t;
  }

  function normalizeIssuer(x) {
    x = x || {};
    x.id = x.id || U.uid();
    x.name = x.name || '';
    x.ownerName = x.ownerName || '';
    x.zip = x.zip || '';
    x.address = x.address || '';
    x.tel = x.tel || '';
    x.email = x.email || '';
    x.web = x.web || '';
    x.invoiceNo = x.invoiceNo || '';           // インボイス登録番号
    x.bank = Object.assign({ name: '', branch: '', type: '普通', number: '', holder: '' }, x.bank || {});
    x.logo = x.logo || '';                     // dataURL
    x.seal = x.seal || '';                     // 印影 dataURL
    x.note = x.note || '';
    return x;
  }

  function normalizeDoc(d) {
    d = d || {};
    d.id = d.id || U.uid();
    d.type = d.type === 'receipt' ? 'receipt' : 'invoice';
    d.number = d.number || '';
    d.issuerId = d.issuerId || '';
    d.issueDate = d.issueDate || U.today();
    d.dueDate = d.dueDate || '';
    d.clientName = d.clientName || '';
    d.honorific = d.honorific || '御中';
    d.clientZip = d.clientZip || '';
    d.clientAddress = d.clientAddress || '';
    d.subject = d.subject || '';
    d.items = (d.items || []).map(function (it) {
      return {
        name: (it && it.name) || '',
        qty: U.num(it && it.qty, 1),
        unit: (it && it.unit) || '式',
        price: U.num(it && it.price, 0)
      };
    });
    if (!d.items.length) d.items = [{ name: '', qty: 1, unit: '式', price: 0 }];
    d.taxMode = ['exclusive', 'inclusive', 'none'].indexOf(d.taxMode) >= 0 ? d.taxMode : 'exclusive';
    d.taxRate = U.num(d.taxRate, 10);
    d.withholding = !!d.withholding;
    d.withholdingRate = d.withholdingRate === undefined ? 10.21 : Number(d.withholdingRate);
    d.note = d.note || '';
    d.proviso = d.proviso || '';               // 領収書の但し書き
    d.paymentMethod = d.paymentMethod || '';   // 領収書のお支払方法
    d.status = ['draft', 'issued', 'paid'].indexOf(d.status) >= 0 ? d.status : 'draft';
    d.createdAt = d.createdAt || new Date().toISOString();
    return d;
  }

  /* ---------------- 屋号 ---------------- */

  function issuers() { return state.settings.issuers || []; }

  function getIssuer(id) {
    var list = issuers();
    return list.filter(function (x) { return x.id === id; })[0]
      || list.filter(function (x) { return x.id === state.settings.defaultIssuerId; })[0]
      || list[0] || null;
  }

  function addIssuer(data) {
    var x = normalizeIssuer(Object.assign({ id: U.uid() }, data));
    state.settings.issuers = issuers().concat([x]);
    if (!state.settings.defaultIssuerId) state.settings.defaultIssuerId = x.id;
    save();
    return x;
  }

  function updateIssuer(id, patch) {
    var x = getIssuer(id);
    if (!x) return null;
    Object.assign(x, patch);
    normalizeIssuer(x);
    save();
    return x;
  }

  function removeIssuer(id) {
    state.settings.issuers = issuers().filter(function (x) { return x.id !== id; });
    if (state.settings.defaultIssuerId === id) {
      state.settings.defaultIssuerId = (issuers()[0] || {}).id || '';
    }
    save();
  }

  /* ---------------- 書類（請求書・領収書） ---------------- */

  function docs(pid) {
    var p = getProject(pid);
    return p ? (p.docs || []) : [];
  }

  function getDoc(pid, did) {
    return docs(pid).filter(function (d) { return d.id === did; })[0] || null;
  }

  function addDoc(pid, data) {
    var p = getProject(pid);
    if (!p) return null;
    var d = normalizeDoc(Object.assign({ id: U.uid() }, data));
    p.docs.push(d);
    save();
    return d;
  }

  function updateDoc(pid, did, patch) {
    var d = getDoc(pid, did);
    if (!d) return null;
    Object.assign(d, patch);
    normalizeDoc(d);
    save();
    return d;
  }

  function removeDoc(pid, did) {
    var p = getProject(pid);
    if (!p) return;
    p.docs = (p.docs || []).filter(function (d) { return d.id !== did; });
    save();
  }

  // 書類番号を採番する（種類ごとの年間連番）
  function issueNumber(type) {
    var seq = state.settings.docSeq || (state.settings.docSeq = { invoice: 0, receipt: 0 });
    seq[type] = U.num(seq[type], 0) + 1;
    save();
    return (type === 'receipt' ? 'RCP' : 'INV') + '-' + U.today().slice(0, 4) + '-' +
      String(seq[type]).padStart(4, '0');
  }

  /* 全案件の書類を新しい順に */
  function allDocs() {
    var out = [];
    state.projects.forEach(function (p) {
      (p.docs || []).forEach(function (d) { out.push({ project: p, doc: d }); });
    });
    out.sort(function (a, b) { return U.cmp(b.doc.issueDate, a.doc.issueDate); });
    return out;
  }

  // 案件の識別色（青系で濃淡と色相を少しずつ変えて区別する）
  var PALETTE = ['#3b82f6', '#0ea5e9', '#6172e8', '#12a5b8', '#2563eb', '#0891b2', '#8093f1', '#1e40af'];
  // 旧配色からの読み替え（同じ並び順で対応させる）
  var OLD_PALETTE = ['#ff6b8a', '#5b8cff', '#a06bff', '#26c6a6', '#ffa64d', '#4dc3ff', '#ff7ac4', '#8bd450'];
  function pickColor() {
    var used = (state && state.projects || []).map(function (p) { return p.color; });
    for (var i = 0; i < PALETTE.length; i++) if (used.indexOf(PALETTE[i]) < 0) return PALETTE[i];
    return PALETTE[Math.floor(Math.random() * PALETTE.length)];
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('保存に失敗しました', e);
      DL.ui && DL.ui.toast('保存に失敗しました（ストレージ容量）', 'danger');
    }
    emit();
  }

  function emit() { listeners.forEach(function (f) { f(state); }); }
  function subscribe(fn) { listeners.push(fn); }

  /* ---------------- プロジェクト ---------------- */

  function projects() { return state.projects; }

  function activeProjects() {
    return state.projects.filter(function (p) { return p.status === 'active'; });
  }

  function getProject(id) {
    return state.projects.filter(function (p) { return p.id === id; })[0] || null;
  }

  function createProject(data) {
    var p = normalizeProject(Object.assign({ id: U.uid(), color: pickColor() }, data));
    state.projects.push(p);
    save();
    return p;
  }

  function updateProject(id, patch) {
    var p = getProject(id);
    if (!p) return null;
    Object.assign(p, patch);
    normalizeProject(p);
    save();
    return p;
  }

  function removeProject(id) {
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    save();
  }

  /* ---------------- タスク ---------------- */

  function addTask(pid, data) {
    var p = getProject(pid);
    if (!p) return null;
    var t = normalizeTask(Object.assign({ id: U.uid() }, data));
    p.tasks.push(t);
    save();
    return t;
  }

  function getTask(pid, tid) {
    var p = getProject(pid);
    if (!p) return null;
    return p.tasks.filter(function (t) { return t.id === tid; })[0] || null;
  }

  function updateTask(pid, tid, patch) {
    var t = getTask(pid, tid);
    if (!t) return null;
    Object.assign(t, patch);
    normalizeTask(t);
    save();
    return t;
  }

  function removeTask(pid, tid) {
    var p = getProject(pid);
    if (!p) return;
    p.tasks = p.tasks.filter(function (t) { return t.id !== tid; });
    save();
  }

  function moveTask(pid, tid, dir) {
    var p = getProject(pid);
    if (!p) return;
    var i = p.tasks.findIndex(function (t) { return t.id === tid; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= p.tasks.length) return;
    var tmp = p.tasks[i]; p.tasks[i] = p.tasks[j]; p.tasks[j] = tmp;
    save();
  }

  // 実績の記録（date に qty を設定。0 以下は削除）
  function setProgress(pid, tid, date, qty) {
    var t = getTask(pid, tid);
    if (!t) return;
    if (qty > 0) t.progress[date] = qty;
    else delete t.progress[date];
    save();
  }

  function bumpProgress(pid, tid, date, delta) {
    var t = getTask(pid, tid);
    if (!t) return;
    setProgress(pid, tid, date, Math.max(0, U.num(t.progress[date], 0) + delta));
  }

  // テンプレートからタスクを生成
  function templateTasks(category, qty) {
    var tpl = state.settings.templates[category] || TEMPLATES[category] || [];
    return tpl.map(function (t) {
      return normalizeTask({
        name: t.name, weight: t.weight, unit: t.unit,
        qty: t.unit === 'none' ? null : U.num(qty, 0)
      });
    });
  }

  /* ---------------- 設定 ---------------- */

  function updateSettings(patch) {
    Object.assign(state.settings, patch);
    save();
  }

  /* ---------------- 入出力 ---------------- */

  function exportJSON() {
    state.settings.lastBackupAt = U.today();
    save();
    return JSON.stringify(state, null, 2);
  }

  // 最後にバックアップしてからの日数（一度もなければ null）
  function backupAgeDays() {
    var d = state.settings.lastBackupAt;
    return U.isISO(d) ? U.diffDays(d, U.today()) : null;
  }

  function snapshot() {
    try { localStorage.setItem(PREV_KEY, JSON.stringify(state)); } catch (e) { /* 容量不足なら諦める */ }
  }

  function hasSnapshot() {
    try { return !!localStorage.getItem(PREV_KEY); } catch (e) { return false; }
  }

  // 直前の状態（読み込み・全削除の前）に戻す
  function restoreSnapshot() {
    var raw = null;
    try { raw = localStorage.getItem(PREV_KEY); } catch (e) { /* 読めなければ諦める */ }
    if (!raw) return false;
    var cur = JSON.stringify(state);
    state = migrate(JSON.parse(raw));
    try { localStorage.setItem(PREV_KEY, cur); } catch (e) { /* 戻す操作自体も取り消せるようにする */ }
    save();
    return true;
  }

  /**
   * バックアップの読み込み
   * @param {string} text JSON
   * @param {'replace'|'merge'} mode replace=全置き換え / merge=無い案件だけ追加
   */
  function importJSON(text, mode) {
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data.projects)) throw new Error('形式が違います');
    snapshot();
    if (mode === 'merge') {
      var incoming = migrate(U.clone(data)).projects;
      var have = {};
      state.projects.forEach(function (p) { have[p.id] = true; });
      var added = 0, skipped = 0;
      incoming.forEach(function (p) {
        if (have[p.id]) { skipped++; return; }
        state.projects.push(p); added++;
      });
      save();
      return { mode: 'merge', added: added, skipped: skipped };
    }
    var before = state.projects.length;
    state = migrate(data);
    save();
    return { mode: 'replace', total: state.projects.length, replaced: before };
  }

  function clearAll(keepSnapshot) {
    if (!keepSnapshot) snapshot();
    state = defaultState();
    save();
  }

  /* ---------------- サンプルデータ ---------------- */

  function seedSample() {
    var t = U.today();
    var eventDay = U.addDays(t, 62);
    var printDue = U.addDays(eventDay, -28);

    var ev = createProject({
      kind: 'event', category: 'manga',
      title: '春の新刊（コピー本）',
      eventName: 'サンプル即売会', eventDate: eventDay,
      venue: '東京ビッグサイト', space: 'あ-12b',
      deadline: printDue, startDate: t,
      printings: [
        { id: U.uid(), label: '早割', printer: 'サンプル印刷', due: printDue, copies: 100, note: '30%OFF', primary: true },
        { id: U.uid(), label: '通常', printer: 'サンプル印刷', due: U.addDays(eventDay, -14), copies: 100, note: '', primary: false }
      ],
      qty: 30, memo: '本文30P＋表紙'
    });
    ev.tasks = templateTasks('manga', 30);
    DL.schedule.autoSchedule(ev, { start: t, end: printDue });

    var work = createProject({
      kind: 'work', category: 'illust',
      title: 'カバーイラスト（書籍）',
      client: 'サンプル出版',
      deadline: U.addDays(t, 21), startDate: t,
      qty: 1, fee: 60000, memo: 'ラフ提出は1週間前'
    });
    work.tasks = templateTasks('illust', 1);
    DL.schedule.autoSchedule(work, { start: t, end: U.addDays(t, 21) });

    var support = createProject({
      kind: 'support', category: 'manga',
      title: '支援サイト・今月のおまけ漫画',
      site: 'pixivFANBOX', plan: '500円プラン向け',
      deadline: U.addDays(t, 12), startDate: t,
      qty: 8, memo: '月末までに投稿'
    });
    support.tasks = templateTasks('manga', 8);
    DL.schedule.autoSchedule(support, { start: t, end: U.addDays(t, 12) });

    save();
  }

  /* ブラウザに「このデータは消さないで」と申請する（対応していない環境では何もしない） */
  function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(null);
    return navigator.storage.persisted().then(function (already) {
      return already ? true : navigator.storage.persist();
    }).catch(function () { return null; });
  }

  DL.store = {
    KEY: KEY, TEMPLATES: TEMPLATES, UNIT_LABEL: UNIT_LABEL, PRINT_PRESETS: PRINT_PRESETS,
    SUPPORT_SITES: SUPPORT_SITES,
    PALETTE: PALETTE,
    load: load, save: save, subscribe: subscribe,
    get state() { return state; },
    get settings() { return state.settings; },
    projects: projects, activeProjects: activeProjects, getProject: getProject,
    createProject: createProject, updateProject: updateProject, removeProject: removeProject,
    addTask: addTask, getTask: getTask, updateTask: updateTask, removeTask: removeTask,
    moveTask: moveTask, setProgress: setProgress, bumpProgress: bumpProgress,
    issuers: issuers, getIssuer: getIssuer, addIssuer: addIssuer,
    updateIssuer: updateIssuer, removeIssuer: removeIssuer,
    docs: docs, getDoc: getDoc, addDoc: addDoc, updateDoc: updateDoc, removeDoc: removeDoc,
    issueNumber: issueNumber, allDocs: allDocs,
    templateTasks: templateTasks, updateSettings: updateSettings,
    exportJSON: exportJSON, importJSON: importJSON, clearAll: clearAll, seedSample: seedSample,
    backupAgeDays: backupAgeDays, hasSnapshot: hasSnapshot, restoreSnapshot: restoreSnapshot,
    requestPersistence: requestPersistence,
    pickColor: pickColor
  };
})(window.DL);
