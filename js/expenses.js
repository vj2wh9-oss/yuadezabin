/* 経費の計算と、レシート写真の下ごしらえ。

   帳簿は2つに分けている。
     work … 事業（仕事の経費）。案件や名義と結びつく
     life … 日常（家計簿）。案件も名義も持たない */
(function (DL) {
  'use strict';
  var U = DL.util;

  var BOOKS = [
    { value: 'work', label: '事業' },
    { value: 'life', label: '日常' }
  ];

  /* 科目。並び順がそのまま選択肢と画面の並びになる */
  var CATEGORIES = {
    work: ['印刷費', '画材・消耗品', '資料費', '機材費',
           '通信費', '交通費', '外注費', '支払手数料', '広告宣伝費', 'その他'],
    life: ['食費', '日用品', '住居', '水道光熱', '通信費', '交通費',
           '医療・健康', '趣味・娯楽', '交際費', '衣服・美容', '教育・教養',
           '保険', '税金・社会保険', 'その他']
  };

  function categories(book) { return CATEGORIES[book] || CATEGORIES.work; }
  function bookLabel(book) { return book === 'life' ? '日常' : '事業'; }

  function total(rows) {
    return (rows || []).reduce(function (s, x) { return s + U.num(x.amount, 0); }, 0);
  }

  /** 科目ごとの合計。多い順に並べる */
  function byCategory(rows) {
    var map = {};
    (rows || []).forEach(function (x) {
      map[x.category] = (map[x.category] || 0) + U.num(x.amount, 0);
    });
    return Object.keys(map).map(function (k) {
      return { category: k, amount: map[k] };
    }).sort(function (a, b) { return b.amount - a.amount; });
  }

  /** 月ごとの合計。1〜12月ぶんを必ず返す */
  function byMonth(rows, year) {
    var out = [];
    for (var m = 1; m <= 12; m++) {
      var mm = (m < 10 ? '0' : '') + m;
      var inMonth = (rows || []).filter(function (x) { return x.date.slice(5, 7) === mm; });
      out.push({ m: m, ym: year + '-' + mm, amount: total(inMonth), count: inMonth.length });
    }
    return out;
  }

  /**
   * 写真を送る前に縮める。
   * iPhone で撮ると1枚3〜4MBあり、そのまま上げると重いうえに置き場も食う。
   * 長辺 1600px・JPEG に落とせば、レシートの文字は十分読める。
   * @param {File} file
   * @param {object} [opts] {max, quality}
   * @returns {Promise<File>} 縮めたもの。縮められなければ元のまま返す
   */
  function shrink(file, opts) {
    opts = opts || {};
    var max = opts.max || 1600, quality = opts.quality || 0.78;
    if (!file || file.type.indexOf('image/') !== 0) return Promise.resolve(file);

    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, max / Math.max(w, h));
          if (scale >= 1 && file.size < 1200000) { done(file); return; }   // すでに小さい
          var cv = document.createElement('canvas');
          cv.width = Math.round(w * scale);
          cv.height = Math.round(h * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob(function (blob) {
            if (!blob || blob.size >= file.size) { done(file); return; }
            var name = String(file.name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg';
            done(new File([blob], name, { type: 'image/jpeg' }));
          }, 'image/jpeg', quality);
        } catch (e) { done(file); }     // canvas が使えない環境ではそのまま送る
      };
      img.onerror = function () { done(file); };
      img.src = url;

      function done(f) { URL.revokeObjectURL(url); resolve(f); }
    });
  }

  /* ---------------- CSV ---------------- */

  /* 1つの値をCSVの1セルにする。区切り・改行・引用符が入っていれば囲う */
  function cell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var CSV_HEADER = ['日付', '帳簿', '科目', '金額', '支払先', 'メモ', '案件', '名義', 'レシート', '固定費'];

  /**
   * 経費をCSVにする。
   * Excel がそのまま開けるよう、UTF-8 の BOM を付けて改行は CRLF にする。
   * @param {Array} rows 経費
   * @param {object} ctx {project(id)->名前, issuer(id)->名前}
   */
  function toCSV(rows, ctx) {
    ctx = ctx || {};
    var lines = [CSV_HEADER.map(cell).join(',')];
    (rows || []).forEach(function (x) {
      lines.push([
        x.date, bookLabel(x.book), x.category, x.amount, x.vendor, x.memo,
        x.projectId && ctx.project ? (ctx.project(x.projectId) || '') : '',
        x.issuerId && ctx.issuer ? (ctx.issuer(x.issuerId) || '') : '',
        x.fileId ? 'あり' : '',
        x.recurringId ? '固定費' : ''
      ].map(cell).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* ---------------- 固定費 ---------------- */

  /**
   * まだ記録していない月を洗い出す。
   * 始めた月（または最後に記録した月の翌月）から今月までを順に見る。
   * @param {Array} list 固定費
   * @param {string} [nowYm] 'YYYY-MM'（既定は今月）
   * @returns {Array} [{recurringId, ym, name, amount, book}]
   */
  function dueRecurring(list, nowYm) {
    var now = nowYm || U.today().slice(0, 7);
    var out = [];
    (list || []).forEach(function (r) {
      if (!r.active || !r.amount) return;
      var ym = r.lastYm ? U.addYm(r.lastYm, 1) : r.startYm;
      if (U.cmp(ym, r.startYm) < 0) ym = r.startYm;
      // 何年もさかのぼって大量に作らないよう、24ヶ月ぶんで打ち切る
      for (var i = 0; i < 24 && U.cmp(ym, now) <= 0; i++) {
        out.push({ recurringId: r.id, ym: ym, name: r.name, amount: r.amount, book: r.book });
        ym = U.addYm(ym, 1);
      }
    });
    return out.sort(function (a, b) { return U.cmp(a.ym, b.ym); });
  }

  DL.expenses = {
    BOOKS: BOOKS, categories: categories, bookLabel: bookLabel,
    total: total, byCategory: byCategory, byMonth: byMonth, shrink: shrink,
    toCSV: toCSV, dueRecurring: dueRecurring
  };
})(window.DL);
