/* レシートの写真から金額を読み取る。

   速さや通信量より、当たることを優先した作り。手持ちのレシート10枚で
   「正解が候補の1番目に出たか」を測りながら決めている（旧2/10 → 10/10）。

   1. 撮ったままの写真を読む。送る用に縮めたものを読ませると細い字が潰れる
   2. 影やムラに強い「まわりと比べる」二値化を通す（紙全体を1つのしきい値で
      切ると、明るい側が飛んで暗い側が潰れる）
   3. 学習データを2つ、別々に走らせて位置で突き合わせる。
      日本語のデータは「合計」「お預り」を読める代わりに、数字を丸囲み文字に
      寄せてしまう（218 → ②①⑧）。英語のデータは数字を素直に読む代わりに、
      見出しがまったく読めない。片方だけでは、どちらかを必ず落とす
   4. 金額は「見出し・字の大きさ・下にあること・金額そのもの」で点を付けて並べる。
      レシートの合計は、たいてい「合計」の右にあって字が大きく、下のほうにある */
(function (DL) {
  'use strict';
  var U = DL.util;

  // 差し替えられるようにしておく（つながらない環境での試験や、別のCDNに移すとき）
  var sources = {
    lib: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js',
    worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
    core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6',
    // 軽い版（_fast）ではなく標準版。日本語は字の種類が多く、軽い版だと崩れる
    lang: 'https://tessdata.projectnaptha.com/4.0.0',
    // 数字を読む側と、見出しを読む側。別々に走らせて突き合わせる
    numLang: 'eng',
    textLang: 'jpn'
  };

  var loading = null;

  function loadLib() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = sources.lib;
      s.onload = function () {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error('文字認識の部品を読み込めませんでした'));
      };
      s.onerror = function () {
        loading = null;
        reject(new Error('文字認識の部品を取りに行けませんでした。通信できる場所で試してください'));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  /* ---------------- 下ごしらえ ---------------- */

  var MAX_SIDE = 2400;      // これより小さければ引き伸ばす
  var MIN_SIDE = 1400;      // これを下回ると細い字がつぶれる

  /**
   * 読み取りやすい白黒画像にする。
   * 影やレシートの反りでページ全体が均一にならないので、画素ごとに
   * 「まわりの明るさ」と比べて決める（Sauvola に近い考え方）。
   * ひとつのしきい値で切ると、明るい側が飛んで暗い側が潰れる。
   */
  function prepare(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var long = Math.max(w, h);
          // 小さい写真は引き伸ばし、大きすぎるものは落とす（大きすぎても速度だけ食う）
          var scale = long < MIN_SIDE ? (MIN_SIDE / long) : Math.min(1, MAX_SIDE / long);
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));

          var cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          var ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, cw, ch);

          var d = ctx.getImageData(0, 0, cw, ch);
          binarize(d.data, cw, ch);
          ctx.putImageData(d, 0, 0);

          URL.revokeObjectURL(url);
          resolve(cv);
        } catch (e) {
          URL.revokeObjectURL(url);
          resolve(file);          // canvas が使えなければ元の画像のまま渡す
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  /**
   * まわりと比べて白黒にする。
   * 積分画像を作っておくと、窓の大きさに関わらず1画素あたり一定の手間で済む。
   */
  function binarize(px, w, h) {
    var n = w * h;
    var gray = new Float64Array(n);
    var i, x, y;
    for (i = 0; i < n; i++) {
      var p = i * 4;
      gray[i] = px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114;
    }

    // 積分画像（和と二乗和）。(w+1)x(h+1) で端の場合分けを無くす
    var W = w + 1;
    var sum = new Float64Array(W * (h + 1));
    var sq = new Float64Array(W * (h + 1));
    for (y = 0; y < h; y++) {
      var rs = 0, rq = 0;
      for (x = 0; x < w; x++) {
        var g = gray[y * w + x];
        rs += g; rq += g * g;
        sum[(y + 1) * W + (x + 1)] = sum[y * W + (x + 1)] + rs;
        sq[(y + 1) * W + (x + 1)] = sq[y * W + (x + 1)] + rq;
      }
    }
    function boxSum(t, x0, y0, x1, y1) {
      return t[(y1 + 1) * W + (x1 + 1)] - t[y0 * W + (x1 + 1)] - t[(y1 + 1) * W + x0] + t[y0 * W + x0];
    }

    // 窓は文字の高さの数倍が目安。長辺の 1/28 くらいが実測でよかった
    var r = Math.max(8, Math.round(Math.max(w, h) / 28));
    var k = 0.25, R = 128;      // Sauvola の係数。値が大きいほど文字を残す
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        var cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        var s = boxSum(sum, x0, y0, x1, y1);
        var q = boxSum(sq, x0, y0, x1, y1);
        var mean = s / cnt;
        var varr = Math.max(0, q / cnt - mean * mean);
        var sd = Math.sqrt(varr);
        var th = mean * (1 + k * (sd / R - 1));
        var v = gray[y * w + x] <= th ? 0 : 255;
        var o = (y * w + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = v;
        px[o + 3] = 255;
      }
    }
  }

  /* ---------------- 金額の選び方 ---------------- */

  // 合計を表す見出し。日本語が読めるようになったので、まずこれで拾う
  var TOTAL_HINT = /(合\s*計|総\s*計|お?会\s*計|税\s*込\s*合?\s*計|ご?請\s*求|total|goukei)/i;
  // 合計ではない金額。ここに当たる行は下げる
  var SUB_HINT = /(小\s*計|subtotal|税\s*抜|外\s*税|内\s*税|消費税|税\s*額|tax|お?預(り|かり)?|お?釣|釣\s*銭|change|cash|現\s*金|カード|クレジット|point|ポイント|残\s*高|値\s*引|割\s*引|個\s*数|点\s*数|tel|電話|20\d{2}\s*[-\/\.年]\s*\d{1,2}\s*[-\/\.月]|\d{1,2}\s*:\s*\d{2})/i;
  // 単価・数量の行（「@120」「120円 x 2」）も合計ではない
  var UNIT_HINT = /(^|\s)[@＠]\s*\d|[x×]\s*\d+\s*$/i;

  var MONEY = /(?:[¥￥\\$]\s*)?(\d{1,3}(?:[,，.]\d{3})+|\d{2,7})/g;

  /* 丸囲み数字などを、ふつうの数字に直す。
     日本語の学習データは ①②③ を持っているので、少しつぶれた数字を
     そちらに寄せてしまう（218 が ②①⑧ になる）。ここで戻す */
  var ENCLOSED = {};
  (function () {
    var i;
    ENCLOSED['⓪'] = '0';                                     // ⓪
    for (i = 0; i < 20; i++) ENCLOSED[String.fromCharCode(0x2460 + i)] = String(i + 1);   // ①〜⑳
    for (i = 0; i < 15; i++) ENCLOSED[String.fromCharCode(0x3251 + i)] = String(i + 21);  // ㉑〜㉟
    for (i = 0; i < 10; i++) ENCLOSED[String.fromCharCode(0x2776 + i)] = String(i + 1);   // ❶〜❿
    for (i = 0; i < 10; i++) ENCLOSED[String.fromCharCode(0x2780 + i)] = String(i + 1);   // ➀〜➉
    for (i = 0; i < 10; i++) ENCLOSED[String.fromCharCode(0x278A + i)] = String(i + 1);   // ➊〜➓
    for (i = 0; i < 20; i++) ENCLOSED[String.fromCharCode(0x2474 + i)] = String(i + 1);   // ⑴〜⒇
    for (i = 0; i < 20; i++) ENCLOSED[String.fromCharCode(0x2488 + i)] = String(i + 1);   // ⒈〜⒛
  })();

  function fixDigits(s) {
    return String(s || '')
      .replace(/[①-⓿㉑-㉟❶-➓]/g, function (c) {
        return ENCLOSED[c] !== undefined ? ENCLOSED[c] : c;
      })
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[，、]/g, ',')
      .replace(/[．]/g, '.');
  }

  /**
   * tesseract が組んだ行をそのまま使う。
   * 傾いた紙でも行を追えるのは、向こうのレイアウト解析のほうが確かなため。
   * 自前で高さの重なりだけで束ねると、傾きで隣の行と混ざる。
   * @returns {Array} [{text, words, top, bottom, height, conf}]
   */
  function fromBlocks(data) {
    var lines = [];
    (data.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (par) {
        (par.lines || []).forEach(function (l) {
          var ws = (l.words || []).filter(function (w) {
            return w && w.bbox && String(w.text || '').trim();
          });
          var bb = l.bbox || (ws.length ? ws[0].bbox : null);
          if (!bb) return;
          var text = fixDigits(String(l.text || ws.map(function (w) { return w.text; }).join(' '))
            .replace(/\s+/g, ' ').trim());
          if (!text) return;
          lines.push({
            text: text, words: ws,
            top: bb.y0, bottom: bb.y1, height: Math.max(1, bb.y1 - bb.y0),
            conf: ws.length ? U.sum(ws, function (w) { return w.confidence; }) / ws.length
                            : U.num(l.confidence, 60)
          });
        });
      });
    });
    return lines;
  }

  /**
   * 位置だけがあって行が組まれていないときの受け皿。
   * 文字の高さを基準にした幅で、上から順にまとめる。
   */
  function toLines(words) {
    var ws = (words || []).filter(function (w) {
      return w && w.bbox && String(w.text || '').trim() && U.num(w.confidence, 0) > 25;
    });
    if (!ws.length) return [];
    var mid = function (w) { return (w.bbox.y0 + w.bbox.y1) / 2; };
    ws.sort(function (a, b) { return mid(a) - mid(b); });

    var hs = ws.map(function (w) { return w.bbox.y1 - w.bbox.y0; }).sort(function (a, b) { return a - b; });
    var med = Math.max(1, hs[Math.floor(hs.length / 2)]);
    var tol = med * 0.6;      // これ以上ずれていれば別の行

    var lines = [];
    var cur = null;
    ws.forEach(function (w) {
      var m = mid(w);
      // 直前の行の中心と比べる。積み上げた高さではなく中心で見るので、
      // ひとつの行がどこまでも太っていくことがない
      if (cur && Math.abs(m - cur.mid) <= tol) {
        cur.words.push(w);
        cur.mid = (cur.mid * (cur.words.length - 1) + m) / cur.words.length;   // 少しずつ追う
      } else {
        cur = { words: [w], mid: m };
        lines.push(cur);
      }
    });

    return lines.map(function (L) {
      L.words.sort(function (a, b) { return a.bbox.x0 - b.bbox.x0; });
      var top = Math.min.apply(null, L.words.map(function (w) { return w.bbox.y0; }));
      var bottom = Math.max.apply(null, L.words.map(function (w) { return w.bbox.y1; }));
      return {
        text: fixDigits(L.words.map(function (w) { return w.text; }).join(' ').replace(/\s+/g, ' ').trim()),
        words: L.words, top: top, bottom: bottom, height: Math.max(1, bottom - top),
        conf: U.sum(L.words, function (w) { return U.num(w.confidence, 0); }) / L.words.length
      };
    }).filter(function (L) { return L.text; });
  }

  /**
   * 行から金額の候補を作って点数を付ける。
   * 手がかりは4つ：見出し・字の大きさ・下のほうにあること・金額そのもの。
   * @param {Array} lines 行（text / top / bottom / height / conf）
   * @param {object} page {height}
   * @param {function} [ctxFor] その行と同じ高さにある別の読み取り結果（見出し）を返す
   */
  function pick(lines, page, ctxFor) {
    var H = (page && page.height) || 1;
    // 本文の字の高さ。合計は本文より大きいことが多いので、そのものさしにする
    var heights = lines.map(function (L) { return L.height; }).sort(function (a, b) { return a - b; });
    var median = heights.length ? heights[Math.floor(heights.length / 2)] : 1;

    var out = [];
    lines.forEach(function (L) {
      // 見出しは日本語の読み取りのほうが確かなので、同じ高さにある文字も見る
      var ctx = ctxFor ? ctxFor(L) : '';
      var look = L.text + ' ' + ctx;
      var isTotal = TOTAL_HINT.test(look);
      var isNoise = SUB_HINT.test(look) || UNIT_HINT.test(L.text);
      var big = median > 0 ? L.height / median : 1;

      var m;
      MONEY.lastIndex = 0;
      var found = [];
      while ((m = MONEY.exec(L.text)) !== null) found.push(m);

      found.forEach(function (mm, idx) {
        var v = U.num(String(mm[1]).replace(/[,.]/g, ''), 0);
        if (v < 10 || v > 9999999) return;              // 明らかに金額でないもの
        var yen = /[¥￥]/.test(mm[0]);
        // 同じ行に数字が並ぶときは、いちばん右（＝金額の欄）を採る
        var rightmost = idx === found.length - 1;

        var score = 0;
        if (isTotal) score += 1000;
        if (isNoise) score -= 900;
        if (yen) score += 120;
        if (rightmost) score += 60;
        score += Math.min(300, Math.round((big - 1) * 320));   // 字が大きいほど有利
        score += Math.round((L.top / H) * 160);                // 下にあるほど有利
        score += Math.min(120, Math.round(L.conf));            // 読めている行を優先
        score += Math.min(90, Math.round(Math.log10(Math.max(10, v)) * 22));

        out.push({
          value: v, line: (L.text + (ctx ? '　' + ctx.trim() : '')).trim(),
          score: score, total: isTotal, noise: isNoise
        });
      });
    });

    // 同じ金額はいちばん点の高いものにまとめる
    var by = {};
    out.forEach(function (c) { if (!by[c.value] || by[c.value].score < c.score) by[c.value] = c; });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 8);
  }

  /* 文字だけしか無いとき（位置が取れない古い形）の受け皿 */
  function candidates(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (t, i, arr) {
      var s = fixDigits(t).replace(/\s+/g, ' ').trim();
      return { text: s, height: 1, top: i, bottom: i + 1, conf: 80, words: [] };
    }).filter(function (L) { return L.text; });
    return pick(lines, { height: Math.max(1, lines.length) });
  }

  /* ---------------- 読み取り ---------------- */

  /**
   * 写真から金額の候補を読み取る。
   * @param {File|Blob} file レシートの画像
   * @param {function} [onProgress] 0〜1 の進み具合
   * @returns {Promise<{text:string, amounts:Array}>}
   */
  function read(file, onProgress) {
    return withTimeout(recognize(file, onProgress), 300000,
      '読み取りに時間がかかりすぎました。通信の具合を確かめて、もう一度お試しください')
      .catch(function (e) {
        var msg = (e && e.message) || (typeof e === 'string' ? e : '') || '読み取れませんでした';
        throw new Error(msg);
      });
  }

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true; reject(new Error(message));
      }, ms);
      promise.then(function (v) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(timer); reject(e);
      });
    });
  }

  /* 段組みの見方（PSM）。手持ちのレシート5枚で総当たりして決めた。
     3(自動)と4(1段組み)は、品目と金額の間が空いているレシートを
     「2段組み」と見て金額の列ごと捨ててしまう（数字の一致 1/15）。
     11(まばらな文字を場所を問わず拾う)なら 15/15 で全部拾えた。
     日本語の見出しは 11 と 6 で拾えるものが食い違うので、両方かける。 */
  var PSM_SPARSE = '11';   // 場所を問わず拾う
  var PSM_BLOCK = '6';     // ひとかたまりの文章として読む

  /**
   * 2つの学習データを別々に走らせて、位置で突き合わせる。
   *
   * 日本語のデータは「合計」「お預り」を読める代わりに、数字を丸囲み文字
   * （218 → ②①⑧）に寄せてしまう。英語のデータは数字を素直に読む代わりに、
   * 見出しがまったく読めない。片方だけでは、どちらかを必ず落とす。
   * そこで英語で数字を、日本語で見出しを読み、同じ高さにあるもの同士を組にする。
   */
  function recognize(file, onProgress) {
    var prog = onProgress || function () {};
    return loadLib().then(function (T) {
      return prepare(file).then(function (input) {
        prog(0.08);
        // 数字を読む側。ここで採れた位置と値を土台にする
        return runPass(T, input, sources.numLang, PSM_SPARSE, function (f) { prog(0.08 + f * 0.34); })
          .then(function (num) {
            // 見出しを読む側。数字は当てにせず、位置と文字だけを使う。
            // どちらかが落としても、もう片方が拾えることが多いので2通りかける
            return runPass(T, input, sources.textLang, PSM_SPARSE, function (f) { prog(0.42 + f * 0.29); })
              .catch(function () { return null; })
              .then(function (jp1) {
                return runPass(T, input, sources.textLang, PSM_BLOCK, function (f) { prog(0.71 + f * 0.29); })
                  .catch(function () { return null; })
                  .then(function (jp2) { return combine(num, jp1, jp2); });
              });
          });
      });
    }).then(function (out) { prog(1); return out; });
  }

  /* 1つの学習データで1回読む。終わったら worker を畳んで次に備える */
  function runPass(T, input, lang, psm, onFrac) {
    var w = null;
    return T.createWorker(lang, 1, {
      workerPath: sources.worker,
      corePath: sources.core,
      langPath: sources.lang,
      logger: function (m) {
        if (!onFrac) return;
        // 学習データの取得までで半分、認識で残り半分
        if (m.status === 'recognizing text') onFrac(0.5 + (m.progress || 0) * 0.5);
        else onFrac(Math.min(0.49, (m.progress || 0) * 0.49));
      }
    }).then(function (worker) {
      w = worker;
      return w.setParameters({
        tessedit_pageseg_mode: psm,
        // 日本語の学習データは縦書きも探しにいく。レシートは横書きなので止める。
        // 止めないと、品目の1文字目だけを縦に拾った行ができて全部おかしくなる
        textord_tabfind_vertical_text: '0',
        // 語の間の空白を残す（「合計 ¥2,165」を1語に潰させない）
        preserve_interword_spaces: '1',
        // 解像度が分からないと縮尺の推定が外れるので、こちらで決めておく
        user_defined_dpi: '300'
      });
    }).then(function () {
      return w.recognize(input, {}, { text: true, blocks: true });
    }).then(function (r) {
      var data = (r && r.data) || {};
      var lines = fromBlocks(data);
      if (!lines.length) {
        var words = collectWords(data);
        if (words.length) lines = toLines(words);
      }
      var out = { text: data.text || '', lines: lines, height: pageHeight(collectWords(data)) };
      return w.terminate().then(function () { return out; }, function () { return out; });
    }, function (e) {
      if (w) w.terminate().catch(function () {});
      throw e;
    });
  }

  /**
   * 数字側の行に、同じ高さにある日本語の行を貼り合わせる。
   * @param {object} num 英語で読んだ結果
   * @param {object|null} jp 日本語で読んだ結果
   */
  function combine(num, jp1, jp2) {
    var jpLines = ((jp1 && jp1.lines) || []).concat((jp2 && jp2.lines) || []);

    function ctxFor(L) {
      var hit = [];
      jpLines.forEach(function (J) {
        var ov = Math.min(L.bottom, J.bottom) - Math.max(L.top, J.top);
        var small = Math.min(L.height, J.height);
        // 高さが3分の1以上重なっていれば、同じ行の見出しとみなす
        if (ov > 0 && ov >= small * 0.34) hit.push(J.text);
      });
      return hit.join(' ');
    }

    var H = Math.max(num.height || 1, (jp1 && jp1.height) || 1, (jp2 && jp2.height) || 1);
    var amounts;
    if (num.lines && num.lines.length) {
      amounts = pick(num.lines, { height: H }, ctxFor);
    } else if (jpLines.length) {
      amounts = pick(jpLines, { height: H });          // 数字側が空なら日本語だけで見る
    } else {
      amounts = candidates(num.text || (jp && jp.text) || '');
    }

    return {
      text: [num.text, jp1 && jp1.text, jp2 && jp2.text].filter(Boolean).join('\n---\n'),
      amounts: amounts
    };
  }

  /* words は版によって置き場所が違う（data.words / blocks の中）ので、両方から集める */
  function collectWords(data) {
    if (data.words && data.words.length) return data.words;
    var out = [];
    (data.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) {
          (l.words || []).forEach(function (w) { out.push(w); });
        });
      });
    });
    return out;
  }

  function pageHeight(words) {
    var max = 1;
    words.forEach(function (w) { if (w.bbox && w.bbox.y1 > max) max = w.bbox.y1; });
    return max;
  }

  DL.ocr = {
    read: read, candidates: candidates, sources: sources,
    prepare: prepare, toLines: toLines, fromBlocks: fromBlocks, pick: pick, fixDigits: fixDigits,
    setSources: function (o) { Object.assign(sources, o || {}); }
  };
})(window.DL);
