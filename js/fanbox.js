/* 支援サイト（pixivFANBOX）の「支援金管理／振込」の表を読み取る。

   サイトを自動で巡回して取ってくることはしない（別オリジンなので
   ブラウザから直接は読めず、合鍵をアプリに持たせることにもなるため）。
   代わりに、その画面をそのまま選んでコピーし、貼り付けてもらう。

   実際に貼り付くのはこういう形（年と月が別の行で、金額に見出しが付く）：

     2026年
     8月
     支援金詳細
     支援金
     ¥500
     手数料
     ¥64
     小計
     ¥436

   なので「支援金」の見出しの次に来る金額を採る。
   見出しが無い形（1行に年月と金額が並ぶ表など）でも読めるようにしてある。 */
(function (DL) {
  'use strict';
  var U = DL.util;

  // 金額の見出し。「支援金詳細」を「支援金」と取り違えないよう、行全体で照らす
  var LABELS = ['支援金', '手数料', '小計', '振込金額', '振込額', '報酬'];
  var LABEL_LINE = new RegExp('^(' + LABELS.join('|') + ')\\s*[:：]?\\s*([¥￥]?[\\d,]+\\s*円?)?$');

  var YEAR_ONLY = /^(20\d{2})\s*年$/;
  var MONTH_ONLY = /^(1[0-2]|0?[1-9])\s*月$/;
  // 2026年1月 / 2026/01 / 2026-1 のように1行にまとまっている場合
  var YEAR_MONTH = /^(20\d{2})\s*[年\/\-\.]\s*(1[0-2]|0?[1-9])\s*月?$/;
  // 行の途中に年月がある場合（例：2026年1月　¥12,000）
  var YM_INLINE = /(20\d{2})\s*[年\/\-\.]\s*(1[0-2]|0?[1-9])\s*月?/;

  // ¥1,234 / 1,234円 / 1234
  var MONEY = /(?:[¥￥]\s*)?(\d{1,3}(?:,\d{3})+|\d+)\s*(?:円)?/g;

  function toNumber(s) { return U.num(String(s).replace(/,/g, ''), 0); }

  /**
   * 文字列から金額だけを集める。
   * 「3人」のような個数や、素の4桁（年の残り）は金額として拾わない。
   */
  function amountsIn(s) {
    var rest = String(s || '').replace(/\d[\d,]*\s*(?:人|件|名|回|%|％)/g, ' ');
    var out = [], m;
    MONEY.lastIndex = 0;
    while ((m = MONEY.exec(rest)) !== null) {
      if (!/[,¥￥円]/.test(m[0]) && /^\d{4}$/.test(m[1])) continue;
      out.push(toNumber(m[1]));
    }
    return out;
  }

  function ymOf(year, month) { return year + '-' + ('0' + month).slice(-2); }

  /**
   * 貼り付けた文字列を月ごとのまとまりにほどく。
   * @returns {Array} [{ ym, amounts:[…], by:{支援金:n, 手数料:n, …} }]
   */
  function scan(text) {
    var lines = String(text || '').split(/\r?\n/);
    var records = [], year = '', cur = null, pending = '';

    function open(y, m) {
      cur = { ym: ymOf(y, m), amounts: [], by: {} };
      records.push(cur);
      pending = '';
    }
    function take(label, value) {
      if (!cur) return;
      if (label && cur.by[label] === undefined) cur.by[label] = value;
      cur.amounts.push(value);
    }

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+/g, ' ').trim();
      if (!line) return;

      var m;
      if ((m = line.match(YEAR_ONLY))) { year = m[1]; pending = ''; return; }
      if ((m = line.match(YEAR_MONTH))) { year = m[1]; open(year, m[2]); return; }
      // 年は前の行で出ているので、月だけの行で1ヶ月ぶんが始まる
      if ((m = line.match(MONTH_ONLY)) && year) { open(year, m[1]); return; }

      // 「支援金」だけの行、または「支援金 ¥500」の行
      if ((m = line.match(LABEL_LINE))) {
        var v = m[2] ? amountsIn(m[2]) : [];
        if (v.length) { take(m[1], v[0]); pending = ''; }
        else pending = m[1];          // 次に出てくる金額がこの見出しのもの
        return;
      }

      // 行の途中に年月があるとき（1行完結の表）
      if (!cur || line.match(YM_INLINE)) {
        var im = line.match(YM_INLINE);
        if (im) {
          year = im[1];
          open(year, im[2]);
          amountsIn(line.replace(im[0], ' ')).forEach(function (v) { take('', v); });
          return;
        }
      }

      var vals = amountsIn(line);
      vals.forEach(function (v) {
        take(pending, v);
        pending = '';
      });
    });

    return records.filter(function (r) { return r.amounts.length; });
  }

  /**
   * 貼り付けた文字列を読み取る。
   * @param {string} text
   * @param {number} [col] 見出しが無い表で、何番目の金額を使うか（0始まり）
   * @returns {{rows:Array, columns:number, samples:Array, labeled:boolean}}
   *   labeled が true なら「支援金」の見出しで拾えているので、列を選ぶ必要はない
   */
  function parse(text, col) {
    var found = scan(text);
    var labeled = found.some(function (r) { return r.by['支援金'] !== undefined; });

    var rows;
    if (labeled) {
      rows = found.filter(function (r) { return r.by['支援金'] !== undefined; })
        .map(function (r) { return { ym: r.ym, amount: r.by['支援金'] }; });
    } else {
      var columns = 0;
      found.forEach(function (r) { columns = Math.max(columns, r.amounts.length); });
      var pick = Math.min(Math.max(U.num(col, 0), 0), Math.max(columns - 1, 0));
      rows = found.map(function (r) {
        var v = r.amounts.length > pick ? r.amounts[pick] : r.amounts[r.amounts.length - 1];
        return { ym: r.ym, amount: v };
      });
    }

    // 貼り付けた中に同じ年月が二度出てきたら、先に出たほうを残す
    var seen = {};
    rows = rows.filter(function (r) {
      if (seen[r.ym]) return false;
      seen[r.ym] = true;
      return true;
    });

    var cols = 0;
    found.forEach(function (r) { cols = Math.max(cols, r.amounts.length); });
    return { rows: rows, columns: labeled ? 0 : cols, samples: found.slice(0, 6), labeled: labeled };
  }

  DL.fanbox = { parse: parse, scan: scan };
})(window.DL);
