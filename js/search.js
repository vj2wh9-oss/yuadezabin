/* 横断検索：案件・タスク・書類・経費・予定・取引先・ファイルをまとめて探す */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var MAX_PER_KIND = 40;     // 1種類あたりの上限（多すぎると探しづらい）

  /* 種類の並び順と見出し。ここに足せば検索結果にも出る */
  var KINDS = [
    { key: 'project', label: '案件', icon: 'projects' },
    { key: 'task', label: 'タスク', icon: 'task' },
    { key: 'doc', label: '書類', icon: 'invoice' },
    { key: 'item', label: '頒布物', icon: 'books' },
    { key: 'expense', label: '経費', icon: 'books' },
    { key: 'recurring', label: '固定費', icon: 'refresh' },
    { key: 'event', label: '日常の予定', icon: 'calendar' },
    { key: 'client', label: '取引先', icon: 'client' },
    { key: 'file', label: 'ファイル', icon: 'folder' }
  ];

  /**
   * 探すとき用に文字を揃える。
   * 全角と半角、大文字と小文字、カタカナとひらがなを同じものとして扱う
   * （「ｲﾗｽﾄ」「イラスト」「いらすと」がどれでも当たるように）。
   */
  function norm(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.toLowerCase();
    // カタカナ → ひらがな（長音符はそのまま）
    s = s.replace(/[ァ-ヶ]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
    return s.replace(/\s+/g, '');
  }

  /** 打ち込んだ文字を語に分ける。空白で区切ったぶんは全部入っていること（AND） */
  function terms(q) {
    return String(q || '').trim().split(/[\s　]+/).filter(Boolean).map(norm);
  }

  /** haystack（探される側の文字を並べた配列）に、語が全部入っているか */
  function hit(fields, ts) {
    if (!ts.length) return false;
    var hay = norm(fields.filter(Boolean).join(' '));
    for (var i = 0; i < ts.length; i++) if (hay.indexOf(ts[i]) < 0) return false;
    return true;
  }

  /**
   * 検索する。
   * @param {string} q 打ち込んだ文字
   * @param {object} [opts] {files: [{id,name,size}]} ファイルの一覧（あれば混ぜる）
   * @returns {{terms:string[], total:number, groups:Array}}
   */
  function run(q, opts) {
    opts = opts || {};
    var ts = terms(q);
    var out = {};
    KINDS.forEach(function (k) { out[k.key] = []; });
    if (!ts.length) return { terms: ts, total: 0, groups: [] };

    var D = DL.docs, E = DL.expenses;

    /* 案件とタスク、そこにぶら下がる書類 */
    S.projects().forEach(function (p) {
      var client = p.clientId ? S.getClient(p.clientId) : null;
      var kind = ({ event: '即売会', work: 'お仕事', support: '支援サイト' })[p.kind] || '';
      if (hit([p.title, p.client, (client && client.name), p.site, p.plan, p.memo, kind], ts)) {
        out.project.push({
          kind: 'project', id: p.id, title: p.title,
          sub: [kind, p.client || (client && client.name) || ''], note: p.memo,
          date: p.deadline || '', color: p.color,
          href: '#/project/' + p.id,
          dim: p.status === 'archived'
        });
      }
      (p.tasks || []).forEach(function (t) {
        if (!hit([t.name, t.note], ts)) return;
        out.task.push({
          kind: 'task', id: t.id, title: t.name,
          sub: [p.title, t.done ? '完了' : ''], note: t.note,
          date: t.start || '', color: p.color,
          href: '#/project/' + p.id,
          dim: t.done
        });
      });
      (p.docs || []).forEach(function (d) {
        var itemNames = (d.items || []).map(function (i) { return i.name; });
        if (!hit([d.number, d.clientName, d.subject, d.proviso, d.note].concat(itemNames), ts)) return;
        out.doc.push({
          kind: 'doc', id: d.id,
          title: D.TYPE_LABEL[d.type] + (d.number ? '　' + d.number : ''),
          sub: [d.clientName || p.title, D.yen(D.calc(d).payable), D.statusLabel(d)],
          date: d.issueDate || '', icon: D.TYPE_ICON[d.type],
          href: '#/doc/' + p.id + '/' + d.id,
          dim: d.status === 'draft' || d.status === 'declined'
        });
      });
    });

    /* 頒布物（本・グッズ） */
    S.items({ withArchived: true }).forEach(function (x) {
      var p = x.projectId ? S.getProject(x.projectId) : null;
      if (!hit([x.title, x.memo, DL.stock.kindLabel(x.kind), p && (p.eventName || p.title)], ts)) return;
      var sum = DL.stock.summary(x);
      out.item.push({
        kind: 'item', id: x.id, title: x.title,
        sub: [
          DL.stock.kindLabel(x.kind),
          '残' + sum.left + '部',
          x.price ? D.yen(x.price) : '',
          x.archived ? '頒布終了' : ''
        ],
        note: x.memo,
        date: x.releaseDate || '', open: 'item', dim: x.archived
      });
    });

    /* 経費 */
    S.expenses().forEach(function (x) {
      var p = x.projectId ? S.getProject(x.projectId) : null;
      if (!hit([x.vendor, x.memo, x.category, String(x.amount), p && p.title], ts)) return;
      out.expense.push({
        kind: 'expense', id: x.id,
        title: x.vendor || x.category,
        sub: [E.bookLabel(x.book), x.category, D.yen(x.amount)], note: x.memo,
        date: x.date || '', open: 'expense'
      });
    });

    /* 固定費 */
    S.recurring().forEach(function (r) {
      if (!hit([r.name, r.vendor, r.memo, r.category], ts)) return;
      out.recurring.push({
        kind: 'recurring', id: r.id, title: r.name,
        sub: [E.bookLabel(r.book), r.category, D.yen(r.amount), '毎月' + r.day + '日'], note: r.memo,
        date: '', open: 'recurring', dim: !r.active
      });
    });

    /* 日常の予定 */
    S.events().forEach(function (e) {
      if (!hit([e.title, e.memo], ts)) return;
      out.event.push({
        kind: 'event', id: e.id, title: e.title,
        sub: [
          DL.events.timeText(e) || '終日',
          e.repeat ? DL.events.repeatLabel(e.repeat) : '',
          e.important ? '重要' : ''
        ],
        note: e.memo,
        date: e.date || '', color: e.color, open: 'event'
      });
    });

    /* 取引先 */
    S.clients().forEach(function (c) {
      if (!hit([c.name, c.contact, c.address, c.email, c.tel, c.invoiceNo, c.note], ts)) return;
      out.client.push({
        kind: 'client', id: c.id, title: c.name || '(名称未設定)',
        sub: [c.contact], note: c.address, date: '', open: 'client'
      });
    });

    /* ファイル（一覧を渡されたときだけ） */
    (opts.files || []).forEach(function (f) {
      var folder = S.folderPath(S.fileFolder(f.id));
      if (!hit([f.name, folder], ts)) return;
      out.file.push({
        kind: 'file', id: f.id, title: f.name,
        sub: [folder || 'いちばん上', size(f.size)],
        date: (f.uploadedAt || '').slice(0, 10), open: 'file'
      });
    });

    /* 新しいものから。日付が無いものは後ろへ */
    var groups = [];
    var total = 0;
    KINDS.forEach(function (k) {
      var list = out[k.key];
      if (!list.length) return;
      list.sort(function (a, b) { return U.cmp(b.date || '', a.date || '') || U.cmp(a.title, b.title); });
      total += list.length;
      groups.push({ key: k.key, label: k.label, icon: k.icon, count: list.length, items: list.slice(0, MAX_PER_KIND) });
    });
    return { terms: ts, total: total, groups: groups };
  }

  function size(n) {
    n = U.num(n, 0);
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  }

  DL.search = { run: run, norm: norm, terms: terms, hit: hit, KINDS: KINDS };
})(window.DL);
