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

  // レシートの写真を置くフォルダ。帳簿ごとに分ける
  var RECEIPT_FOLDER = { work: '経費レシート', life: '日常レシート' };
  function receiptFolder(book) { return RECEIPT_FOLDER[book] || RECEIPT_FOLDER.work; }

  /** もとから入っている科目だけ */
  function baseCategories(book) { return CATEGORIES[book] || CATEGORIES.work; }

  /**
   * 選び口に出す科目。もとからのもの＋設定で足したもの。
   * 「その他」は受け皿なので、足したぶんはその手前に入れる。
   */
  function categories(book) {
    var base = baseCategories(book).slice();
    var mine = (DL.store.myCategories ? DL.store.myCategories(book) : []);
    if (!mine.length) return base;
    var at = base.indexOf('その他');
    if (at < 0) return base.concat(mine);
    return base.slice(0, at).concat(mine, base.slice(at));
  }
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

  /**
   * 分類ごとの合計。分類は品目ひとつずつに付くので、集計も品目の金額で行う。
   * 分類の付いていない品目は「未分類」にまとめ、品目そのものが無い記録は数えない。
   * @returns {Array<{tagId,name,color,amount,count}>} 多い順
   */
  function byTag(rows) {
    var map = {};
    (rows || []).forEach(function (x) {
      (x.items || []).forEach(function (i) {
        var id = i.tagId || '';
        var m = map[id] || (map[id] = { tagId: id, amount: 0, count: 0 });
        m.amount += U.num(i.price, 0);
        m.count++;
      });
    });
    return Object.keys(map).map(function (id) {
      var t = id ? DL.store.getTag(id) : null;
      map[id].name = t ? t.name : (id ? '(消された分類)' : '未分類');
      map[id].color = t ? t.color : '';
      return map[id];
    }).sort(function (a, b) {
      // 「未分類」は下に置く。金額が同じなら名前順
      if (!a.tagId !== !b.tagId) return a.tagId ? -1 : 1;
      return (b.amount - a.amount) || U.cmp(a.name, b.name);
    });
  }

  /** 月ごとの合計。1〜12月ぶんを必ず返す */
  /**
   * その月に出ていく固定費。事業と日常の両方をまとめて数える。
   * 予算は事業と日常を合わせた1本なので、固定費も合わせて見る。
   *
   * まだその日が来ていなくても、その月のうちに必ず出ていく。
   * だから月のはじめから取りのけておく。
   *
   * @param {string} ym 'YYYY-MM'
   * @param {string} [book] 'work'|'life' を渡すと、その帳簿のぶんだけ
   * @returns {number}
   */
  function fixedOfMonth(ym, book) {
    var U = DL.util;
    return (DL.store.settings.recurring || []).filter(function (r) {
      return (!book || r.book === book) && r.active !== false
        && String(r.startYm || '') <= ym;      // 始まる前の月には出ていかない
    }).reduce(function (n, r) { return n + Math.max(0, U.num(r.amount, 0)); }, 0);
  }

  /**
   * 1日ぶんの予算と、今日の使いぐあい。
   *
   * 予算は事業と日常を合わせた1本なので、出ていくほうも両方を足して見る。
   * 帳簿を分けているのは中身を整理するためで、財布は1つだから。
   *
   * 家賃や通信費のような固定費は、日割りにしても意味がない。
   * 27日に家賃が出た日だけ予算が吹き飛んで見えても、何の役にも立たない。
   * そこで月の予算からは固定費を先に取りのけ、残った「自由に使える額」を
   * 日割りにする。使った額のほうも、固定費から起こした記録は数えない
   * （先に引いてあるので、数えると二重になる）。
   *
   * 基準は「（月の予算 − 固定費）÷ その月の日数」。ただし月の途中で
   * 使いすぎていると、この基準を守っても収まらない。そこで、いま時点で
   * 使った額を引いて、今日を含む残りの日数で割り直した「立て直しの
   * 1日予算」も出す。こちらを守れば、月の終わりにちょうど収まる。
   *
   * @param {string} [date] 見たい日。既定は今日
   * @returns {object|null} 予算を決めていなければ null
   */
  function dailyBudget(date) {
    var S = DL.store, U = DL.util;
    var month = Math.max(0, Math.round(U.num(S.settings.lifeBudget, 0)));
    if (!month) return null;
    date = U.isISO(date) ? date : U.today();

    var ym = date.slice(0, 7);
    var day = U.num(date.slice(8, 10), 1);
    // その月の日数（翌月の0日＝今月の末日）
    var days = new Date(U.num(ym.slice(0, 4), 2000), U.num(ym.slice(5, 7), 1), 0).getDate();

    var fixed = fixedOfMonth(ym);                     // 事業＋日常
    var budget = Math.max(0, month - fixed);          // 日割りにできる額

    var rows = (S.settings.expenses || []).filter(function (x) {
      return String(x.date).slice(0, 7) === ym        // 事業も日常も、まとめて数える
        && !x.recurringId;                            // 固定費ぶんは先に引いてある
    });
    var spent = total(rows);
    var today = total(rows.filter(function (x) { return x.date === date; }));
    var before = spent - today;                       // 昨日までに使った額

    // 帳簿ごとの内訳。どちらで使っているかが見えるように
    var byBook = { work: 0, life: 0 };
    rows.forEach(function (x) {
      byBook[x.book === 'life' ? 'life' : 'work'] += U.num(x.amount, 0);
    });

    var perDay = budget / days;                       // ふだんの1日予算
    var rest = Math.max(1, days - day + 1);           // 今日を含む、残りの日数
    var room = budget - before;                       // 今日以降に使える額
    var restPerDay = Math.max(0, room / rest);        // 立て直しの1日予算

    return {
      month: month, fixed: fixed,
      fixedWork: fixedOfMonth(ym, 'work'), fixedLife: fixedOfMonth(ym, 'life'),
      spentWork: byBook.work, spentLife: byBook.life,
      budget: budget, days: days, day: day, rest: rest,
      perDay: Math.round(perDay),
      restPerDay: Math.round(restPerDay),
      today: today,
      // 予算が0のときに使っていたら、0%ではなく振り切った扱いにする
      todayPct: perDay > 0 ? pct(today, perDay) : (today > 0 ? 100 : 0),
      restPct: restPerDay > 0 ? pct(today, restPerDay) : (today > 0 ? 100 : 0),
      spent: spent, before: before, left: budget - spent,
      // 固定費だけで予算を使い切っている。使いすぎとは別の話
      noRoom: fixed >= month,
      // 自由に使えるぶんをもう使い切っている
      overspent: room <= 0,
      // 立て直しの予算がふだんより目に見えて少ない＝ペースがよくない
      behind: restPerDay < perDay - 1
    };
  }

  function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

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
    // あとから読み取り直すことがあるので、字が潰れない程度は残す
    var max = opts.max || 2000, quality = opts.quality || 0.85;
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

  var CSV_HEADER = ['日付', '帳簿', '科目', '金額', '支払先', 'メモ', '案件', '名義', 'レシート', '固定費', '分類'];

  /**
   * 経費をCSVにする。
   * Excel がそのまま開けるよう、UTF-8 の BOM を付けて改行は CRLF にする。
   * @param {Array} rows 経費
   * @param {object} ctx {project(id)->名前, issuer(id)->名前}
   */
  /* その記録に入っている品目の分類を「画材×2・資料×1」の形にまとめる */
  function tagSummary(x) {
    var order = [], n = {};
    (x.items || []).forEach(function (i) {
      if (!i.tagId) return;
      var t = DL.store.getTag(i.tagId);
      var name = t ? t.name : '(消された分類)';
      if (!n[name]) { n[name] = 0; order.push(name); }
      n[name]++;
    });
    return order.map(function (k) { return n[k] > 1 ? k + '×' + n[k] : k; }).join('・');
  }

  function toCSV(rows, ctx) {
    ctx = ctx || {};
    var lines = [CSV_HEADER.map(cell).join(',')];
    (rows || []).forEach(function (x) {
      lines.push([
        x.date, bookLabel(x.book), x.category, x.amount, x.vendor, x.memo,
        x.projectId && ctx.project ? (ctx.project(x.projectId) || '') : '',
        x.issuerId && ctx.issuer ? (ctx.issuer(x.issuerId) || '') : '',
        x.fileId ? 'あり' : '',
        x.recurringId ? '固定費' : '',
        tagSummary(x)
      ].map(cell).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* ---------------- 固定費 ---------------- */

  /**
   * すでに登録してある支出から、固定費になりそうなものを挙げる。
   *
   * 毎月きまって出るものは、同じ支払先・同じ科目で、月をまたいで
   * 何度も出てくる。そこをまとめて「これでは？」と並べる。
   * 決めるのは人なので、ここは候補を出すだけ。
   *
   * @param {Array} rows その帳簿の経費
   * @param {Array} [already] すでに登録してある固定費（重なりに印を付ける）
   * @returns {Array} 月をまたいで出た数が多い順
   *   [{key,name,vendor,category,amount,day,count,months,last,rows,registered}]
   */
  function fixedCandidates(rows, already) {
    var U = DL.util;
    var map = {};

    (rows || []).forEach(function (x) {
      // 固定費から起こしたものは、もう登録済みなので挙げない
      if (x.recurringId) return;
      if (!U.num(x.amount, 0)) return;
      var name = String(x.vendor || '').trim();
      var key = norm(name) + '/' + x.category;
      var g = map[key] || (map[key] = {
        key: key, name: name || x.category, vendor: name, category: x.category,
        rows: [], months: {}
      });
      g.rows.push(x);
      g.months[String(x.date).slice(0, 7)] = true;
    });

    var regs = {};
    (already || []).forEach(function (r) {
      regs[norm(r.vendor || r.name) + '/' + r.category] = true;
    });

    return Object.keys(map).map(function (k) {
      var g = map[k];
      // 新しい順にそろえてから、直近の金額と、よく出る日を拾う
      g.rows.sort(function (a, b) { return U.cmp(b.date, a.date); });
      return {
        key: g.key, name: g.name, vendor: g.vendor, category: g.category,
        amount: U.num(g.rows[0].amount, 0),          // 直近の金額
        day: U.num(String(g.rows[0].date).slice(8, 10), 1),
        count: g.rows.length,
        months: Object.keys(g.months).length,
        last: g.rows[0].date,
        memo: g.rows[0].memo || '',
        projectId: g.rows[0].projectId || '',
        issuerId: g.rows[0].issuerId || '',
        rows: g.rows,
        registered: !!regs[g.key]
      };
    }).sort(function (a, b) {
      // 月をまたいで出ているものほど固定費らしい。同じなら件数、それも同じなら新しい順
      if (b.months !== a.months) return b.months - a.months;
      if (b.count !== a.count) return b.count - a.count;
      return U.cmp(b.last, a.last);
    });
  }

  /* 支払先を比べるための形（空白と記号を落とす） */
  function norm(name) {
    return String(name || '').replace(/[\s　]/g, '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .toLowerCase();
  }

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
    RECEIPT_FOLDER: RECEIPT_FOLDER, receiptFolder: receiptFolder,
    BOOKS: BOOKS, categories: categories, baseCategories: baseCategories, bookLabel: bookLabel,
    total: total, dailyBudget: dailyBudget, fixedOfMonth: fixedOfMonth, byCategory: byCategory, byTag: byTag, byMonth: byMonth, shrink: shrink,
    toCSV: toCSV, dueRecurring: dueRecurring, fixedCandidates: fixedCandidates
  };
})(window.DL);
