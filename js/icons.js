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
    // 設定：歯車。20pxでも歯が潰れないよう、8歯で谷を深めに取っている
    settings: '<path d="M9.7 2.0L14.3 2.0L14.0 5.4L15.2 5.9L17.5 3.3L20.7 6.5L18.1 8.8L18.6 10.0' +
              'L22.0 9.7L22.0 14.3L18.6 14.0L18.1 15.2L20.7 17.5L17.5 20.7L15.2 18.1L14.0 18.6' +
              'L14.3 22.0L9.7 22.0L10.0 18.6L8.8 18.1L6.5 20.7L3.3 17.5L5.9 15.2L5.4 14.0' +
              'L2.0 14.3L2.0 9.7L5.4 10.0L5.9 8.8L3.3 6.5L6.5 3.3L8.8 5.9L10.0 5.4Z"/>' +
              '<circle cx="12" cy="12" r="3.3"/>',

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
    // 見積書：まだ確定していない書類なので、下の行を短くして「途中」に見せる
    estimate: '<path d="M4.5 3.5h15v17h-15z"/><path d="M8 8.5h8M8 12h8"/><path d="M8 15.5h4"/>',
    task: '<path d="M4.5 3.5h15v17h-15z"/><path d="M8 9l2.2 2.2L15 6.5"/><path d="M8 15.5h8"/>',
    // 売上：軸と棒グラフ
    sales: '<path d="M3.5 3.5v17h17"/><path d="M7 17.2v-5.6h3.2v5.6zM13.3 17.2V7.2h3.2v10z"/>',
    // 売上タブ：軸と折れ線（節に印を打つ）
    chartLine: '<path d="M3.5 3.5v17h17"/><path d="M6.6 16.4 10.4 11.2 13.6 13.6 19.4 6.6"/>' +
               '<path d="M5.6 15.4h2v2h-2zM9.4 10.2h2v2h-2zM12.6 12.6h2v2h-2zM18.4 5.6h2v2h-2z" fill="var(--card)"/>',
    // 名義：軒先のある店構え
    issuer: '<path d="M3.5 8.6h17v11.9h-17z"/><path d="M5.6 3.5h12.8l2.1 5.1h-17z"/><path d="M9.6 20.5v-6.2h4.8v6.2z"/>',
    // 経理：表示窓とキーのある電卓
    books: '<path d="M4.5 3.5h15v17h-15z"/><path d="M7.4 6.4h9.2v3.2H7.4z"/>' +
           '<path d="M7.4 12.4h2.6v2.2H7.4zM12.9 12.4h3.7v2.2h-3.7zM7.4 16.4h2.6v2.2H7.4zM12.9 16.4h3.7v2.2h-3.7z"/>',
    // 取引先：名刺と担当者
    client: '<path d="M3.5 5.5h17v13h-17z"/><path d="M6.4 9.2h4.4v4.4H6.4z"/><path d="M13.4 9.5h4.4M13.4 12.4h4.4M6.4 15.6h11.4"/>',
    // バックアップ：箱に入れて保管する
    backup: '<path d="M3.5 4.5h17V9h-17z"/><path d="M5.2 9v10.5h13.6V9"/><path d="M9.6 12.4h4.8"/>',
    cloud: '<path d="M6.6 19.5h10.2a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4-1.1 3.9 3.9 0 0 0-.3 8.9z"/>',
    // ファイル：見出しの付いた書類入れ
    folder: '<path d="M3.5 5.5h6.2l2 2.8h8.8v11.2h-17z"/><path d="M3.5 10.4h17"/>',
    // 一覧で大きく出すときの塗りつぶし版
    folderFill: '<path d="M2.5 5h6.9l2 2.8h10.1v11.2h-19z" fill="currentColor" stroke="none"/>',
    fileFill: '<path d="M5 3h9l5 5v13H5z" fill="currentColor" stroke="none"/>' +
              '<path d="M14 3v5h5" fill="none" stroke="var(--card)" stroke-width="1.4"/>',

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
    // 切替：上下で向きの違う2本の矢印
    swap: '<path d="M3 8.5h15"/><path d="M13.5 4 18 8.5 13.5 13"/><path d="M21 15.5H6"/><path d="M10.5 11 6 15.5 10.5 20"/>',

    /* 状態 */
    alert: '<path d="M12 3.5 22 20.5H2z"/><path d="M12 9.6v5"/><path d="M11.2 16.6h1.6v1.7h-1.6z" fill="currentColor" stroke="none"/>',
    info: '<path d="M4 4h16v16H4z"/><path d="M12 11v6"/><path d="M11.2 7.2h1.6v1.7h-1.6z" fill="currentColor" stroke="none"/>',
    clock: '<path d="M4 4h16v16H4z"/><path d="M12 7.5V12l3 2.2"/>',

    /* 天気（Open-Meteo の記号に合わせた9種）。
       くもりの形はひとつの雲を使い回し、下に足すものだけを変えて見分ける */
    wSun: '<circle cx="12" cy="12" r="4.6"/>' +
          '<path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6"/>' +
          '<path d="M5.4 5.4 7.2 7.2M16.8 16.8l1.8 1.8M18.6 5.4 16.8 7.2M7.2 16.8l-1.8 1.8"/>',
    wSunCloud: '<circle cx="8.4" cy="7.4" r="3.2"/>' +
               '<path d="M8.4 1.4v1.8M2.4 7.4h1.8M4.2 3.2 5.4 4.4M12.6 3.2 11.4 4.4"/>' +
               '<path d="M9.8 21h8.4a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-.9 3.3 3.3 0 0 0-.4 7.5z"/>',
    wCloud2: '<path d="M6.6 18.5h10.2a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4-1.1 3.9 3.9 0 0 0-.3 8.9z"/>',
    wFog: '<path d="M6.6 15.5h10.2a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4-1.1 3.9 3.9 0 0 0-.3 8.9z"/>' +
          '<path d="M5 18.6h14M7.4 21.6h9.2"/>',
    wDrizzle: '<path d="M6.6 15.5h10.2a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4-1.1 3.9 3.9 0 0 0-.3 8.9z"/>' +
              '<path d="M9.2 18.4v1.8M12 19.4v1.8M14.8 18.4v1.8"/>',
    wRain: '<path d="M6.6 15.5h10.2a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4-1.1 3.9 3.9 0 0 0-.3 8.9z"/>' +
           '<path d="M8.6 18.2v3.4M12 18.2v3.4M15.4 18.2v3.4"/>',
    wShower: '<path d="M6.6 15.5h10.2a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4-1.1 3.9 3.9 0 0 0-.3 8.9z"/>' +
             '<path d="M9.6 18.2 7.8 21.8M13 18.2l-1.8 3.6M16.4 18.2l-1.8 3.6"/>',
    wSnow: '<path d="M6.6 15.5h10.2a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4-1.1 3.9 3.9 0 0 0-.3 8.9z"/>' +
           '<path d="M8.1 18.4h1.7v1.7H8.1zM14.2 18.4h1.7v1.7h-1.7zM11.15 20.7h1.7v1.7h-1.7z"' +
           ' fill="currentColor" stroke="none"/>',
    wThunder: '<path d="M6.6 15.5h10.2a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4-1.1 3.9 3.9 0 0 0-.3 8.9z"/>' +
              '<path d="M13.4 17.2 9.8 21h2.9l-1.3 2.4"/>',
    // 夜の晴れ（現在の天気に使う）
    wMoon: '<path d="M19.8 15.2A8.4 8.4 0 0 1 8.8 4.2 8.4 8.4 0 1 0 19.8 15.2z"/>',
    wMoonCloud: '<path d="M12.4 9.2A5 5 0 0 1 6 2.8 5 5 0 1 0 12.4 9.2z"/>' +
                '<path d="M9.8 21h8.4a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-.9 3.3 3.3 0 0 0-.4 7.5z"/>',
    // 地点が未設定・取得できなかったとき
    wUnknown: '<circle cx="12" cy="12" r="8.4"/><path d="M12 15.4v-1.2c0-1.6 2.2-1.9 2.2-3.6a2.2 2.2 0 0 0-4.3-.6"/>' +
              '<path d="M11.2 17.2h1.6v1.7h-1.6z" fill="currentColor" stroke="none"/>'
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
