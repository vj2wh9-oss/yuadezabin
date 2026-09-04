/* 1日の時間の振り分けを、見て・直す。

   カレンダーの日別画面では円グラフ（24時間の時計として、0時を上にして右回り）。
   ホームでは横長の長方形。どちらも同じ帯を見ているだけで、中身は同じ。

   案件と日常で分けない。どちらのカレンダーから開いても同じものが出る。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, T = DL.timeblocks, el = U.el;

  var DAY = 1440;
  var NS = 'http://www.w3.org/2000/svg';

  /* ---------------- 円グラフ ---------------- */

  /**
   * 24時間の円グラフ。0時が上で、時計と同じ右回り。
   * @param {string} date
   * @param {object} [opts] {size, onPick:fn(block)}
   */
  function pie(date, opts) {
    opts = opts || {};
    var size = opts.size || 200;
    var R = 50, r = 29, C = 60;      // 60×60 の座標で描いて、表示だけ大きくする

    var svg = svgEl('svg', {
      class: 'tp-pie', viewBox: '0 0 120 120',
      width: size, height: size, role: 'img',
      'aria-label': date + ' の時間の振り分け'
    });

    // まだ書いていないところ
    svg.appendChild(svgEl('circle', { cx: C, cy: C, r: (R + r) / 2, class: 'tp-rest', 'stroke-width': R - r }));

    T.ofDay(date).forEach(function (b) {
      var p = svgEl('path', {
        class: 'tp-slice', d: ring(C, R, r, b.start, b.end), fill: T.color(b.kind)
      });
      p.appendChild(svgEl('title', { text: slabel(b) }));
      if (opts.onPick && !b.carry) {
        p.classList.add('tap');
        p.addEventListener('click', function () { opts.onPick(b); });
      }
      svg.appendChild(p);
    });

    // 時刻の目盛り。0/6/12/18 だけ置く
    [0, 6, 12, 18].forEach(function (h) {
      var a = ang(h * 60);
      svg.appendChild(svgEl('text', {
        class: 'tp-tick', x: C + Math.sin(a) * (R + 7), y: C - Math.cos(a) * (R + 7) + 3,
        'text-anchor': 'middle', text: String(h)
      }));
    });

    // まん中に、いちばん長いものを出す
    var top = T.sums(date)[0];
    if (top) {
      svg.appendChild(svgEl('text', { class: 'tp-mid-v', x: C, y: C + 1, 'text-anchor': 'middle', text: hm(top.min) }));
      svg.appendChild(svgEl('text', { class: 'tp-mid-l', x: C, y: C + 12, 'text-anchor': 'middle', text: top.label }));
    }
    return svg;
  }

  /* 0時を上にした角度（ラジアン）。右回り */
  function ang(min) { return (min % DAY) / DAY * Math.PI * 2; }

  /* ドーナツの一切れ */
  function ring(c, R, r, start, end) {
    var span = Math.max(0, end - start);
    if (span >= DAY) span = DAY - 0.01;      // まるまる1日は、閉じないように少し欠かす
    var a0 = ang(start), a1 = ang(start) + span / DAY * Math.PI * 2;
    var big = span / DAY > 0.5 ? 1 : 0;
    var p = function (a, rad) {
      return [c + Math.sin(a) * rad, c - Math.cos(a) * rad];
    };
    var o0 = p(a0, R), o1 = p(a1, R), i1 = p(a1, r), i0 = p(a0, r);
    return 'M' + o0 + 'A' + R + ',' + R + ' 0 ' + big + ' 1 ' + o1 +
           'L' + i1 + 'A' + r + ',' + r + ' 0 ' + big + ' 0 ' + i0 + 'Z';
  }

  /* ---------------- 長方形（ホーム） ---------------- */

  /**
   * 24時間を横に伸ばした帯。0時が左、24時が右。
   * @param {string} date
   * @param {object} [opts] {now:true で今の時刻に印を出す, href}
   */
  function bar(date, opts) {
    opts = opts || {};
    var box = el('div', { class: 'tp-bar' });
    T.ofDay(date).forEach(function (b) {
      box.appendChild(el('i', {
        class: 'tp-seg', title: slabel(b),
        style: {
          left: (b.start / DAY * 100) + '%',
          width: ((b.end - b.start) / DAY * 100) + '%',
          background: T.color(b.kind)
        }
      }));
    });
    if (opts.now) {
      var d = new Date();
      var m = d.getHours() * 60 + d.getMinutes();
      box.appendChild(el('i', { class: 'tp-now', style: { left: (m / DAY * 100) + '%' } }));
    }
    var wrap = el('div', { class: 'tp-barwrap' }, [
      box,
      // 目盛りは帯の位置とそろえたいので、左からの割合で置く
      el('div', { class: 'tp-scale' }, [0, 6, 12, 18, 24].map(function (h) {
        return el('span', { text: h + '時', style: { left: (h / 24 * 100) + '%' } });
      }))
    ]);
    return wrap;
  }

  /** ホームに出す一枚。押すとその日の時間割を開く */
  function homeCard(date) {
    var list = T.ofDay(date);
    var card = el('a', { class: 'card tp-home', href: '#/time/' + date });
    if (!list.length) {
      card.appendChild(el('div', { class: 'tp-empty' }, [
        el('span', { class: 'muted small', text: '今日の時間の振り分けはまだありません。' }),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
      return card;
    }
    card.appendChild(bar(date, { now: true }));
    card.appendChild(legend(date, 4));
    return card;
  }

  /* 種類ごとの合計。多い順にいくつかだけ */
  function legend(date, max) {
    var rows = T.sums(date);
    if (max) rows = rows.slice(0, max);
    return el('div', { class: 'tp-legend' }, rows.map(function (s) {
      return el('span', { class: 'tp-leg' }, [
        el('i', { style: { background: s.color } }),
        el('span', { text: s.label }),
        el('b', { text: hm(s.min) })
      ]);
    }));
  }

  /* ---------------- 日別画面に出す一枚 ---------------- */

  /**
   * カレンダーの日別画面に差し込む。案件でも日常でも同じものを出す。
   * @param {Element} wrap 差し込み先
   */
  function dayCard(wrap, date) {
    var list = T.ofDay(date);
    wrap.appendChild(ui.section('1日の時間',
      list.length ? ui.chip(hm(T.filled(date)) + ' ぶん', 'soft') : null));

    var card = el('div', { class: 'card tp-card' });
    if (!list.length) {
      card.appendChild(el('p', { class: 'muted small', text: 'まだ書いていません。時間を足すか、勤務のひな型から入れられます。' }));
    } else {
      card.appendChild(el('div', { class: 'tp-top' }, [
        pie(date, { size: 168, onPick: function (b) { blockSheet(date, b); } }),
        legend(date)
      ]));
      card.appendChild(rows(date));
    }
    card.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('時間を足す', 'ghost', function () { blockSheet(date, null); }, 'plus'),
      presetBtn(date),
      list.length ? ui.btn('全部消す', 'ghost tiny', function () { clearDay(date); }) : null
    ]));
    wrap.appendChild(card);
  }

  /* 勤務のひな型を入れるボタン。勤務を選んでいる日だけ出す */
  function presetBtn(date) {
    var duty = S.duty(date);
    if (!T.hasPreset(duty)) return null;
    return ui.btn(S.dutyLabel(duty) + 'のひな型', 'ghost', function () {
      offerPreset(date, duty, true);
    }, 'refresh');
  }

  /**
   * ひな型を入れるか聞いてから入れる。
   * @param {boolean} [ask] すでに書いてあるときも聞く
   */
  function offerPreset(date, duty, ask) {
    if (!T.hasPreset(duty)) return Promise.resolve(false);
    var had = S.timeblocks(date).length;
    var msg = S.dutyLabel(duty) + 'のひな型を入れます。\n\n' + T.presetText(duty)
      + (had ? '\n\nすでに書いてあるぶんは、置き換わります。' : '');
    if (!ask && !had) {
      T.applyPreset(date, duty, true);
      return Promise.resolve(true);
    }
    return ui.confirm(msg, { title: '1日の時間', okText: '入れる' }).then(function (ok) {
      if (!ok) return false;
      T.applyPreset(date, duty, true);
      ui.toast('ひな型を入れました');
      return true;
    });
  }

  function clearDay(date) {
    ui.confirm('この日の時間の振り分けを、全部消します。', { danger: true, okText: '消す' })
      .then(function (ok) {
        if (!ok) return;
        S.setTimeblocks(date, []);
        ui.toast('消しました');
      });
  }

  /* 帯を上から順に並べた一覧。押すと直せる */
  function rows(date) {
    return el('div', { class: 'tp-rows' }, T.ofDay(date).map(function (b) {
      return el('button', {
        class: 'tp-row' + (b.carry ? ' carry' : ''),
        onclick: function () { blockSheet(b.carry ? b.date : date, b); }
      }, [
        el('i', { class: 'tp-dot', style: { background: T.color(b.kind) } }),
        el('span', { class: 'tp-row-t', text: T.fmt(b.start) + '〜' + T.fmt(b.end) }),
        el('span', { class: 'tp-row-k', text: T.label(b.kind) + (b.memo ? '　' + b.memo : '') }),
        el('span', { class: 'tp-row-d', text: hm(b.end - b.start) + (b.carry ? '（前の日から）' : b.over ? '（翌日へ）' : '') })
      ]);
    }));
  }

  /* ---------------- 帯を1本入れる・直す ---------------- */

  /**
   * @param {string} date その帯を置く日
   * @param {object} [b] 直すとき。前の日から続いているものは、その日のほうを開く
   */
  function blockSheet(date, b) {
    var isNew = !b;
    // 前の日から続いている帯は、保存されている日の値をそのまま出す
    var src = b && b.carry ? S.timeblocks(b.date).filter(function (o) { return o.id === b.id; })[0] : null;
    var cur = src || b;
    var v = {
      id: cur ? cur.id : '',
      kind: cur ? cur.kind : guessKind(date),
      start: cur ? cur.start : nextFree(date),
      end: cur ? cur.end : Math.min(DAY, nextFree(date) + 60),
      memo: cur ? (cur.memo || '') : ''
    };

    var startIn = ui.input({ value: T.fmt(v.start), inputmode: 'numeric', placeholder: '8:00' });
    var endIn = ui.input({ value: T.fmt(v.end), inputmode: 'numeric', placeholder: '16:30' });
    var memoIn = ui.input({ value: v.memo, maxlength: 40, placeholder: 'ひとこと（なくてよい）' });

    var kindWrap = el('div', { class: 'tp-kinds' });
    T.kinds().forEach(function (k) {
      var btn = el('button', {
        type: 'button', class: 'tp-kind' + (k.value === v.kind ? ' on' : ''),
        onclick: function () {
          v.kind = k.value;
          U.$$('.tp-kind', kindWrap).forEach(function (x) { x.classList.remove('on'); });
          btn.classList.add('on');
        }
      }, [el('i', { style: { background: k.color } }), el('span', { text: k.label })]);
      kindWrap.appendChild(btn);
    });

    var note = el('p', { class: 'muted small' });
    function showLen() {
      var s = T.parse(startIn.value), e = T.parse(endIn.value);
      if (s === null || e === null) { note.textContent = '時刻は 8:00 のように入れてください。'; return; }
      if (e <= s) { note.textContent = '終わりは、始まりより後にしてください（夜勤なら 32:30 のように24時を超えた書き方ができます）。'; return; }
      note.textContent = hm(e - s) + '　' + T.fmtDay(s) + '〜' + T.fmtDay(e)
        + (e > DAY ? '（翌日にまたがります）' : '');
    }
    startIn.addEventListener('input', showLen);
    endIn.addEventListener('input', showLen);
    showLen();

    var close = ui.sheet({
      title: isNew ? '時間を足す' : '時間を直す',
      body: el('div', { class: 'form' }, [
        ui.block('何をしていたか', kindWrap),
        el('div', { class: 'grid2' }, [
          ui.field('始まり', startIn),
          ui.field('終わり', endIn)
        ]),
        note,
        ui.field('メモ', memoIn),
        !isNew ? ui.btn('この時間を消す', 'danger full mt', function () {
          S.removeTimeblock(cur && src ? b.date : date, v.id);
          close();
          ui.toast('消しました');
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var s = T.parse(startIn.value), e = T.parse(endIn.value);
          if (s === null || e === null) { ui.toast('時刻を読み取れませんでした', 'danger'); return; }
          if (e <= s) { ui.toast('終わりは始まりより後にしてください', 'danger'); return; }
          S.putTimeblock(src ? b.date : date, { id: v.id, kind: v.kind, start: s, end: e, memo: memoIn.value });
          close();
          ui.toast(isNew ? '足しました' : '直しました');
        })
      ]
    });
  }

  /* 空いているところの先頭。足すときの初期値に使う */
  function nextFree(date) {
    var g = T.gaps(date).filter(function (x) { return x.end - x.start >= 15; })[0];
    if (g) return g.start;
    var last = T.ofDay(date).slice(-1)[0];
    return last ? Math.min(DAY - 60, last.end) : 480;
  }

  /* 足すときの種類の当たり。朝晩は睡眠、日中は仕事にしておく */
  function guessKind(date) {
    var at = nextFree(date);
    if (at < 360 || at >= 1380) return 'sleep';
    if (at >= 540 && at < 1080) return 'work';
    return 'free';
  }

  /* ---------------- そのほか ---------------- */

  function slabel(b) {
    return T.label(b.kind) + ' ' + T.fmt(b.start) + '〜' + T.fmt(b.end) + (b.memo ? '　' + b.memo : '');
  }

  /** 分 → '8時間30分' / '45分' */
  function hm(min) {
    var m = Math.max(0, Math.round(min));
    var h = Math.floor(m / 60);
    return (h ? h + '時間' : '') + (m % 60 ? (m % 60) + '分' : (h ? '' : '0分'));
  }

  function svgEl(name, attrs) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.setAttribute('class', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    return n;
  }

  /* ---------------- その日だけの画面 ---------------- */

  function render(root, params) {
    var date = U.isISO(params.date) ? params.date : U.today();
    var wrap = el('div', { class: 'page' });

    wrap.appendChild(el('div', { class: 'daynav' }, [
      el('a', { class: 'iconbtn', href: '#/time/' + U.addDays(date, -1), 'aria-label': '前の日' }, ui.icon('chevronLeft', 20)),
      el('div', { class: 'daytitle' }, [
        ui.dateHead(date),
        el('div', { class: 'today-sub', text: '1日の時間' })
      ]),
      el('a', { class: 'iconbtn', href: '#/time/' + U.addDays(date, 1), 'aria-label': '次の日' }, ui.icon('chevronRight', 20))
    ]));

    dayCard(wrap, date);

    wrap.appendChild(el('div', { class: 'pad btn-row3' }, [
      ui.btn('この日のカレンダー', 'ghost', function () { location.hash = '#/day/' + date; }, 'calendar'),
      ui.btn('この日の記録', 'ghost', function () { location.hash = '#/log/' + date; }, 'task')
    ]));

    root.appendChild(wrap);
  }

  DL.views = DL.views || {};
  DL.views.time = {
    render: render, dayCard: dayCard, homeCard: homeCard,
    pie: pie, bar: bar, legend: legend, blockSheet: blockSheet, offerPreset: offerPreset
  };
})(window.DL);
