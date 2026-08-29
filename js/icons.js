/* 自前のアイコン（インラインSVG）
   24x24 グリッド・線幅1.7・角は落とさない（square cap / miter join）で統一する。
   色は currentColor を継承するので、CSS の色設定がそのまま効く。 */
(function (DL) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  var PATHS = {
    /* ナビゲーション */
    home: '<path d="M3 11.4 12 4l9 7.4"/><path d="M5.5 10.2V20h5v-6h3v6h5v-9.8"/>',
    calendar: '<path d="M3.5 5.5h17v15h-17z"/><path d="M3.5 10.2h17"/><path d="M8 3v4.5M16 3v4.5"/><path d="M7 13h3v3H7zM14 13h3v3h-3z"/>',
    projects: '<path d="M4.5 3.5h10l5 5v12h-15z"/><path d="M14.5 3.5V9h5"/><path d="M8 12.5h8M8 16h8"/>',
    settings: '<path d="M3 6.5h10M17.6 6.5H21"/><path d="M13 4.3h4.6v4.4H13z"/>' +
              '<path d="M3 12h3M10.6 12H21"/><path d="M6 9.8h4.6v4.4H6z"/>' +
              '<path d="M3 17.5h10M17.6 17.5H21"/><path d="M13 15.3h4.6v4.4H13z"/>',

    /* 種別・内容 */
    event: '<path d="M6 3v18"/><path d="M6 4.5h13l-3.2 4.6L19 13.7H6z"/>',
    work: '<path d="M3 7.5h18v13H3z"/><path d="M9 7.5V4.5h6v3"/><path d="M3 13h18"/><path d="M11 12h2v2.4h-2z"/>',
    // 支援サイト：「F」を角ばった枠に収めたマーク
    support: '<path d="M3.2 3.2h17.6v17.6H3.2z"/><path d="M8.9 17.6V6.9h6.6"/><path d="M8.9 11.9h5.1"/>',
    manga: '<path d="M3.5 5h8v14h-8zM12.5 5h8v14h-8z"/><path d="M6 8.5h3M6 11.5h3M15 8.5h3M15 11.5h3"/>',
    design: '<path d="M3.5 4.5h17v15h-17z"/><path d="M6.5 7.5h11v3.4h-11z"/><path d="M6.5 13.4h4.8v3.1H6.5zM12.7 13.4h4.8v3.1h-4.8z"/>',
    illust: '<path d="M3.5 4.5h17v15h-17z"/><path d="M3.5 16.2 9 10.7l4 4 3-3 4.5 4.5"/><path d="M14.6 7.2h2.6v2.6h-2.6z"/>',

    /* 締切まわり */
    deadline: '<path d="M6 3h12M6 21h12"/><path d="M8 3v3.6l4 4 4-4V3"/><path d="M8 21v-3.6l4-4 4 4V21"/>',
    printer: '<path d="M7 8V3h10v5"/><path d="M3.5 8h17v8h-3.5v5h-10v-5H3.5z"/><path d="M7.5 16h9"/><path d="M17 10.5h1.5"/>',
    invoice: '<path d="M4.5 3.5h15v17h-15z"/><path d="M9 8.5l3 3 3-3"/><path d="M12 11.5v5"/><path d="M9.3 13.2h5.4M9.3 15.4h5.4"/>',
    receipt: '<path d="M4.5 3.5h15v17l-2.5-1.6-2.5 1.6-2.5-1.6-2.5 1.6L7 18.9l-2.5 1.6z"/><path d="M8 8.5h8M8 12h8"/>',
    task: '<path d="M4.5 3.5h15v17h-15z"/><path d="M8 9l2.2 2.2L15 6.5"/><path d="M8 15.5h8"/>',
    // 売上：軸と棒グラフ
    sales: '<path d="M3.5 3.5v17h17"/><path d="M7 17.2v-5.6h3.2v5.6zM13.3 17.2V7.2h3.2v10z"/>',
    // 屋号：軒先のある店構え
    issuer: '<path d="M3.5 8.6h17v11.9h-17z"/><path d="M5.6 3.5h12.8l2.1 5.1h-17z"/><path d="M9.6 20.5v-6.2h4.8v6.2z"/>',

    /* 操作 */
    plus: '<path d="M12 4.5v15M4.5 12h15"/>',
    minus: '<path d="M4.5 12h15"/>',
    check: '<path d="M4 12.4 9.6 18 20 6.6"/>',
    close: '<path d="M5 5 19 19M19 5 5 19"/>',
    chevronRight: '<path d="M9 4.5 16.5 12 9 19.5"/>',
    chevronLeft: '<path d="M15 4.5 7.5 12 15 19.5"/>',
    chevronDown: '<path d="M4.5 9 12 16.5 19.5 9"/>',
    arrowRight: '<path d="M3.5 12h15"/><path d="M13 6.5 18.5 12 13 17.5"/>',
    arrowUp: '<path d="M12 20V5"/><path d="M6 11 12 5l6 6"/>',
    arrowDown: '<path d="M12 4v15"/><path d="M6 13l6 6 6-6"/>',
    edit: '<path d="M4 20v-4.2L15.8 4l4.2 4.2L8.2 20z"/><path d="M13.8 6l4.2 4.2"/>',
    more: '<path d="M3.5 10.5h3.4v3.4H3.5zM10.3 10.5h3.4v3.4h-3.4zM17.1 10.5h3.4v3.4h-3.4z" fill="currentColor" stroke="none"/>',
    search: '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20.5 20.5"/>',
    trash: '<path d="M4.5 6.5h15"/><path d="M9 6.5V3.5h6v3"/><path d="M6.5 6.5 7.6 20.5h8.8L17.5 6.5"/><path d="M10 10.5v6M14 10.5v6"/>',
    refresh: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/>',

    /* 状態 */
    alert: '<path d="M12 3.5 22 20.5H2z"/><path d="M12 9.6v5"/><path d="M11.2 16.6h1.6v1.7h-1.6z" fill="currentColor" stroke="none"/>',
    info: '<path d="M4 4h16v16H4z"/><path d="M12 11v6"/><path d="M11.2 7.2h1.6v1.7h-1.6z" fill="currentColor" stroke="none"/>',
    clock: '<path d="M4 4h16v16H4z"/><path d="M12 7.5V12l3 2.2"/>'
  };

  /**
   * アイコン要素を作る
   * @param {string} name PATHS のキー
   * @param {number} [size] 一辺のピクセル数（既定 20）
   * @param {string} [cls] 追加のクラス名
   */
  function icon(name, size, cls) {
    var body = PATHS[name] || PATHS.info;
    var px = size || 20;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<svg xmlns="' + NS + '" class="icon' + (cls ? ' ' + cls : '') + '"' +
      ' width="' + px + '" height="' + px + '" viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor" stroke-width="1.7"' +
      ' stroke-linecap="square" stroke-linejoin="miter"' +
      ' aria-hidden="true" focusable="false">' + body + '</svg>';
    return wrap.firstElementChild;
  }

  function has(name) { return !!PATHS[name]; }

  DL.icons = { icon: icon, has: has, names: Object.keys(PATHS) };
})(window.DL);
