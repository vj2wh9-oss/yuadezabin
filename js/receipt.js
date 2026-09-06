/* レシートを読む。撮る → 紙だけ切り出す → R2 へ置く → Worker 経由で OpenAI → JSON。

   鍵はアプリ側に持たない。Worker の secret にだけ置いてあり、
   こちらは「読んで」と頼んで JSON を受け取るだけ。

   置いた写真はそのまま経費レシートのフォルダに残るので、
   読み取りのために別途アップロードし直すことはしない。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store, F = DL.files;


  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }
  function ready() { return F.ready(); }

  function err(msg, extra) {
    var e = new Error(msg);
    if (extra) Object.assign(e, extra);
    return e;
  }

  /* サーバー側の返事を、そのまま出しても分かる日本語にする */
  function reason(status, body) {
    var k = body && body.error;
    if (status === 401) return '合鍵が違います';
    if (k === 'no_api_key') return 'サーバー側に OpenAI の鍵がありません。Worker の Settings → Variables で OPENAI_API_KEY を secret として追加してください';
    if (k === 'r2_not_bound') return 'サーバー側にファイル置き場（R2）がつながっていません';
    if (k === 'openai_error') return 'OpenAI が断りました（' + (body.status || '') + '・model=' + (body.model || '') + '）：' + (body.message || '');
    if (k === 'openai_unreachable') return 'OpenAI につながりませんでした';
    if (k === 'openai_empty') return 'OpenAI が中身を返しませんでした（長さ上限に当たった可能性があります）';
    if (k === 'not_json') return '読み取り結果が JSON になっていません';
    if (k === 'not_image') return '画像ではないので読めません';
    if (k === 'too_large') return '画像が大きすぎます';
    if (status === 404) return 'サーバー側がレシート読み取りに未対応です。Cloudflare の Worker を最新のコードにして deploy し直してください';
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  /* ---------------- 設定できているか ---------------- */

  /* 鍵そのものは返ってこない。あるか無いかだけ */
  function status() {
    if (!ready()) return Promise.resolve({ ok: false, why: 'no_sync' });
    return fetch(base() + '/v1/ocr/status', {
      headers: { authorization: 'Bearer ' + conf().token }, cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) return { ok: false, why: b.error || String(res.status), message: reason(res.status, b) };
        return Object.assign({ ok: true }, b);
      });
    }).catch(function () { return { ok: false, why: 'offline', message: '通信できませんでした' }; });
  }

  /* ---------------- 読み取り ---------------- */

  /* 読み取りの種類ごとの違い。ここだけ差し替えれば増やせる */
  var KINDS = {
    receipt: { path: 'receipt', folder: null, normalize: normalize },
    card: { path: 'card', folder: '名刺', normalize: normalizeCard }
  };

  function kindOf(opts) { return KINDS[(opts && opts.kind) || 'receipt'] || KINDS.receipt; }

  /**
   * 写真1枚を読み取る。
   * @param {File|Blob} file 撮ったままの写真
   * @param {object} [opts] {kind:'receipt'|'card', onStep:fn(step),
   *                         book:'work'|'life'（写真の置き場所）,
   *                         projectId, folder, noRetry}
   * @returns {Promise<{data:object, fileId:string, file:File, crop:object, model:string, retried:boolean, usage:object}>}
   */
  function read(file, opts) {
    opts = opts || {};
    var step = opts.onStep || function () {};
    if (!ready()) return Promise.reject(err('同期の接続先が未設定です。設定から先につないでください'));

    step('crop');
    return DL.crop.receipt(file, { max: opts.max })
      .then(function (c) {
        step('upload');
        var k = kindOf(opts);
        var folder = opts.folder !== undefined ? opts.folder
          : k.folder !== null ? k.folder
            : DL.expenses.receiptFolder(opts.book);
        return F.upload(c.file, { folder: folder, projectId: opts.projectId || '' })
          .then(function (up) {
            // アプリ側にも置き場所を覚えさせる。これをしないと
            // ファイル画面でフォルダの外に出てしまう
            if (up && up.id && folder) S.setFileFolder(up.id, S.ensureFolderPath(folder));
            return { crop: c, up: up, folder: folder };
          });
      })
      .then(function (o) {
        step('read');
        return ask(o.up.id, opts).then(function (r) {
          return {
            data: kindOf(opts).normalize(r.data),
            raw: r.data,
            fileId: o.up.id,
            file: o.crop.file,
            crop: o.crop,
            folder: o.folder,
            model: r.model,
            retried: !!r.retried,
            retryReason: r.retryReason || '',
            usage: r.usage || null
          };
        }).catch(function (e) {
          // 読めなくても写真は残す（あとから手で入れられるように）
          e.fileId = o.up.id;
          throw e;
        });
      });
  }

  /**
   * すでに置いてある写真を、もう一度読み取る。
   * 撮り直さずに済むので、読み違えたときはこちらを使う。
   * @param {string} fileId 共有ファイルのID
   * @param {object} [opts] {noRetry, model}
   */
  function reread(fileId, opts) {
    if (!ready()) return Promise.reject(err('同期の接続先が未設定です。設定から先につないでください'));
    if (!fileId) return Promise.reject(err('読み取る写真がありません'));
    return ask(fileId, opts).then(function (r) {
      return {
        data: kindOf(opts).normalize(r.data),
        raw: r.data,
        fileId: fileId,
        model: r.model,
        retried: !!r.retried,
        retryReason: r.retryReason || '',
        usage: r.usage || null
      };
    });
  }

  /* Worker に「この写真を読んで」と頼む */
  function ask(fileId, opts) {
    var body = { fileId: fileId };
    if (opts && opts.noRetry) body.noRetry = true;
    if (opts && opts.model) body.model = opts.model;

    return fetch(base() + '/v1/ocr/' + kindOf(opts).path, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + conf().token, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw err(reason(res.status, b), { detail: b });
        return b;
      });
    });
  }

  /* ---------------- 受け取った値をアプリの形に直す ---------------- */

  /**
   * 向こうから来た JSON を、そのまま画面に出せる形にそろえる。
   * 相手の言うことを鵜呑みにせず、日付や金額はこちらで確かめる。
   */
  function normalize(d) {
    d = d || {};
    var out = {
      store: String(d.store == null ? '' : d.store).trim().slice(0, 60),
      date: fixDate(d.date),
      total: money(d.total),
      items: [],
      itemsComplete: !!d.itemsComplete,
      confidence: clamp01(d.confidence),
      unclear: !!d.unclear
    };
    (Array.isArray(d.items) ? d.items : []).slice(0, 100).forEach(function (x) {
      var name = String((x && x.name) || '').trim().slice(0, 80);
      if (!name) return;
      out.items.push({ name: name, price: money(x.price), qty: money(x.qty) });
    });
    out.itemsTotal = out.items.reduce(function (a, x) { return a + (x.price || 0); }, 0);
    // 合計と品目が合っているか。ここは画面で「確かめてください」を出すために使う
    out.mismatch = !!(out.total && out.itemsTotal && out.itemsTotal > out.total * 1.05 + 1);
    return out;
  }

  /**
   * 名刺の読み取り結果を、顧客管理の欄に入れられる形にそろえる。
   * 向こうの言うことは鵜呑みにせず、こちらでも形を整える。
   */
  function normalizeCard(d) {
    d = d || {};
    var zip = String(d.zip == null ? '' : d.zip).replace(/[〒\s　]/g, '')
      .replace(/[０-９－]/g, function (c) {
        return c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      });
    // 7桁だけで来ることがあるので、区切りを入れておく
    if (/^\d{7}$/.test(zip)) zip = zip.slice(0, 3) + '-' + zip.slice(3);
    if (!/^\d{3}-\d{4}$/.test(zip)) zip = '';

    var out = {
      company: txt(d.company, 80),
      contact: txt(d.contact, 40),
      title: txt(d.title, 60),
      email: txt(d.email, 120).toLowerCase(),
      tel: tel(d.tel),
      fax: tel(d.fax),
      zip: zip,
      address: txt(d.address, 160).replace(/^〒?\s*\d{3}-?\d{4}\s*/, ''),
      url: txt(d.url, 160),
      note: txt(d.note, 300),
      confidence: clamp01(d.confidence),
      unclear: !!d.unclear
    };
    // 形になっていないアドレスは入れない。あとで照合に使うので、汚したくない
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) out.email = '';
    // 何ひとつ拾えていなければ、読めなかったものとして扱う
    out.empty = !(out.company || out.contact || out.email || out.tel || out.address);
    return out;
  }

  function txt(v, max) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 80);
  }

  /* 電話番号。全角を半角にして、区切りは書いてあるとおりに残す */
  function tel(v) {
    return txt(v, 32).replace(/[０-９－（）]/g, function (c) {
      return c === '－' ? '-' : c === '（' ? '(' : c === '）' ? ')'
        : String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/[^\d+\-()\s]/g, '').trim();
  }

  function money(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, ''));
    if (!isFinite(n)) return null;
    return Math.round(n);
  }

  function clamp01(v) {
    var n = parseFloat(v);
    return isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
  }

  /**
   * 日付をそろえる。年が抜けていたら、いちばん近い過去の年を補う。
   * 先の日付になってしまうものは1年戻す（レシートは未来には出ない）。
   */
  function fixDate(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (m) {
      var iso = m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
      return U.isISO(iso) ? notFuture(iso) : '';
    }
    // 年が無い「8/21」のような書き方
    var md = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (md) {
      var y = +U.today().slice(0, 4);
      var guess = y + '-' + pad(md[1]) + '-' + pad(md[2]);
      return U.isISO(guess) ? notFuture(guess) : '';
    }
    return '';
  }

  function notFuture(iso) {
    if (U.cmp(iso, U.today()) <= 0) return iso;
    var back = (+iso.slice(0, 4) - 1) + iso.slice(4);
    return U.isISO(back) ? back : iso;
  }

  function pad(n) { return (+n < 10 ? '0' : '') + (+n); }

  DL.receipt = {
    read: read, reread: reread, status: status, ready: ready, ask: ask,
    normalize: normalize, normalizeCard: normalizeCard, fixDate: fixDate,
    /** 名刺を読む。read の名刺版 */
    readCard: function (file, opts) {
      return read(file, Object.assign({}, opts, { kind: 'card' }));
    }
  };
})(window.DL);
