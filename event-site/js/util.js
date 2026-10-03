/* 小さな道具。METEO365 と同じ書きぶりにそろえてある（素の JS・ビルド無し） */
(function (DL) {
  'use strict';

  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

  /** '2026-11-23' → '11/23(月)' */
  function fmtMD(s) {
    if (!isISO(s)) return '';
    var p = s.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return (+p[1]) + '/' + (+p[2]) + '(' + WD[d.getDay()] + ')';
  }

  /** 日の差（b - a）。どちらも ISO */
  function diffDays(a, b) {
    if (!isISO(a) || !isISO(b)) return 0;
    var x = Date.parse(a + 'T00:00:00'), y = Date.parse(b + 'T00:00:00');
    return Math.round((y - x) / 86400000);
  }

  function num(v, d) {
    var n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : (d || 0);
  }

  function yen(n) { return '¥' + Math.round(num(n, 0)).toLocaleString('ja-JP'); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * 札を作る。METEO365 の el と同じ使い方。
   * @param {string} tag
   * @param {object} [attrs] text/class/style/onclick と、ふつうの属性
   * @param {Node|Array|null} [kids]
   */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') { n.textContent = v; return; }
      if (k === 'class') { n.className = v; return; }
      if (k === 'style' && typeof v === 'object') { Object.assign(n.style, v); return; }
      if (k.indexOf('on') === 0 && typeof v === 'function') {
        n.addEventListener(k.slice(2).toLowerCase(), v);
        return;
      }
      n.setAttribute(k, v === true ? '' : v);
    });
    append(n, kids);
    return n;
  }

  function append(n, kids) {
    if (kids === null || kids === undefined) return n;
    (Array.isArray(kids) ? kids : [kids]).forEach(function (k) {
      if (k === null || k === undefined || k === false) return;
      n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    });
    return n;
  }

  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  DL.util = {
    WD: WD, pad: pad, today: today, isISO: isISO, fmtMD: fmtMD, diffDays: diffDays,
    num: num, yen: yen, uid: uid, el: el, append: append, clear: clear, $: $, $$: $$
  };
})(window.DL = window.DL || {});
