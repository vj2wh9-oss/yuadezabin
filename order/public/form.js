/* 発注フォームの動き。

   決めごと
     - 選択肢は form.json だけに書く。ここには持たない（受け口の Worker も同じものを見る）。
     - 入力したものは、送るまでどこにも残さない。localStorage も Cookie も使わない。
     - 送るのは同じサイトの /api/order だけ。ほかへは一切出さない。
     - 送ったあとは画面から消す。戻るボタンで内容が戻らないようにもする。 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var conf = null;
  var startedAt = Date.now();
  var sending = false;

  var form = $('orderForm');
  var FIELDS = ['company', 'person', 'email', 'service', 'deadline', 'format', 'note'];

  /* ---------------- 読み込み ---------------- */

  fetch('/form.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(setup)
    .catch(function () {
      $('pageLead').textContent = '';
      $('deadMsg').textContent =
        'ページを読み込めませんでした。通信の状態をお確かめのうえ、画面を再読み込みしてください。';
      $('deadPane').hidden = false;
    });

  function setup(c) {
    conf = c;
    if (c.title) { document.getElementById('pageTitle').textContent = c.title; }
    $('pageLead').textContent = c.lead || '';

    fill($('service'), c.services);
    fill($('format'), c.formats);

    var dl = c.deadline || {};
    var min = addDays(today(), num(dl.minLeadDays, 0));
    var max = addDays(today(), num(dl.maxAheadDays, 365));
    $('deadline').min = min;
    $('deadline').max = max;
    $('deadlineHint').textContent = dl.hint || '';

    var lim = c.limits || {};
    cap('company', lim.company, 100);
    cap('person', lim.person, 60);
    cap('email', lim.email, 254);
    cap('note', lim.note, 1000);

    $('formPane').hidden = false;
    startedAt = Date.now();

    if (c.turnstileSiteKey) loadTurnstile(c.turnstileSiteKey);
  }

  function fill(sel, list) {
    (list || []).forEach(function (o) {
      if (!o || !o.id) return;
      var op = document.createElement('option');
      op.value = o.id;
      op.textContent = o.label || o.id;
      sel.appendChild(op);
    });
  }

  function cap(id, v, def) {
    var n = num(v, def);
    $(id).maxLength = n;
    if (id === 'note') $('noteMax').textContent = String(n);
  }

  /* ---------------- 人かどうかの確認（Turnstile） ----------------
     鍵を入れていないときは何もしない。入れたときだけ枠を出す。
     Cloudflare の枠なので、外へお客様の入力が出ることはない。 */

  var tsToken = '';

  function loadTurnstile(siteKey) {
    window.onTurnstileOk = function (t) { tsToken = t || ''; };
    window.onTurnstileGone = function () { tsToken = ''; };

    var box = $('turnstile');
    box.dataset.sitekey = siteKey;
    box.className = 'turnstile cf-turnstile';
    box.setAttribute('data-callback', 'onTurnstileOk');
    box.setAttribute('data-expired-callback', 'onTurnstileGone');
    box.setAttribute('data-error-callback', 'onTurnstileGone');
    box.setAttribute('data-language', 'ja');

    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  /* ---------------- 入力の確認 ---------------- */

  $('note').addEventListener('input', function () {
    $('noteCount').textContent = String($('note').value.length);
  });

  FIELDS.forEach(function (id) {
    var n = $(id);
    if (n) n.addEventListener('input', function () { clearErr(id); });
    if (n) n.addEventListener('change', function () { clearErr(id); });
  });

  function clearErr(id) {
    var e = $('err-' + id);
    if (e) { e.hidden = true; e.textContent = ''; }
    var f = $(id);
    if (f && f.parentNode) f.parentNode.classList.remove('bad');
  }

  function setErr(id, msg) {
    var e = $('err-' + id);
    if (e) { e.textContent = msg; e.hidden = false; }
    var f = $(id);
    if (f && f.parentNode) f.parentNode.classList.add('bad');
  }

  /** 入力を確かめて、送る形にまとめる。だめなら null を返して印を付ける */
  function collect() {
    FIELDS.forEach(clearErr);
    $('err-form').hidden = true;

    var v = {};
    FIELDS.forEach(function (id) { v[id] = String($(id).value || '').trim(); });

    var bad = null;
    function fail(id, msg) { setErr(id, msg); if (!bad) bad = id; }

    if (!v.company) fail('company', '発注社名をご入力ください。');
    else if (v.company.length > $('company').maxLength) fail('company', '発注社名が長すぎます。');

    if (v.person.length > $('person').maxLength) fail('person', 'ご担当者名が長すぎます。');

    if (!v.email) fail('email', 'メールアドレスをご入力ください。');
    else if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v.email)) fail('email', 'メールアドレスの形をご確認ください。');
    else if (v.email.length > 254) fail('email', 'メールアドレスが長すぎます。');

    if (!has(conf.services, v.service)) fail('service', 'サービス種目をお選びください。');
    if (!has(conf.formats, v.format)) fail('format', '納品形式をお選びください。');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.deadline)) fail('deadline', '納期をお選びください。');
    else if (v.deadline < $('deadline').min) fail('deadline', $('deadline').min + ' 以降の日付をお選びください。');
    else if (v.deadline > $('deadline').max) fail('deadline', $('deadline').max + ' までの日付をお選びください。');

    if (v.note.length > $('note').maxLength) fail('note', 'ご要望が長すぎます。');

    if (bad) {
      var n = $(bad);
      n.focus();
      n.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return null;
    }

    v.website = $('website').value;                 // 自動送信よけ（人は触れない）
    v.elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (tsToken) v.turnstile = tsToken;
    return v;
  }

  function has(list, id) {
    return !!id && (list || []).some(function (o) { return o && o.id === id; });
  }

  /* ---------------- 送信 ---------------- */

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;

    var v = collect();
    if (!v) return;

    if (conf.turnstileSiteKey && !tsToken) {
      showFormErr('「あなたは人間ですか？」の確認が終わるまで少しお待ちください。');
      return;
    }

    sending = true;
    var btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = '送信しています…';

    fetch('/api/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(v),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        return { status: r.status, ok: r.ok, body: b };
      });
    }).then(function (r) {
      sending = false;
      btn.disabled = false;
      btn.textContent = 'この内容で発注する';
      resetTurnstile();

      if (r.ok && r.body && r.body.id) { finish(r.body.id, v); return; }
      showFormErr(message(r));
    }).catch(function () {
      sending = false;
      btn.disabled = false;
      btn.textContent = 'この内容で発注する';
      resetTurnstile();
      showFormErr('送信できませんでした。通信の状態をお確かめのうえ、もう一度お試しください。');
    });
  });

  function message(r) {
    var e = r.body && r.body.error;
    if (e === 'rate_limited') return '短い間に何度も送信されています。しばらく時間をおいてからお試しください。';
    if (e === 'human_check') return '人による操作の確認が取れませんでした。画面を再読み込みして、もう一度お試しください。';
    if (e === 'invalid') return 'ご入力の内容をもう一度お確かめください。' + (r.body.field ? '（' + fieldName(r.body.field) + '）' : '');
    if (r.status === 413) return 'ご入力が長すぎます。ご要望欄を短くしてお試しください。';
    return '受け付けられませんでした。お手数ですが、しばらくしてからもう一度お試しください。';
  }

  var NAMES = {
    company: '発注社名', person: 'ご担当者名', email: 'メールアドレス',
    service: 'サービス種目', deadline: '納期', format: '納品形式', note: 'ご要望'
  };
  function fieldName(k) { return NAMES[k] || k; }

  function showFormErr(msg) {
    var e = $('err-form');
    e.textContent = msg;
    e.hidden = false;
    e.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function resetTurnstile() {
    tsToken = '';
    if (window.turnstile && typeof window.turnstile.reset === 'function') {
      try { window.turnstile.reset(); } catch (err) { /* 出ていなければそのまま */ }
    }
  }

  /* ---------------- 受付後 ---------------- */

  function finish(id, v) {
    $('receiptNo').textContent = id;

    var dl = $('doneSummary');
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    row(dl, '発注社名', v.company);
    if (v.person) row(dl, 'ご担当者', v.person);
    row(dl, 'ご連絡先', v.email);
    row(dl, 'サービス種目', label(conf.services, v.service));
    row(dl, 'ご希望納期', jpDate(v.deadline));
    row(dl, '納品形式', label(conf.formats, v.format));
    if (v.note) row(dl, 'ご要望', v.note);

    // 入力欄を空にしてから隠す。戻る操作でも中身が残らないようにする
    form.reset();
    $('noteCount').textContent = '0';
    $('formPane').hidden = true;
    $('donePane').hidden = false;
    window.scrollTo(0, 0);
  }

  function row(dl, k, val) {
    var d = document.createElement('div');
    var dt = document.createElement('dt');
    var dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = val;
    d.appendChild(dt);
    d.appendChild(dd);
    dl.appendChild(d);
  }

  function label(list, id) {
    var hit = (list || []).filter(function (o) { return o.id === id; })[0];
    return hit ? hit.label : id;
  }

  $('againBtn').addEventListener('click', function () {
    $('donePane').hidden = true;
    $('formPane').hidden = false;
    startedAt = Date.now();
    window.scrollTo(0, 0);
    $('company').focus();
  });

  /* ---------------- 小物 ---------------- */

  function num(v, def) {
    var n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(iso, n) {
    var p = iso.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2] + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function jpDate(iso) {
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    var wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
    return (+p[0]) + '年' + (+p[1]) + '月' + (+p[2]) + '日(' + wd + ')';
  }
})();
