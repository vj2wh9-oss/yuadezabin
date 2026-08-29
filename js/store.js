/* データ層：localStorage への保存・読み込みと CRUD */
(function (DL) {
  'use strict';
  var U = DL.util;

  var KEY = 'shimekiri-calendar.v1';
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
    ]
  };

  var UNIT_LABEL = { page: 'P', cut: '枚', none: '' };

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
    p.kind = p.kind === 'work' ? 'work' : 'event';
    p.category = p.category === 'illust' ? 'illust' : 'manga';
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

  function exportJSON() { return JSON.stringify(state, null, 2); }

  function importJSON(text) {
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data.projects)) throw new Error('形式が違います');
    state = migrate(data);
    save();
  }

  function clearAll() {
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

    save();
  }

  DL.store = {
    KEY: KEY, TEMPLATES: TEMPLATES, UNIT_LABEL: UNIT_LABEL, PRINT_PRESETS: PRINT_PRESETS,
    PALETTE: PALETTE,
    load: load, save: save, subscribe: subscribe,
    get state() { return state; },
    get settings() { return state.settings; },
    projects: projects, activeProjects: activeProjects, getProject: getProject,
    createProject: createProject, updateProject: updateProject, removeProject: removeProject,
    addTask: addTask, getTask: getTask, updateTask: updateTask, removeTask: removeTask,
    moveTask: moveTask, setProgress: setProgress, bumpProgress: bumpProgress,
    templateTasks: templateTasks, updateSettings: updateSettings,
    exportJSON: exportJSON, importJSON: importJSON, clearAll: clearAll, seedSample: seedSample,
    pickColor: pickColor
  };
})(window.DL);
