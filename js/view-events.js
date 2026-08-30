/* 日常のカレンダー：日別の一覧・月の一覧・予定の入力 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, E = DL.events, el = U.el;

  /* ---------------- 日別 ---------------- */

  /**
   * その日の予定を並べる（案件側の renderDay から呼ばれる）。
   * @param {HTMLElement} wrap 追記先
   * @param {string} date 'YYYY-MM-DD'
   */
  function dayView(wrap, date) {
    var list = E.ofDay(date);

    wrap.appendChild(ui.section('この日の予定', list.length ? ui.chip(list.length + '件', 'soft') : null));

    if (!list.length) {
      wrap.appendChild(ui.empty('この日に予定はありません。'));
    } else {
      wrap.appendChild(el('div', { class: 'list' }, list.map(function (o) { return row(o); })));
    }

    wrap.appendChild(el('div', { class: 'pad' },
      ui.btn('予定を追加', 'ghost full', function () { form(null, { date: date }); }, 'plus')
    ));

    dutyBox(wrap, date);
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
          S.setDuty(date, on ? '' : d.value);      // 同じものをもう一度押したら外す
          ui.toast(on ? d.label + 'を外しました' : d.label + 'にしました');
        }
      }, [
        el('i', { class: 'duty-dot' }),
        el('span', { text: d.label })
      ]);
    })));

    wrap.appendChild(el('p', { class: 'muted small pad',
      text: '選ぶとカレンダーのその日に色が付きます（出社＝黄・リモートワーク＝赤・泊まり勤務＝青）。もう一度押すと外れます。' }));
  }

  function row(o) {
    return el('button', { class: 'row ev-row', onclick: function () { form(o.ev, { occurrence: o }); } }, [
      el('div', { class: 'row-bar', style: { background: o.ev.color } }),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title', text: o.ev.title }),
        el('div', { class: 'row-sub' }, [
          ui.chip(E.whenText(o), 'soft'),
          o.ev.repeat ? ui.iconChip('refresh', E.repeatLabel(o.ev.repeat), 'ghosty') : null
        ]),
        o.ev.memo ? el('p', { class: 'muted small ev-memo', text: o.ev.memo }) : null
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
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
      color: S.EVENT_COLORS[0].value, repeat: '', until: ''
    };

    var titleIn = ui.input({ value: v.title, maxlength: 80, placeholder: '例）歯医者 / 燃えるゴミ / 母の誕生日' });
    var dateIn = ui.input({ type: 'date', value: v.date });
    var daysIn = ui.stepper({ value: v.days, max: 60, onChange: function () { syncDays(); } });
    var startIn = ui.input({ type: 'time', value: v.start });
    var endIn = ui.input({ type: 'time', value: v.end });
    var memoIn = ui.textarea({ value: v.memo, maxlength: 400, placeholder: '持ち物・場所など' });
    var untilIn = ui.input({ type: 'date', value: v.until });

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
      repeatBox.appendChild(ui.field('いつまで', untilIn, '空にすると、ずっと繰り返します'));
    }
    syncRepeat();

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
        memo: memoIn.value, color: color,
        repeat: repeat, until: repeat ? untilIn.value : ''
      };
      // 終了が開始より前なら、入れ違いとして終了を落とす（翌日にまたがる指定は日数で表す）
      if (patch.start && patch.end && patch.end <= patch.start) patch.end = '';

      if (isNew) S.addEvent(patch);
      else S.updateEvent(ev.id, patch);
      close();
      ui.toast(isNew ? '予定を追加しました' : '予定を直しました');
    }

    var close = ui.sheet({
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
        ui.field('色', swatches),
        ui.field('メモ', memoIn),
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
  }

  DL.views = DL.views || {};
  DL.views.events = { dayView: dayView, monthBody: monthBody, form: form };
})(window.DL);
