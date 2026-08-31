/* 売上：案件をまたいで請求書・領収書を集計する */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, D = DL.docs, el = U.el;

  var year = 0;          // 表示中の年（0 なら今年）
  var band = 'both';     // グラフに出す系列 both / doc / fan

  function currentYear() { return year || U.num(U.today().slice(0, 4), 2026); }

  function render(root) {
    var y = currentYear();
    var wrap = el('div', { class: 'page' });

    /* ---- 年の切り替え ---- */
    wrap.appendChild(el('div', { class: 'year-nav' }, [
      el('button', { class: 'iconbtn', 'aria-label': '前の年', onclick: function () { year = y - 1; DL.app.render(); } }, ui.icon('chevronLeft', 20)),
      el('button', {
        class: 'year-label', text: y + '年',
        onclick: function () { year = U.num(U.today().slice(0, 4), y); DL.app.render(); }
      }),
      el('button', { class: 'iconbtn', 'aria-label': '次の年', onclick: function () { year = y + 1; DL.app.render(); } }, ui.icon('chevronRight', 20))
    ]));

    /* ---- 名義の絞り込み（アプリ全体の切り替えと同じもの） ---- */
    var issuers = S.issuers();
    var active = S.scopeId();
    if (issuers.length > 1) {
      var opts = [{ value: '', label: 'すべて' }].concat(issuers.map(function (x) {
        return { value: x.id, label: x.name || '(名称未設定)' };
      }));
      wrap.appendChild(el('div', { class: 'card' },
        ui.field('名義', ui.segmented(opts, active, function (v) { S.setScope(v); }),
          'ホーム・カレンダー・案件一覧の表示も、選んだ名義に合わせて切り替わります')
      ));
    }

    /* ---- 対象の書類 ---- */
    var inYear = S.allDocs().filter(function (e) {
      if (String(e.doc.issueDate).slice(0, 4) !== String(y)) return false;
      if (active && (e.doc.issuerId || '') !== active) return false;
      return true;
    });
    // 見積書はまだ売上ではないので、集計とは別に並べる
    var estimates = inYear.filter(function (e) { return e.doc.type === 'estimate'; });
    var all = inYear.filter(function (e) { return e.doc.type !== 'estimate'; });

    var totals = D.sales(all);
    // 支援金も売上に数える。名義を絞っているときは、その名義のぶんだけ
    var fb = S.fanboxInScope() ? S.fanbox(y) : [];
    var fbTotal = sumFanbox(fb);
    var grand = totals.total + fbTotal;

    /* ---- 年間の集計 ---- */
    wrap.appendChild(ui.section(y + '年の合計',
      el('span', { class: 'muted small', text: totals.count + '件' + (fb.length ? '＋支援金' + fb.length + 'ヶ月' : '') })));
    // 消費税・源泉・入金は請求書だけの話なので、支援金とは混ぜずに並べる
    var boxes = [sumBox('売上合計（税込）', D.yen(grand), 'big')];
    if (fbTotal) {
      boxes.push(sumBox('うち請求書', D.yen(totals.total)));
      boxes.push(sumBox('うち支援金', D.yen(fbTotal), 'fan'));
    }
    boxes.push(sumBox(fbTotal ? '請求書の消費税' : 'うち消費税', D.yen(totals.tax)));
    boxes.push(sumBox(fbTotal ? '請求書の税抜' : '税抜（小計）', D.yen(totals.subtotal)));
    boxes.push(sumBox('源泉徴収', totals.withholding ? '-' + D.yen(totals.withholding) : '—'));
    boxes.push(sumBox('入金済み', D.yen(totals.paid), 'ok'));
    boxes.push(sumBox('未入金', D.yen(totals.unpaid), totals.unpaid ? 'warn' : ''));
    wrap.appendChild(el('div', { class: 'card sum-grid' }, boxes));

    if (totals.draftCount) {
      wrap.appendChild(el('div', { class: 'alert info' }, [
        el('span', { class: 'alert-icon' }, ui.icon('info', 17)),
        el('span', { text: '下書きの書類が ' + totals.draftCount + '件（' + D.yen(totals.draft) + '）あります。発行済みにすると売上に入ります。' })
      ]));
    }

    /* ---- 月別の推移 ---- */
    wrap.appendChild(ui.section('月別の推移'));
    wrap.appendChild(lineChart(all, fb, y));

    /* ---- 月別 ---- */
    wrap.appendChild(ui.section('月別の内訳'));
    wrap.appendChild(monthTable(all, fb, y));

    /* ---- 支援サイト ---- */
    wrap.appendChild(fanboxSection(fb, y));

    /* ---- 見積書 ---- */
    if (estimates.length) wrap.appendChild(estimateSection(estimates));

    /* ---- 書類の一覧 ---- */
    wrap.appendChild(ui.section('書類', el('span', { class: 'muted small', text: all.length + '件' })));
    if (!all.length) {
      wrap.appendChild(ui.empty(y + '年の書類はまだありません。'));
    } else {
      var list = el('div', { class: 'list' });
      all.forEach(function (e) { list.appendChild(docRow(e)); });
      wrap.appendChild(list);
    }

    wrap.appendChild(el('p', { class: 'muted small pad', text:
      '請求書を発行済みにした時点で売上として数えます（下書きは数えません）。請求書が無い案件は領収書を数えます（二重計上を避けるため）。'
      + '支援金は取り込んだ月の売上として、手数料を引く前の金額を税込で数えます。' }));

    root.appendChild(wrap);
  }

  /* ---------------- 月別の推移（折れ線） ---------------- */

  var YEN = function (n) { return D.yen(n); };

  /** その年の12ヶ月ぶんの値を作る */
  function monthly(entries, fb) {
    var out = [];
    for (var m = 1; m <= 12; m++) {
      var mm = (m < 10 ? '0' : '') + m;
      var inMonth = entries.filter(function (e) { return e.doc.issueDate.slice(5, 7) === mm; });
      var f = fb.filter(function (r) { return r.ym.slice(5, 7) === mm; })[0];
      out.push({ m: m, doc: D.sales(inMonth).total, fan: f ? f.amount : null });
    }
    return out;
  }

  /**
   * 請求書の売上と支援金を、同じ軸（円）で重ねた折れ線。
   * 支援金がまだ1件も無い年は1本だけ描き、凡例も出さない。
   */
  function lineChart(entries, fb, y) {
    var data = monthly(entries, fb);
    var hasFan = data.some(function (d) { return d.fan !== null; });
    // 支援金が無い年は、絞り込みの意味がないので常に両方扱いにする
    var showDoc = !hasFan || band !== 'fan';
    var showFan = hasFan && band !== 'doc';

    var max = Math.max.apply(null, data.map(function (d) {
      return Math.max(showDoc ? d.doc : 0, showFan ? (d.fan || 0) : 0);
    }).concat([1]));
    // 目盛りはきりのいい数にまるめる
    var step = niceStep(max / 3);
    var top = Math.max(step * 3, step);

    var W = 320, H = 132, L = 40, R = 8, T = 10, B = 20;
    var iw = W - L - R, ih = H - T - B;
    var x = function (i) { return L + (data.length === 1 ? iw / 2 : i * iw / (data.length - 1)); };
    var yv = function (v) { return T + ih - (v / top) * ih; };

    var svg = svgEl('svg', {
      class: 'lchart', viewBox: '0 0 ' + W + ' ' + H,
      role: 'img', 'aria-label': y + '年の月別の推移'
    });

    /* 目盛り（控えめに） */
    for (var g = 0; g <= 3; g++) {
      var gv = top / 3 * g;
      svg.appendChild(svgEl('line', {
        class: 'lc-grid', x1: L, x2: W - R, y1: yv(gv), y2: yv(gv)
      }));
      svg.appendChild(svgEl('text', {
        class: 'lc-ytick', x: L - 5, y: yv(gv) + 3, 'text-anchor': 'end'
      }, shortYen(gv)));
    }
    /* 月の目盛りは3ヶ月ごと */
    data.forEach(function (d, i) {
      if (d.m % 3 !== 1) return;
      svg.appendChild(svgEl('text', {
        class: 'lc-xtick', x: x(i), y: H - 6, 'text-anchor': 'middle'
      }, d.m + '月'));
    });

    if (showDoc) series(svg, data, 'doc', x, yv, 'is-doc');
    if (showFan) series(svg, data, 'fan', x, yv, 'is-fan');

    var head = [];
    // 桁が違うと片方が潰れて読めないので、1本ずつにも切り替えられるようにする。
    // 軸は増やさず、選んだ系列だけで目盛りを取り直す
    if (hasFan) {
      head.push(ui.segmented([
        { value: 'both', label: '両方' },
        { value: 'doc', label: '請求書' },
        { value: 'fan', label: '支援金' }
      ], band, function (v) { band = v; DL.app.render(); }));
    }
    var keys = [];
    if (showDoc) keys.push(legend('is-doc', '請求書の売上'));
    if (showFan) keys.push(legend('is-fan', '支援金（FANBOX）'));

    var box = el('div', { class: 'card lchart-box' }, [
      head.length ? el('div', { class: 'lchart-filter' }, head) : null,
      keys.length > 1 ? el('div', { class: 'lchart-legend' }, keys) : null,
      svg,
      el('div', { class: 'lchart-read', text: '月をなぞると内訳が出ます' })
    ]);
    attachHover(box, svg, data, x, showDoc, showFan, W, L, R);
    return box;
  }

  /* 1本ぶんの線と点。値が無い月は線を切る（0として結ばない） */
  function series(svg, data, key, x, yv, cls) {
    var run = [];
    var flush = function () {
      if (run.length > 1) {
        svg.appendChild(svgEl('polyline', {
          class: 'lc-line ' + cls,
          points: run.map(function (p) { return p.x + ',' + p.y; }).join(' ')
        }));
      }
      run.forEach(function (p) {
        svg.appendChild(svgEl('circle', { class: 'lc-dot ' + cls, cx: p.x, cy: p.y, r: 3.2 }));
      });
      run = [];
    };
    data.forEach(function (d, i) {
      var v = d[key];
      if (v === null || v === undefined) { flush(); return; }
      run.push({ x: x(i), y: yv(v) });
    });
    flush();
  }

  function legend(cls, label) {
    return el('span', { class: 'lc-key' }, [
      el('i', { class: cls }), el('span', { text: label })
    ]);
  }

  /* なぞった月の値を読めるようにする（指でもマウスでも） */
  function attachHover(box, svg, data, x, showDoc, showFan, W, L, R) {
    var line = svgEl('line', { class: 'lc-cursor', y1: 0, y2: 132, x1: -99, x2: -99 });
    svg.appendChild(line);
    var tip = el('div', { class: 'lc-tip', hidden: true });
    box.appendChild(tip);

    function at(clientX) {
      var r = svg.getBoundingClientRect();
      var px = (clientX - r.left) / r.width * W;          // viewBox の座標へ
      var i = Math.round((px - L) / ((W - L - R) / (data.length - 1)));
      return Math.min(Math.max(i, 0), data.length - 1);
    }
    function show(clientX) {
      var i = at(clientX);
      var d = data[i];
      line.setAttribute('x1', x(i)); line.setAttribute('x2', x(i));
      U.clear(tip);
      tip.appendChild(el('b', { text: d.m + '月' }));
      if (showDoc) tip.appendChild(el('span', { class: 'lc-tv is-doc', text: '請求書 ' + YEN(d.doc) }));
      if (showFan) {
        tip.appendChild(el('span', { class: 'lc-tv is-fan',
          text: '支援金 ' + (d.fan === null ? '—' : YEN(d.fan)) }));
      }
      tip.hidden = false;
      // グラフの枠の中に出す（切り替えや凡例に被らないように）。
      // SVG には offsetTop が無いので、枠との位置の差から出す
      var r = svg.getBoundingClientRect();
      var br = box.getBoundingClientRect();
      tip.style.left = Math.round(x(i) / W * r.width) + 'px';
      tip.style.top = Math.round(r.top - br.top + 4) + 'px';
    }
    function hide() { tip.hidden = true; line.setAttribute('x1', -99); line.setAttribute('x2', -99); }

    var timer = 0;
    svg.addEventListener('pointerdown', function (e) { clearTimeout(timer); show(e.clientX); });
    svg.addEventListener('pointermove', function (e) {
      if (e.buttons || e.pointerType === 'mouse') { clearTimeout(timer); show(e.clientX); }
    });
    // 指のときは離した直後に pointerleave も飛ぶので、それでは消さない。
    // 代わりに少し置いてから引っ込める（読む時間を残すため）
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse') return;         // マウスは離れたときに消す
      clearTimeout(timer);
      timer = setTimeout(hide, 2500);
    });
  }

  function svgEl(name, attrs, text) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* 目盛りを 1/2/5×10ⁿ にまるめる */
  function niceStep(v) {
    if (v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  }

  /* 軸は「12万」のように短く出す */
  function shortYen(n) {
    if (!n) return '0';
    if (n >= 100000000) return Math.round(n / 10000000) / 10 + '億';
    if (n >= 10000) return Math.round(n / 1000) / 10 + '万';
    if (n >= 1000) return Math.round(n / 100) / 10 + '千';
    return String(Math.round(n));
  }

  /* ---------------- 支援サイト（FANBOX） ---------------- */

  function fanboxSection(rows, y) {
    var box = el('div', { class: 'card' });
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);

    if (!rows.length) {
      box.appendChild(el('p', { class: 'muted small',
        text: 'pixivFANBOX の「支援金管理／振込」の画面を開いて、月ごとの表をコピーし、下のボタンから貼り付けてください。年月と支援金を読み取ってグラフに重ねます。' }));
    } else {
      var list = el('div', { class: 'fb-list' });
      rows.slice().reverse().forEach(function (r) {
        list.appendChild(el('div', { class: 'fb-row' }, [
          el('span', { class: 'fb-ym', text: U.num(r.ym.slice(5), 0) + '月' }),
          el('b', { class: 'fb-v', text: D.yen(r.amount) }),
          el('button', {
            class: 'iconbtn small', 'aria-label': r.ym + ' を削除',
            onclick: function () { S.removeFanbox(r.ym); ui.toast('削除しました'); }
          }, ui.icon('trash', 16))
        ]));
      });
      box.appendChild(el('div', { class: 'info-row' }, [
        el('span', { class: 'info-k', text: y + '年の支援金' }),
        el('span', { class: 'info-v', text: D.yen(total) + '（' + rows.length + 'ヶ月）' })
      ]));
      box.appendChild(list);
    }

    // 名義が2つ以上あるなら、支援金をどちらの売上として数えるか決めてもらう
    if (S.issuers().length > 1) {
      var opts = [{ value: '', label: 'どちらでも数える' }].concat(S.issuers().map(function (x) {
        return { value: x.id, label: x.name || '(名称未設定)' };
      }));
      var sel = ui.select(opts, S.settings.fanboxIssuerId || '');
      sel.addEventListener('change', function () {
        S.updateSettings({ fanboxIssuerId: sel.value });
      });
      box.appendChild(ui.field('どの名義の売上にするか', sel,
        '名義を絞って見ているとき、ここで選んだ名義のときだけ売上に数えます'));
    }

    box.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('表を貼り付けて取り込む', 'primary', function () { pasteSheet(); }, 'arrowDown'),
      ui.btn('1ヶ月ぶん手で入れる', 'ghost', function () { manualSheet(y); }, 'plus')
    ]));

    var wrap = el('div', {}, [
      ui.section('支援金（pixivFANBOX）',
        el('a', { class: 'link', href: 'https://datemeteo.fanbox.cc/', target: '_blank', rel: 'noopener', text: 'FANBOXを開く' })),
      box
    ]);
    return wrap;
  }

  /* 貼り付けた表を読み取る。列が複数あるときは、どれが支援金かを選ばせる */
  function pasteSheet() {
    var ta = ui.textarea({ placeholder: '例）\n2026年1月　¥12,000\n2025年12月　¥9,500' });
    ta.rows = 6;
    var preview = el('div', { class: 'fb-preview' });
    var colWrap = el('div');
    var col = 0, parsed = { rows: [], columns: 0, samples: [] };

    var overwrite = false;
    var overChk = el('input', { type: 'checkbox', class: 'check' });
    overChk.addEventListener('change', function () { overwrite = overChk.checked; update(); });
    var overWrap = el('label', { class: 'row-check' }, [
      overChk, el('span', { text: 'すでに入っている月も入れ直す' })
    ]);

    function update() {
      parsed = DL.fanbox.parse(ta.value, col);
      U.clear(colWrap);
      // 「支援金」の見出しで拾えなかった表だけ、どの列を使うか選ばせる
      if (!parsed.labeled && parsed.columns > 1) {
        var opts = [];
        for (var i = 0; i < parsed.columns; i++) {
          var sample = (parsed.samples[0] || { amounts: [] }).amounts[i];
          opts.push({ value: String(i), label: (i + 1) + '列目' + (sample === undefined ? '' : '（' + D.yen(sample) + '）') });
        }
        colWrap.appendChild(ui.field('どの金額を支援金として使うか',
          ui.segmented(opts, String(col), function (v) { col = U.num(v, 0); update(); }),
          '貼り付けた表に金額の列が ' + parsed.columns + 'つあります'));
      }

      // すでに入っている月と、これから増える月を分けて見せる
      var dup = parsed.rows.filter(function (r) { return S.fanboxOf(r.ym); });
      var fresh = parsed.rows.filter(function (r) { return !S.fanboxOf(r.ym); });
      overWrap.hidden = !dup.length;

      U.clear(preview);
      if (!ta.value.trim()) {
        preview.appendChild(el('span', { class: 'muted small', text: 'ここに読み取り結果が出ます。' }));
      } else if (!parsed.rows.length) {
        preview.appendChild(el('span', { class: 'muted small', text: '年月と金額を見つけられませんでした。画面をそのまま選んでコピーし、貼り付けてみてください。' }));
      } else {
        var note = parsed.rows.length + 'ヶ月ぶんを読み取りました'
          + (parsed.labeled ? '（「支援金」の欄を使います）' : '')
          + (dup.length ? ' ／ うち ' + dup.length + 'ヶ月はすでに入っています'
              + (overwrite ? '（入れ直します）' : '（そのままにします）') : '');
        preview.appendChild(el('div', { class: 'muted small', text: note }));
        parsed.rows.slice(0, 14).forEach(function (r) {
          var old = S.fanboxOf(r.ym);
          var skip = old && !overwrite;
          preview.appendChild(el('div', { class: 'fb-prow' + (skip ? ' dim' : '') }, [
            el('span', { text: U.num(r.ym.slice(0, 4), 0) + '年' + U.num(r.ym.slice(5), 0) + '月' }),
            el('b', { text: D.yen(r.amount) }),
            old ? el('span', { class: 'fb-tag', text: skip ? '登録済み' : '入れ直す' }) : null
          ]));
        });
        if (parsed.rows.length > 14) {
          preview.appendChild(el('div', { class: 'muted small', text: 'ほか ' + (parsed.rows.length - 14) + 'ヶ月' }));
        }
        if (!fresh.length && !overwrite) {
          preview.appendChild(el('div', { class: 'muted small', text: '新しく増える月はありません。' }));
        }
      }
    }
    ta.addEventListener('input', update);

    var close = ui.sheet({
      title: '支援金を取り込む',
      body: el('div', { class: 'form' }, [
        el('p', { class: 'muted small', text: 'FANBOX の「支援金管理／振込」の画面を上から下までそのまま選んでコピーし、貼り付けてください。年月と「支援金」の欄だけを拾います。すでに入っている月は自動で除きます。' }),
        ui.field('貼り付け', ta),
        colWrap,
        overWrap,
        preview
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('取り込む', 'primary', function () {
          if (!parsed.rows.length) { ui.toast('読み取れる行がありません', 'warn'); return; }
          var r = S.putFanbox(parsed.rows, { overwrite: overwrite });
          close();
          var parts = [];
          if (r.added) parts.push('新規 ' + r.added + 'ヶ月');
          if (r.updated) parts.push('入れ直し ' + r.updated + 'ヶ月');
          if (r.skipped) parts.push('重複 ' + r.skipped + 'ヶ月は除外');
          ui.toast(parts.length ? '取り込みました（' + parts.join(' / ') + '）' : '増えた月はありませんでした');
        })
      ]
    });
    update();
    setTimeout(function () { ta.focus(); }, 100);
  }

  /* 1ヶ月ぶんだけ手で足す・直す */
  function manualSheet(y) {
    var ym = ui.input({ type: 'month', value: U.today().slice(0, 7) });
    var amount = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: '' });
    var close = ui.sheet({
      title: '支援金を入れる',
      body: el('div', { class: 'form' }, [
        ui.field('年月', ym),
        ui.field('支援金（円）', amount, '同じ年月がすでにあれば置き換えます')
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          if (!/^\d{4}-\d{2}$/.test(ym.value)) { ui.toast('年月を選んでください', 'warn'); return; }
          S.putFanbox([{ ym: ym.value, amount: U.num(amount.value, 0) }], { overwrite: true });
          close(); ui.toast('保存しました');
        })
      ]
    });
  }

  function sumBox(label, value, cls) {
    return el('div', { class: 'sum-box ' + (cls || '') }, [
      el('span', { text: label }), el('b', { text: value })
    ]);
  }

  /* 月ごとの棒と金額。棒は請求書ぶんと支援金ぶんを積んで見せる */
  function monthTable(entries, fb, y) {
    var months = [];
    for (var m = 1; m <= 12; m++) {
      var mm = (m < 10 ? '0' : '') + m;
      var inMonth = entries.filter(function (e) { return e.doc.issueDate.slice(5, 7) === mm; });
      var f = fb.filter(function (r) { return r.ym.slice(5, 7) === mm; })[0];
      var sum = D.sales(inMonth);
      months.push({ m: m, sum: sum, fan: f ? f.amount : 0, total: sum.total + (f ? f.amount : 0) });
    }
    var max = Math.max.apply(null, months.map(function (x) { return x.total; }).concat([1]));
    var hasFan = months.some(function (x) { return x.fan; });

    var box = el('div', { class: 'card month-sales' });
    var thisMonth = U.today().slice(0, 7);
    months.forEach(function (x) {
      var mm = (x.m < 10 ? '0' : '') + x.m;
      var key = y + '-' + mm;
      box.appendChild(el('div', { class: 'ms-row' + (key === thisMonth ? ' now' : '') + (x.total ? '' : ' zero') }, [
        el('span', { class: 'ms-m', text: x.m + '月' }),
        el('span', { class: 'ms-bar' }, [
          el('i', { style: { width: Math.round(x.sum.total / max * 100) + '%' } }),
          x.fan ? el('i', { class: 'fan', style: { width: Math.round(x.fan / max * 100) + '%' } }) : null
        ]),
        el('span', { class: 'ms-v', text: x.total ? D.yen(x.total) : '—' }),
        el('span', { class: 'ms-u', text: x.sum.unpaid ? '未' + D.yen(x.sum.unpaid) : '' })
      ]));
    });
    if (hasFan) {
      box.appendChild(el('div', { class: 'ms-note' }, [
        el('span', { class: 'lc-key' }, [el('i', { class: 'is-doc' }), el('span', { text: '請求書' })]),
        el('span', { class: 'lc-key' }, [el('i', { class: 'is-fan' }), el('span', { text: '支援金' })])
      ]));
    }
    return box;
  }

  function sumFanbox(rows) {
    return rows.reduce(function (s, r) { return s + r.amount; }, 0);
  }

  function docRow(e) {
    var p = e.project, d = e.doc;
    var c = D.calc(d);
    var issuer = S.issuers().filter(function (x) { return x.id === d.issuerId; })[0];
    var color = S.issuerColor(d.issuerId);
    return el('a', { class: 'row doc', href: '#/doc/' + p.id + '/' + d.id }, [
      color ? el('div', { class: 'row-bar', style: { background: color } }) : null,
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon(D.TYPE_ICON[d.type], 16),
          el('span', { text: d.clientName || p.title }),
          d.number ? el('span', { class: 'muted small', text: d.number }) : null
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(U.fmtYMD(d.issueDate), 'soft'),
          ui.chip(D.yen(c.payable), 'ghosty'),
          ui.chip(D.statusLabel(d), D.statusTone(d)),
          issuer ? ui.chip(issuer.name || '名義', 'ghosty') : null
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /**
   * 見積書のまとめ。
   * 出したまま返事が無いものを見つけられるように、提出済みだけ合計を出す。
   */
  function estimateSection(list) {
    var box = el('div', {});
    var open = list.filter(function (e) { return e.doc.status === 'issued'; });
    var won = list.filter(function (e) { return e.doc.status === 'accepted'; });
    var openSum = open.reduce(function (n, e) { return n + D.calc(e.doc).payable; }, 0);
    var wonSum = won.reduce(function (n, e) { return n + D.calc(e.doc).payable; }, 0);

    box.appendChild(ui.section('見積書', el('span', { class: 'muted small', text: list.length + '件' })));
    box.appendChild(el('div', { class: 'card sum-grid' }, [
      sumBox('提出中', D.yen(openSum), open.length ? 'warn' : ''),
      sumBox('受注', D.yen(wonSum), 'ok')
    ]));
    var rows = el('div', { class: 'list' });
    list.forEach(function (e) { rows.appendChild(docRow(e)); });
    box.appendChild(rows);
    box.appendChild(el('p', { class: 'muted small pad', text:
      '見積書は売上に数えません。受注したら「この見積書から請求書」で請求書を起こせます。' }));
    return box;
  }

  /* ホームに出す当月・当年のミニ集計 */
  function homeCard() {
    var t = U.today();
    var scope = S.scopeId();
    function pick(prefix) {
      return S.allDocs().filter(function (e) {
        if (String(e.doc.issueDate).indexOf(prefix) !== 0) return false;
        return !scope || (e.doc.issuerId || '') === scope;
      });
    }
    // 名義も支援金も無いうちは、この機能自体を使っていないので出さない
    var fbAll = S.fanboxInScope() ? S.fanbox() : [];
    if (!S.issuers().length && !fbAll.length) return null;

    function fanIn(prefix) {
      return sumFanbox(fbAll.filter(function (r) { return r.ym.indexOf(prefix) === 0; }));
    }
    var month = D.sales(pick(t.slice(0, 7))).total + fanIn(t.slice(0, 7));
    var yearSum = D.sales(pick(t.slice(0, 4)));
    var yearTotal = yearSum.total + fanIn(t.slice(0, 4));

    return el('a', { class: 'card sales-card', href: '#/sales' }, [
      el('div', { class: 'row-title' }, [
        ui.icon('chartLine', 16), el('span', { text: '売上' }),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]),
      el('div', { class: 'quota-row three' }, [
        el('div', { class: 'quota-box' }, [el('span', { text: '今月' }), el('b', { text: D.yen(month) })]),
        el('div', { class: 'quota-box' }, [el('span', { text: '今年' }), el('b', { text: D.yen(yearTotal) })]),
        el('div', { class: 'quota-box' + (yearSum.unpaid ? ' over' : '') }, [
          el('span', { text: '未入金' }), el('b', { text: D.yen(yearSum.unpaid) })
        ])
      ])
    ]);
  }

  DL.views = DL.views || {};
  DL.views.sales = { render: render, homeCard: homeCard };
})(window.DL);
