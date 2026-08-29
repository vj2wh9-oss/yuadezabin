/* 汎用ユーティリティ（日付・DOM） */
window.DL = window.DL || {};
(function (DL) {
  'use strict';

  /* ---------------- 日付 ---------------- */
  // 日付は全て 'YYYY-MM-DD' のローカル日付文字列で扱う（時刻・タイムゾーンの事故を避けるため）

  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function toISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parse(iso) {
    var p = String(iso).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function isISO(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }

  function today() { return toISO(new Date()); }

  function addDays(iso, n) {
    var d = parse(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  function addMonths(iso, n) {
    var d = parse(iso);
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return toISO(d);
  }

  // a から b までの日数（b - a）
  function diffDays(a, b) {
    return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
  }

  function dow(iso) { return parse(iso).getDay(); }

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function min(a, b) { return cmp(a, b) <= 0 ? a : b; }
  function max(a, b) { return cmp(a, b) >= 0 ? a : b; }
  function clampDate(v, lo, hi) { return min(max(v, lo), hi); }

  // 期間内の日付配列（両端含む）
  function rangeDays(from, to) {
    var out = [];
    if (!isISO(from) || !isISO(to) || cmp(from, to) > 0) return out;
    var cur = from, guard = 0;
    while (cmp(cur, to) <= 0 && guard++ < 4000) { out.push(cur); cur = addDays(cur, 1); }
    return out;
  }

  function monthStart(iso) { return iso.slice(0, 8) + '01'; }
  function monthEnd(iso) {
    var d = parse(iso);
    return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  /* 表示用フォーマット */
  function fmtMD(iso) { if (!isISO(iso)) return '—'; var p = iso.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function fmtMDW(iso) { if (!isISO(iso)) return '—'; return fmtMD(iso) + '(' + WD[dow(iso)] + ')'; }
  function fmtYMD(iso) { if (!isISO(iso)) return '—'; var p = iso.split('-'); return p[0] + '/' + (+p[1]) + '/' + (+p[2]); }
  function fmtYMDW(iso) { if (!isISO(iso)) return '—'; return fmtYMD(iso) + '(' + WD[dow(iso)] + ')'; }
  function wdName(i) { return WD[i]; }

  // 残り日数の表現
  function untilLabel(iso, base) {
    if (!isISO(iso)) return '';
    var d = diffDays(base || today(), iso);
    if (d === 0) return '今日';
    if (d === 1) return '明日';
    if (d === 2) return '明後日';
    if (d < 0) return Math.abs(d) + '日超過';
    return 'あと' + d + '日';
  }

  /* ---------------- DOM ---------------- */

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) { children.forEach(function (c) { append(node, c); }); return node; }
    node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------------- その他 ---------------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function num(v, def) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (def === undefined ? 0 : def) : n;
  }

  function sum(arr, f) {
    return arr.reduce(function (a, x) { return a + (f ? f(x) : x); }, 0);
  }

  function groupBy(arr, f) {
    var m = {};
    arr.forEach(function (x) { var k = f(x); (m[k] = m[k] || []).push(x); });
    return m;
  }

  DL.util = {
    WD: WD, pad: pad, toISO: toISO, parse: parse, isISO: isISO, today: today,
    addDays: addDays, addMonths: addMonths, diffDays: diffDays, dow: dow,
    cmp: cmp, minDate: min, maxDate: max, clampDate: clampDate, rangeDays: rangeDays,
    monthStart: monthStart, monthEnd: monthEnd,
    fmtMD: fmtMD, fmtMDW: fmtMDW, fmtYMD: fmtYMD, fmtYMDW: fmtYMDW,
    wdName: wdName, untilLabel: untilLabel,
    el: el, append: append, clear: clear, $: $, $$: $$,
    uid: uid, clone: clone, num: num, sum: sum, groupBy: groupBy
  };
})(window.DL);
