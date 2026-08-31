/* pixivFANBOX の画面から、支援金の表を締切アプリへ送る。
 *
 *   このファイルはアプリの中では動かない。
 *   設定画面がこれを読み込み、先頭に接続先と合鍵を足したうえで
 *   ブックマークレット（javascript: …）や
 *   iPhone のショートカット（Webページで JavaScript を実行）の中身にする。
 *
 *   前提：呼ぶ側が API（同期の接続先）と TOKEN（合鍵）を先に決めている。
 *
 *   ここでは金額を読み取らない。ページの文字をそのまま預けて、
 *   読み解くのはアプリ側（js/fanbox.js）に任せる。
 *   読み取りの決まりごとを2か所に分けると、FANBOX の見た目が変わったときに
 *   両方を直すことになるため。 */
(function () {
  'use strict';

  var LIMIT = 200000;   // 送る文字の上限（Worker 側は 256KB まで受け取る）

  // ショートカットから呼ばれたときは completion() が用意されている。
  // その場では画面を出さずに送り、結果を返す（確認の画面を出すと先に進めないため）
  var inShortcut = (typeof completion === 'function');
  function finish(msg) {
    if (inShortcut) { try { completion(msg); } catch (e) { /* 返せなくても送信は済んでいる */ } }
  }

  if (location.hostname.indexOf('fanbox.cc') < 0) {
    if (!inShortcut) alert('pixivFANBOX のページを開いてから使ってください。');
    finish('pixivFANBOX のページではありません');
    return;
  }

  /* 画面に出ている文字をそのまま集める。
     innerText なので、隠れている部分は入らない＝見えているものが送られる */
  var text = (document.body && document.body.innerText) || '';
  text = text.replace(/\u00a0/g, ' ');   // 空白に見える NBSP は普通の空白に直す
  if (text.length > LIMIT) text = text.slice(0, LIMIT);

  /* ここでは読み取らず、「それらしいか」だけ数える */
  var months = (text.match(/(?:^|\n)\s*(?:1[0-2]|0?[1-9])\s*月/g) || []).length;
  var yen = (text.match(/[¥￥]\s*[\d,]+/g) || []).length;

  function post() {
    return fetch(API.replace(/\/+$/, '') + '/v1/inbox/fanbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ text: text, from: 'FANBOX' })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
        return b;
      });
    });
  }

  /* ---- ショートカットから：そのまま送って結果を返す ---- */
  if (inShortcut) {
    if (!months || !yen) { finish('支援金の表が見当たりませんでした'); return; }
    post().then(function () {
      finish('送りました（' + months + 'ヶ月ぶんらしき記述）');
    }).catch(function (e) {
      finish('送れませんでした：' + e.message);
    });
    return;
  }

  /* ---- ブックマークレットから：確かめてから送る ---- */
  var box = document.createElement('div');
  box.setAttribute('style', [
    'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
    'z-index:2147483647', 'background:#fff', 'color:#111',
    'border:1px solid #ccc', 'border-radius:8px', 'padding:16px 18px',
    'width:min(320px,86vw)', 'box-shadow:0 8px 30px rgba(0,0,0,.25)',
    'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif'
  ].join(';'));

  var title = document.createElement('b');
  title.textContent = '締切アプリへ送る';
  box.appendChild(title);

  function line(t) {
    var d = document.createElement('div');
    d.textContent = t;
    d.setAttribute('style', 'font-size:12px;color:#666;margin-top:6px');
    box.appendChild(d);
    return d;
  }

  function button(t, primary, onclick) {
    var b = document.createElement('button');
    b.textContent = t;
    b.setAttribute('style', [
      'flex:1', 'padding:9px 10px', 'border-radius:6px', 'cursor:pointer',
      'font:inherit', 'font-weight:700',
      primary ? 'background:#3b82f6;color:#fff;border:0' : 'background:#f3f4f6;color:#333;border:1px solid #ddd'
    ].join(';'));
    b.onclick = onclick;
    return b;
  }

  if (!months || !yen) {
    line('このページには支援金の表が見当たりませんでした。');
    line('月ごとの金額が並んでいる画面（支援金の管理・振込の画面）を開いてから、もう一度押してください。');
  } else {
    line(months + 'ヶ月ぶんの見出しと、' + yen + '件の金額が見つかりました。');
    line('このページの文字を送ります。金額の確認と取り込みは、アプリの「売上」でできます。');
  }

  var row = document.createElement('div');
  row.setAttribute('style', 'display:flex;gap:8px;margin-top:14px');
  box.appendChild(row);
  row.appendChild(button('やめる', false, function () { box.remove(); }));

  var send = button('送る', true, function () {
    send.disabled = true;
    send.textContent = '送っています…';
    post().then(function () {
      box.textContent = '';
      box.appendChild(title);
      line('送りました。アプリの「売上」を開くと取り込めます。');
      setTimeout(function () { box.remove(); }, 2600);
    }).catch(function (e) {
      send.disabled = false;
      send.textContent = '送る';
      line('送れませんでした：' + e.message);
    });
  });
  row.appendChild(send);

  document.body.appendChild(box);
})();
