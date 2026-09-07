/* 書類（見積書・請求書・領収書）を PDF にして、Cloudflare（R2）に置く。

   端末には落とさない。書き出したものは共有ファイルの「書類」に入るので、
   どの端末からでも同じものが見られる。

   作り：画面と同じ書面をそのまま絵に起こして、A4 に貼る。
   書面は mm と pt で組んであり、色も固定なので、画面で見えているとおりに出る。
   文字を文字のまま PDF に入れる道もあるが、それには日本語の字形を丸ごと
   埋め込む必要があり、数MBを毎回読み込むことになる。ここでは見た目を優先した。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store, D = DL.docs, F = DL.files;

  // 差し替えられるようにしておく（つながらない環境での試験や、別のCDNに移すとき）
  var sources = {
    canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    pdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'
  };

  var A4 = { w: 210, h: 297 };     // mm
  var MARGIN = 12;                 // mm。ふちの余白
  var SCALE = 2;                   // 絵の細かさ（2 でおよそ 150dpi）

  var loading = {};

  function loadScript(key, src, has) {
    if (has()) return Promise.resolve();
    if (loading[key]) return loading[key];
    loading[key] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () {
        if (has()) resolve();
        else reject(new Error('PDF の部品を読み込めませんでした'));
      };
      s.onerror = function () {
        loading[key] = null;
        reject(new Error('PDF の部品を取りに行けませんでした。通信できる場所で試してください'));
      };
      document.head.appendChild(s);
    });
    return loading[key];
  }

  function libs() {
    return loadScript('canvas', sources.canvas, function () { return !!window.html2canvas; })
      .then(function () {
        return loadScript('pdf', sources.pdf, function () {
          return !!(window.jspdf && window.jspdf.jsPDF);
        });
      });
  }

  /* ---------------- 書面を絵にする ---------------- */

  /**
   * 画面に出ているものではなく、同じ中身をもう一度組んで写す。
   * 画面のほうは iPhone の幅に合わせて縮めてあるので、そのまま写すと小さくなる。
   */
  function shoot(doc, project, issuer) {
    var holder = U.el('div', {
      style: {
        position: 'fixed', left: '-10000px', top: '0',
        background: '#fff', zIndex: '-1'
      }
    });
    var sheet = D.sheet(doc, project, issuer);
    // 画面用の縮小を打ち消して、原寸で写す
    sheet.style.transform = 'none';
    sheet.style.marginBottom = '0';
    holder.appendChild(sheet);
    document.body.appendChild(holder);

    return new Promise(function (resolve) { setTimeout(resolve, 60); })   // 字が組まれるのを待つ
      .then(function () {
        return window.html2canvas(sheet, {
          scale: SCALE, backgroundColor: '#ffffff',
          useCORS: true, logging: false,
          windowWidth: sheet.scrollWidth, windowHeight: sheet.scrollHeight
        });
      })
      .then(function (canvas) { holder.remove(); return canvas; },
        function (e) { holder.remove(); throw e; });
  }

  /* 絵を A4 に貼る。縦に長ければ、ページに切り分ける */
  function toPdf(canvas) {
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    var innerW = A4.w - MARGIN * 2;
    var innerH = A4.h - MARGIN * 2;
    // 幅を合わせたときの、絵1枚ぶんの高さ（mm）
    var fullH = canvas.height * innerW / canvas.width;

    if (fullH <= innerH + 0.5) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG',
        MARGIN, MARGIN, innerW, fullH, undefined, 'FAST');
      return pdf;
    }

    // 1ページに入る高さぶんずつ、絵を切って貼る
    var pxPerPage = Math.floor(canvas.width * innerH / innerW);
    var at = 0, first = true;
    while (at < canvas.height) {
      var h = Math.min(pxPerPage, canvas.height - at);
      var part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = h;
      var cx = part.getContext('2d');
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, part.width, part.height);
      cx.drawImage(canvas, 0, at, canvas.width, h, 0, 0, canvas.width, h);

      if (!first) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG',
        MARGIN, MARGIN, innerW, h * innerW / canvas.width, undefined, 'FAST');
      first = false;
      at += h;
    }
    return pdf;
  }

  /* ---------------- 名前 ---------------- */

  /** '2026-09-07_請求書_R-2026-003_株式会社◯◯.pdf' */
  function fileName(doc, project) {
    var parts = [
      String(doc.issueDate || U.today()),
      D.TYPE_LABEL[doc.type] || '書類',
      doc.number || '下書き',
      doc.clientName || (project && project.title) || ''
    ].filter(Boolean);
    // ファイル名に使えない字を落とす
    return parts.join('_').replace(/[\\\/:*?"<>|\s]+/g, '_').slice(0, 90) + '.pdf';
  }

  /** 書類を置くフォルダ */
  function folderOf(doc) {
    return '書類/' + (D.TYPE_LABEL[doc.type] || 'その他');
  }

  /* ---------------- 本体 ---------------- */

  /**
   * PDF を作って、Cloudflare（R2）に置く。端末には落とさない。
   * @param {object} doc 書類
   * @param {object} project 案件
   * @param {object} [opts] {onStep:fn(step)}
   * @returns {Promise<{fileId,name,size,folder,pages}>}
   */
  function save(doc, project, opts) {
    opts = opts || {};
    var step = opts.onStep || function () {};
    if (!F.ready()) {
      return Promise.reject(new Error('同期の接続先が未設定です。設定から先につないでください'));
    }
    var issuer = S.getIssuer(doc.issuerId);

    step('lib');
    return libs()
      .then(function () { step('draw'); return shoot(doc, project, issuer); })
      .then(function (canvas) {
        step('pdf');
        var pdf = toPdf(canvas);
        var blob = pdf.output('blob');
        var name = fileName(doc, project);
        var file = new File([blob], name, { type: 'application/pdf' });
        var folder = folderOf(doc);

        step('upload');
        return F.upload(file, { folder: folder, projectId: project ? project.id : '' })
          .then(function (up) {
            // アプリ側にも置き場所を覚えさせる（ファイル画面でフォルダの外に出ないように）
            if (up && up.id && folder) S.setFileFolder(up.id, S.ensureFolderPath(folder));
            return {
              fileId: up.id, name: name, size: blob.size,
              folder: folder, pages: pdf.getNumberOfPages()
            };
          });
      });
  }

  DL.docpdf = {
    save: save, fileName: fileName, folderOf: folderOf,
    sources: sources, setSources: function (o) { Object.assign(sources, o || {}); }
  };
})(window.DL);
