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
   * まわりに予定の名前を置き、その時刻から線で結ぶ。
   * @param {string} date
   * @param {object} [opts] {onPick:fn(block)}
   */
  function pie(date, opts) {
    opts = opts || {};
    /* 230×206 の中に描いて、表示は幅いっぱいに伸ばす。
       まん中に円、そのまわりを囲うように名前を置く */
    var VW = 230, VH = 206;
    var C = 115, CY = 100, R = 56, r = 34;
    var FS = 7;                   // 名前の字の大きさ
    var TAG_H = 11;               // 名前を囲う枠の高さ
    var TAG_MAX = 44;             // 名前を囲う枠の幅（いっぱいまで）
    var LR = R + 13;              // 名前を置く輪の大きさ

    var svg = svgEl('svg', {
      class: 'tp-pie', viewBox: '0 0 ' + VW + ' ' + VH, role: 'img',
      'aria-label': date + ' の時間の振り分け'
    });

    // まだ書いていないところ
    svg.appendChild(svgEl('circle', {
      cx: C, cy: CY, r: (R + r) / 2, class: 'tp-rest', 'stroke-width': R - r
    }));

    var list = T.ofDay(date);
    var slices = [];
    list.forEach(function (b) {
      var p = svgEl('path', {
        class: 'tp-slice', d: ring(C, CY, R, r, b.start, b.end), fill: b.color
      });
      p.appendChild(svgEl('title', { text: slabel(b) }));
      if (opts.onPick && !b.carry) {
        p.classList.add('tap');
        p.addEventListener('click', function () { opts.onPick(b); });
      }
      svg.appendChild(p);
      slices.push({ node: p, start: b.start, end: b.end });
    });

    /* 円を囲う目盛り。数字を置く 0/6/12/18 以外の時刻に、細い線を1本ずつ */
    TICK_HOURS.forEach(function (h) {
      var a = ang(h * 60);
      var s1 = Math.sin(a), c1 = Math.cos(a);
      svg.appendChild(svgEl('line', {
        class: 'tp-hair',
        x1: C + s1 * (R + 2), y1: CY - c1 * (R + 2),
        x2: C + s1 * (R + 5.5), y2: CY - c1 * (R + 5.5)
      }));
    });

    /* 時刻の数字。0/6/12/18 だけ、輪の外側に置く。
       薄い色にしてあるので、名前や線と重なってもじゃまにならない */
    [0, 6, 12, 18].forEach(function (h) {
      var a = ang(h * 60);
      svg.appendChild(svgEl('text', {
        class: 'tp-htick', x: C + Math.sin(a) * (R + 9), y: CY - Math.cos(a) * (R + 9) + 2.5,
        'text-anchor': 'middle', text: String(h)
      }));
    });

    /* いまの時刻。針は出さず、円の中のその場所だけを点滅させる */
    var now = nowMin(date);
    var nowArc = null;
    if (now !== null) {
      nowArc = svgEl('path', {
        class: 'tp-nowarc',
        d: ring(C, CY, R + 1, r - 1, Math.max(0, now - 11), Math.min(DAY, now + 11))
      });
      nowArc.appendChild(svgEl('title', { text: 'いま ' + T.fmt(now) }));
      svg.appendChild(nowArc);
    }

    /* まん中に、いちばん長いものの名前と、その時間帯 */
    var top = T.sums(date)[0];
    if (top) {
      var main = list.filter(function (x) { return x.label === top.label; })
        .sort(function (p, q) { return (q.end - q.start) - (p.end - p.start); })[0];
      var n = top.label.length;
      var fs = n > 6 ? 8 : n > 5 ? 9 : n > 4 ? 10 : 11.5;
      svg.appendChild(svgEl('text', {
        class: 'tp-mid-v', x: C, y: CY + 1, 'text-anchor': 'middle',
        style: 'font-size:' + fs + 'px', text: top.label
      }));
      if (main) {
        svg.appendChild(svgEl('text', {
          class: 'tp-mid-l', x: C, y: CY + 12, 'text-anchor': 'middle',
          text: T.fmt(main.start) + '〜' + T.fmt(main.end)
        }));
      }
    }

    /* まわりに置く名前。円を囲うように、その時刻の外側へ。
       ぶつかるときは1つ外の輪へ逃がす（縦にはそろえない） */
    var tags = place(list, {
      cx: C, cy: CY, LR: LR, VW: VW, VH: VH, H: TAG_H, MAX: TAG_MAX, FS: FS
    });

    // 線は名前より先に描く（名前が線の端を隠す）
    var marks = [];
    tags.forEach(function (o) {
      var b = o.b;
      var a = ang((b.start + b.end) / 2);
      var s2 = Math.sin(a), c2 = Math.cos(a);
      var line = svgEl('line', {
        class: 'tp-lead', stroke: b.color,
        x1: C + s2 * (R + 1), y1: CY - c2 * (R + 1),
        x2: C + s2 * (o.rad - 1), y2: CY - c2 * (o.rad - 1)
      });
      svg.appendChild(line);
      marks.push({ line: line, at: ((b.start + b.end) / 2) / DAY,
        len: Math.round(Math.abs(o.rad - 1 - R - 1) * 10) / 10 });
    });
    tags.forEach(function (o, i) {
      var b = o.b;
      var g = svgEl('g', { class: 'tp-tag' + (opts.onPick && !b.carry ? ' tap' : '') });
      g.appendChild(svgEl('rect', {
        x: o.x, y: o.y, width: o.w, height: TAG_H, rx: 2, fill: b.color
      }));
      g.appendChild(svgEl('text', {
        class: 'tp-tag-t', x: o.x + o.w / 2, y: o.y + TAG_H / 2 + FS * 0.36,
        'text-anchor': 'middle', fill: U.inkOn(b.color),
        style: 'font-size:' + FS + 'px', text: o.text
      }));
      g.appendChild(svgEl('title', { text: slabel(b) }));
      if (opts.onPick && !b.carry) {
        g.addEventListener('click', function () { opts.onPick(b); });
      }
      svg.appendChild(g);
      marks[i].tag = g;
    });

    /* 見せ方は3段。
       ①0時から時計回りに色が埋まる ②もう一周して名前が並ぶ ③線が伸びる */
    var last = sweepEnd(slices, now);
    svg._sweep = function (t) {
      var upto = last * t;
      slices.forEach(function (o) {
        var e = Math.max(o.start, Math.min(o.end, upto));
        o.node.setAttribute('d', ring(C, CY, R, r, o.start, e));
        o.node.style.visibility = e > o.start ? '' : 'hidden';
      });
      // いまの印は、時計回りがそこを通り過ぎてから出す
      if (nowArc) nowArc.style.visibility = upto >= Math.min(now, last) ? '' : 'hidden';
      if (t <= 0) hold();
      if (t >= 1) release();
    };
    /* ①のあいだ、名前と線は伏せておく */
    function hold() {
      marks.forEach(function (m) {
        m.tag.style.transition = 'none';
        m.tag.style.opacity = '0';
        m.line.style.transition = 'none';
        m.line.style.strokeDasharray = m.len;
        m.line.style.strokeDashoffset = m.len;
      });
    }
    /* ②名前を一周ぶんかけて出し、そろってから③線を伸ばす */
    function release() {
      if (!marks.length) return;
      marks.forEach(function (m) {
        m.tag.style.transition = 'opacity .3s ease';
        m.tag.style.transitionDelay = Math.round(m.at * LAP_MS) + 'ms';
        m.tag.style.opacity = '1';
        m.line.style.transition = 'stroke-dashoffset .45s ease';
        m.line.style.transitionDelay = Math.round(LAP_MS + 300 + m.at * LINE_MS) + 'ms';
        m.line.style.strokeDashoffset = '0';
      });
    }
    return svg;
  }

  var LAP_MS = 800;      // 名前がぐるっと一周そろうまで
  var LINE_MS = 400;     // 線が順に伸びるまで
  /* 数字を置く 0/6/12/18 以外の時刻。ここに細い目盛りを引く */
  var TICK_HOURS = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];

  /* 字の幅のあたり。日本語は1文字ぶん、英数字は半分で数える */
  function textW(s, fs) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      w += s.charCodeAt(i) > 0x2e80 ? fs : fs * 0.55;
    }
    return w;
  }

  /* 入らない名前は、後ろを「…」にして詰める */
  function fit(s, max, fs) {
    if (textW(s, fs) <= max) return s;
    var out = s;
    while (out.length > 1 && textW(out + '…', fs) > max) out = out.slice(0, -1);
    return out + '…';
  }

  /**
   * まわりに置く名前の位置を決める。
   * その帯のまん中の時刻の外側に、円を囲うように置く。
   * 右半分は右へ、左半分は左へ、上下は真ん中ぞろえで伸ばす。
   * すでに置いたものとぶつかるときは、1つ外の輪へ逃がす。
   */
  function place(list, g) {
    var out = [];
    list.forEach(function (b) {
      var text = fit(b.label, g.MAX - 7, g.FS);
      var w = Math.min(g.MAX, Math.round(textW(text, g.FS)) + 7);
      var a = ang((b.start + b.end) / 2);
      var s = Math.sin(a), c = Math.cos(a);
      var best = null;
      for (var step = 0; step < 4; step++) {
        var rad = g.LR + step * (g.H + 4);
        var px = g.cx + s * rad, py = g.cy - c * rad;
        var x = s > 0.25 ? px : (s < -0.25 ? px - w : px - w / 2);
        var y = py - g.H / 2;
        x = Math.max(1, Math.min(g.VW - w - 1, x));
        y = Math.max(1, Math.min(g.VH - g.H - 1, y));
        var box = { b: b, text: text, x: x, y: y, w: w, rad: rad };
        if (!best) best = box;
        if (!bump(box, out, g.H)) { best = box; break; }
      }
      out.push(best);
    });
    return out;
  }

  /* すでに置いたものと重なっているか */
  function bump(box, list, h) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (box.x < o.x + o.w + 2 && o.x < box.x + box.w + 2
        && box.y < o.y + h + 2 && o.y < box.y + h + 2) return true;
    }
    return false;
  }

  /* 描き出しをどこまで進めればいいか。
     いちばん遅い帯の終わりまで来れば、もう描くものはない。24時までを
     一律に回すと、夕方で終わる日は途中から何も起きない間ができてしまう。
     いまの時刻がその先にある日は、印を最後に出す（そこまで空回りしない）。 */
  function sweepEnd(list, now) {
    var end = 0;
    list.forEach(function (o) { if (o.end > end) end = o.end; });
    return end || (now === null ? DAY : now) || DAY;
  }

  /* 0時を上にした角度（ラジアン）。右回り */
  function ang(min) { return (min % DAY) / DAY * Math.PI * 2; }

  /* その日が今日なら、いまが0時から何分か。ほかの日なら null */
  function nowMin(date) {
    if (date !== U.today()) return null;
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  /* ドーナツの一切れ */
  function ring(cx, cy, R, r, start, end) {
    var span = Math.max(0, end - start);
    if (span >= DAY) span = DAY - 0.01;      // まるまる1日は、閉じないように少し欠かす
    var a0 = ang(start), a1 = ang(start) + span / DAY * Math.PI * 2;
    var big = span / DAY > 0.5 ? 1 : 0;
    var p = function (a, rad) {
      return [cx + Math.sin(a) * rad, cy - Math.cos(a) * rad];
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
    var segs = [];
    /* 3時間ごとの目盛り。帯の上に薄く引いて、どのあたりが何時か分かるように
       （6時間ごとは少し濃く。0時と24時は帯の縁なので引かない） */
    for (var h = 3; h < 24; h += 3) {
      box.appendChild(el('i', {
        class: 'tp-tick' + (h % 6 === 0 ? ' big' : ''), style: { left: (h / 24 * 100) + '%' }
      }));
    }
    T.ofDay(date).forEach(function (b) {
      var i = el('i', {
        class: 'tp-seg', title: slabel(b),
        style: {
          left: (b.start / DAY * 100) + '%',
          width: ((b.end - b.start) / DAY * 100) + '%',
          background: b.color
        }
      });
      box.appendChild(i);
      segs.push({ node: i, start: b.start, end: b.end });
    });
    // いまの時刻。今日を見ているときだけ
    var m = nowMin(date);
    var mark = null;
    if (m !== null) {
      mark = el('i', {
        class: 'tp-now', title: 'いま ' + T.fmt(m), style: { left: (m / DAY * 100) + '%' }
      });
      box.appendChild(mark);
    }

    /* 円グラフと同じ見せ方。0→1 を渡すと、左から順に出てくる。
       ui.introduce がこれを見つけて呼ぶ */
    var last = sweepEnd(segs, m);
    box._sweep = function (t) {
      var upto = last * t;
      segs.forEach(function (o) {
        var e = Math.max(o.start, Math.min(o.end, upto));
        o.node.style.width = ((e - o.start) / DAY * 100) + '%';
        o.node.style.visibility = e > o.start ? '' : 'hidden';
      });
      if (mark) mark.style.visibility = upto >= Math.min(m, last) ? '' : 'hidden';
    };
    var wrap = el('div', { class: 'tp-barwrap' }, [
      box,
      // 目盛りは帯の位置とそろえたいので、左からの割合で置く。
      // 3時間ごとに刻み、6時間ごとははっきり見せる
      el('div', { class: 'tp-scale' }, [0, 3, 6, 9, 12, 15, 18, 21, 24].map(function (h) {
        return el('span', { class: h % 6 === 0 ? 'big' : '',
          text: h + '時', style: { left: (h / 24 * 100) + '%' } });
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
      // 名前はその色の中に入れる。字の色は、色の明るさで白と黒を選ぶ
      return el('span', { class: 'tp-leg' }, [
        el('span', { class: 'tp-leg-t',
          style: { background: s.color, color: U.inkOn(s.color) }, text: s.label }),
        el('span', { class: 'tp-leg-v', text: hm(s.min) })
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
    wrap.appendChild(ui.section('1日の時間'));

    var card = el('div', { class: 'card tp-card' });

    // いまが何時で、何をしていることになっているか。まずここで言い切る
    var nb = nowBanner(date);
    if (nb) card.appendChild(nb);

    if (!list.length) {
      card.appendChild(el('p', { class: 'muted small', text: 'まだ書いていません。時間を足すか、勤務のプリセットから入れられます。' }));
    } else {
      /* 円は真ん中に大きく。名前は円のまわりに置くので、横に並べない */
      card.appendChild(el('div', { class: 'tp-pie-wrap' },
        pie(date, { onPick: function (b) { blockSheet(b.carry ? b.date : date, b); } })));
      card.appendChild(rows(date));
      var pr = projRows(date);
      if (pr) card.appendChild(pr);
    }
    // iPhone の幅でも折り返さないよう、等分の1行に並べる
    var acts = [ui.btn('時間を足す', 'ghost', function () { blockSheet(date, null); }, 'plus')];
    var preset = presetBtn(date);
    if (preset) acts.push(preset);
    if (list.length) acts.push(ui.btn('全部消す', 'ghost', function () { clearDay(date); }, 'trash'));
    card.appendChild(el('div', { class: 'tp-acts n' + acts.length }, acts));
    wrap.appendChild(card);
  }

  /* 勤務のプリセットを入れるボタン。勤務を選んでいる日だけ出す。
     3つ並べても1行に収めたいので、ボタンの字は「プリセット」だけにして、
     どの勤務のものかは読み上げと長押しの説明に持たせる */
  function presetBtn(date) {
    var duty = S.duty(date);
    if (!T.hasPreset(duty)) return null;
    var b = ui.btn('プリセット', 'ghost', function () { offerPreset(date, duty, true); }, 'refresh');
    b.setAttribute('aria-label', S.dutyLabel(duty) + 'のプリセットを入れる');
    b.setAttribute('title', S.dutyLabel(duty) + 'のプリセットを入れる');
    return b;
  }

  /**
   * プリセットを入れるか聞いてから入れる。
   * @param {boolean} [ask] すでに書いてあるときも聞く
   */
  function offerPreset(date, duty, ask) {
    if (!T.hasPreset(duty)) return Promise.resolve(false);
    var had = S.timeblocks(date).length;
    var msg = S.dutyLabel(duty) + 'のプリセットを入れます。\n\n' + T.presetText(duty)
      + (had ? '\n\nすでに書いてあるぶんは、置き換わります。' : '');
    if (!ask && !had) {
      T.applyPreset(date, duty, true);
      return Promise.resolve(true);
    }
    return ui.confirm(msg, { title: '1日の時間', okText: '入れる' }).then(function (ok) {
      if (!ok) return false;
      T.applyPreset(date, duty, true);
      ui.toast('プリセットを入れました');
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

  /* 帯を上から順に並べた一覧。押すと直せる。
     いま進行中のものは青く光らせて、どれが「今」か目で追えるようにする */
  /* 予定の名前。色の中に入れて、字の色は色の明るさで決める */
  function blockTag(b) {
    return el('span', { class: 'tp-np-t', text: b.label,
      style: { background: b.color, color: U.inkOn(b.color) } });
  }

  /* いまの時刻と、いましていること。今日を見ているときだけ出す。
     円や帯の印は小さいので、まず文字で言い切っておく */
  function nowBanner(date) {
    var m = nowMin(date);
    if (m === null) return null;
    var list = T.ofDay(date);
    var b = list.filter(function (x) { return m >= x.start && m < x.end; })[0];
    // このあと最初に始まるもの
    var next = list.filter(function (x) { return x.start > m; })
      .sort(function (p, q) { return p.start - q.start; })[0];

    // 'empty' という名前は、空っぽの案内枠（.empty）と当たって縦並びになる
    var box = el('div', { class: 'tp-nowbar' + (b ? '' : ' is-empty') }, [
      /* いま何時で、何をしていることになっているか */
      el('div', { class: 'tp-np' }, [
        el('div', { class: 'tp-np-h' }, [
          el('b', { class: 'tp-nowtime', text: T.fmt(m) }),
          b ? blockTag(b) : el('span', { class: 'tp-np-none', text: 'まだ書いていません' })
        ]),
        b ? el('div', { class: 'tp-np-r', text: T.fmt(b.start) + '〜' + T.fmt(b.end) }) : null
      ]),
      /* 次へ流れていく印。押せるものではないので読み上げからは外す */
      next ? el('div', { class: 'tp-flow', 'aria-hidden': 'true' },
        [el('i'), el('i'), el('i')]) : null,
      /* このあとの予定 */
      next ? el('div', { class: 'tp-np next' }, [
        el('div', { class: 'tp-np-h' }, [
          el('b', { class: 'tp-np-time', text: T.fmt(next.start) }),
          blockTag(next)
        ]),
        el('div', { class: 'tp-np-r', text: T.fmt(next.start) + '〜' + T.fmt(next.end) })
      ]) : null
      // 「ここを書く」は、すぐ下の「時間を足す」と同じことなので置かない
    ]);

    /* 時計は進む。開きっぱなしでも合うように書き替える。
       ふだんは時刻の字だけ差し替え、帯をまたいだときだけ描き直す
       （毎分まるごと描き直すと、開いている画面がその都度ちらつく）。
       画面が描き直されて消えたら、そこで見張るのをやめる */
    var wasId = b ? b.id : '';
    var tick = setInterval(function () {
      if (!box.isConnected) { clearInterval(tick); return; }
      var now = nowMin(date);
      if (now === null) { clearInterval(tick); return; }
      var nb = T.ofDay(date).filter(function (x) { return now >= x.start && now < x.end; })[0];
      if ((nb ? nb.id : '') !== wasId) { clearInterval(tick); DL.app.render(); return; }
      var t = box.querySelector('.tp-nowtime');
      if (t) t.textContent = T.fmt(now);
    }, 20000);

    return box;
  }

  function projTitle(id) {
    var p = S.getProject(id);
    return p ? p.title : '（消された案件）';
  }

  /* 案件ごとの合計。結びつけた帯があるときだけ出す */
  function projRows(date) {
    var list = T.projectsOfDay(date);
    if (!list.length) return null;
    return el('div', { class: 'tp-projs' }, [
      el('span', { class: 'muted small', text: '案件ごと' })
    ].concat(list.map(function (x) {
      return el(x.project ? 'a' : 'span', {
        class: 'tp-proj', href: x.project ? '#/project/' + x.projectId : null
      }, [
        el('i', { style: { background: x.color } }),
        el('span', { class: 'tp-proj-t', text: x.title }),
        el('b', { text: hm(x.min) })
      ]);
    })));
  }

  function rows(date) {
    var box = el('div', { class: 'tp-rows' }, T.ofDay(date).map(function (b) {
      var row = el('button', {
        class: 'tp-row' + (b.carry ? ' carry' : ''),
        onclick: function () { blockSheet(b.carry ? b.date : date, b); }
      }, [
        el('i', { class: 'tp-dot', style: { background: b.color } }),
        el('span', { class: 'tp-row-t', text: T.fmt(b.start) + '〜' + T.fmt(b.end) }),
        el('span', { class: 'tp-row-k' }, [
          el('span', { text: b.label + (b.memo ? '　' + b.memo : '') }),
          // どの案件に使ったかは、名前の下に小さく添える
          b.projectId ? el('span', { class: 'tp-row-p', text: projTitle(b.projectId) }) : null
        ]),
        el('span', { class: 'tp-row-d', text: hm(b.end - b.start) + (b.carry ? '（前の日から）' : b.over ? '（翌日へ）' : '') })
      ]);
      row._span = b;
      return row;
    }));
    markNow(box, date);
    return box;
  }

  /* いまの時刻が入っている行に印をつける。
     時計は進むので、しばらく開きっぱなしでも付け替わるように見張る。
     画面が描き直されて消えたら、そこで見張るのをやめる */
  function markNow(box, date) {
    var paint = function () {
      var now = nowMin(date);
      U.$$('.tp-row', box).forEach(function (row) {
        var b = row._span;
        var on = now !== null && b && now >= b.start && now < b.end;
        row.classList.toggle('now', on);
        if (on) row.setAttribute('aria-current', 'time');
        else row.removeAttribute('aria-current');
      });
    };
    paint();
    if (nowMin(date) === null) return;      // 今日でなければ、見張るまでもない
    var iv = setInterval(function () {
      if (!box.isConnected) { clearInterval(iv); return; }
      paint();
    }, 20000);
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
      start: cur ? cur.start : nextFree(date),
      end: cur ? cur.end : Math.min(DAY, nextFree(date) + 60),
      memo: cur ? (cur.memo || '') : '',
      projectId: cur ? (cur.projectId || '') : ''
    };

    /* どの案件に使った時間か。
       結びつけておくと、案件の画面で「実際にどれだけかかったか」が出る。
       睡眠や家事のように案件と関係ない時間は、空のままでよい。
       消した案件が入っていても選び口から消えないよう、その1つは残す */
    var projOpts = [{ value: '', label: '（案件と結びつけない）' }].concat(
      S.projects().filter(function (p) {
        return p.status !== 'archived' || p.id === v.projectId;
      }).map(function (p) { return { value: p.id, label: p.title }; })
    );
    if (v.projectId && !projOpts.some(function (o) { return o.value === v.projectId; })) {
      projOpts.push({ value: v.projectId, label: '（消された案件）' });
    }
    var projSel = ui.select(projOpts, v.projectId);

    var startIn = ui.input({ value: T.fmt(v.start), inputmode: 'numeric', placeholder: '8:00' });
    var endIn = ui.input({ value: T.fmt(v.end), inputmode: 'numeric', placeholder: '16:30' });
    var memoIn = ui.input({ value: v.memo, maxlength: 40, placeholder: 'ひとこと（なくてよい）' });

    /* 何をしていたかは、その都度自由に書ける。
       よく使う名前はボタンで並べておいて、押せば入るようにする */
    var nameIn = ui.input({
      value: cur ? cur.label : guessLabel(date), maxlength: 20,
      placeholder: '例）打ち合わせ / 買いもの / 散歩'
    });
    var swatch = el('i', { class: 'tp-swatch' });
    var pickWrap = el('div', { class: 'tp-kinds' });

    /* 色は名前ではなく始まりの時刻で決まるので、印もその色にしておく */
    function markPick() {
      var now = nameIn.value.trim();
      var at = T.parse(startIn.value);
      swatch.style.background = T.colorAt(at === null ? v.start : at);
      U.$$('.tp-kind', pickWrap).forEach(function (x) {
        x.classList.toggle('on', x.dataset.label === now);
      });
    }
    T.labels().slice(0, 12).forEach(function (k) {
      var btn = el('button', {
        type: 'button', class: 'tp-kind', 'data-label': k.label,
        onclick: function () { nameIn.value = k.label; markPick(); }
      }, [el('span', { text: k.label })]);
      pickWrap.appendChild(btn);
    });
    nameIn.addEventListener('input', markPick);
    startIn.addEventListener('input', markPick);
    markPick();

    var nameWrap = el('div', { class: 'tp-name' }, [
      el('div', { class: 'tp-name-in' }, [swatch, nameIn]),
      pickWrap
    ]);

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
        ui.block('何をしていたか', nameWrap),
        el('div', { class: 'grid2' }, [
          ui.field('始まり', startIn),
          ui.field('終わり', endIn)
        ]),
        note,
        ui.field('案件', projSel),
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
          var name = nameIn.value.trim();
          if (!name) { ui.toast('何をしていたかを書いてください', 'danger'); nameIn.focus(); return; }
          if (s === null || e === null) { ui.toast('時刻を読み取れませんでした', 'danger'); return; }
          if (e <= s) { ui.toast('終わりは始まりより後にしてください', 'danger'); return; }
          S.putTimeblock(src ? b.date : date, {
            id: v.id, label: name, start: s, end: e,
            memo: memoIn.value, projectId: projSel.value
          });
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

  /* 足すときの名前の当たり。朝晩は睡眠、日中は仕事にしておく */
  function guessLabel(date) {
    var at = nextFree(date);
    if (at < 360 || at >= 1380) return '睡眠';
    if (at >= 540 && at < 1080) return '仕事';
    return '自由時間';
  }

  /* ---------------- そのほか ---------------- */

  function slabel(b) {
    return b.label + ' ' + T.fmt(b.start) + '〜' + T.fmt(b.end) + (b.memo ? '　' + b.memo : '');
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
