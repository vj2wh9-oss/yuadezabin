/* データ層：localStorage への保存・読み込みと CRUD */
(function (DL) {
  'use strict';
  var U = DL.util;

  // 本体は IndexedDB（DL.db の kv ストア）に置く。
  // localStorage は IndexedDB が使えない環境のための控えと、旧データからの引き継ぎ元。
  var KEY = 'shimekiri-calendar.v1';
  var PREV_KEY = KEY + '.prev';   // 旧：読み込み前の状態を1世代だけ退避していた場所
  var SCHEMA = 2;

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
    holidays: [],          // 休業日 'YYYY-MM-DD'（カレンダーの日別画面から指定する）
    bufferDays: 1,         // 締切の何日前までに終わらせるか
    warnDays: 14,          // 締切が近いと警告する日数
    weekStart: 0,          // 0=日曜はじまり 1=月曜はじまり
    dailyLimit: 0,         // 1日の作業量の上限（0で無効）
    icsAlarm: 'P1D',       // .ics に入れる通知のタイミング
    lastBackupAt: '',      // 最後にファイルへ書き出した日
    autoBackup: true,      // 端末内への自動バックアップ（1日1回）
    autoBackupKeep: 30,    // 残す世代数
    lastAutoBackupAt: '',  // 最後に自動バックアップした日
    issuers: [],           // 名義（発行元）
    defaultIssuerId: '',   // 既定の名義
    scopeIssuerId: '',     // 表示を絞り込む名義（空＝すべて）
    clients: [],           // 取引先
    folders: [],           // 共有ファイルのフォルダ [{id,name,createdAt}]
    // ファイルとフォルダの対応 { ファイルID: フォルダID }。
    // R2 のメタ情報ではなくここに持つ理由：R2 はメタ情報だけの更新ができないため、
    // フォルダを移すたびにファイルを丸ごと入れ直すことになってしまう。
    fileFolders: {},
    // 支援サイト（pixivFANBOX）の月ごとの支援金 [{ym:'2026-01', amount:12345}]
    fanbox: [],
    sync: {                // 同期サーバーの接続情報（この端末だけのもの）
      url: '', token: '', enabled: false, deviceName: '',
      rev: 0,              // 最後にやりとりした版番号
      baseSavedAt: '',     // 同期した時点の savedAt（以後の変更の有無を見る）
      lastAt: '', lastError: ''
    },
    docSeq: { invoice: {}, receipt: {} },  // 書類番号の連番（年ごと）
    taxRate: 10,           // 消費税率(%)
    withholdingRate: 10.21,// 源泉徴収税率(%)
    templates: U.clone(TEMPLATES)
  };

  /* 端末ごとの設定。同期・読み込み・復元で持ち込まず、この端末のものを守る */
  var LOCAL_SETTING_KEYS = ['sync', 'scopeIssuerId', 'lastBackupAt', 'lastAutoBackupAt'];

  var state = null;
  var listeners = [];

  /* next の中の端末ごとの設定を、prev（いまの端末の値）で上書きする */
  function keepLocal(prev, next) {
    LOCAL_SETTING_KEYS.forEach(function (k) {
      if (prev && prev[k] !== undefined) next[k] = prev[k];
      else delete next[k];
    });
    return next;
  }

  function defaultState() {
    return { schema: SCHEMA, settings: U.clone(DEFAULT_SETTINGS), projects: [] };
  }

  /* localStorage の控えを読む（壊れていれば null） */
  function readLocal() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return null; }   // プライベートモード等
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {
      console.error('控えの読み込みに失敗しました', e);
      return null;
    }
  }

  /* localStorage から読む（IndexedDB が空／使えないときの入口） */
  function load() {
    var data = readLocal();
    state = data ? migrate(data) : defaultState();
    return state;
  }

  /**
   * 起動時の読み込み。
   * 本体は IndexedDB だが、書き込みが間に合わないまま閉じた場合に備えて
   * localStorage の控えと savedAt を比べ、新しいほうを採用する。
   * @returns {Promise} 読み込み後の state
   */
  function init() {
    var local = readLocal();
    return DL.db.get('kv', 'state').then(function (rec) {
      var idb = rec && rec.v ? rec.v : null;

      if (idb && local && U.cmp(String(local.savedAt || ''), String(idb.savedAt || '')) > 0) {
        // 控えのほうが新しい。画像は控えから外れていることがあるので IndexedDB 側で補う
        state = migrate(withImagesFrom(local, idb));
        return writeIDB();
      }
      if (idb) { state = migrate(idb); return null; }

      state = local ? migrate(local) : defaultState();   // 旧データの引き継ぎ／初回
      return writeIDB();
    }).catch(function (e) {
      console.error('読み込みに失敗しました', e);
      load();
    }).then(adoptOldSnapshot).then(function () { return state; });
  }

  /* 控えから復帰するとき、抜けている画像だけ IndexedDB 側から戻す */
  function withImagesFrom(target, source) {
    if (!target.compact || !source) return target;
    var by = {};
    (source.settings && source.settings.issuers || []).forEach(function (x) { by[x.id] = x; });
    (target.settings && target.settings.issuers || []).forEach(function (x) {
      var src = by[x.id];
      if (!src) return;
      if (!x.logo) x.logo = src.logo || '';
      if (!x.seal) x.seal = src.seal || '';
    });
    delete target.compact;
    return target;
  }

  /* 旧 localStorage の1世代スナップショットを、バックアップ世代へ引き取る */
  function adoptOldSnapshot() {
    var raw = null;
    try { raw = localStorage.getItem(PREV_KEY); } catch (e) { return null; }
    if (!raw) return null;
    return DL.db.put('backups', {
      id: U.uid(), at: new Date().toISOString(), kind: 'legacy',
      note: '以前の「直前の状態」', size: raw.length, data: raw
    }).then(function (ok) {
      if (ok) { try { localStorage.removeItem(PREV_KEY); } catch (e) { /* 残っても害はない */ } }
    });
  }

  function migrate(data) {
    var s = data || {};
    s.schema = SCHEMA;
    s.settings = Object.assign(U.clone(DEFAULT_SETTINGS), s.settings || {});
    delete s.settings.offDays;   // 曜日単位の休みは廃止した（古いデータから取り除く）
    s.settings.templates = Object.assign(U.clone(TEMPLATES), s.settings.templates || {});
    s.settings.sync = Object.assign(U.clone(DEFAULT_SETTINGS.sync), s.settings.sync || {});
    s.settings.clients = (s.settings.clients || []).map(normalizeClient);
    s.settings.folders = (s.settings.folders || []).map(normalizeFolder);
    s.settings.fileFolders = s.settings.fileFolders || {};
    s.settings.fanbox = normalizeFanbox(s.settings.fanbox);
    s.settings.docSeq = migrateDocSeq(s.settings.docSeq);
    s.projects = (s.projects || []).map(normalizeProject);
    return s;
  }

  /* 旧形式 {invoice:12} は「今年ぶんの連番」として引き継ぐ（以後は年ごとにリセット） */
  function migrateDocSeq(seq) {
    var out = { invoice: {}, receipt: {} };
    var y = U.today().slice(0, 4);
    ['invoice', 'receipt'].forEach(function (t) {
      var v = seq && seq[t];
      if (typeof v === 'number') { if (v > 0) out[t][y] = v; }
      else if (v && typeof v === 'object') {
        Object.keys(v).forEach(function (k) { out[t][k] = U.num(v[k], 0); });
      }
    });
    return out;
  }

  function normalizeProject(p) {
    p = p || {};
    p.id = p.id || U.uid();
    p.kind = (p.kind === 'work' || p.kind === 'support') ? p.kind : 'event';
    p.category = (p.category === 'illust' || p.category === 'design') ? p.category : 'manga';
    p.title = p.title || '(無題)';
    p.status = p.status || 'active';
    p.issuerId = p.issuerId || '';     // どの名義の仕事か（空＝未割り当て）
    p.clientId = p.clientId || '';     // 登録済みの取引先（空＝client の自由入力のみ）
    p.startDate = p.startDate || '';   // 作業開始日（スケジュール算出の起点）
    p.color = p.color || pickColor();
    var oldIdx = OLD_PALETTE.indexOf(p.color);
    if (oldIdx >= 0) p.color = PALETTE[oldIdx];   // 旧配色は青系へ置き換える
    p.tasks = (p.tasks || []).map(normalizeTask);
    p.printings = p.printings || [];
    delete p.offDays;                   // 曜日単位の休みは廃止した
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
    x.color = x.color || '';                   // 名義の識別色
    x.note = x.note || '';
    return x;
  }

  function normalizeClient(c) {
    c = c || {};
    c.id = c.id || U.uid();
    c.name = c.name || '';
    c.honorific = c.honorific === '様' ? '様' : '御中';
    c.contact = c.contact || '';        // 担当者名
    c.zip = c.zip || '';
    c.address = c.address || '';
    c.tel = c.tel || '';
    c.email = c.email || '';
    c.invoiceNo = c.invoiceNo || '';    // 先方のインボイス登録番号（控え用）
    c.paymentTermDays = U.num(c.paymentTermDays, 0);   // 支払サイト（0＝翌月末）
    c.taxMode = ['exclusive', 'inclusive', 'none'].indexOf(c.taxMode) >= 0 ? c.taxMode : 'exclusive';
    c.withholding = !!c.withholding;    // いつも源泉徴収される取引先か
    c.note = c.note || '';
    c.createdAt = c.createdAt || new Date().toISOString();
    return c;
  }

  function normalizeFolder(f) {
    f = f || {};
    f.id = f.id || U.uid();
    f.name = f.name || '(名称未設定)';
    f.parentId = f.parentId || '';     // 空＝いちばん上。入れ子にできる
    f.fromHint = !!f.fromHint;         // R2 の記録から組み直したものか
    f.createdAt = f.createdAt || new Date().toISOString();
    return f;
  }

  function normalizeDoc(d) {
    d = d || {};
    d.id = d.id || U.uid();
    d.type = d.type === 'receipt' ? 'receipt' : 'invoice';
    d.number = d.number || '';
    d.issuerId = d.issuerId || '';
    d.clientId = d.clientId || '';
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

  /* ---------------- 名義 ---------------- */

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
    if (state.settings.scopeIssuerId === id) state.settings.scopeIssuerId = '';
    // 消した名義を参照していた案件は未割り当てに戻す
    state.projects.forEach(function (p) { if (p.issuerId === id) p.issuerId = ''; });
    save();
  }

  // 名義の識別色（未設定なら並び順から割り当てる）
  function issuerColor(id) {
    var list = issuers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== id) continue;
      return list[i].color || PALETTE[i % PALETTE.length];
    }
    return '';
  }

  /* ---------------- 表示の絞り込み（名義スコープ） ---------------- */

  // 存在しない名義が残っていても「すべて」に落とす
  function scopeId() {
    var id = state.settings.scopeIssuerId || '';
    if (!id) return '';
    return issuers().filter(function (x) { return x.id === id; }).length ? id : '';
  }

  function scopeIssuer() {
    var id = scopeId();
    return id ? issuers().filter(function (x) { return x.id === id; })[0] : null;
  }

  function setScope(id) { updateSettings({ scopeIssuerId: id || '' }); }

  // 名義を割り当てていない案件は、どのスコープでも隠さない（取りこぼし防止）
  function inScope(p) {
    var id = scopeId();
    return !id || !p.issuerId || p.issuerId === id;
  }

  function scopedProjects() { return state.projects.filter(inScope); }

  function unassignedCount() {
    return state.projects.filter(function (p) { return !p.issuerId && p.status !== 'archived'; }).length;
  }

  /* ---------------- 取引先 ---------------- */

  function clients() { return state.settings.clients || []; }

  function getClient(id) {
    return clients().filter(function (c) { return c.id === id; })[0] || null;
  }

  function addClient(data) {
    var c = normalizeClient(Object.assign({ id: U.uid() }, data));
    state.settings.clients = clients().concat([c]);
    save();
    return c;
  }

  function updateClient(id, patch) {
    var c = getClient(id);
    if (!c) return null;
    Object.assign(c, patch);
    normalizeClient(c);
    save();
    return c;
  }

  function removeClient(id) {
    state.settings.clients = clients().filter(function (c) { return c.id !== id; });
    // 参照していた案件・書類は、名前を残したまま紐付けだけ外す
    state.projects.forEach(function (p) {
      if (p.clientId !== id) return;
      p.clientId = '';
      (p.docs || []).forEach(function (d) { if (d.clientId === id) d.clientId = ''; });
    });
    save();
  }

  /* 取引先ごとの案件と書類（一覧・集計用） */
  function clientProjects(id) {
    return state.projects.filter(function (p) { return p.clientId === id; });
  }

  function clientDocs(id) {
    var out = [];
    state.projects.forEach(function (p) {
      (p.docs || []).forEach(function (d) {
        if (d.clientId === id || (!d.clientId && p.clientId === id)) out.push({ project: p, doc: d });
      });
    });
    out.sort(function (a, b) { return U.cmp(b.doc.issueDate, a.doc.issueDate); });
    return out;
  }

  /* ---------------- 共有ファイルのフォルダ ---------------- */

  function folders() { return state.settings.folders || []; }

  function getFolder(id) {
    return folders().filter(function (f) { return f.id === id; })[0] || null;
  }

  /** 直下のフォルダだけを返す。parentId が空ならいちばん上の階層 */
  function folderChildren(parentId) {
    parentId = parentId || '';
    return folders().filter(function (f) { return (f.parentId || '') === parentId; });
  }

  /** @param {boolean} [quiet] R2 の記録から組み直すときは保存日時を動かさない */
  function addFolder(name, parentId, quiet) {
    var f = normalizeFolder({
      id: U.uid(),
      name: String(name || '').trim() || '新しいフォルダ',
      parentId: parentId || '',
      fromHint: !!quiet     // 自分で作ったのではなく R2 の記録から復元したもの
    });
    state.settings.folders = folders().concat([f]);
    save(quiet ? { quiet: true } : null);
    return f;
  }

  function renameFolder(id, name) {
    var f = getFolder(id);
    if (!f) return null;
    f.name = String(name || '').trim() || f.name;
    f.fromHint = false;      // 自分で手を入れたので、もう組み直しの産物ではない
    save();
    return f;
  }

  /**
   * いちばん上からのパス。'資料/ラフ' のような形にする。
   * この文字列を R2 にも持たせて、まだ同期していない端末でも置き場所が分かるようにする。
   */
  function folderPath(id) {
    var parts = [], seen = {}, f = getFolder(id);
    while (f && !seen[f.id]) {           // 万一輪になっていても止まるようにする
      seen[f.id] = true;
      parts.unshift(f.name);
      f = f.parentId ? getFolder(f.parentId) : null;
    }
    return parts.join('/');
  }

  /** パス文字列をたどってフォルダIDを返す。途中に無いものは作る */
  function ensureFolderPath(path, quiet) {
    var parent = '';
    String(path || '').split('/').forEach(function (name) {
      name = name.trim();
      if (!name) return;
      var hit = folderChildren(parent).filter(function (f) { return f.name === name; })[0];
      parent = hit ? hit.id : addFolder(name, parent, quiet).id;
    });
    return parent;
  }

  /** そのフォルダと、その下にあるフォルダすべてのID */
  function folderTreeIds(id) {
    var out = [id];
    folderChildren(id).forEach(function (c) { out = out.concat(folderTreeIds(c.id)); });
    return out;
  }

  /**
   * フォルダを消す。中のファイルの扱いは呼び出し側が決める。
   * ここではフォルダ（下の階層も含む）と対応表だけを片づける（ファイルの実体は触らない）。
   */
  function removeFolder(id) {
    var gone = {};
    folderTreeIds(id).forEach(function (x) { gone[x] = true; });
    state.settings.folders = folders().filter(function (f) { return !gone[f.id]; });
    var map = state.settings.fileFolders || {};
    // 消すのではなく「いちばん上」にする。消すと R2 側の記録から元に戻ってしまう
    Object.keys(map).forEach(function (fid) { if (gone[map[fid]]) map[fid] = ''; });
    save();
  }

  function fileFolder(fileId) { return (state.settings.fileFolders || {})[fileId] || ''; }

  /** そのファイルの置き場所を、この端末が知っているか */
  function knowsFileFolder(fileId) {
    return Object.prototype.hasOwnProperty.call(state.settings.fileFolders || {}, fileId);
  }

  function setFileFolder(fileId, folderId) {
    var map = state.settings.fileFolders || (state.settings.fileFolders = {});
    // いちばん上に置いた、という指定も憶えておく。
    // 消してしまうと「まだ知らない」と区別が付かず、R2 側の記録で戻されてしまう
    map[fileId] = folderId || '';
    var f = folderId ? getFolder(folderId) : null;
    if (f) f.fromHint = false;   // 自分でここへ入れたのだから、もう仮のフォルダではない
    save();
  }

  /**
   * まだ置き場所を知らないファイルを、R2 に記録されたフォルダのパスから割り当てる。
   * 片方の端末で入れたフォルダが、もう片方ではいちばん上に出てしまうのを防ぐ。
   * @param {Array} files list() が返した files（f.folder にパスが入っている）
   * @returns {number} 割り当てた件数
   */
  function applyFolderHints(files) {
    var n = 0;
    (files || []).forEach(function (f) {
      if (!f || !f.id || knowsFileFolder(f.id)) return;
      var map = state.settings.fileFolders || (state.settings.fileFolders = {});
      map[f.id] = f.folder ? ensureFolderPath(f.folder, true) : '';
      n++;
    });
    // R2 から組み直しただけなので保存日時は動かさない。
    // 動かすと、まだ空の端末が「変更あり」に見えて衝突してしまう
    if (n) save({ quiet: true });
    return n;
  }

  /* 消えたファイルの対応が溜まらないよう掃除する */
  function pruneFileFolders(existingIds) {
    var have = {};
    existingIds.forEach(function (id) { have[id] = true; });
    var map = state.settings.fileFolders || {};
    var removed = 0;
    Object.keys(map).forEach(function (fid) { if (!have[fid]) { delete map[fid]; removed++; } });
    if (removed) save({ quiet: true });
    return removed;
  }

  /* ---------------- 支援サイトの月ごとの支援金 ---------------- */

  /** 年月の重複をまとめ、古い順に並べ直す */
  function normalizeFanbox(list) {
    var byYm = {};
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (!r || !/^\d{4}-\d{2}$/.test(String(r.ym))) return;
      byYm[r.ym] = {
        ym: r.ym,
        amount: Math.max(0, Math.round(U.num(r.amount, 0))),
        updatedAt: r.updatedAt || new Date().toISOString()
      };
    });
    return Object.keys(byYm).sort().map(function (k) { return byYm[k]; });
  }

  function fanbox(year) {
    var list = state.settings.fanbox || [];
    if (!year) return list.slice();
    return list.filter(function (r) { return r.ym.slice(0, 4) === String(year); });
  }

  function fanboxOf(ym) {
    return (state.settings.fanbox || []).filter(function (r) { return r.ym === ym; })[0] || null;
  }

  /**
   * 月ごとの支援金を入れる。
   * @param {Array} rows [{ym, amount}]
   * @param {object} [opts] {overwrite} すでに入っている年月をどうするか。
   *   既定では触らない（同じ表を続けて貼っても二重に増えない）。
   *   overwrite:true のときだけ金額を入れ直す。
   * @returns {{added:number, updated:number, skipped:number}}
   */
  function putFanbox(rows, opts) {
    opts = opts || {};
    var cur = state.settings.fanbox || (state.settings.fanbox = []);
    var have = {};
    cur.forEach(function (r) { have[r.ym] = r; });
    var out = { added: 0, updated: 0, skipped: 0 };
    (rows || []).forEach(function (r) {
      if (!r || !/^\d{4}-\d{2}$/.test(String(r.ym))) return;
      var amount = Math.max(0, Math.round(U.num(r.amount, 0)));
      if (have[r.ym]) {
        if (!opts.overwrite) { out.skipped++; return; }
        if (have[r.ym].amount === amount) { out.skipped++; return; }
        have[r.ym].amount = amount;
        have[r.ym].updatedAt = new Date().toISOString();
        out.updated++;
      } else {
        var add = { ym: r.ym, amount: amount, updatedAt: new Date().toISOString() };
        cur.push(add); have[r.ym] = add; out.added++;
      }
    });
    state.settings.fanbox = normalizeFanbox(cur);
    if (out.added || out.updated) save();
    return out;
  }

  function removeFanbox(ym) {
    state.settings.fanbox = (state.settings.fanbox || []).filter(function (r) { return r.ym !== ym; });
    save();
  }

  function clearFanbox() {
    state.settings.fanbox = [];
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

  var NUM_PREFIX = { invoice: 'INV', receipt: 'RCP' };

  /**
   * 書類番号を採番する。連番は「種類 × 発行年」ごとで、年が変わると 0001 に戻る。
   * バックアップの読み込み後などに番号が重複しないよう、実在する番号の最大値も見る。
   * @param {'invoice'|'receipt'} type
   * @param {string} [dateISO] 発行日。省略時は今日
   */
  function issueNumber(type, dateISO) {
    var year = (U.isISO(dateISO) ? dateISO : U.today()).slice(0, 4);
    if (!state.settings.docSeq) state.settings.docSeq = { invoice: {}, receipt: {} };
    var seq = state.settings.docSeq[type] || (state.settings.docSeq[type] = {});
    var next = Math.max(U.num(seq[year], 0), highestNumber(type, year)) + 1;
    seq[year] = next;
    save();
    return NUM_PREFIX[type] + '-' + year + '-' + String(next).padStart(4, '0');
  }

  /* すでに使われている番号のうち、その種類・その年の最大の連番 */
  function highestNumber(type, year) {
    var re = new RegExp('^' + NUM_PREFIX[type] + '-' + year + '-(\\d+)$');
    var max = 0;
    state.projects.forEach(function (p) {
      (p.docs || []).forEach(function (d) {
        var m = re.exec(d.number || '');
        if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
      });
    });
    return max;
  }

  /* 次に振られる番号のプレビュー（採番はしない） */
  function peekNumber(type, dateISO) {
    var year = (U.isISO(dateISO) ? dateISO : U.today()).slice(0, 4);
    var seq = (state.settings.docSeq || {})[type] || {};
    var next = Math.max(U.num(seq[year], 0), highestNumber(type, year)) + 1;
    return NUM_PREFIX[type] + '-' + year + '-' + String(next).padStart(4, '0');
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

  /* ---------------- 保存 ---------------- */

  var idbTimer = null;
  var mirrorWarned = false;

  /**
   * 保存する。
   * @param {object} [opts]
   * @param {boolean} [opts.quiet] savedAt を進めない。
   *   同期の版番号など「中身ではない情報」を書くときに使う。これを進めてしまうと、
   *   同期した直後の端末が「変更あり」に見えて、毎回ぶつかったことになってしまう。
   */
  function save(opts) {
    if (!opts || !opts.quiet) state.savedAt = new Date().toISOString();
    writeMirror();
    scheduleIDB();
    emit();
  }

  /**
   * localStorage 側の控え。IndexedDB が使えない環境ではこれが本体になる。
   * 5MB に収まらないときは、画像（ロゴ・印影）を落として最低限を残す。
   */
  function writeMirror() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return;
    } catch (e) { /* 容量超過 → 画像を抜いて再挑戦 */ }
    try {
      localStorage.setItem(KEY, JSON.stringify(compact(state)));
    } catch (e2) {
      // IndexedDB が生きていれば控えが無くても困らないので、うるさく言わない
      if (!mirrorWarned) {
        mirrorWarned = true;
        DL.db.usable().then(function (ok) {
          if (!ok && DL.ui) DL.ui.toast('保存に失敗しました（ストレージ容量）', 'danger');
        });
      }
    }
  }

  function compact(s) {
    var c = U.clone(s);
    (c.settings.issuers || []).forEach(function (x) { x.logo = ''; x.seal = ''; });
    c.compact = true;
    return c;
  }

  /* 書き込みが連続しても IndexedDB へは1回にまとめる */
  function scheduleIDB() {
    if (idbTimer) clearTimeout(idbTimer);
    idbTimer = setTimeout(function () { idbTimer = null; writeIDB(); }, 200);
  }

  function writeIDB() {
    return DL.db.put('kv', { k: 'state', v: state });
  }

  /* 画面を離れる直前に確実に書き切る */
  function flush() {
    if (idbTimer) { clearTimeout(idbTimer); idbTimer = null; }
    return writeIDB();
  }

  function emit() { listeners.forEach(function (f) { f(state); }); }
  function subscribe(fn) { listeners.push(fn); }

  /* ---------------- プロジェクト ---------------- */

  function projects() { return state.projects; }

  function activeProjects() {
    return state.projects.filter(function (p) { return p.status === 'active' && inScope(p); });
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

  /* ---------------- 端末内のバックアップ世代（IndexedDB） ---------------- */

  var KIND_LABEL = {
    auto: '自動', manual: '手動', 'before-import': '読み込み前',
    'before-clear': '全削除前', 'before-restore': '復元前', legacy: '以前の状態'
  };

  /**
   * 今の状態を1世代として残す。
   * @param {string} kind auto / manual / before-import / before-clear / before-restore
   * @param {string} [note]
   */
  function makeBackup(kind, note) {
    var json = JSON.stringify(state);
    var rec = {
      id: U.uid(), at: new Date().toISOString(), kind: kind || 'manual',
      note: note || '', size: json.length,
      projects: state.projects.length, data: json
    };
    return DL.db.put('backups', rec).then(function (ok) {
      if (!ok) return null;
      return pruneBackups().then(function () { return rec; });
    });
  }

  /* 新しい順の世代一覧（本文は落として返す） */
  function listBackups() {
    return DL.db.all('backups').then(function (list) {
      return list.map(function (b) {
        return { id: b.id, at: b.at, kind: b.kind, note: b.note, size: b.size, projects: b.projects };
      }).sort(function (a, b) { return U.cmp(b.at, a.at); });
    });
  }

  /* 古い自動バックアップから消す。手動・操作前のものは残す */
  function pruneBackups(keep) {
    keep = U.num(keep || state.settings.autoBackupKeep, 30);
    if (keep <= 0) return Promise.resolve(0);
    return listBackups().then(function (list) {
      var autos = list.filter(function (b) { return b.kind === 'auto'; });
      var over = autos.slice(keep);
      return Promise.all(over.map(function (b) { return DL.db.del('backups', b.id); }))
        .then(function () { return over.length; });
    });
  }

  function removeBackup(id) { return DL.db.del('backups', id); }

  /* 世代から復元する。復元前の状態も1世代として残す */
  function restoreBackup(id) {
    return DL.db.get('backups', id).then(function (rec) {
      if (!rec || !rec.data) return false;
      return makeBackup('before-restore', '復元する前の状態').then(function () {
        var mine = state.settings;
        state = migrate(JSON.parse(rec.data));
        keepLocal(mine, state.settings);   // 古い控えの合鍵で上書きしない
        save();
        return true;
      });
    }).catch(function () { return false; });
  }

  /* 1日1回の自動バックアップ。既に今日ぶんがあれば何もしない */
  function autoBackupIfDue() {
    if (!state.settings.autoBackup) return Promise.resolve(null);
    if (!state.projects.length) return Promise.resolve(null);
    var today = U.today();
    if (state.settings.lastAutoBackupAt === today) return Promise.resolve(null);
    return makeBackup('auto', '毎日の自動バックアップ').then(function (rec) {
      if (!rec) return null;
      state.settings.lastAutoBackupAt = today;
      save();
      return rec;
    });
  }

  /* 直前の状態に戻す（いちばん新しい世代へ） */
  function restoreLatest() {
    return listBackups().then(function (list) {
      if (!list.length) return false;
      return restoreBackup(list[0].id);
    });
  }

  /**
   * ファイルの中身を、読み込まずに確かめる。どちらの端末が新しいかの判断に使う。
   * @param {string} text JSON
   */
  function inspectBackup(text) {
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data.projects)) throw new Error('形式が違います');
    var s = data.settings || {};
    return {
      savedAt: data.savedAt || '',
      projects: data.projects.length,
      issuers: (s.issuers || []).length,
      clients: (s.clients || []).length,
      docs: data.projects.reduce(function (n, p) { return n + ((p.docs || []).length); }, 0),
      // この端末より新しいか（savedAt が無い古いファイルは判定しない）
      newer: data.savedAt && state.savedAt ? U.cmp(data.savedAt, state.savedAt) > 0 : null
    };
  }

  /* id をキーに、いま無いものだけ足す */
  function mergeById(current, incoming) {
    var have = {};
    current.forEach(function (x) { have[x.id] = true; });
    var added = 0;
    incoming.forEach(function (x) {
      if (have[x.id]) return;
      current.push(x); added++;
    });
    return added;
  }

  /**
   * バックアップの読み込み
   * @param {string} text JSON
   * @param {'replace'|'merge'} mode replace=全置き換え / merge=いま無いものだけ追加
   */
  function importJSON(text, mode) {
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data.projects)) throw new Error('形式が違います');
    makeBackup('before-import', '読み込む前の状態');

    if (mode === 'merge') {
      var incoming = migrate(U.clone(data));
      var r = {
        mode: 'merge',
        added: 0, skipped: 0,
        issuers: mergeById(state.settings.issuers, incoming.settings.issuers || []),
        clients: mergeById(state.settings.clients, incoming.settings.clients || []),
        folders: mergeById(state.settings.folders, incoming.settings.folders || [])
      };
      // ファイルとフォルダの対応は、こちらに無いものだけ足す
      var mine = state.settings.fileFolders || (state.settings.fileFolders = {});
      Object.keys(incoming.settings.fileFolders || {}).forEach(function (fid) {
        if (!mine[fid]) mine[fid] = incoming.settings.fileFolders[fid];
      });
      // 支援金も、こちらに無い年月だけ足す（既にある月の金額は書き換えない）
      var haveYm = {};
      (state.settings.fanbox || []).forEach(function (x) { haveYm[x.ym] = true; });
      r.fanbox = 0;
      (incoming.settings.fanbox || []).forEach(function (x) {
        if (haveYm[x.ym]) return;
        state.settings.fanbox.push(x); r.fanbox++;
      });
      state.settings.fanbox = normalizeFanbox(state.settings.fanbox);
      var have = {};
      state.projects.forEach(function (p) { have[p.id] = true; });
      incoming.projects.forEach(function (p) {
        if (have[p.id]) { r.skipped++; return; }
        state.projects.push(p); r.added++;
      });
      // 書類番号の連番は、両方の大きいほうを採用して重複を防ぐ
      ['invoice', 'receipt'].forEach(function (t) {
        var from = (incoming.settings.docSeq || {})[t] || {};
        var to = state.settings.docSeq[t] || (state.settings.docSeq[t] = {});
        Object.keys(from).forEach(function (y) {
          to[y] = Math.max(U.num(to[y], 0), U.num(from[y], 0));
        });
      });
      save();
      return r;
    }

    var before = state.projects.length;
    var mine = state.settings;
    state = migrate(data);
    keepLocal(mine, state.settings);      // 同期の合鍵などはこの端末のものを残す
    save();
    return { mode: 'replace', total: state.projects.length, replaced: before };
  }

  /**
   * すべて削除する。
   * 接続先と合鍵は残すが同期は止める（空の状態をサーバーへ押し出さないため）。
   */
  function clearAll(skipBackup) {
    if (!skipBackup) makeBackup('before-clear', '全削除する前の状態');
    var sync = state && state.settings ? state.settings.sync : null;
    state = defaultState();
    if (sync) {
      state.settings.sync = Object.assign({}, sync, {
        enabled: false, rev: 0, baseSavedAt: '', lastAt: '', lastError: ''
      });
    }
    save();
  }

  /* ---------------- 同期 ---------------- */

  /* サーバーへ送る中身。端末ごとの設定は外す */
  function syncPayload() {
    var s = U.clone(state);
    LOCAL_SETTING_KEYS.forEach(function (k) { delete s.settings[k]; });
    return s;
  }

  /* サーバーの内容で置き換える（端末ごとの設定は残す） */
  function applyRemote(remote) {
    var mine = state.settings;
    state = migrate(U.clone(remote));
    keepLocal(mine, state.settings);
    save();
    return state;
  }

  /* サーバーの内容を、いま無いものだけ足す形で取り込む */
  function mergeRemote(remote) {
    return importJSON(JSON.stringify(remote), 'merge');
  }

  function syncSettings() { return state.settings.sync; }

  function updateSync(patch) {
    Object.assign(state.settings.sync, patch);
    save({ quiet: true });      // 同期の記録で「変更あり」にしない
    return state.settings.sync;
  }

  /**
   * まだ何も入っていない端末か（失うものが無いので、サーバーの内容をそのまま受け取れる）。
   * 数え忘れると、そこだけ送られず・黙って消えることになるので、
   * 同期の対象になるものはすべて見る。
   */
  function isEmpty() {
    var s = state.settings;
    // R2 の記録から組み直したフォルダと割り当ては数に入れない。
    // いつでも組み直せるので、これだけを理由に「中身がある」と見なすと、
    // まだ空の端末が受け取る前に押し付ける側になってしまう
    var mine = (s.folders || []).filter(function (f) { return !f.fromHint; });
    var placed = Object.keys(s.fileFolders || {}).filter(function (fid) {
      var id = s.fileFolders[fid];
      return id && !((getFolder(id) || {}).fromHint);
    });
    return !state.projects.length
      && !issuers().length
      && !clients().length
      && !mine.length
      && !placed.length
      && !(s.fanbox || []).length;
  }

  /* 最後に同期してから、この端末で変更があったか */
  function changedSinceSync() {
    if (isEmpty()) return false;
    var sy = state.settings.sync;
    if (!sy.baseSavedAt) return true;      // 一度も同期していない＆中身がある
    return String(state.savedAt || '') !== sy.baseSavedAt;
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
    SUPPORT_SITES: SUPPORT_SITES, BACKUP_KIND_LABEL: KIND_LABEL,
    PALETTE: PALETTE,
    load: load, init: init, save: save, flush: flush, subscribe: subscribe,
    get state() { return state; },
    get settings() { return state.settings; },
    projects: projects, activeProjects: activeProjects, getProject: getProject,
    createProject: createProject, updateProject: updateProject, removeProject: removeProject,
    addTask: addTask, getTask: getTask, updateTask: updateTask, removeTask: removeTask,
    moveTask: moveTask, setProgress: setProgress, bumpProgress: bumpProgress,
    issuers: issuers, getIssuer: getIssuer, addIssuer: addIssuer,
    updateIssuer: updateIssuer, removeIssuer: removeIssuer, issuerColor: issuerColor,
    scopeId: scopeId, scopeIssuer: scopeIssuer, setScope: setScope,
    inScope: inScope, scopedProjects: scopedProjects, unassignedCount: unassignedCount,
    clients: clients, getClient: getClient, addClient: addClient,
    updateClient: updateClient, removeClient: removeClient,
    clientProjects: clientProjects, clientDocs: clientDocs,
    folders: folders, getFolder: getFolder, addFolder: addFolder,
    folderChildren: folderChildren, folderPath: folderPath,
    ensureFolderPath: ensureFolderPath, folderTreeIds: folderTreeIds,
    renameFolder: renameFolder, removeFolder: removeFolder,
    fanbox: fanbox, fanboxOf: fanboxOf, putFanbox: putFanbox,
    removeFanbox: removeFanbox, clearFanbox: clearFanbox,
    fileFolder: fileFolder, setFileFolder: setFileFolder, pruneFileFolders: pruneFileFolders,
    knowsFileFolder: knowsFileFolder, applyFolderHints: applyFolderHints,
    docs: docs, getDoc: getDoc, addDoc: addDoc, updateDoc: updateDoc, removeDoc: removeDoc,
    issueNumber: issueNumber, peekNumber: peekNumber, allDocs: allDocs,
    templateTasks: templateTasks, updateSettings: updateSettings,
    exportJSON: exportJSON, importJSON: importJSON, inspectBackup: inspectBackup,
    clearAll: clearAll, seedSample: seedSample,
    backupAgeDays: backupAgeDays,
    makeBackup: makeBackup, listBackups: listBackups, restoreBackup: restoreBackup,
    removeBackup: removeBackup, pruneBackups: pruneBackups, restoreLatest: restoreLatest,
    autoBackupIfDue: autoBackupIfDue,
    syncPayload: syncPayload, applyRemote: applyRemote, mergeRemote: mergeRemote,
    syncSettings: syncSettings, updateSync: updateSync,
    changedSinceSync: changedSinceSync, isEmpty: isEmpty,
    requestPersistence: requestPersistence,
    pickColor: pickColor
  };
})(window.DL);
