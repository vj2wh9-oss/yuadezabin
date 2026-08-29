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

    var offWrap = el('div', { class: 'wdays' });
    for (var i = 0; i < 7; i++) {
      (function (d) {
        var on = (s.offDays || []).indexOf(d) >= 0;
        offWrap.appendChild(el('button', {
          class: 'wday' + (on ? ' on' : ''), text: U.wdName(d),
          onclick: function () {
            var before = DL.forms.planSnapshot();
            var list = (S.settings.offDays || []).slice();
            var idx = list.indexOf(d);
            var adding = idx < 0;
            if (adding) list.push(d); else list.splice(idx, 1);
            S.updateSettings({ offDays: list });
            if (adding) DL.forms.offerReschedule(before);
          }
        }));
      })(i);
    }
    wrap.appendChild(el('div', { class: 'card' }, [
      ui.field('作業しない曜日', offWrap, '選んだ曜日にはノルマを割り当てません'),
      ui.field('締切前の予備日', numInput(s.bufferDays, function (v) { S.updateSettings({ bufferDays: v }); }), '自動スケジュールの既定値'),
      ui.field('締切が近いと知らせる日数', numInput(s.warnDays, function (v) { S.updateSettings({ warnDays: v }); })),
      ui.field('1日の作業量の上限', numInput(s.dailyLimit, function (v) { S.updateSettings({ dailyLimit: v }); }),
        '0で無効。ページ数・枚数・点数の合計がこれを超える日を警告します'),
      ui.field('週のはじまり', ui.segmented(
        [{ value: '0', label: '日曜' }, { value: '1', label: '月曜' }],
        String(s.weekStart), function (v) { S.updateSettings({ weekStart: U.num(v, 0) }); }
      ))
    ]));

    /* ---- 休業日 ---- */
    wrap.appendChild(ui.section('休業日'));
    var holiBox = el('div', { class: 'card' });
    var addDate = ui.input({ type: 'date' });
    holiBox.appendChild(el('div', { class: 'row-end gap' }, [
      addDate,
      ui.btn('追加', 'primary', function () {
        if (!U.isISO(addDate.value)) return;
        var before = DL.forms.planSnapshot();
        var list = (S.settings.holidays || []).slice();
        if (list.indexOf(addDate.value) < 0) list.push(addDate.value);
        list.sort();
        S.updateSettings({ holidays: list });
        ui.toast('休業日を追加しました');
        DL.forms.offerReschedule(before);
      })
    ]));
    var chips = el('div', { class: 'row-wrap' });
    (s.holidays || []).slice().sort().forEach(function (d) {
      chips.appendChild(el('button', {
        class: 'chip removable', text: U.fmtMDW(d) + ' ×',
        onclick: function () {
          S.updateSettings({ holidays: S.settings.holidays.filter(function (x) { return x !== d; }) });
        }
      }));
    });
    if (!(s.holidays || []).length) chips.appendChild(el('span', { class: 'muted small', text: '登録なし' }));
    holiBox.appendChild(chips);
    wrap.appendChild(holiBox);

    /* ---- テンプレート ---- */
    wrap.appendChild(ui.section('基本タスクのテンプレート'));
    wrap.appendChild(el('div', { class: 'card' }, [
      tplSummary('manga', '漫画', 'manga'),
      tplSummary('illust', 'イラスト', 'illust'),
      tplSummary('design', 'デザイン', 'design')
    ]));

    /* ---- 屋号 ---- */
    wrap.appendChild(ui.section('屋号（請求書・領収書の発行元）',
      el('a', { class: 'link', href: '#/sales', text: '売上' })));
    var issuerBox = el('div', { class: 'card' });
    var list = S.issuers();
    if (!list.length) {
      issuerBox.appendChild(el('p', { class: 'muted small', text: '登録するとお仕事の案件から請求書・領収書を発行できます。屋号ごとに住所・ロゴ・振込先を持てます。' }));
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
          ui.toast('既定の屋号にしました');
        })
      ]));
    });
    issuerBox.appendChild(ui.btn('屋号を追加', 'ghost full', function () { DL.forms.issuerSheet(null); }, 'plus'));
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
      el('p', { class: 'muted small', text: 'データはこの端末のブラウザ内（IndexedDB。使えない環境では localStorage）にのみ保存されます。サーバーには一切送りません。機種変更や履歴の削除で消えるため、ときどき iCloud へ書き出してください。' }),
      el('p', { class: 'muted small', text: 'iPhone では Safari の共有ボタン →「ホーム画面に追加」でアプリのように使えます（オフラインでも動きます）。' }),
      el('p', { class: 'muted small', text: '案件数：' + S.projects().length + '　取引先：' + S.clients().length + '件　バージョン：0.2' })
    ]));

    root.appendChild(wrap);
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
    var data;
    try {
      data = JSON.parse(text);
      if (!data || !Array.isArray(data.projects)) throw new Error('形式が違います');
    } catch (e) {
      ui.toast('読み込めませんでした：' + e.message, 'danger');
      return;
    }
    var body = el('div', { class: 'form' }, [
      el('div', { class: 'preview' }, el('div', { class: 'preview-main' }, [
        el('strong', { text: 'ファイル内の案件 ' + data.projects.length + '件' }),
        el('span', { class: 'muted', text: '　いまの案件 ' + S.projects().length + '件' })
      ])),
      el('p', { class: 'muted small', text: 'どちらを選んでも、実行前の状態は控えとして残ります（自動バックアップ →「控えの一覧から戻す」）。' })
    ]);
    var close = ui.sheet({
      title: 'バックアップの読み込み', body: body,
      actions: [
        ui.btn('統合（無い案件だけ追加）', 'ghost', function () { run('merge'); }),
        ui.btn('全て置き換え', 'danger', function () { run('replace'); })
      ]
    });
    function run(mode) {
      try {
        var r = S.importJSON(text, mode);
        close();
        ui.toast(r.mode === 'merge'
          ? r.added + '件を追加しました' + (r.skipped ? '（' + r.skipped + '件は既にあるため変更なし）' : '')
          : r.total + '件に置き換えました');
        DL.app.render();
      } catch (e) {
        ui.toast('読み込みに失敗しました：' + e.message, 'danger');
      }
    }
  }

  DL.views = DL.views || {};
  DL.views.settings = { render: render };
})(window.DL);
