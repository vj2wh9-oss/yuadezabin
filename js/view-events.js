/* 日常のカレンダー：日別の一覧・月の一覧・予定の入力 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, E = DL.events, el = U.el;

  /* ---------------- 日別 ---------------- */

  /**
   * その日の予定を並べる（案件側の renderDay から呼ばれる）。
   * @param {HTMLElement} wrap 追記先
   * @param {string} date 'YYYY-MM-DD'
   * @param {object} [opts] {duty:false} にすると勤務は出さない
   *   （呼ぶ側が dutyBox を好きな位置に置きたいとき）
   */
  function dayView(wrap, date, opts) {
    var list = E.ofDay(date);

    wrap.appendChild(ui.section('この日の予定', list.length ? ui.chip(list.length + '件', 'soft') : null));

    if (!list.length) {
      wrap.appendChild(ui.empty('この日に予定はありません。'));
    } else {
      wrap.appendChild(el('div', { class: 'list' }, list.map(function (o) { return row(o, true); })));
      // 押し間違えても、ここからいつでも戻せる
    }

    // 「予定を追加」は置かない。右下の＋が同じ入り口なので、二重になる

    if (!opts || opts.duty !== false) dutyBox(wrap, date);
  }

  /* ---------------- その日の働き方 ---------------- */

  /**
   * 出社 / リモートワーク / 泊まり勤務。1日にひとつだけ。
   * 押すとカレンダーのその日に色が付き、もう一度押すと外れる。
   */
  function dutyBox(wrap, date) {
    var cur = S.duty(date);

    wrap.appendChild(ui.section('この日の勤務', cur ? ui.chip(S.dutyLabel(cur), 'soft') : null));

    wrap.appendChild(el('div', { class: 'duty-row' }, S.DUTIES.map(function (d) {
      var on = cur === d.value;
      return el('button', {
        type: 'button', class: 'duty-btn duty-' + d.value + (on ? ' on' : ''),
        'aria-pressed': on ? 'true' : 'false',
        onclick: function () {
          var before = DL.forms.planSnapshot();
          var wasOff = (S.settings.holidays || []).indexOf(date) >= 0;
          S.setDuty(date, on ? '' : d.value);      // 同じものをもう一度押したら外す
          var isOff = (S.settings.holidays || []).indexOf(date) >= 0;
          var msg = on ? d.label + 'を外しました' : d.label + 'にしました';
          if (!wasOff && isOff) msg += '\n案件のほうは休業日にしました';
          else if (wasOff && !isOff) msg += '\n案件の休業日も外しました';
          // 勤務を選んだら、1日の時間もプリセットで入れておく。
          // すでに書いてある日は、勝手に置き換えず先に聞く
          if (!on && DL.timeblocks.hasPreset(d.value)) {
            var had = S.timeblocks(date).length;
            DL.views.time.offerPreset(date, d.value, had > 0);
            if (!had) msg += '\n今日の予定もプリセットで入れました';
          }
          ui.toast(msg);
          // 休みが増えたぶん、残りの割り振りを組み直すか聞く
          if (!wasOff && isOff) DL.forms.offerReschedule(before);
        }
      }, [
        el('i', { class: 'duty-dot' }),
        el('span', { text: d.label })
      ]);
    })));


  }

  /**
   * 予定1行。
   * @param {object} o 予定の回
   * @param {boolean} [withCheck] ホームに出すかどうかの印を付ける（日別画面だけ）
   */
  function row(o, withCheck) {
    var done = E.isDone(o);
    return el('div', { class: 'row ev-row' + (withCheck && done ? ' is-done' : '') }, [
      el('div', { class: 'row-bar', style: { background: o.ev.color } }),
      el('div', { class: 'row-main', onclick: function () { form(o.ev, { occurrence: o }); } }, [
        el('div', { class: 'row-title', text: o.ev.title }),
        el('div', { class: 'row-sub' }, [
          o.ev.important ? ui.iconChip('alert', '重要', 'warn') : null,
          ui.chip(E.whenText(o), 'soft'),
          o.ev.repeat ? ui.iconChip('refresh', E.repeatLabel(o.ev.repeat), 'ghosty') : null,
          // 鳴らす約束をしてあるものは、それが分かるようにする
          o.ev.important && (o.ev.reminders || []).length
            ? ui.iconChip('clock', '通知' + o.ev.reminders.length, 'soft') : null,
          withCheck && done ? ui.chip('ホームから外し中', 'ghosty') : null
        ]),
        o.ev.memo ? el('p', { class: 'muted small ev-memo', text: o.ev.memo }) : null,
        thumbs(o.ev)
      ]),
      withCheck
        ? el('button', {
            class: 'checkbtn' + (done ? ' on' : ''),
            'aria-label': done ? '今日やることに戻す' : 'やった（今日やることから消す）',
            onclick: function () {
              S.setEventDone(o.ev.id, o.date, !done);
              ui.toast(done ? 'ホームの「今日やること」に戻しました' : 'ホームの「今日やること」から外しました');
            }
          }, ui.icon('check', 17))
        : el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* 行に並べる小さな絵。押すと大きく見える（行そのものは入力が開くので、
     絵のほうは押したときに上へ伝えない） */
  function thumbs(ev) {
    var refs = (ev.images || []).filter(Boolean);
    if (!refs.length) return null;
    return el('div', { class: 'ev-thumbs' }, refs.map(function (ref, i) {
      var url = DL.imgbank.src(ref);
      if (!url) return el('span', { class: 'ev-thumb wait' });
      return el('button', {
        type: 'button', class: 'ev-thumb', 'aria-label': '画像を大きく見る',
        onclick: function (e) { e.stopPropagation(); viewImage(refs, i); }
      }, el('img', { src: url, alt: '' }));
    }));
  }

  /* ---------------- 月の一覧（月名をタップしたとき） ---------------- */

  function monthBody(first, last) {
    var items = E.ofMonth(first, last);
    if (!items.length) return ui.empty('この月に予定はありません。');

    var box = el('div', { class: 'list' });
    var lastDate = '';
    items.forEach(function (o) {
      if (o.date !== lastDate) {
        lastDate = o.date;
        box.appendChild(el('div', { class: 'ev-day', text: U.fmtMDW(o.date) }));
      }
      box.appendChild(row(o));
    });
    return box;
  }

  /* ---------------- 入力 ---------------- */

  /**
   * 予定の追加・編集。
   * @param {object|null} ev 編集する予定（新規なら null）
   * @param {object} [opts] {date: 新規のときの日付, occurrence: 開いた日の回}
   */
  function form(ev, opts) {
    opts = opts || {};
    var isNew = !ev;
    var v = ev || {
      date: U.isISO(opts.date) ? opts.date : U.today(),
      days: 1, title: '', start: '', end: '', memo: '',
      color: S.EVENT_COLORS[0].value, important: false, repeat: '', until: ''
    };

    var titleIn = ui.input({ value: v.title, maxlength: 80, placeholder: '例）歯医者 / 燃えるゴミ / 母の誕生日' });
    var dateIn = ui.input({ type: 'date', value: v.date });
    var daysIn = ui.stepper({ value: v.days, max: 60, onChange: function () { syncDays(); } });
    var startIn = ui.input({ type: 'time', value: v.start });
    var endIn = ui.input({ type: 'time', value: v.end });
    var memoIn = ui.textarea({ value: v.memo, maxlength: 400, placeholder: '持ち物・場所など' });
    var importantIn = el('input', { type: 'checkbox', checked: !!v.important });
    var untilIn = ui.input({ type: 'date', value: v.until });

    /* ---- 絵 ----
       案内のはがき・会場の地図・チケットの写真など、
       文字で書き写すより1枚あったほうが早いものを持たせる。
       貼り付け（⌘V）・ドラッグ・ファイル選びの3つで入る */
    var images = (v.images || []).slice();
    var imgBox = el('div', { class: 'ev-imgs' });
    var imgFile = el('input', {
      type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }
    });
    var imgDrop = el('div', { class: 'ev-drop' }, [
      imgBox,
      el('div', { class: 'row-wrap' }, [
        ui.btn('画像を選ぶ', 'ghost tiny', function () { imgFile.click(); }, 'plus'),
        ui.btn('貼り付け', 'ghost tiny', function () { pasteFromClipboard(); })
      ]),
      imgFile
    ]);

    function drawImgs() {
      U.clear(imgBox);
      if (!images.length) {
        imgBox.appendChild(el('p', { class: 'muted small',
          text: 'コピーした画像をそのまま貼り付けられます（ここへドラッグしても入ります）' }));
        return;
      }
      images.forEach(function (ref, i) {
        var url = DL.imgbank.src(ref);
        imgBox.appendChild(el('div', { class: 'ev-img' }, [
          el('button', {
            type: 'button', class: 'ev-img-b', 'aria-label': '大きく見る',
            onclick: function () { viewImage(images, i); }
          }, url
            ? el('img', { src: url, alt: '' })
            : el('span', { class: 'ev-img-wait muted small', text: '読み込み中' })),
          el('button', {
            type: 'button', class: 'iconbtn ev-img-x', 'aria-label': 'この画像を外す',
            onclick: function () { images.splice(i, 1); drawImgs(); }
          }, ui.icon('close', 15))
        ]));
      });
    }

    /* 読み込んで、置き場へ預ける。預けられたら鍵が、だめなら絵そのものが返る */
    function takeFiles(files) {
      var list = [].slice.call(files || []).filter(function (f) {
        return f && /^image\//.test(f.type || '');
      });
      if (!list.length) return;
      var room = S.EVENT_IMG_MAX - images.length;
      if (room <= 0) { ui.toast('画像は' + S.EVENT_IMG_MAX + '枚までです', 'warn'); return; }
      if (list.length > room) {
        ui.toast('画像は' + S.EVENT_IMG_MAX + '枚までなので、' + room + '枚だけ入れます', 'warn');
        list = list.slice(0, room);
      }
      list.reduce(function (p, f) {
        return p.then(function () {
          return U.readPhoto(f)
            .then(function (url) { return DL.imgbank.put(url); })
            .then(function (ref) { if (ref) images.push(ref); })
            .catch(function (e) { ui.toast(e.message, 'danger'); });
        });
      }, Promise.resolve()).then(function () {
        drawImgs();
        ui.toast('画像を入れました');
      });
    }

    imgFile.addEventListener('change', function () {
      /* FileList は入力欄と地続きなので、先に配列へ写してから空にする。
         順を逆にすると、写したはずの中身まで一緒に消える */
      var fs = [].slice.call(imgFile.files || []);
      imgFile.value = '';
      takeFiles(fs);
    });

    /* この入力を開いているあいだの貼り付けを拾う。
       （⌘V は、どこを触っていても効いてほしい） */
    function onPaste(e) {
      var items = (e.clipboardData || {}).items;
      if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind !== 'file') continue;
        var f = items[i].getAsFile();
        if (f && /^image\//.test(f.type || '')) files.push(f);
      }
      if (!files.length) return;      // 文字の貼り付けは、そのまま入力欄へ通す
      e.preventDefault();
      takeFiles(files);
    }
    document.addEventListener('paste', onPaste);

    /* iPhone の Safari には「貼り付け」の口が無いことがあるので、
       ボタンからも読みにいけるようにしておく */
    function pasteFromClipboard() {
      var nav = window.navigator;
      if (!nav.clipboard || !nav.clipboard.read) {
        ui.toast('この端末では、⌘V か「画像を選ぶ」をお使いください', 'warn');
        return;
      }
      nav.clipboard.read().then(function (items) {
        var jobs = [];
        (items || []).forEach(function (it) {
          (it.types || []).forEach(function (t) {
            if (/^image\//.test(t)) jobs.push(it.getType(t));
          });
        });
        if (!jobs.length) { ui.toast('コピーした画像が見つかりませんでした', 'warn'); return; }
        Promise.all(jobs).then(takeFiles);
      }).catch(function () {
        ui.toast('貼り付けを許してもらえませんでした。⌘V をお試しください', 'warn');
      });
    }

    ['dragover', 'dragenter'].forEach(function (k) {
      imgDrop.addEventListener(k, function (e) {
        e.preventDefault(); imgDrop.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (k) {
      imgDrop.addEventListener(k, function (e) {
        e.preventDefault(); imgDrop.classList.remove('over');
        if (k === 'drop') takeFiles(e.dataTransfer && e.dataTransfer.files);
      });
    });
    drawImgs();

    /* 終日 / 時間を決める */
    var timeRow = el('div', { class: 'grid2' }, [
      ui.field('開始', startIn), ui.field('終了', endIn)
    ]);
    var allDay = !v.start;
    var timeSeg = ui.segmented(
      [{ value: 'all', label: '終日' }, { value: 'time', label: '時間を決める' }],
      allDay ? 'all' : 'time',
      function (val) { allDay = (val === 'all'); timeRow.hidden = allDay; }
    );
    timeRow.hidden = allDay;

    /* 続く日数の言い換え（3日なら「3日間」） */
    var daysNote = el('span', { class: 'field-hint' });
    function syncDays() {
      var n = daysIn.getValue();
      daysNote.textContent = n <= 1 ? 'その日だけ' : n + '日間（' + U.fmtMD(dateIn.value) + ' から）';
    }
    dateIn.addEventListener('change', function () { syncDays(); syncRepeat(); });
    syncDays();

    /* 繰り返し */
    var repeat = v.repeat;
    var repeatBox = el('div', { class: 'ev-repeat' });
    var repeatSeg = ui.segmented(E.REPEATS, repeat, function (val) { repeat = val; syncRepeat(); });
    function syncRepeat() {
      U.clear(repeatBox);
      if (!repeat) return;
      repeatBox.appendChild(el('p', {
        class: 'muted small',
        text: E.repeatNote({ date: dateIn.value, repeat: repeat })
      }));
      repeatBox.appendChild(ui.field('いつまで', untilIn));
    }
    syncRepeat();

    /* リマインダー（重要にした予定だけ）。日にちと時刻をいくつでも足せる */
    var reminders = (v.reminders || []).map(function (r) { return Object.assign({}, r); });
    var remList = el('div', { class: 'rm-list' });
    var remWrap = el('div', { class: 'rm-wrap' }, [
      remList,
      el('div', { class: 'row-wrap' }, [
        ui.btn('前日 20:00', 'ghost tiny', function () { addRem({ mode: 'rel', days: 1, time: '20:00' }); }, 'plus'),
        ui.btn('当日 08:00', 'ghost tiny', function () { addRem({ mode: 'rel', days: 0, time: '08:00' }); }, 'plus'),
        ui.btn('30分前', 'ghost tiny', function () { addRem({ mode: 'min', minutes: 30 }); }, 'plus'),
        ui.btn('日時を選ぶ', 'ghost tiny', function () { pickRem(); }, 'clock')
      ])
    ]);

    function drawRem() {
      U.clear(remList);
      if (!reminders.length) {
        remList.appendChild(el('p', { class: 'muted small', text: 'まだありません' }));
        return;
      }
      sortRem().forEach(function (r) {
        remList.appendChild(el('div', { class: 'rm-item' }, [
          ui.icon('clock', 15),
          el('span', { text: S.reminderLabel(r) }),
          el('button', {
            type: 'button', class: 'iconbtn rm-del', 'aria-label': 'この通知を消す',
            onclick: function () {
              reminders = reminders.filter(function (x) { return x.id !== r.id; });
              drawRem();
            }
          }, ui.icon('close', 16))
        ]));
      });
    }

    /* 早く鳴るものから並べる。目安の順で、きっちりでなくてよい */
    function sortRem() {
      return reminders.slice().sort(function (a, b) {
        return rank(a) - rank(b);
      });
      function rank(r) {
        if (r.mode === 'abs') return -1000 + U.num(String(r.date).replace(/-/g, ''), 0) / 1e6;
        if (r.mode === 'min') return 1000 - r.minutes / 1000;
        return 100 - r.days;
      }
    }

    function addRem(r) {
      if (reminders.length >= 8) { ui.toast('通知は8つまでです', 'warn'); return; }
      var one = S.normalizeReminders([Object.assign({ id: U.uid() }, r)])[0];
      if (!one) return;
      // 同じものは足さない
      var same = reminders.some(function (x) { return S.reminderLabel(x) === S.reminderLabel(one); });
      if (same) { ui.toast('同じ通知がもうあります', 'warn'); return; }
      reminders.push(one);
      drawRem();
    }

    /* 日時をそのまま決めるぶん */
    function pickRem() {
      var dIn = ui.input({ type: 'date', value: dateIn.value });
      var tIn = ui.input({ type: 'time', value: '09:00' });
      var close2 = ui.sheet({
        title: '日時を選ぶ',
        body: el('div', { class: 'form' }, [
          el('div', { class: 'grid2' }, [ui.field('日付', dIn), ui.field('時刻', tIn)]),
        ]),
        actions: [
          ui.btn('やめる', 'ghost', function () { close2(); }),
          ui.btn('足す', 'primary', function () {
            if (!U.isISO(dIn.value)) { ui.toast('日付を入れてください', 'warn'); return; }
            addRem({ mode: 'abs', date: dIn.value, time: tIn.value });
            close2();
          })
        ]
      });
    }
    drawRem();
    // 重要でない予定は鳴らないので、そう見えるようにしておく
    function syncImp() { remWrap.classList.toggle('off', !importantIn.checked); }
    importantIn.addEventListener('change', syncImp);
    syncImp();

    /* 色 */
    var color = v.color;
    // 一覧に無い色（前の配色で作った予定など）は、選んだままに見えるよう先頭に足す
    var colors = S.EVENT_COLORS.slice();
    if (!colors.some(function (c) { return c.value === color; })) {
      colors.unshift({ value: color, label: 'いまの色' });
    }
    var swatches = el('div', { class: 'sw-row' }, colors.map(function (c) {
      var b = el('button', {
        type: 'button', class: 'sw' + (c.value === color ? ' on' : ''),
        'aria-label': c.label, style: { background: c.value },
        onclick: function () {
          color = c.value;
          U.$$('.sw', swatches).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        }
      });
      return b;
    }));

    function save() {
      var title = titleIn.value.trim();
      if (!title) { ui.toast('予定の名前を入れてください', 'danger'); titleIn.focus(); return; }
      if (!U.isISO(dateIn.value)) { ui.toast('日付を入れてください', 'danger'); return; }

      var patch = {
        title: title, date: dateIn.value, days: daysIn.getValue(),
        start: allDay ? '' : startIn.value, end: allDay ? '' : endIn.value,
        memo: memoIn.value, color: color, important: importantIn.checked,
        images: images,
        // 重要をやめたら鳴らさない。書いたものは消さずに取っておく
        reminders: reminders,
        repeat: repeat, until: repeat ? untilIn.value : ''
      };
      // 終了が開始より前なら、入れ違いとして終了を落とす（翌日にまたがる指定は日数で表す）
      if (patch.start && patch.end && patch.end <= patch.start) patch.end = '';

      if (isNew) S.addEvent(patch);
      else S.updateEvent(ev.id, patch);
      close();
      ui.toast(isNew ? '予定を追加しました' : '予定を直しました');
    }

    var sheetClose = ui.sheet({
      title: isNew ? '日常の予定を追加' : '日常の予定',
      body: el('div', { class: 'form' }, [
        ui.field('予定', titleIn),
        el('div', { class: 'grid2' }, [
          ui.field('日付', dateIn),
          el('label', { class: 'field' }, [
            el('span', { class: 'field-label', text: '続く日数' }), daysIn, daysNote
          ])
        ]),
        ui.field('時間', timeSeg),
        timeRow,
        ui.field('繰り返し', repeatSeg),
        repeatBox,
        ui.block('色', swatches),
        el('label', { class: 'row-check' }, [
          importantIn,
          el('span', {}, [
            el('span', { text: '重要' }),
            null
          ])
        ]),
        ui.block('リマインダー', remWrap),
        ui.field('メモ', memoIn),
        ui.block('画像', imgDrop),
        !isNew ? ui.btn('この予定を削除', 'danger full mt', function () {
          var msg = ev.repeat
            ? 'この予定を削除します。繰り返している回もまとめて消えます。'
            : 'この予定を削除します。';
          ui.confirm(msg, { danger: true, okText: '削除' }).then(function (ok) {
            if (!ok) return;
            S.removeEvent(ev.id); close(); ui.toast('削除しました');
          });
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', save)
      ]
    });

    /* 閉じるときに、貼り付けの耳を外す。
       付けっぱなしにすると、ほかの画面での⌘Vまで拾ってしまう */
    function close() {
      document.removeEventListener('paste', onPaste);
      sheetClose();
    }
  }

  /* 絵を大きく見る。何枚かあれば、めくって見られる */
  function viewImage(refs, at) {
    var i = Math.max(0, Math.min(refs.length - 1, at || 0));
    var box = el('div', { class: 'ev-view' });
    var close;

    function draw() {
      U.clear(box);
      var url = DL.imgbank.src(refs[i]);
      box.appendChild(url
        ? el('img', { src: url, alt: '' })
        : el('p', { class: 'muted small', text: '読み込み中です' }));
      if (refs.length > 1) {
        box.appendChild(el('div', { class: 'ev-view-nav' }, [
          ui.btn('前', 'ghost tiny', function () { i = (i - 1 + refs.length) % refs.length; draw(); }, 'chevronLeft'),
          el('span', { class: 'muted small', text: (i + 1) + ' / ' + refs.length }),
          ui.btn('次', 'ghost tiny', function () { i = (i + 1) % refs.length; draw(); }, 'chevronRight')
        ]));
      }
    }
    draw();

    close = ui.sheet({
      title: '画像', body: box,
      actions: [ui.btn('閉じる', 'ghost', function () { close(); })]
    });
  }

  DL.views = DL.views || {};
  DL.views.events = { dayView: dayView, dutyBox: dutyBox, monthBody: monthBody, form: form };
})(window.DL);
