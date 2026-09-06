/* 顧客管理。

   取引先と、まだ契約していない営業先（見込み）を同じ名簿で持つ。
   メールで届いた発注の社名は、この名簿と照らし合わせる。

   合言葉（できれば顔）を通さないと中は見せない。ただしこれは蓋であって、
   中身を暗号で守るものではない。詳しくは crm.js の頭書き。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, C = DL.crm, el = U.el;

  var keyword = '';
  var filter = 'all';           // all / client / prospect

  /* ---------------- 入口 ---------------- */

  function render(root, params) {
    if (!C.unlocked()) { lockScreen(root); return; }
    if (params && params.id) { detail(root, params.id); return; }
    list(root);
  }

  /* 題名の右に出すボタン（app.js から呼ぶ） */
  function actions(box) {
    if (!C.unlocked() || !C.hasPass()) return;
    box.appendChild(el('button', {
      class: 'iconbtn', 'aria-label': '顧客管理を閉じる', title: '閉じる',
      onclick: function () { C.lock(); location.hash = '#/projects'; ui.toast('顧客管理を閉じました'); }
    }, [ui.icon('lock', 19)]));
  }

  /* ---------------- 鍵の画面 ---------------- */

  function lockScreen(root) {
    var wrap = el('div', { class: 'page crm-lock' });
    wrap.appendChild(el('div', { class: 'crm-lock-icon' }, [ui.icon('lock', 34)]));
    wrap.appendChild(el('h2', { class: 'crm-lock-title', text: '顧客管理' }));
    wrap.appendChild(el('p', { class: 'muted small', text: '合言葉を入れると開きます。' }));

    var pin = ui.input({ type: 'password', inputmode: 'numeric', autocomplete: 'off',
      placeholder: '合言葉', 'aria-label': '合言葉' });
    var msg = el('p', { class: 'small crm-lock-msg' });
    var form = el('form', { class: 'crm-lock-form' }, [pin]);

    var tryPass = function (e) {
      if (e) e.preventDefault();
      var v = pin.value;
      pin.value = '';
      C.checkPass(v).then(function (ok) {
        if (ok) { DL.app.render(); return; }
        msg.textContent = '合言葉が違います。';
        msg.classList.add('danger');
        pin.focus();
      });
    };
    form.addEventListener('submit', tryPass);
    wrap.appendChild(form);
    wrap.appendChild(ui.btn('開く', 'primary full', tryPass, 'check'));
    wrap.appendChild(msg);

    // 顔で開ける（この端末で用意してあるときだけ）
    if (C.faceOn()) {
      var faceBtn = ui.btn('Face ID で開く', 'ghost full', function () {
        C.faceUnlock().then(function (ok) {
          if (ok) { DL.app.render(); return; }
          msg.textContent = '顔では開けませんでした。合言葉を入れてください。';
          msg.classList.add('danger');
        });
      }, 'faceid');
      wrap.appendChild(faceBtn);
      // 開いたらすぐ聞く。断られても、合言葉で入れる
      setTimeout(function () { if (wrap.isConnected) faceBtn.click(); }, 350);
    }

    wrap.appendChild(el('p', { class: 'muted small crm-note',
      text: '合言葉を忘れたときは、設定 →「顧客管理」から入れ直せます。' }));
    root.appendChild(wrap);
    setTimeout(function () { if (pin.isConnected && !C.faceOn()) pin.focus(); }, 100);
  }

  /* 合言葉をまだ決めていないときに使う。設定からも呼ぶ */
  function passSheet(onDone) {
    var a = ui.input({ type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: '合言葉' });
    var b = ui.input({ type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: 'もう一度' });
    var msg = el('p', { class: 'small danger' });

    var close = ui.sheet({
      title: C.hasPass() ? '合言葉を変える' : '合言葉を決める',
      body: el('div', { class: 'form' }, [
        el('p', { class: 'muted small',
          text: C.MIN + '文字以上。ほかの端末でも同じ合言葉で開きます。' }),
        ui.field('合言葉', a), ui.field('もう一度', b), msg
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('決める', 'primary', function () {
          if (a.value !== b.value) { msg.textContent = '2つが違います。'; return; }
          if (String(a.value).length < C.MIN) { msg.textContent = C.MIN + '文字以上にしてください。'; return; }
          C.setPass(a.value).then(function (ok) {
            if (!ok) { msg.textContent = C.MIN + '文字以上にしてください。'; return; }
            C.open();
            close();
            ui.toast('合言葉を決めました');
            if (onDone) onDone();
            DL.app.render();
          });
        })
      ]
    });
  }

  /* ---------------- 一覧 ---------------- */

  function list(root) {
    var wrap = el('div', { class: 'page' });

    var search = ui.input({ value: keyword, placeholder: '会社名・担当者・メール・電話で検索' });
    search.addEventListener('input', function () { keyword = search.value; draw(); });
    wrap.appendChild(el('div', { class: 'searchbox' }, [ui.icon('search', 17), search]));

    var tabs = el('div', { class: 'filters' });
    [{ v: 'all', l: 'すべて' }, { v: 'client', l: '取引中' }, { v: 'prospect', l: '見込み' }]
      .forEach(function (o) {
        tabs.appendChild(el('button', {
          class: 'filter' + (filter === o.v ? ' on' : ''), text: o.l,
          onclick: function () { filter = o.v; DL.app.render(); }
        }));
      });
    wrap.appendChild(tabs);

    var box = el('div');
    wrap.appendChild(box);

    function draw() {
      U.clear(box);
      var items = C.search(keyword).filter(function (c) {
        return filter === 'all' || c.status === filter;
      });
      if (!items.length) {
        box.appendChild(ui.empty(keyword ? '見つかりませんでした。'
          : '下の＋から、会社や営業先を入れられます。'));
        return;
      }
      box.appendChild(el('div', { class: 'crm-count muted small',
        text: items.length + '件（取引中 ' + count('client') + '／見込み ' + count('prospect') + '）' }));
      items.forEach(function (c) { box.appendChild(row(c)); });
    }
    function count(st) {
      return S.clients().filter(function (c) { return c.status === st; }).length;
    }
    draw();

    wrap.appendChild(ui.btn('会社・営業先を追加', 'primary full', function () { form(null); }, 'plus'));
    root.appendChild(wrap);
  }

  function row(c) {
    var st = C.statusOf(c);
    var sub = [c.contact, c.plan].filter(function (t) { return t; }).join('　');
    return el('a', { class: 'card crm-row', href: '#/crm/' + c.id }, [
      el('span', { class: 'crm-row-icon' }, [ui.icon('person', 18)]),
      el('span', { class: 'crm-row-main' }, [
        el('span', { class: 'crm-row-name', text: c.name || '(名前なし)' }),
        sub ? el('span', { class: 'muted small', text: sub }) : null
      ].filter(Boolean)),
      ui.chip(st.label, st.cls),
      el('span', { class: 'chev' }, [ui.icon('chevronRight', 16)])
    ]);
  }

  /* ---------------- 1社の中身 ---------------- */

  function detail(root, id) {
    var c = S.getClient(id);
    if (!c) { root.appendChild(ui.empty('この会社は見つかりませんでした。')); return; }
    var wrap = el('div', { class: 'page' });
    var st = C.statusOf(c);

    var head = el('div', { class: 'card crm-head' }, [
      el('div', { class: 'crm-head-top' }, [
        el('h2', { class: 'crm-name', text: c.name || '(名前なし)' }),
        ui.chip(st.label, st.cls)
      ])
    ]);
    if (c.aliases.length) {
      head.appendChild(el('p', { class: 'muted small', text: '別名　' + c.aliases.join('／') }));
    }
    head.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('直す', 'ghost', function () { form(c); }, 'edit'),
      ui.btn('営業の記録', 'ghost', function () { visitSheet(c, null); }, 'plus')
    ]));
    wrap.appendChild(head);

    // 連絡先まわり
    wrap.appendChild(ui.section('連絡先'));
    var info = el('div', { class: 'card' });
    [
      ['担当者名', c.contact, null],
      ['メールアドレス', c.email, c.email ? 'mailto:' + c.email : null],
      ['電話番号', c.tel, c.tel ? 'tel:' + c.tel.replace(/[^\d+]/g, '') : null],
      ['住所', [c.zip ? '〒' + c.zip : '', c.address].filter(Boolean).join(' '), null],
      ['契約プラン', c.plan, null]
    ].forEach(function (r) {
      info.appendChild(el('div', { class: 'info-row' }, [
        el('span', { class: 'info-k', text: r[0] }),
        r[1]
          ? (r[2] ? el('a', { class: 'info-v link', href: r[2], text: r[1] })
                  : el('span', { class: 'info-v', text: r[1] }))
          : el('span', { class: 'info-v muted', text: '—' })
      ]));
    });
    wrap.appendChild(info);

    // 長い文章のところ
    [['会社概要', c.about], ['記事欄', c.article], ['特記事項', c.note]].forEach(function (r) {
      if (!r[1]) return;
      wrap.appendChild(ui.section(r[0]));
      wrap.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'crm-text', text: r[1] })
      ]));
    });

    // 発注履歴。案件と、メールで届いた発注の両方から拾う
    var hist = C.history(c);
    wrap.appendChild(ui.section('発注履歴', hist.length ? ui.chip(hist.length + '件', 'soft') : null));
    var hbox = el('div', { class: 'card' });
    if (!hist.length) {
      hbox.appendChild(el('p', { class: 'muted small', text: 'まだありません。' }));
    } else {
      hist.forEach(function (h) {
        hbox.appendChild(el(h.kind === 'project' ? 'a' : 'div', {
          class: 'crm-hist' + (h.kind === 'project' ? ' tap' : ''),
          href: h.kind === 'project' ? '#/project/' + h.id : null
        }, [
          el('span', { class: 'crm-hist-d muted small', text: h.date || '—' }),
          el('span', { class: 'crm-hist-t', text: h.title }),
          ui.chip(h.note, 'soft')
        ]));
      });
    }
    wrap.appendChild(hbox);

    // 営業に行った記録
    wrap.appendChild(ui.section('営業の記録',
      c.visits.length ? ui.chip(c.visits.length + '件', 'soft') : null));
    var vbox = el('div', { class: 'card' });
    if (!c.visits.length) {
      vbox.appendChild(el('p', { class: 'muted small', text: 'まだありません。' }));
    } else {
      c.visits.forEach(function (v) {
        vbox.appendChild(el('button', {
          class: 'crm-visit', onclick: function () { visitSheet(c, v); }
        }, [
          el('span', { class: 'crm-hist-d muted small', text: v.date }),
          el('span', { class: 'crm-visit-main' }, [
            el('span', { text: [v.place, v.person].filter(Boolean).join('　') || '（記録）' }),
            v.memo ? el('span', { class: 'muted small', text: v.memo }) : null
          ].filter(Boolean)),
          ui.chip(C.resultLabel(v.result), v.result === 'won' ? 'ok' : v.result === 'lost' ? 'muted' : 'soft')
        ]));
      });
    }
    vbox.appendChild(ui.btn('営業の記録を足す', 'ghost full', function () { visitSheet(c, null); }, 'plus'));
    wrap.appendChild(vbox);

    wrap.appendChild(ui.btn('この会社を消す', 'ghost full danger', function () {
      ui.confirm(c.name + ' を名簿から消します。案件と書類は残り、紐付けだけ外れます。',
        { danger: true, okText: '消す' }).then(function (ok) {
          if (!ok) return;
          S.removeClient(c.id);
          ui.toast('消しました');
          location.hash = '#/crm';
        });
    }, 'trash'));

    root.appendChild(wrap);
  }

  /* ---------------- 入れる・直す ---------------- */

  function form(c) {
    var isNew = !c;
    c = c || {};
    var f = {
      name: ui.input({ value: c.name || '', placeholder: '株式会社◯◯' }),
      status: null,
      contact: ui.input({ value: c.contact || '', placeholder: '山田 太郎' }),
      email: ui.input({ value: c.email || '', type: 'email', inputmode: 'email', autocapitalize: 'off', placeholder: 'info@example.co.jp' }),
      tel: ui.input({ value: c.tel || '', type: 'tel', inputmode: 'tel', placeholder: '03-0000-0000' }),
      zip: ui.input({ value: c.zip || '', inputmode: 'numeric', placeholder: '100-0001' }),
      address: ui.input({ value: c.address || '', placeholder: '東京都千代田区…' }),
      plan: ui.input({ value: c.plan || '', placeholder: '月額プラン / 都度 など' }),
      aliases: ui.input({ value: (c.aliases || []).join('、'),
        placeholder: 'メールで来る別の書きかた（読点で区切る）' }),
      about: ui.textarea({ value: c.about || '', rows: 3, placeholder: 'どんな会社か' }),
      article: ui.textarea({ value: c.article || '', rows: 3, placeholder: '記事・掲載など' }),
      note: ui.textarea({ value: c.note || '', rows: 3, placeholder: '気をつけること' })
    };

    // 取引中 / 見込み
    var status = c.status || 'client';
    var pick = el('div', { class: 'crm-pick' });
    [['client', '取引中'], ['prospect', '見込み（営業済み・未契約）']].forEach(function (o) {
      var b = ui.btn(o[1], 'ghost' + (status === o[0] ? ' on' : ''), function () {
        status = o[0];
        U.$$('.btn', pick).forEach(function (n, i) {
          n.classList.toggle('on', (i === 0 ? 'client' : 'prospect') === status);
        });
      });
      pick.appendChild(b);
    });

    var close = ui.sheet({
      title: isNew ? '会社・営業先を入れる' : '直す',
      body: el('div', { class: 'form' }, [
        ui.field('会社名', f.name),
        ui.block('状態', pick),
        ui.field('担当者名', f.contact),
        ui.field('メールアドレス', f.email),
        ui.field('電話番号', f.tel),
        ui.field('郵便番号', f.zip),
        ui.field('住所', f.address),
        ui.field('契約プラン', f.plan),
        ui.field('別名', f.aliases),
        ui.field('会社概要', f.about),
        ui.field('記事欄', f.article),
        ui.field('特記事項', f.note)
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
        var name = f.name.value.trim();
        if (!name) { ui.toast('会社名を入れてください', 'danger'); f.name.focus(); return; }
        var patch = {
          name: name, status: status,
          contact: f.contact.value.trim(), email: f.email.value.trim(), tel: f.tel.value.trim(),
          zip: f.zip.value.trim(), address: f.address.value.trim(), plan: f.plan.value.trim(),
          aliases: f.aliases.value.split(/[、,／/\n]/).map(function (s) { return s.trim(); })
            .filter(function (s) { return s; }),
          about: f.about.value.trim(), article: f.article.value.trim(), note: f.note.value.trim()
        };
        if (isNew) {
          var made = S.addClient(patch);
          ui.toast('入れました');
          close();
          location.hash = '#/crm/' + made.id;
        } else {
          S.updateClient(c.id, patch);
          ui.toast('直しました');
          close();
        }
        })
      ]
    });
  }

  function visitSheet(c, visit) {
    var isNew = !visit;
    visit = visit || {};
    var date = ui.input({ type: 'date', value: visit.date || U.today() });
    var place = ui.input({ value: visit.place || '', placeholder: '本社 / ◯◯支店 など' });
    var person = ui.input({ value: visit.person || '', placeholder: '会った人' });
    var memo = ui.textarea({ value: visit.memo || '', rows: 3, placeholder: '話したこと' });

    var result = visit.result || 'visited';
    var pick = el('div', { class: 'crm-pick' });
    Object.keys(C.RESULT).forEach(function (k) {
      pick.appendChild(ui.btn(C.RESULT[k], 'ghost' + (result === k ? ' on' : ''), function () {
        result = k;
        U.$$('.btn', pick).forEach(function (n, i) {
          n.classList.toggle('on', Object.keys(C.RESULT)[i] === result);
        });
      }));
    });

    var close = ui.sheet({
      title: isNew ? '営業の記録' : '営業の記録を直す',
      body: el('div', { class: 'form' }, [
        ui.field('行った日', date),
        ui.field('行き先', place),
        ui.field('会った人', person),
        ui.block('どうなったか', pick),
        ui.field('メモ', memo),
        isNew ? null : ui.btn('この記録を消す', 'danger full mt', function () {
          S.removeClientVisit(c.id, visit.id);
          close();
          ui.toast('消しました');
        }, 'trash')
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          if (!U.isISO(date.value)) { ui.toast('日付を入れてください', 'danger'); return; }
          // 「契約になった」なら、状態も取引中に寄せる
          var toClient = result === 'won' && S.getClient(c.id).status === 'prospect';
          S.putClientVisit(c.id, {
            id: visit.id, date: date.value, place: place.value.trim(),
            person: person.value.trim(), result: result, memo: memo.value.trim()
          });
          if (toClient) S.updateClient(c.id, { status: 'client' });
          close();
          ui.toast(toClient ? '控えて、取引中にしました' : '控えました');
        })
      ]
    });
  }

  /** ほかの画面から「この社名で1件入れる」ときに使う（発注の画面から） */
  function addFrom(data) {
    var made = S.addClient(Object.assign({ status: 'prospect' }, data || {}));
    return made;
  }

  DL.views = DL.views || {};
  DL.views.crm = {
    render: render, actions: actions, form: form, passSheet: passSheet, addFrom: addFrom
  };
})(window.DL);
