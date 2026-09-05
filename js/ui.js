/* 共通UI部品：トースト・ボトムシート・入力部品など */
(function (DL) {
  'use strict';
  var U = DL.util, el = U.el;

  /* ---------------- トースト ---------------- */

  // 出すのは常に1つだけ。続けて押すと積み上がって画面を埋めてしまうので、
  // 前のものは片づけてから新しいものを出す（新しいほうだけを見せる）
  var toastNow = null;

  function toast(msg, kind) {
    var root = U.$('#toastRoot');
    if (toastNow) {
      clearTimeout(toastNow.hide);
      clearTimeout(toastNow.gone);
      toastNow.node.remove();
      toastNow = null;
    }
    U.$$('.toast', root).forEach(function (n) { n.remove(); });   // 取りこぼしの掃除

    var t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    root.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });

    var cur = { node: t };
    toastNow = cur;
    cur.hide = setTimeout(function () {
      t.classList.remove('show');
      cur.gone = setTimeout(function () {
        t.remove();
        if (toastNow === cur) toastNow = null;
      }, 250);
    }, 2200);
  }

  /* ---------------- ボトムシート ---------------- */
  var sheetStack = [];

  function sheet(opts) {
    var root = U.$('#sheetRoot');
    var body = opts.body instanceof Node ? opts.body : el('div', { text: String(opts.body || '') });

    var closeBtn = el('button', { class: 'iconbtn', 'aria-label': '閉じる', onclick: close }, DL.icons.icon('close', 20));
    var head = el('div', { class: 'sheet-head' }, [
      el('h2', { class: 'sheet-title', text: opts.title || '' }), closeBtn
    ]);

    var foot = null;
    if (opts.actions && opts.actions.length) {
      foot = el('div', { class: 'sheet-foot' }, opts.actions);
    }

    var panel = el('div', { class: 'sheet' + (opts.wide ? ' wide' : '') }, [
      el('div', { class: 'sheet-grip' }), head,
      el('div', { class: 'sheet-body' }, body), foot
    ]);
    var back = el('div', { class: 'sheet-back', onclick: function (e) { if (e.target === back) close(); } }, panel);
    root.appendChild(back);
    document.body.classList.add('no-scroll');
    requestAnimationFrame(function () { back.classList.add('show'); });

    var entry = { back: back, close: close };
    sheetStack.push(entry);

    function close() {
      back.classList.remove('show');
      sheetStack = sheetStack.filter(function (s) { return s !== entry; });
      if (!sheetStack.length) document.body.classList.remove('no-scroll');
      setTimeout(function () { back.remove(); }, 260);
      if (opts.onClose) opts.onClose();
    }
    return close;
  }

  function closeAllSheets() {
    sheetStack.slice().forEach(function (s) { s.close(); });
  }

  function confirmSheet(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var close = sheet({
        title: opts.title || '確認',
        body: el('p', { class: 'sheet-msg', text: message }),
        actions: [
          el('button', { class: 'btn ghost', text: opts.cancelText || 'キャンセル', onclick: function () { close(); } }),
          el('button', {
            class: 'btn ' + (opts.danger ? 'danger' : 'primary'), text: opts.okText || 'OK',
            onclick: function () { done = true; resolve(true); close(); }
          })
        ],
        onClose: function () { if (!done) resolve(false); }
      });
    });
  }

  /* ---------------- 入力部品 ---------------- */

  function field(label, input, hint) {
    return el('label', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }),
      input,
      hint ? el('span', { class: 'field-hint', text: hint }) : null
    ]);
  }

  /**
   * field と同じ見た目だが、<label> にしない。
   * 中にボタンなどを並べるときはこちら。<label> にすると、その見出しが
   * 中の最初のボタンの読み上げ名になってしまい、何のボタンか分からなくなる。
   */
  function block(label, content, hint) {
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }),
      content,
      hint ? el('span', { class: 'field-hint', text: hint }) : null
    ]);
  }

  function input(props) {
    return el('input', Object.assign({ class: 'input', type: 'text' }, props || {}));
  }

  function textarea(props) {
    return el('textarea', Object.assign({ class: 'input area', rows: 3 }, props || {}));
  }

  function select(options, value, onchange) {
    var s = el('select', { class: 'input select', onchange: onchange || null },
      options.map(function (o) {
        return el('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) });
      }));
    s.value = value;
    return s;
  }

  /**
   * 品目に付ける分類の選び口。設定で作った分類が並ぶ。
   * 消された分類が付いたままの品目もあるので、その値は先頭に足して残す。
   */
  function tagSelect(value, onchange) {
    var list = DL.store.tags();
    var opts = [{ value: '', label: '（分類なし）' }].concat(list.map(function (t) {
      return { value: t.id, label: t.name };
    }));
    if (value && !list.filter(function (t) { return t.id === value; }).length) {
      opts.push({ value: value, label: '(消された分類)' });
    }
    var s = select(opts, value || '', onchange);
    s.classList.add('tag-select');
    // まだ付けていないものは薄く出す（付いているものが目に入るように）
    function mark() { s.classList.toggle('empty', !s.value); }
    s.addEventListener('change', mark);
    mark();
    return s;
  }

  function segmented(options, value, onchange) {
    var wrap = el('div', { class: 'segmented' });
    options.forEach(function (o) {
      var b = el('button', {
        type: 'button', class: 'seg' + (String(o.value) === String(value) ? ' on' : ''),
        onclick: function () {
          U.$$('.seg', wrap).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          wrap.dataset.value = o.value;
          if (onchange) onchange(o.value);
        }
      }, [o.icon ? icon(o.icon, 16) : null, el('span', { text: o.label })]);
      wrap.appendChild(b);
    });
    wrap.dataset.value = value;
    return wrap;
  }

  /* 数値ステッパー（±ボタン付き） */
  function stepper(opts) {
    var value = U.num(opts.value, 0);
    var inp = el('input', {
      class: 'input num', type: 'number', inputmode: 'numeric', value: value, min: 0,
      onchange: function () { set(U.num(inp.value, 0), true); }
    });
    function set(v, fire) {
      v = Math.max(0, v);
      if (opts.max !== undefined && opts.max !== null) v = Math.min(opts.max, v);
      value = v; inp.value = v;
      if (fire !== false && opts.onChange) opts.onChange(v);
    }
    var wrap = el('div', { class: 'stepper' }, [
      el('button', { type: 'button', class: 'stepbtn', 'aria-label': '減らす', onclick: function () { set(value - 1); } }, DL.icons.icon('minus', 20)),
      inp,
      el('button', { type: 'button', class: 'stepbtn', 'aria-label': '増やす', onclick: function () { set(value + 1); } }, DL.icons.icon('plus', 20))
    ]);
    wrap.getValue = function () { return U.num(inp.value, 0); };
    wrap.setValue = function (v) { set(v, false); };
    return wrap;
  }

  /* ---------------- 表示部品 ---------------- */

  function progress(pct, color) {
    return el('div', { class: 'bar' }, el('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%', background: color || 'var(--accent)' } }));
  }

  function icon(name, size, cls) { return DL.icons.icon(name, size, cls); }

  /* ---------------- 画面に入ったときの見せ方 ----------------

     金額は0から数え上げ、グラフはまっさらな状態から描き足す。
     画面を開いたときだけで、保存のたびの描き直しでは動かさない
     （動かすと、打つたびに数字が跳ねてうるさい）。

     「動きを減らす」設定の端末では、いきなり最終形にする。 */

  var INTRO_MS = 900;

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* だんだん減速する。最後がぴたっと止まって見える */
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /**
   * 0 から今の値まで数え上げる。
   * 文字はそのまま使い、中の数字だけ差し替えるので
   * 「¥1,234」「-¥500」「4件」のどれでも動く。
   */
  function countUp(node, wait) {
    var full = node.textContent;
    var m = /^(\D*)(-?[\d,]+)(\D*)$/.exec(full);
    if (!m) return;                                  // 数字が無いものは触らない
    var to = parseInt(m[2].replace(/,/g, ''), 10);
    if (!isFinite(to) || to === 0) return;
    var head = m[1], tail = m[3];
    var comma = m[2].indexOf(',') >= 0;

    var write = function (v) {
      node.textContent = head + (comma ? v.toLocaleString('en-US') : String(v)) + tail;
    };
    write(0);
    ramp(node, function (t) { write(Math.round(to * t)); },
      function () { node.textContent = full; }, wait);
  }

  /** 横棒。幅0から今の幅まで伸ばす */
  function growBar(node, wait) {
    var w = node.style.width;
    if (!w) return;
    node.style.width = '0%';
    ramp(node, function (t) { node.style.width = 'calc(' + w + ' * ' + t.toFixed(4) + ')'; },
      function () { node.style.width = w; }, wait);
  }

  /** 折れ線。左から描き足す */
  function drawLine(node, wait) {
    var len;
    try { len = node.getTotalLength(); } catch (e) { return; }
    if (!len) return;
    node.style.strokeDasharray = len;
    node.style.strokeDashoffset = len;
    ramp(node, function (t) { node.style.strokeDashoffset = String(len * (1 - t)); }, function () {
      node.style.strokeDasharray = '';
      node.style.strokeDashoffset = '';
    }, wait);
  }

  /**
   * 1日の時間のグラフ。0時のところから、円なら時計回り、長方形なら左から出す。
   * どう描き足すかはグラフ側が知っているので、_sweep(0→1) を呼ぶだけ。
   * こうすると、まん中の字や目盛りは動かさずに中身だけ埋まっていく。
   */
  function sweep(node, wait) {
    if (typeof node._sweep !== 'function') return;
    node._sweep(0);
    ramp(node, node._sweep, function () { node._sweep(1); }, wait);
  }

  /* 毎フレーム step(0→1) を呼び、終わったら done()。
     途中で画面が描き直されたら、その時点でやめる。
     wait を渡すと、そのぶん空のまま待ってから動きだす */
  function ramp(node, step, done, wait) {
    var t0 = 0;
    var tick = function (now) {
      if (!node.isConnected) { done(); return; }     // 描き直された
      if (!t0) t0 = now + (wait || 0);
      var t = (now - t0) / INTRO_MS;
      if (t < 0) { requestAnimationFrame(tick); return; }   // まだ待っているところ
      if (t >= 1) { done(); return; }
      step(easeOut(t));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * 開いたばかりの画面に、ひととおりの見せ方をかける。
   * app.js が画面を組み立てたあとに一度だけ呼ぶ。
   *
   * 空にするのはここで済ませ、動きだすのは wait ミリ秒あと。
   * 起動の幕が開くのに合わせたいときに使う。空にするのを遅らせると、
   * 埋まった状態が一瞬見えてしまうので、そこは必ず先にやる。
   * @param {number} [wait] 動きだすまでの間（ミリ秒）
   */
  function introduce(root, wait) {
    if (!root || reduceMotion()) return;
    var go = function (fn) { return function (n) { fn(n, wait); }; };
    U.$$('.sum-box b', root).forEach(go(countUp));
    U.$$('.cat-bar i, .ms-bar i, .bg-bar i', root).forEach(go(growBar));
    U.$$('.lc-line', root).forEach(go(drawLine));
    U.$$('.tp-pie, .tp-bar', root).forEach(go(sweep));
  }

  function chip(text, cls, style) {
    return el('span', { class: 'chip ' + (cls || ''), text: text, style: style || null });
  }

  // アイコン付きのチップ
  function iconChip(name, text, cls) {
    return el('span', { class: 'chip ' + (cls || '') }, [icon(name, 13), el('span', { text: text })]);
  }

  /* 大きな日付の見出し（2026年8月31日(月)）。数字を大きく、年と単位は控えめに */
  function dateHead(iso) {
    if (!U.isISO(iso)) return el('div', { class: 'today-date', text: '—' });
    var p = iso.split('-'), w = U.dow(iso);
    // 祝日は日付のすぐ右に、日付と同じ大きさで添える
    var hol = DL.holidays ? DL.holidays.name(iso) : '';
    return el('div', { class: 'today-date' }, [
      el('span', { class: 'td-year', text: (+p[0]) + '年' }),
      el('b', { class: 'td-num', text: String(+p[1]) }),
      el('span', { class: 'td-unit', text: '月' }),
      el('b', { class: 'td-num', text: String(+p[2]) }),
      el('span', { class: 'td-unit', text: '日' }),
      el('span', { class: 'td-wd ' + (w === 0 || hol ? 'sun' : w === 6 ? 'sat' : ''), text: U.wdName(w) }),
      hol ? el('span', { class: 'td-holiday', text: hol }) : null
    ]);
  }

  function section(title, right) {
    return el('div', { class: 'section' }, [
      el('h2', { class: 'section-title', text: title }),
      right ? el('div', { class: 'section-right' }, right) : null
    ]);
  }

  function card(children, props) {
    return el('div', Object.assign({ class: 'card' }, props || {}), children);
  }

  function empty(text, action) {
    return el('div', { class: 'empty' }, [el('p', { text: text }), action || null]);
  }

  function btn(text, cls, onclick, iconName) {
    return el('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: onclick }, [
      iconName ? icon(iconName, 16) : null,
      el('span', { text: text })
    ]);
  }

  /* カテゴリ・種別のラベル */
  var KIND_LABEL = { event: '即売会', work: '仕事', support: '支援サイト' };
  var CAT_LABEL = { manga: '漫画', illust: 'イラスト', design: 'デザイン' };
  var KIND_ICON = { event: 'event', work: 'work', support: 'support' };
  var CAT_ICON = { manga: 'manga', illust: 'illust', design: 'design' };

  function kindChip(p) {
    return iconChip(KIND_ICON[p.kind], KIND_LABEL[p.kind], 'kind-' + p.kind);
  }
  function catChip(p) {
    return iconChip(CAT_ICON[p.category], CAT_LABEL[p.category], 'cat-' + p.category);
  }

  /* ファイル保存（iOS では Safari のダウンロード先へ入る） */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /**
   * 共有シート経由の保存。iPhone では「"ファイル"に保存」で保存先フォルダを選べる。
   * 使えない環境では通常のダウンロードに落とす。ボタンのタップから呼ぶこと。
   * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
   */
  function shareFile(filename, text, mime) {
    var type = (mime || 'text/plain') + ';charset=utf-8';
    var file;
    try { file = new File([text], filename, { type: type }); } catch (e) { file = null; }
    if (!file || !navigator.canShare || !navigator.canShare({ files: [file] })) {
      download(filename, text, mime);
      return Promise.resolve('downloaded');
    }
    return navigator.share({ files: [file], title: filename })
      .then(function () { return 'shared'; })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        download(filename, text, mime);
        return 'downloaded';
      });
  }

  DL.ui = {
    toast: toast, sheet: sheet, closeAllSheets: closeAllSheets, confirm: confirmSheet,
    introduce: introduce,
    field: field, block: block, input: input, textarea: textarea, select: select, tagSelect: tagSelect, segmented: segmented,
    stepper: stepper, progress: progress, chip: chip, iconChip: iconChip, icon: icon,
    section: section, card: card, dateHead: dateHead,
    empty: empty, btn: btn, kindChip: kindChip, catChip: catChip,
    KIND_LABEL: KIND_LABEL, CAT_LABEL: CAT_LABEL, KIND_ICON: KIND_ICON, CAT_ICON: CAT_ICON,
    download: download, shareFile: shareFile
  };
})(window.DL);
