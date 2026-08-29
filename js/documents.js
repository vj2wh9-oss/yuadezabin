/* 請求書・領収書：金額の計算と、印刷できる書面の組み立て */
(function (DL) {
  'use strict';
  var U = DL.util, el = U.el;

  var TYPE_LABEL = { invoice: '請求書', receipt: '領収書' };
  var TYPE_ICON = { invoice: 'invoice', receipt: 'receipt' };
  var STATUS_LABEL = { draft: '下書き', issued: '発行済み', paid: '入金済み' };
  var TAX_MODE_LABEL = { exclusive: '税抜', inclusive: '税込', none: '非課税' };
  var HONORIFICS = ['御中', '様'];
  var UNITS = ['式', '点', '枚', 'ページ', '時間', '件', '本'];
  var PAYMENT_METHODS = ['銀行振込', '現金', 'クレジットカード', 'その他'];

  function yen(n) {
    return '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');
  }

  /**
   * 金額の計算。
   * 消費税・源泉徴収とも円未満は切り捨て（実務でよく使われる扱い）。
   */
  function calc(doc) {
    var items = (doc.items || []).map(function (it) {
      var amount = U.num(it.qty, 0) * U.num(it.price, 0);
      return { name: it.name, qty: U.num(it.qty, 0), unit: it.unit, price: U.num(it.price, 0), amount: amount };
    });
    var gross = U.sum(items, function (i) { return i.amount; });
    var rate = Number(doc.taxRate) || 0;

    var subtotal, tax;
    if (doc.taxMode === 'none') {
      subtotal = gross; tax = 0;
    } else if (doc.taxMode === 'inclusive') {
      // 入力額が税込。内税を割り戻す
      tax = Math.floor(gross * rate / (100 + rate));
      subtotal = gross - tax;
    } else {
      subtotal = gross;
      tax = Math.floor(gross * rate / 100);
    }
    var total = subtotal + tax;

    // 源泉徴収は税抜額に対して計算する
    var wRate = Number(doc.withholdingRate) || 0;
    var withholding = doc.withholding ? Math.floor(subtotal * wRate / 100) : 0;

    return {
      items: items, subtotal: subtotal, tax: tax, total: total,
      withholding: withholding, payable: total - withholding, rate: rate
    };
  }

  /**
   * 支払期限の既定値。
   * 取引先に支払サイト（日数）があればその日数後、無ければ翌月末。
   */
  function defaultDueDate(issueDate, client) {
    var base = U.isISO(issueDate) ? issueDate : U.today();
    var days = U.num(client && client.paymentTermDays, 0);
    if (days > 0) return U.addDays(base, days);
    var d = U.parse(base);
    return U.toISO(new Date(d.getFullYear(), d.getMonth() + 2, 0));   // 翌月の末日
  }

  /* 新しい書類のひな形。案件と取引先の情報から埋められるところを埋める */
  function blank(type, project, issuerId) {
    var s = DL.store.settings;
    var fee = U.num(project && project.fee, 0);
    var client = project && project.clientId ? DL.store.getClient(project.clientId) : null;
    var today = U.today();
    return {
      type: type,
      issuerId: issuerId || s.defaultIssuerId || '',
      clientId: (client && client.id) || '',
      issueDate: today,
      dueDate: type === 'invoice' ? defaultDueDate(today, client) : '',
      clientName: (client && client.name) || (project && project.client) || '',
      honorific: (client && client.honorific) || '御中',
      clientZip: (client && client.zip) || '',
      clientAddress: (client && client.address) || '',
      subject: (project && project.title) || '',
      items: [{ name: (project && project.title) || '', qty: 1, unit: '式', price: fee }],
      taxMode: (client && client.taxMode) || 'exclusive',
      taxRate: U.num(s.taxRate, 10),
      withholding: !!(client && client.withholding),
      withholdingRate: Number(s.withholdingRate) || 10.21,
      proviso: type === 'receipt' ? ((project && project.title) || '') + 'の制作費として' : '',
      paymentMethod: type === 'receipt' ? '銀行振込' : '',
      status: 'draft'
    };
  }

  /* 取引先の登録内容を書類へ反映する（宛名・住所・税・源泉・支払期限） */
  function applyClient(doc, client) {
    if (!client) return doc;
    doc.clientId = client.id;
    doc.clientName = client.name;
    doc.honorific = client.honorific || '御中';
    doc.clientZip = client.zip || '';
    doc.clientAddress = client.address || '';
    doc.taxMode = client.taxMode || doc.taxMode;
    doc.withholding = !!client.withholding;
    if (doc.type === 'invoice') doc.dueDate = defaultDueDate(doc.issueDate, client);
    return doc;
  }

  /* 領収書を請求書から起こす */
  function fromInvoice(inv, project) {
    var d = U.clone(inv);
    delete d.id;
    d.type = 'receipt';
    d.number = '';
    d.issueDate = U.today();
    d.dueDate = '';
    d.status = 'draft';
    d.proviso = (inv.subject || (project && project.title) || '') + 'の制作費として';
    d.paymentMethod = '銀行振込';
    return d;
  }

  /* ---------------- 書面の組み立て ---------------- */

  function row(k, v) {
    return el('tr', {}, [el('th', { text: k }), el('td', { text: v })]);
  }

  /**
   * A4 の書面を組み立てる（画面のプレビューと印刷で同じものを使う）
   */
  function sheet(doc, project, issuer) {
    var c = calc(doc);
    var isInvoice = doc.type === 'invoice';
    var wrap = el('div', { class: 'doc-sheet' });

    /* 見出し */
    wrap.appendChild(el('div', { class: 'ds-head' }, [
      el('h1', { class: 'ds-title', text: TYPE_LABEL[doc.type] }),
      el('div', { class: 'ds-meta' }, [
        doc.number ? el('div', { text: 'No. ' + doc.number }) : null,
        el('div', { text: '発行日　' + U.fmtYMD(doc.issueDate) }),
        isInvoice && U.isISO(doc.dueDate) ? el('div', { text: 'お支払期限　' + U.fmtYMD(doc.dueDate) }) : null
      ])
    ]));

    /* 宛先と発行元 */
    var to = el('div', { class: 'ds-to' }, [
      el('div', { class: 'ds-client' }, [
        el('span', { class: 'ds-client-name', text: doc.clientName || '（宛名未入力）' }),
        el('span', { class: 'ds-honorific', text: ' ' + (doc.honorific || '') })
      ]),
      doc.clientZip ? el('div', { class: 'ds-small', text: '〒' + doc.clientZip }) : null,
      doc.clientAddress ? el('div', { class: 'ds-small', text: doc.clientAddress }) : null
    ]);

    var from = el('div', { class: 'ds-from' }, issuer ? [
      issuer.logo ? el('img', { class: 'ds-logo', src: issuer.logo, alt: '' }) : null,
      el('div', { class: 'ds-issuer-name', text: issuer.name || '（屋号未設定）' }),
      issuer.ownerName ? el('div', { class: 'ds-small', text: issuer.ownerName }) : null,
      issuer.zip ? el('div', { class: 'ds-small', text: '〒' + issuer.zip }) : null,
      issuer.address ? el('div', { class: 'ds-small', text: issuer.address }) : null,
      issuer.tel ? el('div', { class: 'ds-small', text: 'TEL ' + issuer.tel }) : null,
      issuer.email ? el('div', { class: 'ds-small', text: issuer.email }) : null,
      issuer.invoiceNo ? el('div', { class: 'ds-small', text: '登録番号 ' + issuer.invoiceNo }) : null,
      issuer.seal ? el('img', { class: 'ds-seal', src: issuer.seal, alt: '' }) : null
    ] : [el('div', { class: 'ds-small', text: '屋号が未設定です（設定 → 屋号 で登録できます）' })]);

    wrap.appendChild(el('div', { class: 'ds-parties' }, [to, from]));

    /* 合計金額 */
    wrap.appendChild(el('div', { class: 'ds-total' }, [
      el('span', { class: 'ds-total-label', text: isInvoice ? 'ご請求金額' : '領収金額' }),
      el('span', { class: 'ds-total-value', text: yen(c.payable) }),
      el('span', { class: 'ds-total-note', text: doc.taxMode === 'none' ? '（非課税）' : '（税込）' })
    ]));

    if (!isInvoice) {
      wrap.appendChild(el('p', { class: 'ds-proviso', text: '但し　' + (doc.proviso || '') }));
      wrap.appendChild(el('p', { class: 'ds-received', text: '上記正に領収いたしました。' }));
    } else if (doc.subject) {
      wrap.appendChild(el('p', { class: 'ds-subject', text: '件名：' + doc.subject }));
    }

    /* 明細 */
    var tbody = el('tbody', {}, c.items.map(function (i) {
      return el('tr', {}, [
        el('td', { text: i.name }),
        el('td', { class: 'num', text: i.qty ? String(i.qty) : '' }),
        el('td', { class: 'unit', text: i.unit || '' }),
        el('td', { class: 'num', text: i.price ? yen(i.price) : '' }),
        el('td', { class: 'num', text: yen(i.amount) })
      ]);
    }));
    wrap.appendChild(el('table', { class: 'ds-items' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '品目' }), el('th', { class: 'num', text: '数量' }),
        el('th', { class: 'unit', text: '単位' }), el('th', { class: 'num', text: '単価' }),
        el('th', { class: 'num', text: '金額' })
      ])),
      tbody
    ]));

    /* 集計 */
    var sums = el('table', { class: 'ds-sums' }, [
      row('小計', yen(c.subtotal)),
      doc.taxMode === 'none' ? null : row('消費税（' + c.rate + '%）', yen(c.tax)),
      row('合計', yen(c.total)),
      doc.withholding ? row('源泉徴収税（' + doc.withholdingRate + '%）', '-' + yen(c.withholding)) : null,
      doc.withholding ? el('tr', { class: 'grand' }, [
        el('th', { text: isInvoice ? 'お支払金額' : '領収金額' }), el('td', { text: yen(c.payable) })
      ]) : null
    ]);
    wrap.appendChild(el('div', { class: 'ds-sums-wrap' }, sums));

    /* 振込先・支払方法 */
    if (isInvoice && issuer && issuer.bank && issuer.bank.name) {
      var b = issuer.bank;
      wrap.appendChild(el('div', { class: 'ds-bank' }, [
        el('div', { class: 'ds-bank-title', text: 'お振込先' }),
        el('div', { class: 'ds-small', text: [b.name, b.branch, b.type, b.number].filter(Boolean).join('　') }),
        b.holder ? el('div', { class: 'ds-small', text: '名義　' + b.holder }) : null,
        el('div', { class: 'ds-small', text: '※恐れ入りますが、振込手数料は貴社にてご負担をお願いいたします。' })
      ]));
    }
    if (!isInvoice && doc.paymentMethod) {
      wrap.appendChild(el('div', { class: 'ds-bank' }, [
        el('div', { class: 'ds-bank-title', text: 'お支払方法' }),
        el('div', { class: 'ds-small', text: doc.paymentMethod })
      ]));
    }

    if (doc.note) {
      wrap.appendChild(el('div', { class: 'ds-note' }, [
        el('div', { class: 'ds-bank-title', text: '備考' }),
        el('div', { class: 'ds-small', text: doc.note })
      ]));
    }

    return wrap;
  }

  /**
   * 売上として数える書類かどうか。
   * 請求書を基本にし、請求書が1枚も無い案件のときだけ領収書を数える
   * （請求書から起こした領収書を二重に数えないため）。
   */
  function countsAsSale(project, doc) {
    if (doc.type === 'invoice') return true;
    return !(project.docs || []).some(function (d) { return d.type === 'invoice'; });
  }

  /**
   * 書類の集計。{project, doc} の配列を渡す。
   * 下書きは売上に含めず、別枠（draft）で数える。
   */
  function sales(entries) {
    var out = {
      count: 0, subtotal: 0, tax: 0, total: 0, withholding: 0, payable: 0,
      paid: 0, paidCount: 0, unpaid: 0, unpaidCount: 0, draft: 0, draftCount: 0
    };
    entries.forEach(function (e) {
      if (!countsAsSale(e.project, e.doc)) return;
      var c = calc(e.doc);
      if (e.doc.status === 'draft') { out.draft += c.payable; out.draftCount++; return; }
      out.count++;
      out.subtotal += c.subtotal;
      out.tax += c.tax;
      out.total += c.total;
      out.withholding += c.withholding;
      out.payable += c.payable;
      if (e.doc.status === 'paid') { out.paid += c.payable; out.paidCount++; }
      else { out.unpaid += c.payable; out.unpaidCount++; }
    });
    return out;
  }

  /* 案件の書類の状況（一覧のバッジ用） */
  function summary(project) {
    var list = project.docs || [];
    return {
      count: list.length,
      invoice: list.filter(function (d) { return d.type === 'invoice'; }).length,
      receipt: list.filter(function (d) { return d.type === 'receipt'; }).length,
      unpaid: list.filter(function (d) { return d.type === 'invoice' && d.status !== 'paid'; }).length,
      total: U.sum(list.filter(function (d) { return d.type === 'invoice'; }), function (d) { return calc(d).payable; })
    };
  }

  DL.docs = {
    TYPE_LABEL: TYPE_LABEL, TYPE_ICON: TYPE_ICON, STATUS_LABEL: STATUS_LABEL,
    TAX_MODE_LABEL: TAX_MODE_LABEL, HONORIFICS: HONORIFICS, UNITS: UNITS,
    PAYMENT_METHODS: PAYMENT_METHODS,
    yen: yen, calc: calc, blank: blank, applyClient: applyClient, defaultDueDate: defaultDueDate,
    fromInvoice: fromInvoice, sheet: sheet, summary: summary,
    countsAsSale: countsAsSale, sales: sales
  };
})(window.DL);
