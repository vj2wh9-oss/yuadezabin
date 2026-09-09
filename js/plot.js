/* プロット相談。

   物語の大きな流れだけを考えてもらう。性的な場面は中身を作らせず、
   その位置に「ここから成人向けシーン」と置くだけにしてある。
   登場人物は全員おとな。未成年を思わせる言葉が混ざったものは、
   サーバー側で作り直すか、出さずに断る。

   できたものは、指定の Discord チャンネルへそのまま送れる。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  var LENGTHS = [{ value: 'short', label: '短編' }, { value: 'long', label: '長編' }];
  var DEFAULT_PAGES = { short: 24, long: 120 };
  var ADULT_MARK = 'ここから成人向けシーン';

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
      length: o.length, pages: o.pages, genre: o.genre, want: o.want, people: o.people
    }).then(function (b) { return S.setPlot(b.data); });
  }

  /** Discord のチャンネルへ送る */
  function send(p) { return post('/v1/plot/send', { plot: p }); }

  /* ---------------- 画面（ホーム） ---------------- */

  var form = { length: 'short', pages: 24, genre: '', want: '', people: 2 };
  var busy = false;

  function card() {
    if (!ready()) return null;
    var box = el('div', { class: 'card pl-card' });
    var saved = S.getPlot();

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
              S.setPlot(null);
              ui.toast('消しました');
              paint();
            });
          }
        }, ui.icon('trash', 16))
      ]));
      return box;
    }

    box.appendChild(ui.block('長さ', ui.segmented(LENGTHS, form.length, function (v) {
      form.length = v;
      form.pages = DEFAULT_PAGES[v] || 24;
      paint();
    })));

    var pagesIn = ui.input({ type: 'number', inputmode: 'numeric', min: 4, max: 600,
      value: form.pages, onchange: function () { form.pages = U.num(pagesIn.value, form.pages); } });
    var genreIn = ui.input({ value: form.genre, maxlength: 60, placeholder: '例）年の差／幼なじみ再会／オフィス',
      onchange: function () { form.genre = genreIn.value; } });
    var wantIn = ui.textarea({ rows: 2, value: form.want, maxlength: 400,
      placeholder: '例）雨宿り／喧嘩からの仲直り／指輪を渡す',
      onchange: function () { form.want = wantIn.value; } });
    var peopleIn = ui.stepper({ value: form.people, max: 6,
      onChange: function (v) { form.people = Math.max(1, U.num(v, 2)); } });

    box.appendChild(ui.field('ページ数', pagesIn));
    box.appendChild(ui.field('ジャンル', genreIn));
    box.appendChild(ui.field('入れたいシーン', wantIn));
    box.appendChild(ui.block('主要人物', peopleIn));
    box.appendChild(ui.btn(busy ? '考えています…' : 'プロットを出す', 'primary full', function () {
      form.genre = genreIn.value;
      form.want = wantIn.value;
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
    return el('button', { type: 'button', class: 'row', onclick: open }, [
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

  function open() {
    host = el('div');
    host.appendChild(card());
    ui.sheet({
      title: 'プロット相談', body: host,
      onClose: function () { host = null; }
    });
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

    box.appendChild(el('ol', { class: 'pl-beats' }, p.beats.map(function (b) {
      if (b.kind === 'adult') {
        return el('li', { class: 'pl-beat adult' }, [
          el('b', { text: ADULT_MARK }),
          b.page ? ui.chip(b.page, 'ghosty') : null
        ]);
      }
      return el('li', { class: 'pl-beat' }, [
        el('div', { class: 'pl-beat-h' }, [
          el('b', { text: b.label }),
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
