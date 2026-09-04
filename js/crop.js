/* レシートの写真から、紙の部分だけを切り出す。

   撮った写真には机や手が写り込む。そのまま読ませると、
   よけいなところに引っぱられるうえ、送る画素も無駄になる。

   やり方
     1. 小さくしてから当たりを付ける（全画素を見ると重い）
     2. ぼかしてから、明るさで「紙」と「そのほか」に分ける（大津の方法）
     3. つながっている塊のうち、いちばん大きいものを紙とみなす
     4. その外枠を元の大きさに戻して切り出す
     5. 長辺 2000px 前後に縮める（字が潰れない範囲で、送る量を抑える）

   紙が見つからない・切りすぎになるときは、切らずにそのまま返す。
   読み取りが止まるより、余白ごと送るほうがましなので。 */
(function (DL) {
  'use strict';

  var WORK = 480;           // 当たりを付けるときの長辺
  var OUT_MAX = 2000;       // 送るときの長辺
  var QUALITY = 0.86;
  var PAD = 0.012;          // 切り口の余裕（紙の端を落とさないため）

  // 見つけた塊が紙だと言えるかの目安
  var MIN_AREA = 0.10;      // 画面のこれ未満なら小さすぎる（写り込みを拾っている）
  var MAX_AREA = 0.97;      // これ以上なら切る意味がない（背景ごと拾っている）
  var MIN_FILL = 0.55;      // 外枠のうち塊が占める割合。低いと紙の形をしていない

  /**
   * 写真からレシートの部分を切り出して縮める。
   * @param {Blob|File} file
   * @param {object} [opts] {max:長辺, quality:0-1, crop:false で切らずに縮めるだけ}
   * @returns {Promise<{file:File, cropped:boolean, box:object|null, width:number, height:number, why:string}>}
   */
  function receipt(file, opts) {
    opts = opts || {};
    var max = opts.max || OUT_MAX;
    var quality = opts.quality || QUALITY;

    return load(file).then(function (img) {
      if (!img) return { file: file, cropped: false, box: null, width: 0, height: 0, why: 'no_image' };

      var found = opts.crop === false ? { box: null, why: 'skipped' } : detect(img);
      var box = found.box || { x: 0, y: 0, w: img.width, h: img.height };
      var scale = Math.min(1, max / Math.max(box.w, box.h));
      var ow = Math.max(1, Math.round(box.w * scale));
      var oh = Math.max(1, Math.round(box.h * scale));

      // 切りも縮めもしないなら、撮ったままを渡す（作り直すと画質だけ落ちる）
      if (!found.box && scale >= 1) {
        return { file: file, cropped: false, box: null, width: img.width, height: img.height, why: found.why };
      }

      var cv = document.createElement('canvas');
      cv.width = ow; cv.height = oh;
      cv.getContext('2d').drawImage(img.el, box.x, box.y, box.w, box.h, 0, 0, ow, oh);

      return toBlob(cv, quality).then(function (blob) {
        if (!blob) return { file: file, cropped: false, box: null, width: img.width, height: img.height, why: 'encode_failed' };
        var name = String(file.name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg';
        return {
          file: new File([blob], name, { type: 'image/jpeg' }),
          cropped: !!found.box, box: found.box, width: ow, height: oh, why: found.why
        };
      });
    }).catch(function () {
      // canvas が使えないなど。切らずにそのまま渡す
      return { file: file, cropped: false, box: null, width: 0, height: 0, why: 'error' };
    });
  }

  /* ---------------- 紙のありかを探す ---------------- */

  /**
   * @returns {{box:{x,y,w,h}|null, why:string}} box は元の画素での位置
   */
  function detect(img) {
    var s = Math.min(1, WORK / Math.max(img.width, img.height));
    var w = Math.max(8, Math.round(img.width * s));
    var h = Math.max(8, Math.round(img.height * s));

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img.el, 0, 0, w, h);

    var px;
    try { px = cx.getImageData(0, 0, w, h).data; } catch (e) { return { box: null, why: 'no_pixels' }; }

    var gray = toGray(px, w, h);
    blur(gray, w, h);
    var th = otsu(gray);
    // 紙は背景より明るい前提。しきい値より明るいところを紙の候補にする
    var mask = new Uint8Array(w * h);
    var bright = 0;
    for (var i = 0; i < gray.length; i++) {
      if (gray[i] > th) { mask[i] = 1; bright++; }
    }
    if (!bright) return { box: null, why: 'no_paper' };

    var blob = largest(mask, w, h);
    if (!blob) return { box: null, why: 'no_paper' };

    var area = (blob.w * blob.h) / (w * h);
    if (area < MIN_AREA) return { box: null, why: 'too_small' };
    if (area > MAX_AREA) return { box: null, why: 'whole_image' };
    if (blob.count / (blob.w * blob.h) < MIN_FILL) return { box: null, why: 'not_paper' };

    // 元の大きさに戻し、少しだけ余裕を持たせる
    var padX = Math.round(blob.w * PAD), padY = Math.round(blob.h * PAD);
    var x0 = Math.max(0, blob.x - padX), y0 = Math.max(0, blob.y - padY);
    var x1 = Math.min(w, blob.x + blob.w + padX), y1 = Math.min(h, blob.y + blob.h + padY);

    var box = {
      x: Math.max(0, Math.floor(x0 / s)),
      y: Math.max(0, Math.floor(y0 / s)),
      w: Math.min(img.width, Math.ceil((x1 - x0) / s)),
      h: Math.min(img.height, Math.ceil((y1 - y0) / s))
    };
    if (box.x + box.w > img.width) box.w = img.width - box.x;
    if (box.y + box.h > img.height) box.h = img.height - box.y;
    if (box.w < 8 || box.h < 8) return { box: null, why: 'too_small' };
    return { box: box, why: 'ok' };
  }

  function toGray(px, w, h) {
    var g = new Uint8ClampedArray(w * h);
    for (var i = 0, j = 0; j < g.length; i += 4, j++) {
      g[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    }
    return g;
  }

  /* 3x3 のならし。影のふちや紙の模様で塊が切れるのを防ぐ */
  function blur(g, w, h) {
    var src = new Uint8ClampedArray(g);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        g[i] = (src[i - w - 1] + src[i - w] + src[i - w + 1] +
                src[i - 1] + src[i] + src[i + 1] +
                src[i + w - 1] + src[i + w] + src[i + w + 1]) / 9;
      }
    }
  }

  /* 大津の方法。明暗の2山がいちばんよく分かれる明るさを返す */
  function otsu(g) {
    var hist = new Float64Array(256), i;
    for (i = 0; i < g.length; i++) hist[g[i]]++;
    var total = g.length, sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];

    var sumB = 0, wB = 0, best = 0, th = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; th = i; }
    }
    return th;
  }

  /**
   * つながっている 1 の塊のうち、いちばん大きいものの外枠。
   * 再帰は深くなりすぎるので、自前の積み上げで広げる。
   */
  function largest(mask, w, h) {
    var seen = new Uint8Array(w * h);
    var stack = new Int32Array(w * h);
    var best = null;

    for (var start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      var top = 0;
      stack[top++] = start;
      seen[start] = 1;
      var count = 0, minX = w, maxX = -1, minY = h, maxY = -1;

      while (top) {
        var p = stack[--top];
        var y = (p / w) | 0, x = p - y * w;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[top++] = p - w; }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[top++] = p + w; }
      }
      if (!best || count > best.count) {
        best = { count: count, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
      }
    }
    return best;
  }

  /* ---------------- 読み込み ---------------- */

  /* 向き（Exif）を直したうえで、canvas に描けるものを返す */
  function load(file) {
    if (!file || String(file.type || '').indexOf('image/') !== 0) return Promise.resolve(null);

    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(function (bm) { return { el: bm, width: bm.width, height: bm.height }; })
        .catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }

  function viaImg(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve({ el: img, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function toBlob(cv, quality) {
    return new Promise(function (resolve) {
      try { cv.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality); }
      catch (e) { resolve(null); }
    });
  }

  DL.crop = { receipt: receipt, detect: detect, load: load, OUT_MAX: OUT_MAX };
})(window.DL);
