/* 設定 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, sc = DL.schedule, el = U.el;

  function render(root) {
    var s = S.settings;
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
            var list = (S.settings.offDays || []).slice();
            var idx = list.indexOf(d);
            if (idx >= 0) list.splice(idx, 1); else list.push(d);
            S.updateSettings({ offDays: list });
          }
        }));
      })(i);
    }
    wrap.appendChild(el('div', { class: 'card' }, [
      ui.field('作業しない曜日', offWrap, '選んだ曜日にはノルマを割り当てません'),
      ui.field('締切前の予備日', numInput(s.bufferDays, function (v) { S.updateSettings({ bufferDays: v }); }), '自動スケジュールの既定値'),
      ui.field('締切が近いと知らせる日数', numInput(s.warnDays, function (v) { S.updateSettings({ warnDays: v }); })),
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
        var list = (S.settings.holidays || []).slice();
        if (list.indexOf(addDate.value) < 0) list.push(addDate.value);
        list.sort();
        S.updateSettings({ holidays: list });
        ui.toast('休業日を追加しました');
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
      tplSummary('illust', 'イラスト', 'illust')
    ]));

    /* ---- データ ---- */
    wrap.appendChild(ui.section('データ'));
    var file = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          S.importJSON(String(r.result));
          ui.toast('読み込みました');
          DL.app.render();
        } catch (e) {
          ui.toast('読み込みに失敗しました：' + e.message, 'danger');
        }
      };
      r.readAsText(f);
      file.value = '';
    });

    wrap.appendChild(el('div', { class: 'card actions' }, [
      ui.btn('バックアップを書き出す（JSON）', 'ghost', function () {
        ui.download('shimekiri-' + U.today() + '.json', S.exportJSON(), 'application/json');
        ui.toast('書き出しました');
      }, 'arrowDown'),
      ui.btn('バックアップを読み込む', 'ghost', function () { file.click(); }, 'arrowUp'),
      ui.btn('カレンダー用ファイル（.ics）', 'ghost', function () { icsSheet(); }, 'calendar'),
      ui.btn('サンプルデータを追加', 'ghost', function () {
        S.seedSample(); ui.toast('サンプルを追加しました');
      }, 'plus'),
      ui.btn('すべて削除', 'danger', function () {
        ui.confirm('すべての案件と設定を削除します。元に戻せません。', { danger: true, okText: '削除' }).then(function (ok) {
          if (!ok) return;
          S.clearAll(); ui.toast('削除しました');
        });
      }, 'trash'),
      file
    ]));

    /* ---- 情報 ---- */
    wrap.appendChild(ui.section('このアプリについて'));
    wrap.appendChild(el('div', { class: 'card info' }, [
      el('p', { class: 'muted small', text: 'データはこの端末のブラウザ内（localStorage）にのみ保存されます。機種変更や履歴の削除で消えるため、ときどきJSONバックアップを書き出してください。' }),
      el('p', { class: 'muted small', text: 'iPhone では Safari の共有ボタン →「ホーム画面に追加」でアプリのように使えます（オフラインでも動きます）。' }),
      el('p', { class: 'muted small', text: '案件数：' + S.projects().length + '　バージョン：prototype 0.1' })
    ]));

    root.appendChild(wrap);
  }

  function numInput(value, onchange) {
    var i = ui.input({ type: 'number', inputmode: 'numeric', min: 0, value: U.num(value, 0) });
    i.addEventListener('change', function () { onchange(U.num(i.value, 0)); });
    return i;
  }

  function tplSummary(cat, label, iconName) {
    var list = (S.settings.templates[cat] || []).map(function (t) { return t.name; }).join(' → ');
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
          { value: 'page', label: 'ページ' }, { value: 'cut', label: '枚' }, { value: 'none', label: '数量なし' }
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
    var body = el('div', { class: 'form' }, [
      el('p', { class: 'muted small', text: 'イベント・入稿締切・納品日をカレンダーファイルに書き出します。iPhone では書き出したファイルを開くと標準カレンダーに取り込めます。' }),
      el('label', { class: 'row-check' }, [withTasks, el('span', { text: '毎日のノルマも書き出す（予定が多くなります）' })])
    ]);
    var close = ui.sheet({
      title: 'カレンダーに書き出す', body: body,
      actions: [
        ui.btn('キャンセル', 'ghost', function () { close(); }),
        ui.btn('書き出す', 'primary', function () {
          ui.download('shimekiri.ics', sc.buildICS({ withTasks: withTasks.checked }), 'text/calendar');
          close(); ui.toast('書き出しました');
        })
      ]
    });
  }

  DL.views = DL.views || {};
  DL.views.settings = { render: render };
})(window.DL);
