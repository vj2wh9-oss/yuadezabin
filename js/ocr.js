/* レシートの写真から金額を読み取る。

   文字認識は tesseract.js を使う。アプリ本体には同梱せず、
   「読み取る」を押したときだけ CDN から取りに行く（初回だけ数MB。以後はブラウザが持つ）。
   日本語の学習データは16MBあるが、レシートの金額は半角数字なので
   英語の軽い版（約2MB）で足りる。「合計」などの見出しは形で拾えなくても、
   金額の候補を並べて選んでもらう作りにしてある。 */
(function (DL) {
  'use strict';
  var U = DL.util;

  // 差し替えられるようにしておく（つながらない環境での試験や、別のCDNに移すとき）
  var sources = {
    lib: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js',
    worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
    core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6',
    lang: 'https://tessdata.projectnaptha.com/4.0.0_fast',
    langCode: 'eng'
  };

  var loading = null;

  /* tesseract.js を読み込む（一度だけ） */
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

  /**
   * 読み取りやすいように下ごしらえする。
   * 小さい字がつぶれないよう長辺2000pxまで伸ばし、白黒にして濃淡を強める。
   * @returns {Promise<HTMLCanvasElement|Blob>}
   */
  function prepare(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(2.5, Math.max(1, 2000 / Math.max(w, h)));
          var cv = document.createElement('canvas');
          cv.width = Math.round(w * scale);
          cv.height = Math.round(h * scale);
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cv.width, cv.height);

          var d = ctx.getImageData(0, 0, cv.width, cv.height);
          var px = d.data;
          for (var i = 0; i < px.length; i += 4) {
            // 明るさにして、中間を切り上げ・切り下げして文字を濃くする
            var g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
            g = g < 110 ? 0 : g > 175 ? 255 : (g - 110) * 255 / 65;
            px[i] = px[i + 1] = px[i + 2] = g;
          }
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

  // 合計らしい行の見出し。日本語の見出しは英語の学習データでは崩れるので、
  // 記号や数字の並びも手がかりにする
  var TOTAL_HINT = /(合\s*計|総\s*計|お?会\s*計|税\s*込|total|goukei)/i;
  // 合計ではない金額（小計・税・預り・釣り・ポイント・電話番号・日付）を下げる
  var SUB_HINT = /(小\s*計|subtotal|税\s*抜|外\s*税|内\s*税|消費税|tax|お?預(り|かり)?|釣|change|cash|現\s*金|point|ポイント|tel|電話|20\d{2}\s*[-\/\.年]\s*\d{1,2}\s*[-\/\.月]|\d{1,2}:\d{2})/i;
  var MONEY = /(?:[¥￥\\$]\s*)?(\d{1,3}(?:[,.]\d{3})+|\d{2,7})/g;

  /**
   * 認識した文字から金額の候補を作る。
   * 「合計」らしい行を上に、次に大きい金額を上にして並べる。
   */
  function candidates(text) {
    var out = [], seen = {};
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/\s+/g, ' ').trim();
      if (!line) return;
      var isTotal = TOTAL_HINT.test(line);
      var isNoise = SUB_HINT.test(line);
      var m;
      MONEY.lastIndex = 0;
      while ((m = MONEY.exec(line)) !== null) {
        var v = U.num(m[1].replace(/[,.]/g, ''), 0);
        if (v < 10 || v > 9999999) continue;           // 明らかに金額でないもの
        var key = v + '|' + line;
        if (seen[key]) continue;
        seen[key] = true;
        out.push({
          value: v, line: line,
          score: (isTotal ? 1000000 : 0) - (isNoise ? 500000 : 0) + v
        });
      }
    });
    // 同じ金額が何度も出たら1つにまとめ、点数の高い順に
    var byValue = {};
    out.forEach(function (c) {
      if (!byValue[c.value] || byValue[c.value].score < c.score) byValue[c.value] = c;
    });
    return Object.keys(byValue).map(function (k) { return byValue[k]; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 8);
  }

  /**
   * 写真から金額の候補を読み取る。
   * @param {File|Blob} file レシートの画像
   * @param {function} [onProgress] 0〜1 の進み具合
   * @returns {Promise<{text:string, amounts:Array}>}
   */
  function read(file, onProgress) {
    // 部品や学習データの取得に失敗すると、そのまま黙って止まってしまうことがある。
    // 待たせっぱなしにせず、時間で切って理由を返す
    return withTimeout(recognize(file, onProgress), 120000,
      '読み取りに時間がかかりすぎました。通信の具合を確かめて、もう一度お試しください')
      .catch(function (e) {
        // tesseract は文字列を投げてくることがある。画面に出せる形にそろえる
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

  function recognize(file, onProgress) {
    var worker = null;
    return loadLib().then(function (T) {
      return prepare(file).then(function (input) {
        return T.createWorker(sources.langCode, 1, {
          workerPath: sources.worker,
          corePath: sources.core,
          langPath: sources.lang,
          logger: function (m) {
            if (!onProgress) return;
            // 学習データの取得と認識で、それぞれ 0〜1 が来る
            if (m.status === 'recognizing text') onProgress(0.5 + m.progress * 0.5);
            else onProgress(Math.min(0.49, (m.progress || 0) * 0.49));
          }
        }).then(function (w) {
          worker = w;
          // 数字と通貨記号を優先させる（英字も残さないと行の見出しを拾えない）
          return w.setParameters({ tessedit_char_whitelist: '' }).then(function () {
            return w.recognize(input);
          });
        });
      });
    }).then(function (r) {
      var text = (r && r.data && r.data.text) || '';
      return { text: text, amounts: candidates(text) };
    }).then(function (out) {
      if (worker) return worker.terminate().then(function () { return out; }, function () { return out; });
      return out;
    }, function (e) {
      if (worker) worker.terminate().catch(function () {});
      throw e;
    });
  }

  DL.ocr = {
    read: read, candidates: candidates, sources: sources,
    setSources: function (o) { Object.assign(sources, o || {}); }
  };
})(window.DL);
