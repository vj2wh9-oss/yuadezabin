/* 請求書・領収書：案件ごとの一覧と、編集＋プレビュー */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, D = DL.docs, el = U.el;

  /* ---------------- 案件ごとの書類一覧 ---------------- */

  function renderList(root, params) {
    var p = S.getProject(params.id);
    if (!p) {
      root.appendChild(ui.empty('案件が見つかりません。', ui.btn('一覧へ', 'primary', function () { location.hash = '#/projects'; })));
      return;
    }
    var wrap = el('div', { class: 'page' });

    wrap.appendChild(el('div', { class: 'card doc-head' }, [
      el('div', { class: 'row-title' }, [
        el('span', { class: 'dot', style: { background: p.color } }),
        el('span', { text: p.title })
      ]),
      el('div', { class: 'row-sub' }, [
        p.client ? ui.chip(p.client, 'ghosty') : null,
        p.fee ? ui.chip('報酬 ' + D.yen(p.fee), 'soft') : null
      ])
    ]));

    if (!S.issuers().length) {
      wrap.appendChild(el('div', { class: 'alert warn' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: '名義（発行元）がまだありません。先に登録してください。' })
      ]));
      wrap.appendChild(ui.btn('名義を登録する', 'primary full', function () {
        DL.forms.issuerSheet(null);
      }, 'plus'));
    }

    wrap.appendChild(el('div', { class: 'row-wrap doc-new' }, [
      ui.btn('請求書を作る', 'primary', function () { create(p, 'invoice'); }, 'invoice'),
      ui.btn('見積書を作る', 'ghost', function () { create(p, 'estimate'); }, 'estimate'),
      ui.btn('領収書を作る', 'ghost', function () { create(p, 'receipt'); }, 'receipt')
    ]));

    var list = (p.docs || []).slice().sort(function (a, b) { return U.cmp(b.issueDate, a.issueDate); });
    wrap.appendChild(ui.section('この案件の書類', el('span', { class: 'muted small', text: list.length + '件' })));
    if (!list.length) {
      wrap.appendChild(ui.empty('まだ書類がありません。'));
    } else {
      var box = el('div', { class: 'list' });
      list.forEach(function (d) { box.appendChild(docRow(p, d)); });
      wrap.appendChild(box);
    }

    root.appendChild(wrap);
  }

  function create(p, type) {
    if (!S.issuers().length) { ui.toast('先に名義を登録してください', 'warn'); return; }
    // 案件に名義が設定されていればそれを使う
    var d = S.addDoc(p.id, D.blank(type, p, p.issuerId));
    location.hash = '#/doc/' + p.id + '/' + d.id;
  }

  function docRow(p, d) {
    var c = D.calc(d);
    return el('a', { class: 'row doc', href: '#/doc/' + p.id + '/' + d.id }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          ui.icon(D.TYPE_ICON[d.type], 16),
          el('span', { text: D.TYPE_LABEL[d.type] }),
          d.number ? el('span', { class: 'muted small', text: d.number }) : null
        ]),
        el('div', { class: 'row-sub' }, [
          ui.chip(U.fmtYMD(d.issueDate), 'soft'),
          ui.chip(D.yen(d.type === 'receipt' ? c.total : c.payable), 'ghosty'),
          ui.chip(D.statusLabel(d), D.statusTone(d))
        ])
      ]),
      el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
    ]);
  }

  /* ---------------- 1件の編集とプレビュー ---------------- */

  function renderDoc(root, params) {
    var p = S.getProject(params.id);
    var d = p && S.getDoc(p.id, params.docId);
    if (!p || !d) {
      root.appendChild(ui.empty('書類が見つかりません。', ui.btn('戻る', 'primary', function () { history.back(); })));
      return;
    }
    var issuer = S.getIssuer(d.issuerId);
    var wrap = el('div', { class: 'page doc-page' });

    /* 操作 */
    wrap.appendChild(el('div', { class: 'doc-actions row-wrap' }, [
      ui.btn('PDFにする', 'primary', function () { makePdf(p, d); }, 'invoice'),
      ui.btn('内容を編集', 'ghost', function () { DL.forms.docSheet(p.id, d.id); }, 'edit'),
      d.type === 'invoice'
        ? ui.btn('この請求書から領収書', 'ghost', function () {
            var nd = S.addDoc(p.id, D.fromInvoice(d, p));
            location.hash = '#/doc/' + p.id + '/' + nd.id;
            ui.toast('領収書を作りました');
          }, 'receipt')
        : null,
      d.type === 'estimate'
        ? ui.btn('この見積書から請求書', 'ghost', function () {
            var nd = S.addDoc(p.id, D.fromEstimate(d, p));
            // 出した見積がそのまま通ったので、見積のほうも受注にしておく
            if (d.status !== 'accepted') {
              S.updateDoc(p.id, d.id, {
                status: 'accepted',
                number: d.number || S.issueNumber('estimate', d.issueDate)
              });
            }
            location.hash = '#/doc/' + p.id + '/' + nd.id;
            ui.toast('請求書を作りました（見積は受注にしました）');
          }, 'invoice')
        : null,
      ui.btn('複製', 'ghost', function () {
        var copy = U.clone(d); delete copy.id; copy.number = ''; copy.status = 'draft';
        copy.issueDate = U.today();
        var nd = S.addDoc(p.id, copy);
        location.hash = '#/doc/' + p.id + '/' + nd.id;
        ui.toast('複製しました');
      }, 'projects')
    ]));

    /* 状態 */
    var labels = D.statusLabels(d.type);
    var statusSeg = ui.segmented(
      Object.keys(labels).map(function (k) { return { value: k, label: labels[k] }; }),
      d.status, function (v) {
        var patch = { status: v };
        // 発行済みにするときに番号が無ければ採番する（発行日の年の連番）
        if (v !== 'draft' && !d.number) patch.number = S.issueNumber(d.type, d.issueDate);
        S.updateDoc(p.id, d.id, patch);
        ui.toast(v === 'draft' ? '下書きに戻しました' : labels[v] + 'にしました');
      }
    );
    var numHint = d.number
      ? '書類番号は ' + d.number + ' です'
      : '下書き以外にすると ' + S.peekNumber(d.type, d.issueDate) + ' が振られます';
    wrap.appendChild(el('div', { class: 'card' }, [
      ui.field('状態', statusSeg, numHint),
      ui.field('名義（発行元）', issuerSelect(p, d))
    ]));

    /* プレビュー */
    wrap.appendChild(ui.section('プレビュー', el('span', { class: 'muted small', text: 'A4' })));
    wrap.appendChild(el('div', { class: 'doc-preview' }, D.sheet(d, p, issuer)));

    wrap.appendChild(el('div', { class: 'actions' }, [
      ui.btn('この書類を削除', 'danger', function () {
        ui.confirm(D.TYPE_LABEL[d.type] + (d.number ? '（' + d.number + '）' : '') + ' を削除します。', { danger: true, okText: '削除' })
          .then(function (ok) {
            if (!ok) return;
            S.removeDoc(p.id, d.id);
            location.hash = '#/docs/' + p.id;
            ui.toast('削除しました');
          });
      }, 'trash')
    ]));

    root.appendChild(wrap);
  }

  function issuerSelect(p, d) {
    var list = S.issuers();
    if (!list.length) {
      return ui.btn('名義を登録する', 'ghost full', function () { DL.forms.issuerSheet(null); }, 'plus');
    }
    var sel = ui.select(
      list.map(function (x) { return { value: x.id, label: x.name || '(名称未設定)' }; }),
      (S.getIssuer(d.issuerId) || {}).id,
      function () { S.updateDoc(p.id, d.id, { issuerId: sel.value }); ui.toast('名義を切り替えました'); }
    );
    return sel;
  }

  /* ---------------- PDF にする ----------------

     端末には落とさない。Cloudflare（R2）の「書類」に置いて、
     そのまま種類ごとの Discord のチャンネルへ送る。 */

  var STEP = {
    lib: 'PDF の部品を読み込んでいます…',
    draw: '書面を写しています…',
    pdf: 'PDF にしています…',
    upload: 'Cloudflare に置いています…',
    send: 'Discord に送っています…'
  };

  function makePdf(p, d) {
    if (!DL.files.ready()) {
      ui.toast('先に「PC・iPhone の同期」を設定してください', 'danger');
      location.hash = '#/settings';
      return;
    }
    if (!d.number) {
      ui.toast('下書きのままです。番号は「発行済み」にすると振られます', 'warn');
    }

    var note = el('p', { class: 'muted small', text: STEP.lib });
    var bar = ui.progress(10, null);
    var close = ui.sheet({
      title: D.TYPE_LABEL[d.type] + 'を PDF にする',
      body: el('div', { class: 'form' }, [note, bar])
    });
    var pct = { lib: 10, draw: 35, pdf: 60, upload: 80, send: 92 };

    DL.docpdf.save(d, p, {
      onStep: function (s) {
        note.textContent = STEP[s] || '';
        var i = bar.querySelector('i');
        if (i) i.style.width = (pct[s] || 10) + '%';
      }
    }).then(function (out) {
      // 作った PDF は書類にも覚えさせる（あとから同じものを開けるように）
      S.updateDoc(p.id, d.id, { pdfFileId: out.fileId, pdfName: out.name });

      note.textContent = STEP.send;
      var i = bar.querySelector('i');
      if (i) i.style.width = '92%';

      return sendToDiscord(p, d, out).then(function (sent) {
        close();
        done(p, d, out, sent);
      });
    }).catch(function (e) {
      close();
      var bad = ui.sheet({
        title: 'PDF にできませんでした',
        body: el('p', { class: 'sheet-msg', text: e.message }),
        actions: [ui.btn('閉じる', 'primary', function () { bad(); })]
      });
    });
  }

  /* 種類ごとのチャンネルへ。送れなくても PDF は残っているので、そこは分けて伝える */
  function sendToDiscord(p, d, out) {
    var c = D.calc(d);
    return DL.memosend.sendDoc({
      type: d.type, fileId: out.fileId, name: out.name,
      number: d.number || '', client: d.clientName || '',
      total: D.yen(c.total), issueDate: U.fmtYMD(d.issueDate),
      project: p.title || ''
    }).then(function () { return { ok: true }; },
      function (e) { return { ok: false, message: e.message }; });
  }

  function done(p, d, out, sent) {
    var kb = Math.max(1, Math.round(out.size / 1024));
    var body = el('div', { class: 'form' }, [
      el('p', { class: 'muted small',
        text: out.name + '（' + kb + 'KB・' + out.pages + 'ページ）' }),
      el('div', { class: 'alert ' + (sent.ok ? 'info' : 'warn') },
        el('span', { text: sent.ok
          ? 'Cloudflare の「' + out.folder + '」に置いて、' + D.TYPE_LABEL[d.type]
            + 'のチャンネルへ送りました。'
          : 'Cloudflare の「' + out.folder + '」に置きました。'
            + 'Discord へは送れませんでした：' + sent.message })),
      ui.btn('ファイルで見る', 'ghost full', function () {
        close();
        location.hash = '#/files';
      }, 'folder')
    ]);
    var close = ui.sheet({
      title: 'PDF にしました',
      body: body,
      actions: [ui.btn('閉じる', 'primary', function () { close(); })]
    });
  }

  DL.views = DL.views || {};
  DL.views.doc = { renderList: renderList, renderDoc: renderDoc };
})(window.DL);
