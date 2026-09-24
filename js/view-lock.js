/* METEO LOCK — ID とパスワードの金庫（専用の画面）

   画面は3つの顔を持つ。
     ・金庫がまだ無い  … 暗号を決めてもらう
     ・鍵がかかっている … 暗号（使えるなら顔でも）で開ける
     ・開いている      … 探す・写す・足す・直す

   守りかたの中身は lock.js にある。ここは見せかたと操作だけ。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, el = U.el;

  var L = null;               // DL.lock（読み込み順のため、使うときに取る）
  var timer = null;           // 残り時間の数え直し
  var offChange = null;       // 開け閉めの見張り
  var drawnOpen = null;       // いま描いてある顔

  function lk() { return L || (L = DL.lock); }

  /* シートを開いているあいだは、時間で鍵をかけない。
     打ち込んでいる途中に閉じられてしまうと、書いたものが消えるため。
     開くときに掛け金を1つ増やし、畳むときに戻す。 */
  function heldSheet(opts) {
    var done = false;
    var onClose = opts.onClose;
    lk().hold(true);
    opts.onClose = function () {
      if (!done) { done = true; lk().hold(false); }
      if (onClose) onClose();
    };
    return ui.sheet(opts);
  }

  /* ボタンの字を書き換える（ui.btn は中に span を置くので、そこだけ差し替える） */
  function label(b, text) {
    var s = b.querySelector('span');
    if (s) s.textContent = text; else b.textContent = text;
  }

  /* ---------------- ホームの入口 ---------------- */

  /** ホームのいちばん下に置く入口。名前だけの、静かな1行にする */
  function entry() {
    return el('a', { class: 'row lk-entry', href: '#/lock' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('lock', 17), el('span', { class: 'lk-brand', text: 'METEO LOCK' })
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* ---------------- 画面 ---------------- */

  function render(root) {
    stopTimer();
    watch();
    var wrap = el('div', { class: 'page lock-page' });
    drawnOpen = lk().isOpen();

    if (!lk().ready()) {
      wrap.appendChild(head('この端末では使えません'));
      root.appendChild(wrap);
      return;
    }

    // 触っているあいだは、自動で鍵がかからないようにする
    wrap.addEventListener('pointerdown', function () { lk().touch(); });
    wrap.addEventListener('keydown', function () { lk().touch(); });

    if (!lk().hasVault()) setupView(wrap);
    else if (!lk().isOpen()) gateView(wrap);
    else vaultView(wrap);

    root.appendChild(wrap);
  }

  /* 開け閉めが変わったら描き直す（自動で鍵がかかったときなど） */
  function watch() {
    if (offChange) return;
    offChange = lk().onChange(function (open) {
      if ((location.hash || '').indexOf('#/lock') !== 0) return;
      if (open === drawnOpen) return;
      DL.app.render();
    });
  }

  function head(text) {
    return el('div', { class: 'lk-head' }, [
      el('div', { class: 'lk-mark' }, ui.icon('lock', 30)),
      el('div', {}, [
        el('h2', { class: 'lk-title', text: 'METEO LOCK' }),
        text ? el('p', { class: 'lk-lead', text: text }) : null
      ])
    ]);
  }

  /* ---------------- まだ金庫が無いとき ---------------- */

  function setupView(wrap) {
    wrap.appendChild(head(''));

    var box = el('div', { class: 'form lk-form' });
    var p1 = ui.input({ type: 'password', autocomplete: 'new-password',
      placeholder: '暗号（' + lk().MIN_PASS + '文字以上）' });
    var p2 = ui.input({ type: 'password', autocomplete: 'new-password', placeholder: 'もう一度' });
    var meter = el('div', { class: 'lk-meter' }, el('i'));
    var note = el('p', { class: 'lk-note' });

    p1.addEventListener('input', function () {
      var s = lk().strength(p1.value);
      meter.firstChild.className = 'lv' + s.score;
      note.textContent = p1.value ? '強さ：' + s.text : '';
    });

    box.appendChild(ui.field('暗号', p1));
    box.appendChild(meter);
    box.appendChild(note);
    box.appendChild(ui.field('確かめ', p2));

    // 取り返しがつかないところなので、この一行だけは残す
    box.appendChild(el('div', { class: 'lk-warn' },
      el('b', { text: '忘れると、誰にも開けられません。' })));

    var go = ui.btn('金庫を作る', 'primary full', function () {
      var bad = lk().passProblem(p1.value);
      if (bad) { ui.toast(bad, 'warn'); return; }
      if (p1.value !== p2.value) { ui.toast('2つが違います', 'warn'); return; }
      go.disabled = true;
      label(go, '作っています…');
      lk().create(p1.value).then(function () {
        ui.toast('金庫を作りました');
        DL.app.render();
      }).catch(function (e) {
        go.disabled = false;
        label(go, '金庫を作る');
        ui.toast(e.message, 'danger');
      });
    }, 'lock');
    box.appendChild(go);
    wrap.appendChild(box);
  }

  /* ---------------- 鍵がかかっているとき ---------------- */

  function gateView(wrap) {
    wrap.appendChild(head(''));

    var box = el('div', { class: 'form lk-form' });
    var pass = ui.input({ type: 'password', autocomplete: 'current-password',
      placeholder: '暗号', enterkeyhint: 'go' });
    var msg = el('p', { class: 'lk-note' });

    var pen = lk().penalty();
    if (pen.wait > 0) {
      msg.textContent = '間違いが続いたので、しばらく待ってください。';
      msg.className = 'lk-note bad';
    } else if (pen.fails) {
      msg.textContent = pen.fails + '回 間違えています。';
      msg.className = 'lk-note bad';
    }

    var open = ui.btn('開ける', 'primary full', function () { tryPass(); }, 'lock');

    function tryPass() {
      if (!pass.value) { ui.toast('暗号を入れてください', 'warn'); return; }
      open.disabled = true;
      label(open, '開けています…');
      lk().unlock(pass.value).then(function (ok) {
        if (ok) { pass.value = ''; DL.app.render(); return; }
        open.disabled = false;
        label(open, '開ける');
        pass.value = '';
        var p = lk().penalty();
        msg.className = 'lk-note bad';
        msg.textContent = '暗号が違います。'
          + (p.wait > 0 ? ' しばらく待ってから、もう一度。' : '');
      }).catch(function (e) {
        open.disabled = false;
        label(open, '開ける');
        msg.className = 'lk-note bad';
        msg.textContent = e.message;
      });
    }

    pass.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); tryPass(); }
    });

    box.appendChild(ui.field('暗号', pass));
    box.appendChild(msg);
    box.appendChild(open);

    // 顔で開ける（この端末に包みを作ってあるときだけ）
    if (lk().faceOn()) {
      box.appendChild(ui.btn('Face ID で開ける', 'ghost full', function () {
        lk().faceUnlock().then(function (ok) {
          if (ok) { DL.app.render(); return; }
          ui.toast('開けられませんでした。暗号で開けてください', 'warn');
        }).catch(function (e) { ui.toast(e.message, 'danger'); });
      }, 'faceid'));
    }

    wrap.appendChild(box);
  }

  /* ---------------- 開いているとき ---------------- */

  function vaultView(wrap) {
    var q = '';

    var bar = el('div', { class: 'lk-bar' }, [
      el('span', { class: 'lk-left' }),
      ui.btn('鍵をかける', 'ghost tiny', function () {
        lk().lock();
        DL.app.render();
      }, 'lock')
    ]);
    wrap.appendChild(bar);
    startTimer(bar.firstChild);

    var find = ui.input({ type: 'search', placeholder: 'サービス名で探す',
      enterkeyhint: 'search', autocomplete: 'off' });
    var listBox = el('div', { class: 'list lk-list' });

    find.addEventListener('input', function () { q = find.value; draw(); });
    wrap.appendChild(el('div', { class: 'lk-find' }, [ui.icon('search', 16), find]));

    wrap.appendChild(el('div', { class: 'row-wrap lk-tools' }, [
      ui.btn('追加', 'primary', function () { editSheet(null, draw); }, 'plus'),
      ui.btn('設定', 'ghost', function () { settingsSheet(draw); }, 'settings')
    ]));

    wrap.appendChild(listBox);

    function draw() {
      U.clear(listBox);
      var all = lk().list('');
      var rows = lk().list(q);
      if (!all.length) {
        listBox.appendChild(ui.empty('まだ何も入っていません。',
          ui.btn('最初の1件を入れる', 'primary', function () { editSheet(null, draw); })));
        return;
      }
      if (!rows.length) {
        listBox.appendChild(ui.empty('「' + q + '」に当てはまるものはありません。'));
        return;
      }
      listBox.appendChild(el('p', { class: 'muted small lk-count',
        text: rows.length === all.length ? all.length + '件' : rows.length + ' / ' + all.length + '件' }));
      rows.forEach(function (x) { listBox.appendChild(itemRow(x, draw)); });
    }

    draw();
  }

  /* 一覧の1行。ID とパスワードは、それぞれ写すボタンから */
  function itemRow(x, onChange) {
    var main = el('button', { type: 'button', class: 'lk-main',
      onclick: function () { detailSheet(x.id, onChange); } }, [
      el('div', { class: 'lk-name', text: x.name }),
      el('div', { class: 'lk-user' }, [
        x.user ? el('span', { text: x.user }) : el('span', { class: 'muted', text: 'ID なし' }),
        x.url ? el('span', { class: 'muted small', text: '　' + host(x.url) }) : null
      ])
    ]);

    return el('div', { class: 'row lk-row' }, [
      main,
      el('div', { class: 'lk-acts' }, [
        copyBtn('ID', x.user, 'ID を写しました', false),
        copyBtn('PASS', x.pass, 'パスワードを写しました', true)
      ])
    ]);
  }

  /* 写すボタン。パスワードのほうは、しばらくしたら控えから消す */
  function copyBtn(label, text, done, wipe) {
    var b = ui.btn(label, 'tiny ' + (wipe ? 'primary' : 'ghost'), function () {
      if (!text) { ui.toast('入っていません', 'warn'); return; }
      lk().copy(text, wipe).then(function (ok) {
        if (!ok) { ui.toast('写せませんでした', 'danger'); return; }
        b.classList.add('done');
        setTimeout(function () { b.classList.remove('done'); }, 1200);
        ui.toast(done + (wipe && S().clipSec ? '（' + S().clipSec + '秒で消します）' : ''));
      });
    }, 'fileFill');
    b.classList.add('lk-copy');
    return b;
  }

  function S() { return DL.store.lockOpts(); }

  function host(url) {
    var m = /^(?:https?:\/\/)?([^/\s]+)/i.exec(String(url || ''));
    return m ? m[1] : '';
  }

  /* ---------------- 1件を見る ---------------- */

  function detailSheet(id, onChange) {
    var x = lk().get(id);
    if (!x) return;
    var body = el('div', { class: 'form' });
    var shown = false;
    var revealTimer = null;

    body.appendChild(ui.block('サービス名', el('p', { class: 'lk-big', text: x.name })));

    body.appendChild(ui.block('ID', el('div', { class: 'lk-val' }, [
      el('p', { class: 'lk-code', text: x.user || '（入っていません）' }),
      copyBtn('写す', x.user, 'ID を写しました', false)
    ])));

    var passText = el('p', { class: 'lk-code', text: '••••••••••' });
    var eye = ui.btn('見る', 'ghost tiny', function () {
      shown = !shown;
      passText.textContent = shown ? (x.pass || '（入っていません）') : '••••••••••';
      label(eye, shown ? '隠す' : '見る');
      if (revealTimer) clearTimeout(revealTimer);
      // 出しっぱなしにしない。しばらくしたら自分で伏せる
      if (shown) {
        revealTimer = setTimeout(function () {
          shown = false;
          passText.textContent = '••••••••••';
          label(eye, '見る');
        }, 15000);
      }
    });
    body.appendChild(ui.block('パスワード', el('div', { class: 'lk-val' }, [
      passText, eye, copyBtn('写す', x.pass, 'パスワードを写しました', true)
    ])));

    if (x.url) {
      body.appendChild(ui.block('URL', el('div', { class: 'lk-val' }, [
        el('a', { class: 'lk-code link', href: fullUrl(x.url), target: '_blank',
          rel: 'noopener noreferrer', text: x.url }),
        copyBtn('写す', x.url, 'URL を写しました', false)
      ])));
    }
    if (x.note) body.appendChild(ui.block('メモ', el('p', { class: 'lk-memo', text: x.note })));

    body.appendChild(el('p', { class: 'muted small',
      text: '更新：' + U.fmtYMD(String(x.at).slice(0, 10)) }));

    var close = heldSheet({
      title: x.name,
      body: body,
      actions: [
        ui.btn('消す', 'ghost danger', function () {
          ui.confirm('「' + x.name + '」を消します。元には戻せません。',
            { okText: '消す', danger: true }).then(function (ok) {
            if (!ok) return;
            lk().remove(x.id).then(function () {
              close();
              if (onChange) onChange();
              ui.toast('消しました');
            });
          });
        }, 'trash'),
        ui.btn('直す', 'primary', function () {
          close();
          editSheet(x, onChange);
        }, 'edit')
      ],
      onClose: function () { if (revealTimer) clearTimeout(revealTimer); }
    });
  }

  function fullUrl(u) {
    return /^https?:\/\//i.test(String(u)) ? u : 'https://' + String(u);
  }

  /* ---------------- 足す・直す ---------------- */

  function editSheet(x, onChange) {
    var isNew = !x;
    var v = x || { id: '', name: '', user: '', pass: '', url: '', note: '' };
    var body = el('div', { class: 'form' });

    var name = ui.input({ value: v.name, placeholder: '例：pixiv', maxlength: 120 });
    var user = ui.input({ value: v.user, placeholder: 'メールアドレスなど',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: 200 });
    var pass = ui.input({ value: v.pass, type: 'password', autocomplete: 'new-password',
      autocapitalize: 'off', spellcheck: 'false', maxlength: 400 });
    var url = ui.input({ value: v.url, placeholder: 'example.com', inputmode: 'url',
      autocapitalize: 'off', spellcheck: 'false', maxlength: 300 });
    var note = ui.textarea({ value: v.note, rows: 3, maxlength: 2000,
      placeholder: '秘密の質問の答え、契約の番号など' });

    var meter = el('div', { class: 'lk-meter' }, el('i'));
    var meterNote = el('p', { class: 'lk-note' });
    function drawMeter() {
      var s = lk().strength(pass.value);
      meter.firstChild.className = 'lv' + s.score;
      meterNote.textContent = pass.value ? '強さ：' + s.text : '';
    }
    pass.addEventListener('input', drawMeter);

    var see = ui.btn('見る', 'ghost tiny', function () {
      var on = pass.type === 'password';
      pass.type = on ? 'text' : 'password';
      label(see, on ? '隠す' : '見る');
    });
    var make = ui.btn('作る', 'ghost tiny', function () {
      pass.value = lk().genPass({ len: 20 });
      pass.type = 'text';
      label(see, '隠す');
      drawMeter();
    }, 'refresh');

    body.appendChild(ui.field('サービス名', name));
    body.appendChild(ui.field('ID', user));
    body.appendChild(ui.block('パスワード', el('div', {}, [
      pass, el('div', { class: 'row-wrap lk-pw-tools' }, [see, make])
    ])));
    body.appendChild(meter);
    body.appendChild(meterNote);
    body.appendChild(ui.field('URL', url));
    body.appendChild(ui.field('メモ', note));
    drawMeter();

    var close = heldSheet({
      title: isNew ? '追加' : '直す',
      body: body,
      actions: [
        ui.btn('やめる', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          if (!name.value.trim()) { ui.toast('サービス名を入れてください', 'warn'); return; }
          lk().put({
            id: v.id, name: name.value.trim(), user: user.value, pass: pass.value,
            url: url.value.trim(), note: note.value
          }).then(function () {
            close();
            if (onChange) onChange();
            ui.toast(isNew ? '入れました' : '保存しました');
          }).catch(function (e) { ui.toast(e.message, 'danger'); });
        }, 'check')
      ]
    });
  }

  /* ---------------- 設定 ---------------- */

  function settingsSheet(onChange) {
    var host = el('div');

    function draw() {
      U.clear(host);
      var o = DL.store.lockOpts();
      var box = el('div', { class: 'form' });

      box.appendChild(ui.field('自動で鍵をかけるまで',
        ui.select([
          { value: '30', label: '30秒' }, { value: '60', label: '1分' },
          { value: '120', label: '2分' }, { value: '300', label: '5分' },
          { value: '600', label: '10分' }
        ], String(o.autoSec), function (e) {
          DL.store.setLockOpts({ autoSec: U.num(e.target.value, 120) });
          lk().touch();
        })));

      box.appendChild(ui.field('写したパスワードを消すまで',
        ui.select([
          { value: '0', label: '消さない' }, { value: '15', label: '15秒' },
          { value: '30', label: '30秒' }, { value: '60', label: '1分' }
        ], String(o.clipSec), function (e) {
          DL.store.setLockOpts({ clipSec: U.num(e.target.value, 30) });
        })));

      box.appendChild(ui.section('暗号'));
      box.appendChild(ui.btn('暗号を変える', 'ghost full', function () {
        passSheet();
      }, 'edit'));

      box.appendChild(ui.section('Face ID'));
      var faceBox = el('div', {});
      box.appendChild(faceBox);
      drawFace(faceBox, draw);

      box.appendChild(ui.section('控え'));
      box.appendChild(ui.btn('控えを写す', 'ghost full', function () {
        U.copy(lk().exportBox()).then(function (ok) {
          ui.toast(ok ? '写しました' : '写せませんでした', ok ? '' : 'danger');
        });
      }, 'fileFill'));

      box.appendChild(ui.section('金庫'));
      box.appendChild(ui.btn('金庫ごと捨てる', 'ghost danger full', function () {
        ui.confirm('金庫を、中身ごと捨てます。元には戻せません。',
          { okText: '捨てる', danger: true }).then(function (ok) {
          if (!ok) return;
          lk().destroy();
          close();
          DL.app.render();
          ui.toast('捨てました');
        });
      }, 'trash'));

      host.appendChild(box);
    }

    function drawFace(node, again) {
      U.clear(node);
      if (!lk().faceReady()) {
        return;
      }
      if (lk().faceOn()) {
        node.appendChild(ui.btn('顔での解錠をやめる', 'ghost full', function () {
          lk().forgetFace();
          ui.toast('やめました');
          again();
        }, 'close'));
        return;
      }
      var b = ui.btn('この端末で Face ID を使う', 'ghost full', function () {
        b.disabled = true;
        lk().enrollFace().then(function (ok) {
          b.disabled = false;
          if (ok) { ui.toast('使えるようにしました'); again(); return; }
          ui.toast('この端末では用意できませんでした', 'warn');
        }).catch(function () {
          b.disabled = false;
          ui.toast('用意できませんでした', 'warn');
        });
      }, 'faceid');
      node.appendChild(b);
    }

    var close = heldSheet({
      title: 'METEO LOCK の設定',
      body: host,
      actions: [ui.btn('閉じる', 'ghost full', function () { close(); })],
      onClose: function () { if (onChange) onChange(); }
    });
    draw();
  }

  /* 暗号の入れ替え */
  function passSheet() {
    var body = el('div', { class: 'form' });
    var cur = ui.input({ type: 'password', autocomplete: 'current-password' });
    var n1 = ui.input({ type: 'password', autocomplete: 'new-password' });
    var n2 = ui.input({ type: 'password', autocomplete: 'new-password' });
    var meter = el('div', { class: 'lk-meter' }, el('i'));
    var note = el('p', { class: 'lk-note' });

    n1.addEventListener('input', function () {
      var s = lk().strength(n1.value);
      meter.firstChild.className = 'lv' + s.score;
      note.textContent = n1.value ? '強さ：' + s.text : '';
    });

    body.appendChild(ui.field('いまの暗号', cur));
    body.appendChild(ui.field('新しい暗号', n1));
    body.appendChild(meter);
    body.appendChild(note);
    body.appendChild(ui.field('確かめ', n2));

    var close = heldSheet({
      title: '暗号を変える',
      body: body,
      actions: [
        ui.btn('やめる', 'ghost', function () { close(); }),
        ui.btn('変える', 'primary', function () {
          if (n1.value !== n2.value) { ui.toast('新しいほうの2つが違います', 'warn'); return; }
          lk().changePass(cur.value, n1.value).then(function () {
            close();
            ui.toast('変えました');
          }).catch(function (e) { ui.toast(e.message, 'danger'); });
        }, 'check')
      ]
    });
  }

  /* ---------------- 残り時間 ---------------- */

  function startTimer(node) {
    stopTimer();
    var draw = function () {
      if (!lk().isOpen()) { stopTimer(); return; }
      // 入力の途中は数えない。そのことも出しておく
      if (lk().held()) { node.textContent = '入力中は鍵をかけません'; return; }
      var s = lk().leftSec();
      node.textContent = 'あと ' + (s >= 60 ? Math.ceil(s / 60) + '分' : s + '秒') + 'で鍵がかかります';
    };
    draw();
    timer = setInterval(draw, 1000);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /* ---------------- 出入りの幕 ----------------

     筋トレと同じ作りで、黒い幕を降ろしてから中身を入れ替える。
     幕の中では、南京錠の下で目盛りが 0 から 100 まで溜まる。
     溜まりきったら幕が開いて、METEO LOCK の画面が出る。

     幕を降ろすのは中身を入れ替える前。そうしないと、
     前の画面が一瞬で消えてしまい、幕をはさむ意味がなくなる。 */

  var CURTAIN_MS = 300;        // 幕が降りきるまで
  var LIFT_MS = 380;           // 幕が上がりきるまで
  var FILL_MS = 760;           // 0 から 100 まで
  /* 南京錠の絵は 24 のマスの縦 4.3〜20.5 あたりにしかない。
     枠いっぱいで切ると、溜まりきる前に染まり終わってしまう */
  var CLIP_LO = 85.5, CLIP_HI = 15.5;

  var fx = null;
  var fxRaf = 0;
  var fxTimers = [];
  var fxParts = null;
  var curtainDown = false;

  function calmly() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* 幕を出してよいか。動きを控えめにしている人と、
     起動の幕がまだ出ているあいだは、何もしない */
  function mayPlay() {
    if (calmly()) return false;
    var splash = document.getElementById('splash');
    return !(splash && !splash.classList.contains('out'));
  }

  function later(fn, ms) { fxTimers.push(setTimeout(fn, ms)); }

  /**
   * 黒い幕を降ろす。降りきったら again() を呼ぶ。
   * @returns {boolean} true なら、こちらで引き取ったので描き直しを待ってほしい
   */
  function dropCurtain(again) {
    if (!mayPlay() || curtainDown) return false;
    closeFx();
    buildFx();
    curtainDown = true;
    fx.style.setProperty('--lk-ms', CURTAIN_MS + 'ms');
    document.body.appendChild(fx);
    later(again, CURTAIN_MS);
    return true;
  }

  /** 幕が降りきって、裏で描き直せた、そのとき */
  function intro() {
    if (!curtainDown || !fx) return;
    fx.classList.add('down');
    fill();
  }

  function buildFx() {
    var bar = el('i', { class: 'lki-bar-in' });
    var shut = ui.icon('lock', 104, 'lki-lock lki-lock-on');
    var num = el('b', { class: 'lki-num', text: '0' });

    fx = el('div', { id: 'lockIntro', class: 'lock-intro', 'aria-hidden': 'true' }, [
      el('div', { class: 'lki-curtain' }),
      el('div', { class: 'lki-body' }, [
        // 南京錠。下から色が上がっていく
        el('div', { class: 'lki-stage' }, [
          ui.icon('lock', 104, 'lki-lock lki-lock-off'), shut
        ]),
        // その下に名前
        el('div', { class: 'lki-word', text: 'METEO LOCK' }),
        // さらに下に目盛り
        el('div', { class: 'lki-meter' }, [
          el('span', { class: 'lki-bar' }, bar),
          el('span', { class: 'lki-read' }, [num, el('span', { class: 'lki-pct', text: '%' })])
        ])
      ])
    ]);
    fxParts = { bar: bar, shut: shut, num: num };
  }

  function fill() {
    var t0 = 0;
    var step = function (now) {
      if (!fx || !fxParts) return;
      if (!t0) t0 = now;
      var t = Math.min(1, (now - t0) / FILL_MS);
      // 終わりぎわをゆるめて、閉まりきる手前で「ぐっ」とくるようにする
      var v = Math.round(100 * (1 - Math.pow(1 - t, 2.2)));
      fxParts.num.textContent = String(v);
      fxParts.bar.style.width = v + '%';
      fxParts.shut.style.clipPath =
        'inset(' + (CLIP_LO - (CLIP_LO - CLIP_HI) * v / 100).toFixed(2) + '% 0 0 0)';
      if (t < 1) { fxRaf = requestAnimationFrame(step); return; }
      // 溜まりきった。錠が閉まる音の代わりに、ひと締めしてから幕を開ける
      fx.classList.add('full');
      later(closeFx, 240);
    };
    fxRaf = requestAnimationFrame(step);
  }

  /** 出るとき。張ってある幕が、下から上へ上がる */
  function outro() {
    if (!mayPlay()) return;
    closeFx();
    fx = el('div', { id: 'lockOutro', class: 'lock-outro', 'aria-hidden': 'true' });
    fx.style.setProperty('--lk-ms', LIFT_MS + 'ms');
    document.body.appendChild(fx);
    later(closeFx, LIFT_MS);
  }

  function closeFx() {
    if (fxRaf) { cancelAnimationFrame(fxRaf); fxRaf = 0; }
    fxTimers.forEach(clearTimeout);
    fxTimers = [];
    if (fx && fx.parentNode) fx.parentNode.removeChild(fx);
    fx = null;
    fxParts = null;
    curtainDown = false;
  }

  DL.views.lock = {
    render: render, entry: entry, stopTimer: stopTimer,
    dropCurtain: dropCurtain, intro: intro, outro: outro, closeFx: closeFx
  };
})(window.DL);
