/* 共通UI部品：トースト・ボトムシート・入力部品など */
(function (DL) {
  'use strict';
  var U = DL.util, el = U.el;

  /* ---------------- トースト ---------------- */
  function toast(msg, kind) {
    var root = U.$('#toastRoot');
    var t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    root.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 250);
    }, 2200);
  }

  /* ---------------- ボトムシート ---------------- */
  var sheetStack = [];

  function sheet(opts) {
    var root = U.$('#sheetRoot');
    var body = opts.body instanceof Node ? opts.body : el('div', { text: String(opts.body || '') });

    var closeBtn = el('button', { class: 'iconbtn', text: '×', 'aria-label': '閉じる', onclick: close });
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

  function segmented(options, value, onchange) {
    var wrap = el('div', { class: 'segmented' });
    options.forEach(function (o) {
      var b = el('button', {
        type: 'button', class: 'seg' + (String(o.value) === String(value) ? ' on' : ''), text: o.label,
        onclick: function () {
          U.$$('.seg', wrap).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          wrap.dataset.value = o.value;
          if (onchange) onchange(o.value);
        }
      });
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
      el('button', { type: 'button', class: 'stepbtn', text: '−', onclick: function () { set(value - 1); } }),
      inp,
      el('button', { type: 'button', class: 'stepbtn', text: '＋', onclick: function () { set(value + 1); } })
    ]);
    wrap.getValue = function () { return U.num(inp.value, 0); };
    wrap.setValue = function (v) { set(v, false); };
    return wrap;
  }

  /* ---------------- 表示部品 ---------------- */

  function progress(pct, color) {
    return el('div', { class: 'bar' }, el('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%', background: color || 'var(--accent)' } }));
  }

  function chip(text, cls, style) {
    return el('span', { class: 'chip ' + (cls || ''), text: text, style: style || null });
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

  function btn(text, cls, onclick) {
    return el('button', { type: 'button', class: 'btn ' + (cls || ''), text: text, onclick: onclick });
  }

  /* カテゴリ・種別のラベル */
  var KIND_LABEL = { event: '即売会', work: '仕事' };
  var CAT_LABEL = { manga: '漫画', illust: 'イラスト' };

  function kindChip(p) {
    return chip(KIND_LABEL[p.kind], 'kind-' + p.kind);
  }
  function catChip(p) {
    return chip(CAT_LABEL[p.category], 'cat-' + p.category);
  }

  /* ファイル保存（iOS では新規タブ／共有シートに回る場合がある） */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  DL.ui = {
    toast: toast, sheet: sheet, closeAllSheets: closeAllSheets, confirm: confirmSheet,
    field: field, input: input, textarea: textarea, select: select, segmented: segmented,
    stepper: stepper, progress: progress, chip: chip, section: section, card: card,
    empty: empty, btn: btn, kindChip: kindChip, catChip: catChip,
    KIND_LABEL: KIND_LABEL, CAT_LABEL: CAT_LABEL, download: download
  };
})(window.DL);
