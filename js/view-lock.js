/* METEO LOCK — ID とパスワードの金庫（専用の画面）

   画面は3つの顔を持つ。
     ・金庫がまだ無い  … 合言葉を決めてもらう
     ・鍵がかかっている … 合言葉（使えるなら顔でも）で開ける
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

  /* ボタンの字を書き換える（ui.btn は中に span を置くので、そこだけ差し替える） */
  function label(b, text) {
    var s = b.querySelector('span');
    if (s) s.textContent = text; else b.textContent = text;
  }

  /* ---------------- ホームの入口 ---------------- */

  /** ホームのいちばん下に置く入口 */
  function entry() {
    var has = lk().hasVault();
    return el('a', { class: 'row lk-entry', href: '#/lock' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('lock', 17), el('span', { class: 'lk-brand', text: 'METEO LOCK' })
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(has ? '鍵がかかっています' : 'まだ作っていません', has ? 'soft' : 'ghosty'),
          el('span', { class: 'muted small', text: 'ID とパスワードの金庫' })
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
      wrap.appendChild(el('p', { class: 'muted small pad',
        text: '暗号の仕掛けが使えないため、金庫を開けられません。'
          + 'https で開き直すと使えるようになります。' }));
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

  function head(text, sub) {
    return el('div', { class: 'lk-head' }, [
      el('div', { class: 'lk-mark' }, ui.icon('lock', 30)),
      el('div', {}, [
        el('h2', { class: 'lk-title', text: 'METEO LOCK' }),
        el('p', { class: 'lk-lead', text: text }),
        sub ? el('p', { class: 'lk-lead small', text: sub }) : null
      ])
    ]);
  }

  /* ---------------- まだ金庫が無いとき ---------------- */

  function setupView(wrap) {
    wrap.appendChild(head('ID とパスワードを、合言葉ひとつで仕舞っておきます。'));

    var box = el('div', { class: 'form lk-form' });
    var p1 = ui.input({ type: 'password', autocomplete: 'new-password',
      placeholder: '合言葉（' + lk().MIN_PASS + '文字以上）' });
    var p2 = ui.input({ type: 'password', autocomplete: 'new-password', placeholder: 'もう一度' });
    var meter = el('div', { class: 'lk-meter' }, el('i'));
    var note = el('p', { class: 'lk-note' });

    p1.addEventListener('input', function () {
      var s = lk().strength(p1.value);
      meter.firstChild.className = 'lv' + s.score;
      note.textContent = p1.value ? '強さ：' + s.text : '';
    });

    box.appendChild(ui.field('合言葉', p1));
    box.appendChild(meter);
    box.appendChild(note);
    box.appendChild(ui.field('確かめ', p2));

    box.appendChild(el('div', { class: 'lk-warn' }, [
      el('b', { text: '忘れると、誰にも開けられません。' }),
      el('span', { text: '合言葉はこの金庫のどこにも残しません。'
        + '中身は合言葉から作る鍵でしか解けないので、こちらでも開けられません。'
        + '長くて思い出せるもの（好きな一文など）にしてください。' })
    ]));

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
    wrap.appendChild(head('鍵がかかっています。'));

    var box = el('div', { class: 'form lk-form' });
    var pass = ui.input({ type: 'password', autocomplete: 'current-password',
      placeholder: '合言葉', enterkeyhint: 'go' });
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
      if (!pass.value) { ui.toast('合言葉を入れてください', 'warn'); return; }
      open.disabled = true;
      label(open, '開けています…');
      lk().unlock(pass.value).then(function (ok) {
        if (ok) { pass.value = ''; DL.app.render(); return; }
        open.disabled = false;
        label(open, '開ける');
        pass.value = '';
        var p = lk().penalty();
        msg.className = 'lk-note bad';
        msg.textContent = '合言葉が違います。'
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

    box.appendChild(ui.field('合言葉', pass));
    box.appendChild(msg);
    box.appendChild(open);

    // 顔で開ける（この端末に包みを作ってあるときだけ）
    if (lk().faceOn()) {
      box.appendChild(ui.btn('Face ID で開ける', 'ghost full', function () {
        lk().faceUnlock().then(function (ok) {
          if (ok) { DL.app.render(); return; }
          ui.toast('開けられませんでした。合言葉で開けてください', 'warn');
        }).catch(function (e) { ui.toast(e.message, 'danger'); });
      }, 'faceid'));
    }

    box.appendChild(el('p', { class: 'muted small',
      text: '中身は暗号のまま仕舞ってあります。合言葉を入れるまで、'
        + 'この端末の中でも読める形にはなりません。' }));
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

    var close = ui.sheet({
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

    var close = ui.sheet({
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
        }), '触らないまま この時間が過ぎたら、ひとりでに鍵をかけます'));

      box.appendChild(ui.field('写したパスワードを消すまで',
        ui.select([
          { value: '0', label: '消さない' }, { value: '15', label: '15秒' },
          { value: '30', label: '30秒' }, { value: '60', label: '1分' }
        ], String(o.clipSec), function (e) {
          DL.store.setLockOpts({ clipSec: U.num(e.target.value, 30) });
        }), '貼り付けたあと、控えに残り続けないようにします'));

      box.appendChild(ui.section('合言葉'));
      box.appendChild(ui.btn('合言葉を変える', 'ghost full', function () {
        passSheet();
      }, 'edit'));

      box.appendChild(ui.section('Face ID'));
      var faceBox = el('div', {});
      box.appendChild(faceBox);
      drawFace(faceBox, draw);

      box.appendChild(ui.section('控え'));
      box.appendChild(el('p', { class: 'muted small',
        text: '暗号のかたまりのまま写します。これだけでは中身は読めませんが、'
          + '合言葉が弱いと時間をかけて解かれます。強い合言葉にしておいてください。' }));
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
        node.appendChild(el('p', { class: 'muted small', text: 'この端末では使えません。' }));
        return;
      }
      if (lk().faceOn()) {
        node.appendChild(el('p', { class: 'muted small',
          text: 'この端末では、顔でも開けられます。' }));
        node.appendChild(ui.btn('顔での解錠をやめる', 'ghost full', function () {
          lk().forgetFace();
          ui.toast('やめました');
          again();
        }, 'close'));
        return;
      }
      node.appendChild(el('p', { class: 'muted small',
        text: '顔は「この端末の中にある鍵で包みを解く」ために使います。'
          + '顔だけで開く蓋ではないので、端末が変われば合言葉が要ります。' }));
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

    var close = ui.sheet({
      title: 'METEO LOCK の設定',
      body: host,
      actions: [ui.btn('閉じる', 'ghost full', function () { close(); })],
      onClose: function () { if (onChange) onChange(); }
    });
    draw();
  }

  /* 合言葉の入れ替え */
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

    body.appendChild(ui.field('いまの合言葉', cur));
    body.appendChild(ui.field('新しい合言葉', n1));
    body.appendChild(meter);
    body.appendChild(note);
    body.appendChild(ui.field('確かめ', n2));
    body.appendChild(el('p', { class: 'muted small',
      text: '中身はそのままで、包み直すだけです。'
        + 'この端末の Face ID の設定も、そのまま使えます。' }));

    var close = ui.sheet({
      title: '合言葉を変える',
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

  DL.views.lock = { render: render, entry: entry, stopTimer: stopTimer };
})(window.DL);
