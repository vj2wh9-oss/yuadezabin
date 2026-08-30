/* 支援サイト（pixivFANBOX）の「支援金管理／振込」の表を読み取る。

   サイトを自動で巡回して取ってくることはしない（別オリジンなので
   ブラウザから直接は読めず、合鍵をアプリに持たせることにもなるため）。
   代わりに、その画面の表をそのままコピーして貼り付けてもらい、
   ここで年月と金額に切り分ける。 */
(function (DL) {
  'use strict';
  var U = DL.util;

  // 2026年1月 / 2026/01 / 2026-1 / 2026.01 のどれでも拾う
  var YM = /(20\d{2})\s*[年\/\-\.]\s*(1[0-2]|0?[1-9])\s*月?/;
  // ¥1,234 / 1,234円 / 1234。小数や「3件」のような単位付きは弾く
  var MONEY = /(?:[¥￥]\s*)?(\d{1,3}(?:,\d{3})+|\d+)\s*(?:円)?/g;

  /* 「1,234」→ 1234 */
  function toNumber(s) { return U.num(String(s).replace(/,/g, ''), 0); }

  /**
   * 1行から金額だけを集める。
   * 年月として使った部分は先に取り除いて、2026 や 1 を金額と読み違えないようにする。
   */
  function amountsIn(line, ymMatch) {
    var rest = ymMatch ? line.replace(ymMatch[0], ' ') : line;
    // 「3人」「5件」のような個数は金額ではないので落とす
    rest = rest.replace(/\d[\d,]*\s*(?:人|件|名|回|%|％)/g, ' ');
    var out = [], m;
    MONEY.lastIndex = 0;
    while ((m = MONEY.exec(rest)) !== null) {
      // 「2026」のような素の4桁は年の残りかもしれないので、桁区切りか通貨記号が
      // 付いていない4桁ちょうどの数は拾わない
      var raw = m[0];
      if (!/[,¥￥円]/.test(raw) && /^\d{4}$/.test(m[1])) continue;
      out.push(toNumber(m[1]));
    }
    return out;
  }

  /**
   * 貼り付けた文字列を { ym, amounts[] } の一覧にほどく。
   * 表をコピーすると、1行に収まることも、年月と金額が別々の行に分かれることもある。
   * 年月の行を見つけたら、次の年月が出てくるまでの金額をその月のものとして集める。
   */
  function scan(text) {
    var lines = String(text || '').split(/\r?\n/);
    var rows = [], cur = null;

    lines.forEach(function (line) {
      if (!line.trim()) return;
      var m = line.match(YM);
      if (m) {
        var mm = ('0' + m[2]).slice(-2);
        cur = { ym: m[1] + '-' + mm, amounts: amountsIn(line, m) };
        rows.push(cur);
      } else if (cur) {
        cur.amounts = cur.amounts.concat(amountsIn(line, null));
      }
    });
    return rows.filter(function (r) { return r.amounts.length; });
  }

  /**
   * 貼り付けた文字列を読み取る。
   * @param {string} text
   * @param {number} [col] 何番目の金額を「支援金」として採るか（0始まり。既定 0）
   * @returns {{rows:Array, columns:number, samples:Array}}
   *   rows: [{ym, amount}]／columns: 1行あたりの金額の数（多いほど列が多い表）
   *   samples: 列を選ばせるための見本 [[金額,…], …]
   */
  function parse(text, col) {
    var found = scan(text);
    var columns = 0;
    found.forEach(function (r) { columns = Math.max(columns, r.amounts.length); });
    var pick = Math.min(Math.max(U.num(col, 0), 0), Math.max(columns - 1, 0));

    var rows = found.map(function (r) {
      // その行に列が足りないときは、いちばん最後の金額で代用する
      var v = r.amounts.length > pick ? r.amounts[pick] : r.amounts[r.amounts.length - 1];
      return { ym: r.ym, amount: v };
    });
    return { rows: rows, columns: columns, samples: found.slice(0, 6) };
  }

  DL.fanbox = { parse: parse, scan: scan };
})(window.DL);
