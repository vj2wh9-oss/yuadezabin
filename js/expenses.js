/* 経費の計算と、レシート写真の下ごしらえ。 */
(function (DL) {
  'use strict';
  var U = DL.util;

  /* よく使う科目。並び順がそのまま画面の並びになる */
  var CATEGORIES = [
    '印刷費', '画材・消耗品', '資料費', '機材費',
    '通信費', '交通費', '外注費', '支払手数料', '広告宣伝費', 'その他'
  ];

  /* 科目ごとの目印の色。棒グラフと丸印に使う */
  var CATEGORY_COLOR = {
    '印刷費': 'var(--series1)',
    '画材・消耗品': 'var(--accent2)',
    '資料費': 'var(--indigo)',
    '機材費': 'var(--ok)',
    '通信費': 'var(--event)',
    '交通費': 'var(--warn)',
    '外注費': 'var(--series2)',
    '支払手数料': 'var(--muted)',
    '広告宣伝費': 'var(--danger)',
    'その他': 'var(--line2)'
  };

  function color(cat) { return CATEGORY_COLOR[cat] || 'var(--line2)'; }

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

  DL.expenses = {
    CATEGORIES: CATEGORIES, color: color,
    total: total, byCategory: byCategory, byMonth: byMonth, shrink: shrink
  };
})(window.DL);
