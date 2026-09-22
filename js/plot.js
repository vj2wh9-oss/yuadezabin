/* プロット相談。

   成人向け（ゲイ男性向け）の、男性同士のマンガの設計図を考えてもらう。
   成人向けの場面にも中身を持たせる（どんな状況で、どちらが仕掛け、
   二人のあいだで何が変わり、身体のやりとりがどこへ向かうか）。
   絵に起こすのは作者なので、行為そのものをなぞる文章までは作らせない。

   ジャンルも入れたいシーンも、いくつでも足せる。足したものは
   一つ残らず入るように、サーバー側の頼みかたで念を押してある。

   登場人物は全員おとな。未成年を思わせる言葉が混ざったものは、
   サーバー側で作り直すか、出さずに断る。

   できたものは、指定の Discord チャンネルへそのまま送れる。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  var LENGTHS = [{ value: 'short', label: '短編' }, { value: 'long', label: '長編' }];
  var DEFAULT_PAGES = { short: 24, long: 120 };
  var ADULT_MARK = '成人向けシーン';

  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }
  function ready() { return !!(base() && conf().token); }

  function reason(status, body) {
    var k = body && body.error;
    if (status === 401) return '合鍵が違います';
    if (k === 'no_api_key') return 'Worker に OPENAI_API_KEY がありません';
    if (k === 'no_plot_webhook') return 'Worker に DISCORD_PLOT_WEBHOOK がありません';
    if (k === 'plot_unsafe') {
      return '未成年を思わせる言葉（' + (body.word || '') + '）が混ざったので出しませんでした。もう一度お試しください';
    }
    if (k === 'discord_error') return 'Discord が断りました（' + (body.status || '') + '）';
    if (k === 'openai_error') return 'OpenAI が断りました：' + (body.message || '');
    if (k === 'openai_unreachable') return 'OpenAI につながりませんでした';
    if (k === 'openai_empty') return 'OpenAI が中身を返しませんでした';
    if (k === 'not_json') return '返事が JSON になっていません';
    if (status === 404) return 'Worker を最新にして deploy し直してください';
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  function post(path, body) {
    if (!ready()) return Promise.reject(new Error('同期の接続先が未設定です'));
    return fetch(base() + path, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(reason(res.status, b));
        return b;
      });
    }, function () {
      throw new Error('通信できませんでした');
    });
  }

  /** 作ってもらう */
  function make(o) {
    return post('/v1/plot', {
      length: o.length, pages: o.pages, people: o.people,
      // いくつでも足せる。向こうは並びでも1本の文字列でも受ける
      genre: (o.genre || []).slice(0, 8),
      want: (o.want || []).slice(0, 12)
    }).then(function (b) { return put(b.data); });
  }

  /** Discord のチャンネルへ送る */
  function send(p) { return post('/v1/plot/send', { plot: p }); }

  /* ---------------- 画面（ホーム） ---------------- */

  /* ジャンルも入れたいシーンも、いくつでも足せる並びで持つ */
  var form = { length: 'short', pages: 24, genre: [], want: [], people: 2 };
  var busy = false;

  /* いま扱っているプロットの持ち主。
     空ならどの案件にも紐づいていないぶん（ホームの1行から開いたとき）。
     案件の画面から開いたときは、その案件の id が入る */
  var pid = '';

  /** いま扱っているプロット */
  function cur() {
    if (!pid) return S.getPlot();
    var p = S.getProject(pid);
    return p ? p.plot : null;
  }

  /** いま扱っているプロットを入れ替える。null で消す */
  function put(v) {
    if (!pid) return S.setPlot(v);
    S.updateProject(pid, { plot: v });
    return cur();
  }

  /** 持ち主の案件。紐づいていなければ null */
  function owner() { return pid ? S.getProject(pid) : null; }

  /* 入れた文字を札に割る。読点・カンマ・改行・スラッシュのどれで区切ってもいい */
  function splitTags(s) {
    return String(s || '').split(/[\n、,，／\/]+/)
      .map(function (x) { return x.trim().slice(0, 120); })
      .filter(Boolean);
  }

  /**
   * いくつでも足せる札の入力。足したものは押すと外れる。
   * @param {string} label 見出し
   * @param {Array} list いま入っている並び（この配列を直に触る）
   * @param {number} max いくつまで
   * @param {string} hint 入力欄の下書き
   */
  function tagField(label, list, max, hint) {
    var box = el('div', { class: 'pl-tags' });
    box.appendChild(el('div', { class: 'pl-tags-head' }, [
      el('span', { class: 'pl-tags-l', text: label }),
      list.length ? el('button', {
        type: 'button', class: 'pl-tags-clear',
        onclick: function () { list.length = 0; paint(); }
      }, el('span', { text: 'ぜんぶ外す' })) : null
    ]));

    if (list.length) {
      box.appendChild(el('div', { class: 'pl-tag-row' }, list.map(function (x, i) {
        return el('button', {
          type: 'button', class: 'pl-tag', 'aria-label': x + 'を外す',
          onclick: function () { list.splice(i, 1); paint(); }
        }, [el('span', { text: x }), ui.icon('close', 12)]);
      })));
    }

    var input = ui.input({ value: '', maxlength: 120, placeholder: hint,
      'aria-label': label + 'を足す' });
    var push = function () {
      if (!input.value.trim()) return;
      splitTags(input.value).forEach(function (x) {
        if (list.indexOf(x) < 0 && list.length < max) list.push(x);
      });
      input.value = '';
      paint();
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); push(); }
    });
    box.appendChild(el('div', { class: 'pl-tag-add' }, [input, ui.btn('足す', 'ghost', push, 'plus')]));
    if (list.length >= max) {
      box.appendChild(el('p', { class: 'muted small', text: '足せるのは' + max + 'つまでです。' }));
    }
    return box;
  }

  function card() {
    if (!ready()) return null;
    var box = el('div', { class: 'card pl-card' });
    var saved = cur();
    var own = owner();

    // どの案件のぶんを見ているのか、はじめに断っておく
    if (own) {
      box.appendChild(el('p', { class: 'muted small pl-own' }, [
        ui.icon('projects', 13),
        el('span', { text: own.title + ' のプロット' })
      ]));
    }

    if (saved) {
      box.appendChild(body(saved));
      box.appendChild(el('div', { class: 'row-wrap' }, [
        ui.btn(busy ? '送っています…' : 'Discordへ送る', 'primary', function () {
          if (busy) return;
          busy = true;
          paint();
          send(saved).then(function () {
            busy = false;
            ui.toast('送りました');
            paint();
          }).catch(function (e) {
            busy = false;
            paint();
            ui.toast(e.message, 'danger');
          });
        }, 'send'),
        ui.btn(busy ? '考えています…' : '作り直す', 'ghost', function () { run(); }, 'refresh'),
        el('button', {
          type: 'button', class: 'btn only ghost', 'aria-label': 'このプロットを消す',
          onclick: function () {
            ui.confirm('このプロットを消します。', { okText: '消す' }).then(function (ok) {
              if (!ok) return;
              put(null);
              ui.toast('消しました');
              paint();
            });
          }
        }, ui.icon('trash', 16))
      ]));
      /* どの案件のものでもないプロットは、あとから案件へ移せる。
         案件のぶんは、その案件の画面からいつでも開ける */
      if (!pid) {
        box.appendChild(ui.btn('案件に紐づける', 'ghost full',
          function () { linkSheet(saved); }, 'projects'));
      }
      return box;
    }

    box.appendChild(ui.block('長さ', ui.segmented(LENGTHS, form.length, function (v) {
      form.length = v;
      form.pages = DEFAULT_PAGES[v] || 24;
      paint();
    })));

    var pagesIn = ui.input({ type: 'number', inputmode: 'numeric', min: 4, max: 600,
      value: form.pages, onchange: function () { form.pages = U.num(pagesIn.value, form.pages); } });
    var peopleIn = ui.stepper({ value: form.people, max: 6,
      onChange: function (v) { form.people = Math.max(1, U.num(v, 2)); } });

    box.appendChild(ui.field('ページ数', pagesIn));
    box.appendChild(tagField('ジャンル', form.genre, 8, '例）年の差　再会　上司と部下'));
    box.appendChild(tagField('入れたいシーン', form.want, 12, '例）雨宿り　朝まで帰さない　風呂場'));
    box.appendChild(el('p', { class: 'muted small',
      text: '足したものは、ぜんぶ入るように頼みます。読点で区切れば一度にいくつも足せます。' }));
    box.appendChild(ui.block('主要人物', peopleIn));
    box.appendChild(ui.btn(busy ? '考えています…' : 'プロットを出す', 'primary full', function () {
      form.pages = U.num(pagesIn.value, form.pages);
      form.people = Math.max(1, peopleIn.getValue());
      run();
    }, 'idea'));
    return box;
  }

  function run() {
    if (busy) return;
    busy = true;
    paint();
    make(form).then(function () {
      busy = false;
      paint();
    }).catch(function (e) {
      busy = false;
      paint();
      ui.toast(e.message, 'danger');
    });
  }

  /* ---------------- ホームの1行と、開いたシート ---------------- */

  var host = null;      // シートの中身。開いているあいだだけ

  /* シートを開いていればその中を、いつでもホームの1行も描き直す */
  function paint() {
    if (host) {
      host.textContent = '';
      host.appendChild(card());
    }
    DL.app.render();
  }

  /** ホームに置く入口。プロットがあれば、その名前まで出す */
  function row() {
    if (!ready()) return null;
    var saved = S.getPlot();
    return el('button', { type: 'button', class: 'row', onclick: function () { open(); } }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon('idea', 16),
          el('span', { text: 'プロット相談' }),
          saved ? el('span', { class: 'muted small', text: '　' + (saved.title || '') }) : null
        ]),
        saved ? el('div', { class: 'row-sub' }, [
          ui.chip((saved.length === 'long' ? '長編' : '短編')
            + (saved.pages ? ' ' + saved.pages + 'P' : ''), 'soft'),
          saved.genre ? ui.chip(saved.genre, 'ghosty') : null
        ]) : null
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /**
   * プロット相談を開く。
   * @param {string} [projectId] 案件の id。渡すと、その案件のプロットを扱う
   */
  function open(projectId) {
    pid = projectId || '';
    var own = owner();
    host = el('div');
    host.appendChild(card());
    ui.sheet({
      title: own ? own.title + ' のプロット' : 'プロット相談',
      body: host,
      // 閉じたら、次に開くまで持ち主は持たない（ホームの1行が引きずられないように）
      onClose: function () { host = null; pid = ''; DL.app.render(); }
    });
  }

  /**
   * どの案件のものでもないプロットを、案件へ移す。
   * 移した先にすでにプロットがあれば、置き替えるかどうか聞く。
   * @param {object} p いま持っているプロット
   */
  function linkSheet(p) {
    var list = S.scopedProjects().filter(function (x) { return x.status !== 'archived'; });
    var body = el('div', { class: 'form' });

    if (!list.length) {
      body.appendChild(ui.empty('紐づけられる案件がありません。'));
    } else {
      body.appendChild(el('p', { class: 'muted small',
        text: '選んだ案件のプロットにします。案件の画面から、いつでも開けるようになります。' }));
      body.appendChild(el('div', { class: 'list' }, list.map(function (x) {
        return el('button', {
          type: 'button', class: 'row pl-pick',
          onclick: function () { pick(x); }
        }, [
          el('span', { class: 'dot', style: { background: x.color } }),
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, el('span', { text: x.title })),
            el('div', { class: 'row-sub' }, [
              ui.chip(ui.KIND_LABEL[x.kind] || '', 'soft'),
              x.plot ? ui.chip('プロットあり', 'warn') : null,
              U.isISO(x.deadline) ? el('span', { class: 'muted small',
                text: U.fmtMD(x.deadline) + ' 締切' }) : null
            ])
          ]),
          el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
        ]);
      })));
    }

    var close = ui.sheet({
      title: '案件に紐づける', body: body,
      actions: [ui.btn('やめる', 'ghost', function () { close(); })]
    });

    function pick(x) {
      var go = function () {
        S.updateProject(x.id, { plot: p });
        S.setPlot(null);            // ホームのぶんからは外す（移す、であってコピーではない）
        close();
        pid = x.id;
        paint();
        ui.toast(x.title + ' のプロットにしました');
      };
      if (!x.plot) { go(); return; }
      ui.confirm('「' + x.title + '」にはすでにプロットがあります。\n'
        + '（' + (x.plot.title || '無題') + '）置き替えますか。',
        { okText: '置き替える', danger: true }).then(function (ok) { if (ok) go(); });
    }
  }

  /* できたプロットの見た目 */
  function body(p) {
    var box = el('div', { class: 'pl-body' });

    box.appendChild(el('div', { class: 'pl-head' }, [
      el('b', { text: p.title || 'プロット' }),
      ui.chip((p.length === 'long' ? '長編' : '短編') + (p.pages ? ' ' + p.pages + 'P' : ''), 'soft'),
      p.genre ? ui.chip(p.genre, 'ghosty') : null
    ]));
    if (p.logline) box.appendChild(el('p', { class: 'pl-log', text: p.logline }));

    if (p.characters.length) {
      box.appendChild(el('div', { class: 'pl-people' }, p.characters.map(function (c) {
        return el('div', { class: 'pl-person' }, [
          el('b', { text: c.name }),
          ui.chip(c.age, 'ghosty'),
          c.role ? ui.chip(c.role, 'soft') : null,
          c.note ? el('span', { class: 'muted small', text: c.note }) : null
        ]);
      })));
    }

    /* 成人向けの場面も中身まで出す。どこがそれなのかは 18禁 の印で分かるようにする */
    box.appendChild(el('ol', { class: 'pl-beats' }, p.beats.map(function (b) {
      var adult = b.kind === 'adult';
      return el('li', { class: 'pl-beat' + (adult ? ' adult' : '') }, [
        el('div', { class: 'pl-beat-h' }, [
          adult ? ui.chip('18禁', 'danger') : null,
          el('b', { text: b.label || (adult ? ADULT_MARK : '') }),
          b.page ? ui.chip(b.page, 'ghosty') : null
        ]),
        b.text ? el('p', { text: b.text }) : null
      ]);
    })));

    if (p.note) box.appendChild(el('p', { class: 'muted small', text: p.note }));
    return box;
  }

  DL.plot = { ready: ready, make: make, send: send, ADULT_MARK: ADULT_MARK };
  DL.views = DL.views || {};
  DL.views.plot = { row: row, open: open, card: card, body: body };
})(window.DL);
