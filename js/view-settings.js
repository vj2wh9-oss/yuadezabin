/* 設定 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  function render(root) {
    var s = S.settings;
    var age = S.backupAgeDays();       // ファイルへ書き出してからの日数
    var wrap = el('div', { class: 'page' });

    /* ---- 稼働設定 ---- */
    wrap.appendChild(ui.section('作業の設定'));

    wrap.appendChild(el('div', { class: 'card' }, [
      ui.field('締切前の予備日', numInput(s.bufferDays, function (v) { S.updateSettings({ bufferDays: v }); }), '自動スケジュールの既定値'),
      ui.field('締切が近いと知らせる日数', numInput(s.warnDays, function (v) { S.updateSettings({ warnDays: v }); })),
      ui.field('1日の作業量の上限', numInput(s.dailyLimit, function (v) { S.updateSettings({ dailyLimit: v }); }),
        '0で無効。ページ数・枚数・点数の合計がこれを超える日を警告します'),
      ui.field('週のはじまり', ui.segmented(
        [{ value: '0', label: '日曜' }, { value: '1', label: '月曜' }],
        String(s.weekStart), function (v) { S.updateSettings({ weekStart: U.num(v, 0) }); }
      ))
    ]));

    /* 休業日はカレンダーの日別画面から指定する（ここには置かない） */

    /* ---- テンプレート ---- */
    wrap.appendChild(ui.section('基本タスクのテンプレート'));
    wrap.appendChild(el('div', { class: 'card' }, [
      tplSummary('manga', '漫画', 'manga'),
      tplSummary('illust', 'イラスト', 'illust'),
      tplSummary('design', 'デザイン', 'design')
    ]));

    /* ---- 名義 ---- */
    wrap.appendChild(ui.section('名義（請求書・領収書の発行元）',
      el('a', { class: 'link', href: '#/sales', text: '売上' })));
    var issuerBox = el('div', { class: 'card' });
    var list = S.issuers();
    if (!list.length) {
      issuerBox.appendChild(el('p', { class: 'muted small', text: '登録するとお仕事の案件から請求書・領収書を発行できます。名義ごとに住所・ロゴ・振込先を持てます。' }));
    }
    list.forEach(function (x) {
      var isDefault = S.settings.defaultIssuerId === x.id;
      issuerBox.appendChild(el('div', { class: 'issuer-row' }, [
        el('button', { class: 'tpl-summary', onclick: function () { DL.forms.issuerSheet(x.id); } }, [
          el('div', { class: 'issuer-main' }, [
            el('span', { class: 'scope-dot big', style: { background: S.issuerColor(x.id) } }),
            x.logo ? el('img', { class: 'issuer-logo', src: x.logo, alt: '' }) : null,
            el('div', {}, [
              el('strong', {}, [el('span', { text: x.name || '(名称未設定)' }), isDefault ? ui.chip('既定', 'ok') : null]),
              el('div', { class: 'muted small', text: [x.ownerName, x.address].filter(Boolean).join('　') || '住所未設定' })
            ])
          ]),
          el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
        ]),
        isDefault ? null : ui.btn('既定にする', 'ghost tiny', function () {
          S.updateSettings({ defaultIssuerId: x.id });
          ui.toast('既定の名義にしました');
        })
      ]));
    });
    issuerBox.appendChild(ui.btn('名義を追加', 'ghost full', function () { DL.forms.issuerSheet(null); }, 'plus'));
    wrap.appendChild(issuerBox);

    /* ---- 取引先 ---- */
    wrap.appendChild(ui.section('取引先', el('span', { class: 'muted small', text: S.clients().length + '件' })));
    var clientBox = el('div', { class: 'card' });
    if (!S.clients().length) {
      clientBox.appendChild(el('p', { class: 'muted small', text: '登録しておくと、案件を作るときに選ぶだけで、請求書の宛名・住所・支払期限・源泉徴収の有無まで入ります。' }));
    }
    S.clients().slice().sort(function (a, b) { return U.cmp(a.name, b.name); }).forEach(function (c) {
      var docs = S.clientDocs(c.id);
      var sum = DL.docs.sales(docs);
      clientBox.appendChild(el('button', { class: 'tpl-summary', onclick: function () { DL.forms.clientSheet(c.id); } }, [
        el('div', {}, [
          el('strong', {}, [ui.icon('client', 16), el('span', { text: c.name })]),
          el('div', { class: 'row-sub' }, [
            ui.chip(S.clientProjects(c.id).length + '件の案件', 'ghosty'),
            sum.count ? ui.chip('売上 ' + DL.docs.yen(sum.total), 'soft') : null,
            sum.unpaid ? ui.chip('未入金 ' + DL.docs.yen(sum.unpaid), 'warn') : null
          ]),
          c.address ? el('div', { class: 'muted small', text: c.address }) : null
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]));
    });
    clientBox.appendChild(ui.btn('取引先を追加', 'ghost full', function () { DL.forms.clientSheet(null); }, 'plus'));
    wrap.appendChild(clientBox);

    /* ---- 自動バックアップ ---- */
    wrap.appendChild(ui.section('自動バックアップ'));
    var autoChk = el('input', { type: 'checkbox', class: 'check', checked: !!s.autoBackup });
    autoChk.addEventListener('change', function () { S.updateSettings({ autoBackup: autoChk.checked }); });
    var backupCard = el('div', { class: 'card' }, [
      el('label', { class: 'row-check' }, [autoChk, el('span', { text: '1日1回、端末内に自動で控えを取る' })]),
      el('span', { class: 'field-hint', text: '日付が変わったあと最初にアプリを開いたときに実行します（IndexedDB に保存）。アプリを開かない日は取れません。' }),
      ui.field('残す世代数', numInput(s.autoBackupKeep, function (v) {
        S.updateSettings({ autoBackupKeep: v }); S.pruneBackups(v);
      }), '自動ぶんだけ古いものから消します。手動・操作前の控えは残ります'),
      el('div', { class: 'info-row' }, [
        el('span', { class: 'info-k', text: '最後の自動バックアップ' }),
        el('span', { class: 'info-v', text: U.isISO(s.lastAutoBackupAt) ? U.fmtYMDW(s.lastAutoBackupAt) : 'まだありません' })
      ]),
      el('div', { class: 'info-row' }, [
        el('span', { class: 'info-k', text: '保存場所' }),
        el('span', { class: 'info-v', id: 'dbState', text: '確認中…' })
      ])
    ]);
    wrap.appendChild(backupCard);
    wrap.appendChild(el('div', { class: 'card actions' }, [
      ui.btn('いますぐ控えを取る', 'ghost', function () {
        S.makeBackup('manual', '手動').then(function (r) {
          ui.toast(r ? '控えを取りました' : 'この環境では保存できませんでした', r ? '' : 'danger');
          DL.app.render();
        });
      }, 'backup'),
      ui.btn('控えの一覧から戻す', 'ghost', function () { backupListSheet(); }, 'refresh')
    ]));

    DL.db.usable().then(function (ok) {
      var n = U.$('#dbState');
      if (!n) return;
      n.textContent = ok ? 'この端末の IndexedDB' : 'IndexedDB が使えないため控えを取れません';
      if (!ok) return;
      return DL.db.usage().then(function (u) {
        if (!u || !u.quota) return;
        n.textContent = 'この端末の IndexedDB（' + mb(u.used) + ' / ' + mb(u.quota) + '）';
      });
    });

    /* ---- 同期 ---- */
    wrap.appendChild(ui.section('PC・iPhone の同期',
      DL.sync.active() ? ui.chip('有効', 'ok') : ui.chip('未接続', 'ghosty')));
    wrap.appendChild(syncCard(s));

    /* ---- 通知 ---- */
    wrap.appendChild(ui.section('通知',
      DL.notify.settings().enabled ? ui.chip('この端末で受け取る', 'ok') : ui.chip('切', 'ghosty')));
    wrap.appendChild(notifyCard());

    /* ---- iCloud へ書き出す ---- */
    wrap.appendChild(ui.section('iCloud への書き出し'));
    wrap.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted small', text: 'iOS の Web アプリからは iCloud へ直接書き込めないため、ファイルとして書き出して保存します。Safari の設定 →「ダウンロード」で保存先を iCloud Drive の「案件ポータルバックアップ」にしておくと、下のボタンひとつでそのフォルダに入ります。' }),
      ui.btn('iCloud に書き出す', 'primary full', function () { exportToFile(); }, 'cloud'),
      ui.btn('保存先を選んで書き出す', 'ghost full', function () { shareToFile(); }, 'arrowUp'),
      el('span', { class: 'field-hint', text: '共有シートの「"ファイル"に保存」から、フォルダをその場で選べます' }),
      el('div', { class: 'info-row' }, [
        el('span', { class: 'info-k', text: '最後の書き出し' }),
        el('span', { class: 'info-v', text: age === null ? 'まだ書き出していません' : U.fmtYMD(s.lastBackupAt) + '（' + (age === 0 ? '今日' : age + '日前') + '）' })
      ])
    ]));

    /* ---- データ ---- */
    wrap.appendChild(ui.section('データ'));
    var file = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { importSheet(String(r.result)); };
      r.readAsText(f);
      file.value = '';
    });

    wrap.appendChild(el('div', { class: 'card actions' }, [
      ui.btn('バックアップを書き出す（JSON）', 'ghost', function () { exportToFile(); }, 'arrowDown'),
      ui.btn('バックアップを読み込む', 'ghost', function () { file.click(); }, 'arrowUp'),
      ui.btn('カレンダー用ファイル（.ics）', 'ghost', function () { icsSheet(); }, 'calendar'),
      ui.btn('サンプルデータを追加', 'ghost', function () {
        S.seedSample(); ui.toast('サンプルを追加しました');
      }, 'plus'),
      ui.btn('すべて削除', 'danger', function () {
        ui.confirm('すべての案件と設定を削除します。削除前の状態は控えとして残るので、「控えの一覧から戻す」で呼び戻せます。', { danger: true, okText: '削除' }).then(function (ok) {
          if (!ok) return;
          S.clearAll(); ui.toast('削除しました');
        });
      }, 'trash'),
      file
    ]));

    /* ---- 保存領域 ---- */
    wrap.appendChild(el('div', { class: 'card info' }, [
      el('div', { class: 'info-row' }, [
        el('span', { class: 'info-k', text: '保存領域' }),
        el('span', { class: 'info-v', id: 'persistState', text: '確認中…' })
      ])
    ]));
    S.requestPersistence().then(function (ok) {
      var n = U.$('#persistState');
      if (!n) return;
      n.textContent = ok === true ? 'このアプリのデータは消えにくい設定になっています'
        : ok === false ? '空き容量が減ると消される可能性があります。こまめにバックアップしてください'
        : 'この環境では確認できません。こまめにバックアップしてください';
    });

    /* ---- 情報 ---- */
    wrap.appendChild(ui.section('このアプリについて'));
    wrap.appendChild(el('div', { class: 'card info' }, [
      el('p', { class: 'muted small', text: 'データはこの端末のブラウザ内（IndexedDB。使えない環境では localStorage）に保存されます。同期をつないだときだけ、自分で立てたサーバーにも預けます。機種変更や履歴の削除で消えるため、ときどき iCloud へ書き出してください。' }),
      el('p', { class: 'muted small', text: 'iPhone では Safari の共有ボタン →「ホーム画面に追加」でアプリのように使えます（オフラインでも動きます）。' }),
      el('p', { class: 'muted small', text: '案件数：' + S.projects().length + '　取引先：' + S.clients().length + '件　バージョン：0.2' })
    ]));

    root.appendChild(wrap);
  }


  /* ---------------- 通知 ---------------- */

  function notifyCard() {
    var N = DL.notify;
    var nf = N.settings();
    var st = N.status();
    var box = el('div', { class: 'card' });

    box.appendChild(el('p', { class: 'muted small', text:
      'アプリを閉じていても知らせます。時刻が来たら同期サーバーから送る仕組みなので、'
      + '「PC・iPhone の同期」を設定しておく必要があります。' }));

    if (!st.ok) {
      box.appendChild(el('div', { class: 'alert warn mt' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: st.why })
      ]));
    }

    box.appendChild(el('div', { class: 'row-wrap mt' }, [
      nf.enabled
        ? ui.btn('この端末で受け取るのをやめる', 'ghost', function () {
            N.disable().then(function () { ui.toast('通知を止めました'); });
          }, 'close')
        : ui.btn('この端末で受け取る', 'primary', function () {
            ui.toast('登録しています…');
            N.enable().then(function (r) {
              ui.toast(r.ok ? '通知を受け取ります' : r.why, r.ok ? '' : 'danger');
              DL.app.render();
            });
          }, 'alert'),
      nf.enabled ? ui.btn('テスト送信', 'ghost', function () {
        N.testSend().then(function (r) {
          ui.toast(r.ok ? '送りました。数秒で届きます' : '送れませんでした', r.ok ? '' : 'danger');
        }, function (e) { ui.toast(e.message, 'danger'); });
      }, 'refresh') : null,
      ui.btn('様子を見る', 'ghost tiny', function () { notifyStateSheet(); }, 'info'),
      ui.btn('サーバーの鍵を作る', 'ghost tiny', function () { vapidSheet(); }, 'settings')
    ]));

    box.appendChild(el('h3', { class: 'sub-title mt', text: '知らせるもの' }));
    var rules = N.rules();
    if (!rules.length) {
      box.appendChild(el('p', { class: 'muted small', text: 'まだ何も決めていません。' }));
      box.appendChild(ui.btn('よく使う組み合わせを入れる', 'ghost full mt', function () {
        saveRules(N.defaultRules());
        ui.toast('前日20時・当日8時・今日やること を入れました');
      }, 'plus'));
    } else {
      var list = el('div', { class: 'list' });
      rules.forEach(function (r) { list.appendChild(ruleRow(r)); });
      box.appendChild(list);
    }

    box.appendChild(ui.btn('知らせるものを足す', 'ghost full mt', function () { ruleSheet(null); }, 'plus'));
    return box;
  }

  function saveRules(rules) {
    S.updateSettings({ notify: Object.assign({}, DL.notify.settings(), { rules: rules }) });
    DL.notify.sync().catch(function () { /* つながらないときは次の機会に */ });
  }

  function ruleText(r) {
    if (r.when === 'beforeMin') return '開始の' + r.minutes + '分前';
    if (r.when === 'beforeDay') return (r.kind === 'deadline' ? r.days + '日前の ' : '前日の ') + r.time;
    return '当日の ' + r.time;
  }

  function ruleRow(r) {
    var k = DL.notify.KINDS[r.kind] || { label: r.kind };
    return el('div', { class: 'row' + (r.active ? '' : ' is-done') }, [
      el('div', { class: 'row-main', onclick: function () { ruleSheet(r); } }, [
        el('div', { class: 'row-title', text: k.label }),
        el('div', { class: 'row-sub' }, [
          ui.chip(ruleText(r), 'soft'),
          r.importantOnly ? ui.iconChip('alert', '重要だけ', 'warn') : null,
          !r.active ? ui.chip('停止中', 'ghosty') : null
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  function ruleSheet(r) {
    var N = DL.notify;
    var isNew = !r;
    var v = r || { id: U.uid(), kind: 'lifeEvent', active: true, when: 'beforeDay',
                   time: '20:00', days: 3, minutes: 30, importantOnly: false };

    var kindSel = ui.select(Object.keys(N.KINDS).map(function (k) {
      return { value: k, label: N.KINDS[k].label };
    }), v.kind);
    var noteEl = el('p', { class: 'muted small' });
    var whenWrap = el('div', {});
    var timeIn = ui.input({ type: 'time', value: v.time });
    var daysIn = ui.input({ type: 'number', min: 1, max: 60, value: v.days });
    var minIn = ui.input({ type: 'number', min: 5, max: 720, step: 5, value: v.minutes });
    var impIn = el('input', { type: 'checkbox', checked: !!v.importantOnly });
    var activeIn = el('input', { type: 'checkbox', checked: v.active !== false });
    var when = v.when;

    function draw() {
      var k = N.KINDS[kindSel.value];
      noteEl.textContent = k ? k.note : '';
      U.clear(whenWrap);
      var opts = (k && k.whens) || [];
      if (opts.map(function (o) { return o.value; }).indexOf(when) < 0) {
        when = opts.length ? opts[0].value : 'onDay';
      }
      whenWrap.appendChild(ui.field('鳴らし方', ui.segmented(opts, when, function (val) { when = val; draw(); })));
      if (when === 'beforeMin') {
        whenWrap.appendChild(ui.field('何分前', minIn, '時刻を決めた予定にだけ効きます'));
      } else {
        if (when === 'beforeDay' && kindSel.value === 'deadline') {
          whenWrap.appendChild(ui.field('何日前', daysIn));
        }
        whenWrap.appendChild(ui.field('時刻', timeIn));
      }
      if (kindSel.value === 'lifeEvent') {
        whenWrap.appendChild(el('label', { class: 'row-check' }, [
          impIn, el('span', { text: '「重要」にした予定だけ知らせる' })
        ]));
      }
    }
    kindSel.addEventListener('change', draw);
    draw();

    var close = ui.sheet({
      title: isNew ? '知らせるものを足す' : '通知の設定',
      body: el('div', { class: 'form' }, [
        ui.field('種別', kindSel),
        noteEl,
        whenWrap,
        el('label', { class: 'row-check' }, [activeIn, el('span', { text: '有効にする' })]),
        !isNew ? ui.btn('これを削除', 'danger full mt', function () {
          saveRules(DL.notify.rules().filter(function (x) { return x.id !== v.id; }));
          close(); ui.toast('削除しました');
        }, 'trash') : null
      ]),
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var next = {
            id: v.id, kind: kindSel.value, active: activeIn.checked, when: when,
            time: timeIn.value || '08:00', days: U.num(daysIn.value, 3),
            minutes: U.num(minIn.value, 30), importantOnly: impIn.checked
          };
          var rules = DL.notify.rules().filter(function (x) { return x.id !== v.id; });
          rules.push(next);
          saveRules(rules);
          close();
          ui.toast('保存しました');
        })
      ]
    });
  }

  /* いま何件が控えているか、次はいつか */
  function notifyStateSheet() {
    var body = el('div', { class: 'form' }, el('p', { class: 'muted', text: '見に行っています…' }));
    ui.sheet({ title: '通知の様子', body: body });
    var items = DL.notify.build();
    DL.notify.state().then(function (st) {
      U.clear(body);
      body.appendChild(el('div', { class: 'kv' }, [
        kvRow('サーバーの鍵（VAPID）', st.vapid ? '設定済み' : '未設定'),
        kvRow('受け取る端末', (st.subs || []).length + '台'),
        kvRow('預けてある予定', st.queued + '件（これから ' + st.pending + '件）'),
        kvRow('送信済み', st.sent + '件'),
        kvRow('この端末で作った予定', items.length + '件'),
        kvRow('次に鳴るもの', st.next ? (fmtAt(st.next.at) + '　' + st.next.title) : 'なし')
      ]));
      if (items.length) {
        body.appendChild(el('h3', { class: 'sub-title mt', text: 'これから鳴る予定（先頭10件）' }));
        var list = el('div', { class: 'list' });
        items.slice(0, 10).forEach(function (x) {
          list.appendChild(el('div', { class: 'row' }, el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title', text: x.title }),
            el('div', { class: 'row-sub' }, [
              ui.chip(fmtAt(x.at), 'soft'),
              el('span', { class: 'muted small', text: x.body })
            ])
          ])));
        });
        body.appendChild(list);
      }
      body.appendChild(ui.btn('いま預け直す', 'ghost full mt', function () {
        DL.notify.sync().then(function (r) {
          ui.toast(r ? (r.queued + '件を預けました') : '通知が切になっています');
        }, function (e) { ui.toast(e.message, 'danger'); });
      }, 'refresh'));
    }, function (e) {
      U.clear(body);
      body.appendChild(el('p', { class: 'muted', text: '見に行けませんでした：' + e.message }));
    });
  }

  function kvRow(k, v) {
    return el('div', { class: 'kv-row' }, [
      el('span', { class: 'muted small', text: k }), el('strong', { text: String(v) })
    ]);
  }


  /* 通知に使う鍵（VAPID）をその場で作る。
     Cloudflare に貼るのは持ち主だけなので、作るところもここで済ませる。
     秘密鍵はアプリに保存しない（画面に出すだけ）。 */
  function vapidSheet() {
    var body = el('div', { class: 'form' });
    var close = ui.sheet({ title: '通知サーバーの鍵を作る', body: body });

    body.appendChild(el('p', { class: 'muted small', text:
      '通知を送るには、Cloudflare の Worker に鍵（VAPID）を登録します。下の「作る」を押すと2つの文字列が出るので、Cloudflare のダッシュボードで Worker →「設定」→「変数とシークレット」に貼ってください。' }));

    var out = el('div', { class: 'mt' });
    body.appendChild(ui.btn('作る', 'primary full', function () {
      crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        .then(function (kp) {
          return Promise.all([
            crypto.subtle.exportKey('raw', kp.publicKey),
            crypto.subtle.exportKey('jwk', kp.privateKey)
          ]);
        }).then(function (r) {
          var pub = b64url(new Uint8Array(r[0]));
          var priv = r[1].d;                    // jwk の d がそのまま base64url
          U.clear(out);
          out.appendChild(keyRow('VAPID_PUBLIC', pub, 'シークレット'));
          out.appendChild(keyRow('VAPID_PRIVATE', priv, 'シークレット'));
          out.appendChild(keyRow('VAPID_SUBJECT', 'mailto:' + (S.settings.issuers[0] && S.settings.issuers[0].email || 'you@example.com'), '変数（テキスト）'));
          out.appendChild(el('p', { class: 'muted small mt', text:
            'あわせて、Worker の「トリガー」に Cron を1つ足してください（* * * * * ＝毎分）。これが通知を送るきっかけになります。' }));
          out.appendChild(el('p', { class: 'muted small', text:
            '※ この画面を閉じると秘密鍵は消えます（アプリには保存しません）。貼り終わってから閉じてください。' }));
        }).catch(function (e) { ui.toast('作れませんでした：' + e.message, 'danger'); });
    }, 'plus'));
    body.appendChild(out);
  }

  function keyRow(name, value, kind) {
    var inp = ui.input({ value: value, readonly: true });
    return el('div', { class: 'mt' }, [
      el('div', { class: 'row-sub' }, [ui.chip(name, 'soft'), ui.chip(kind, 'ghosty')]),
      el('div', { class: 'row-wrap' }, [
        inp,
        ui.btn('コピー', 'ghost tiny', function () { copyText(value); }, 'folder')
      ])
    ]);
  }

  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* 同期の設定カード */
  function syncCard(s) {
    var c = s.sync;
    var card = el('div', { class: 'card' });

    if (!DL.sync.ready()) {
      card.appendChild(el('p', { class: 'muted small', text: '接続先と合鍵を入れると、PC と iPhone でデータが自動で揃うようになります。接続先は自分で立てたサーバーです（sync/README.md に手順があります）。まだの場合は、いまのまま iCloud への書き出しで受け渡しできます。' }));
    }

    var urlInput = ui.input({ value: c.url, placeholder: 'https://....workers.dev', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
    urlInput.addEventListener('change', function () {
      S.updateSync({ url: urlInput.value.trim(), rev: 0, baseSavedAt: '', lastError: '' });
    });
    card.appendChild(ui.field('接続先', urlInput, 'wrangler deploy のあとに出る URL'));

    var tokenInput = ui.input({
      value: c.token, placeholder: '（未設定）', type: 'password',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: false
    });
    tokenInput.addEventListener('change', function () {
      S.updateSync({ token: tokenInput.value.trim(), rev: 0, baseSavedAt: '', lastError: '' });
    });
    card.appendChild(ui.field('合鍵', tokenInput, '両方の端末で同じものを入れます。サーバーには保存されません'));
    card.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn(c.token ? '合鍵を作り直す' : '合鍵を作る', 'ghost tiny', function () {
        var make = function () {
          var t = DL.sync.makeToken();
          S.updateSync({ token: t, rev: 0, baseSavedAt: '', lastError: '' });
          ui.toast('合鍵を作りました。もう一方の端末にも同じものを入れてください');
        };
        if (!c.token) { make(); return; }
        ui.confirm('作り直すと、いまサーバーにあるデータは読めなくなります（各端末のデータは残ります）。', { danger: true, okText: '作り直す' })
          .then(function (ok) { if (ok) make(); });
      }, 'refresh'),
      c.token ? ui.btn('合鍵をコピー', 'ghost tiny', function () {
        copyText(c.token).then(function (ok) {
          ui.toast(ok ? 'コピーしました' : 'コピーできませんでした。合鍵の欄を長押しして選択してください', ok ? '' : 'warn');
        });
      }, 'projects') : null,
      c.token ? ui.btn('合鍵を表示', 'ghost tiny', function () {
        tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
      }) : null
    ]));

    if (!DL.sync.ready()) return card;

    var enable = el('input', { type: 'checkbox', class: 'check', checked: !!c.enabled });
    enable.addEventListener('change', function () {
      S.updateSync({ enabled: enable.checked });
      if (enable.checked) {
        DL.sync.run().then(function (r) {
          if (r.status === 'error') return;
          if (r.status !== 'conflict') ui.toast('同期しました');
          DL.app.render();
        });
      }
    });
    card.appendChild(el('label', { class: 'row-check' }, [enable, el('span', { text: '自動で同期する' })]));
    card.appendChild(el('span', { class: 'field-hint', text: 'アプリを開いたとき・閉じるとき・編集して少し経ったときに、自動で送受信します。' }));

    card.appendChild(el('div', { class: 'info-row' }, [
      el('span', { class: 'info-k', text: 'この端末' }),
      el('span', { class: 'info-v', text: c.deviceName || DL.sync.deviceName() })
    ]));
    card.appendChild(el('div', { class: 'info-row' }, [
      el('span', { class: 'info-k', text: '最後の同期' }),
      el('span', { class: 'info-v', text: c.lastAt ? DL.sync.fmtAt(c.lastAt) + '（版 ' + c.rev + '）' : 'まだありません' })
    ]));
    if (c.lastError) {
      card.appendChild(el('div', { class: 'info-row' }, [
        el('span', { class: 'info-k', text: '前回のエラー' }),
        el('span', { class: 'info-v danger-text', text: c.lastError })
      ]));
    }

    card.appendChild(el('div', { class: 'row-wrap' }, [
      ui.btn('いま同期', 'primary', function () {
        DL.sync.run({ force: true }).then(function (r) {
          if (r.status === 'error' || r.status === 'conflict') return;
          ui.toast(r.status === 'pushed' ? 'この端末の内容を送りました'
            : r.status === 'pulled' ? 'サーバーの内容を取り込みました'
            : r.status === 'merged' ? '統合しました' : '変更はありませんでした');
          DL.app.render();
        });
      }, 'refresh'),
      ui.btn('接続をたしかめる', 'ghost', function () {
        DL.sync.test().then(function (r) {
          ui.toast(r.ok
            ? (r.exists ? 'つながりました（版 ' + r.rev + '・' + (r.by || '不明な端末') + 'が最後に保存）' : 'つながりました（サーバーはまだ空です）')
            : 'つながりません：' + r.message, r.ok ? '' : 'danger');
          DL.app.render();
        });
      }, 'cloud'),
      ui.btn('接続を解除', 'ghost', function () {
        ui.confirm('この端末の同期をやめます。端末内のデータもサーバーのデータもそのまま残ります。', { okText: '解除' })
          .then(function (ok) {
            if (!ok) return;
            S.updateSync({ enabled: false, url: '', token: '', rev: 0, baseSavedAt: '', lastAt: '', lastError: '' });
            ui.toast('解除しました');
          });
      })
    ]));

    return card;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  function mb(n) {
    n = U.num(n, 0);
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
    return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + 'MB';
  }

  /* 保存時刻を端末の時間帯で表示する（at は UTC の ISO 文字列） */
  function fmtAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return U.fmtYMDW(U.toISO(d)) + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  function backupFileName() { return '案件ポータル-' + U.today() + '.json'; }

  /* ファイルへ書き出す（iPhone では Safari のダウンロード先へ入る） */
  function exportToFile() {
    ui.download(backupFileName(), S.exportJSON(), 'application/json');
    ui.toast('書き出しました');
  }

  /* 共有シートから保存先を選んで書き出す */
  function shareToFile() {
    ui.shareFile(backupFileName(), S.exportJSON(), 'application/json').then(function (how) {
      if (how === 'cancelled') return;
      ui.toast(how === 'shared' ? '書き出しました' : '書き出しました（ダウンロード）');
    });
  }

  /* 端末内の控えの一覧から戻す */
  function backupListSheet() {
    var body = el('div', { class: 'form' }, el('p', { class: 'muted small', text: '読み込み中…' }));
    var close = ui.sheet({ title: '端末内の控え', body: body });

    S.listBackups().then(function (list) {
      U.clear(body);
      if (!list.length) {
        body.appendChild(el('p', { class: 'muted small', text: 'まだ控えがありません。「いますぐ控えを取る」か、自動バックアップをお待ちください。' }));
        return;
      }
      body.appendChild(el('p', { class: 'muted small', text: '選んだ時点の状態に戻します。戻す直前の状態も控えとして残るので、やり直せます。' }));
      var box = el('div', { class: 'list' });
      list.forEach(function (b) {
        var when = fmtAt(b.at);
        box.appendChild(el('div', { class: 'row backup-row' }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              ui.icon('backup', 15), el('span', { text: when })
            ]),
            el('div', { class: 'row-sub' }, [
              ui.chip(S.BACKUP_KIND_LABEL[b.kind] || b.kind, b.kind === 'auto' ? 'ghosty' : 'soft'),
              ui.chip('案件 ' + (b.projects === undefined ? '—' : b.projects) + '件', 'ghosty'),
              ui.chip(mb(b.size), 'ghosty')
            ])
          ]),
          ui.btn('戻す', 'ghost tiny', function () {
            ui.confirm(when + ' の状態に戻します。いまのデータは控えとして残します。', { okText: '戻す' })
              .then(function (ok) {
                if (!ok) return;
                S.restoreBackup(b.id).then(function (done) {
                  close();
                  ui.toast(done ? '戻しました' : '戻せませんでした', done ? '' : 'danger');
                });
              });
          }),
          el('button', {
            class: 'iconbtn small danger', 'aria-label': '削除',
            onclick: function () {
              S.removeBackup(b.id).then(function () { close(); backupListSheet(); });
            }
          }, ui.icon('trash', 15))
        ]));
      });
      body.appendChild(box);
    });
  }

  function numInput(value, onchange) {
    var i = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: U.num(value, 0) });
    i.addEventListener('change', function () { onchange(U.num(i.value, 0)); });
    return i;
  }

  function tplSummary(cat, label, iconName) {
    var names = (S.settings.templates[cat] || []).map(function (t) { return t.name; });
    var list = names.length ? names.join(' → ') : 'まだ設定なし（自分の工程を登録できます）';
    return el('button', { class: 'tpl-summary', onclick: function () { tplSheet(cat, label); } }, [
      el('div', {}, [
        el('strong', {}, [ui.icon(iconName, 16), el('span', { text: label })]),
        el('div', { class: 'muted small', text: list })
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* テンプレート編集 */
  function tplSheet(cat, label) {
    var items = U.clone(S.settings.templates[cat] || []);
    var list = el('div', { class: 'tpl-edit' });

    function render() {
      U.clear(list);
      items.forEach(function (t, i) {
        var name = ui.input({ value: t.name });
        var weight = ui.input({ type: 'number', inputmode: 'numeric', min: 1, value: t.weight });
        var unit = ui.select([
          { value: 'page', label: 'ページ' }, { value: 'cut', label: '枚' },
          { value: 'item', label: '点' }, { value: 'none', label: '数量なし' }
        ], t.unit);
        name.addEventListener('input', function () { t.name = name.value; });
        weight.addEventListener('input', function () { t.weight = U.num(weight.value, 1); });
        unit.addEventListener('change', function () { t.unit = unit.value; });
        list.appendChild(el('div', { class: 'tpl-row' }, [
          name,
          el('div', { class: 'grid3' }, [
            weight, unit,
            el('div', { class: 'row-end' }, [
              el('button', { class: 'iconbtn small', text: '↑', onclick: function () { if (i > 0) { var x = items[i - 1]; items[i - 1] = items[i]; items[i] = x; render(); } } }),
              el('button', { class: 'iconbtn small', text: '↓', onclick: function () { if (i < items.length - 1) { var x = items[i + 1]; items[i + 1] = items[i]; items[i] = x; render(); } } }),
              el('button', { class: 'iconbtn small danger', 'aria-label': '削除', onclick: function () { items.splice(i, 1); render(); } }, ui.icon('close', 16))
            ])
          ])
        ]));
      });
      list.appendChild(ui.btn('行を追加', 'ghost full', function () {
        items.push({ name: '新しい工程', weight: 10, unit: cat === 'manga' ? 'page' : 'cut' });
        render();
      }));
    }
    render();

    var body = el('div', { class: 'form' }, [
      el('p', { class: 'muted small', text: '名前・重み（日数の配分比率）・単位を設定します。新しい案件を作るときの初期タスクになります。' }),
      list,
      ui.btn('初期設定に戻す', 'ghost full', function () {
        items = U.clone(S.TEMPLATES[cat]); render();
      })
    ]);

    var close = ui.sheet({
      title: label + ' のテンプレート', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('保存', 'primary', function () {
          var t = U.clone(S.settings.templates);
          t[cat] = items;
          S.updateSettings({ templates: t });
          close(); ui.toast('保存しました');
        })
      ]
    });
  }

  /* ICS 書き出し */
  function icsSheet() {
    var withTasks = el('input', { type: 'checkbox', class: 'check' });
    var alarmSel = ui.select(sc.ICS_ALARMS.map(function (a) { return { value: a.value, label: a.label }; }),
      S.settings.icsAlarm || '');
    var body = el('div', { class: 'form' }, [
      el('p', { class: 'muted small', text: 'イベント・入稿締切・納品日・公開日をカレンダーファイルに書き出します。iPhone では書き出したファイルを開くと標準カレンダーに取り込めます。' }),
      ui.field('通知', alarmSel, '取り込んだ予定に通知を付けます。アプリを開かなくても締切に気づけます'),
      el('label', { class: 'row-check' }, [withTasks, el('span', { text: '毎日のノルマも書き出す（予定が多くなります／通知は付きません）' })])
    ]);
    var close = ui.sheet({
      title: 'カレンダーに書き出す', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('書き出す', 'primary', function () {
          S.updateSettings({ icsAlarm: alarmSel.value });
          ui.download('shimekiri.ics', sc.buildICS({ withTasks: withTasks.checked, alarm: alarmSel.value }), 'text/calendar');
          close(); ui.toast('書き出しました');
        })
      ]
    });
  }

  /* 読み込み方法（置き換え／統合）を選ぶ */
  function importSheet(text) {
    var info;
    try {
      info = S.inspectBackup(text);
    } catch (e) {
      ui.toast('読み込めませんでした：' + e.message, 'danger');
      return;
    }

    // どちらが新しいかを言い切る。取り違えて上書きするのがいちばん怖いので
    var verdict = info.newer === true
      ? { text: 'ファイルのほうが新しいデータです。「全て置き換え」で問題ありません。', cls: 'info' }
      : info.newer === false
        ? { text: 'この端末のほうが新しいデータです。「全て置き換え」を選ぶと、この端末の新しい変更が消えます。', cls: 'warn' }
        : { text: '保存日時が入っていないファイルです。どちらが新しいか判断できないので、中身をよく確かめてください。', cls: 'warn' };

    var body = el('div', { class: 'form' }, [
      el('div', { class: 'cmp' }, [
        cmpCol('ファイル', info.savedAt ? fmtAt(info.savedAt) : '日時なし',
          [info.projects + '件の案件', info.docs + '件の書類', info.issuers + 'つの名義', info.clients + '件の取引先']),
        cmpCol('この端末', S.state.savedAt ? fmtAt(S.state.savedAt) : '—',
          [S.projects().length + '件の案件',
           S.allDocs().length + '件の書類',
           S.issuers().length + 'つの名義',
           S.clients().length + '件の取引先'])
      ]),
      el('div', { class: 'alert ' + verdict.cls }, [
        el('span', { class: 'alert-icon' }, ui.icon(verdict.cls === 'warn' ? 'alert' : 'info', 17)),
        el('span', { text: verdict.text })
      ]),
      el('p', { class: 'muted small', text: '「統合」は、いま無い案件・名義・取引先だけを足します。両方の端末で別々に足したものを合流させたいときはこちら。既にあるものの中身は書き換えません。' }),
      el('p', { class: 'muted small', text: 'どちらを選んでも、実行前の状態は控えとして残ります（自動バックアップ →「控えの一覧から戻す」）。' })
    ]);
    var close = ui.sheet({
      title: 'バックアップの読み込み', body: body,
      actions: [
        ui.btn('統合（無いものだけ追加）', 'ghost', function () { run('merge'); }),
        ui.btn('全て置き換え', 'danger', function () { run('replace'); })
      ]
    });
    function run(mode) {
      try {
        var r = S.importJSON(text, mode);
        close();
        if (r.mode === 'merge') {
          var parts = [];
          if (r.added) parts.push('案件 ' + r.added + '件');
          if (r.issuers) parts.push('名義 ' + r.issuers + 'つ');
          if (r.clients) parts.push('取引先 ' + r.clients + '件');
          ui.toast(parts.length ? parts.join('・') + 'を追加しました' : '追加するものはありませんでした');
        } else {
          ui.toast(r.total + '件に置き換えました');
        }
        DL.app.render();
      } catch (e) {
        ui.toast('読み込みに失敗しました：' + e.message, 'danger');
      }
    }
  }

  function cmpCol(title, when, lines) {
    return el('div', { class: 'cmp-col' }, [
      el('span', { class: 'cmp-t', text: title }),
      el('strong', { class: 'cmp-when', text: when }),
      el('div', { class: 'cmp-lines' }, lines.map(function (t) { return el('span', { text: t }); }))
    ]);
  }

  DL.views = DL.views || {};
  DL.views.settings = { render: render, importSheet: importSheet };
})(window.DL);
