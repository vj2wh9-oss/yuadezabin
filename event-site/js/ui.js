/* 画面の部品。METEO365 の ui と同じ名前・同じ使い勝手にそろえてある */
(function (DL) {
  'use strict';
  var U = DL.util, el = U.el;

  function icon(name, size, cls) { return DL.icons.icon(name, size, cls); }

  function btn(label, cls, onclick, iconName) {
    return el('button', {
      type: 'button', class: 'btn ' + (cls || ''), onclick: onclick || null
    }, [iconName ? icon(iconName, 16) : null, el('span', { text: label })]);
  }

  function chip(text, cls) {
    return el('span', { class: 'chip ' + (cls || ''), text: text });
  }

  function section(title, right) {
    return el('div', { class: 'section' }, [el('span', { text: title }), right || null]);
  }

  function empty(text, extra) {
    return el('div', { class: 'empty' }, [el('div', { text: text }), extra || null]);
  }

  function field(label, node) {
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }), node
    ]);
  }

  function input(attrs) {
    var a = Object.assign({ type: 'text' }, attrs || {});
    a.class = 'input ' + (a.class || '');
    return el('input', a);
  }

  /* ---------------- 知らせ ---------------- */

  function toast(text, cls) {
    var root = U.$('#toastRoot');
    var n = el('div', { class: 'toast ' + (cls || ''), text: text });
    root.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 3200);
  }

  /* ---------------- シート ---------------- */

  var sheets = [];

  /**
   * 下から出す一枚。
   * @param {object} o {title, body, actions:[Node]}
   * @returns {function} 閉じるもの
   */
  function sheet(o) {
    var root = U.$('#sheetRoot');
    var back = el('div', { class: 'sheet-back' });
    var close = function () {
      if (back.parentNode) back.parentNode.removeChild(back);
      sheets = sheets.filter(function (x) { return x !== close; });
    };
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    var box = el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-head' }, [
        el('span', { class: 'sheet-title', text: o.title || '' }),
        el('button', {
          type: 'button', class: 'iconbtn', 'aria-label': '閉じる', onclick: close
        }, icon('close', 18))
      ]),
      el('div', { class: 'sheet-body' }, o.body || null),
      (o.actions && o.actions.length) ? el('div', { class: 'sheet-foot' }, o.actions) : null
    ]);
    back.appendChild(box);
    root.appendChild(back);
    sheets.push(close);
    return close;
  }

  function closeAll() { sheets.slice().forEach(function (c) { c(); }); }

  /**
   * 確かめる。はい／いいえだけの一枚。
   * @returns {Promise<boolean>}
   */
  function confirm(text, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var done = false;
      var end = function (v) { if (done) return; done = true; close(); resolve(v); };
      var close = sheet({
        title: o.title || '確かめます',
        body: el('p', { text: text, style: { whiteSpace: 'pre-wrap' } }),
        actions: [
          btn('やめる', 'ghost', function () { end(false); }),
          btn(o.okText || 'はい', o.danger ? 'danger' : 'primary', function () { end(true); })
        ]
      });
    });
  }

  DL.ui = {
    icon: icon, btn: btn, chip: chip, section: section, empty: empty,
    field: field, input: input, toast: toast, sheet: sheet, closeAll: closeAll,
    confirm: confirm
  };
})(window.DL = window.DL || {});
