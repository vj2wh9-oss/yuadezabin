/* 同期：自分で立てた小さなAPIと、アプリのデータを1件だけやりとりする。
   合鍵と接続先は端末ごとの設定で、同期の中身には含めない（store.js の LOCAL_SETTING_KEYS）。

   考え方
     - サーバーは版番号（rev）を持つ。書くときは「自分が知っている rev」を添える。
     - 食い違えば 409。黙って上書きせず、どちらを採るかを利用者に聞く。
     - この端末に変更があるかは savedAt で見る（同期した時点の値を baseSavedAt に控える）。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var TIMEOUT = 15000;
  var MIN_GAP = 8000;      // 画面を行き来しても、これより短い間隔では走らせない
  var busy = false;
  var lastRunAt = 0;
  var pushTimer = null;
  var listeners = [];

  function on(fn) { listeners.push(fn); }
  function emit(ev) { listeners.forEach(function (f) { f(ev); }); }

  function conf() { return S.syncSettings(); }
  function ready() {
    var c = conf();
    return !!(c.url && c.token && c.token.length >= 24);
  }
  function active() { return ready() && conf().enabled; }

  /* ---------------- 通信 ---------------- */

  function req(path, opts) {
    var c = conf();
    opts = opts || {};
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT) : null;

    return fetch(String(c.url).replace(/\/+$/, '') + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ authorization: 'Bearer ' + c.token }, opts.body ? { 'content-type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
      cache: 'no-store'
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { /* JSON でなければ null のまま */ }
        return { status: res.status, ok: res.ok, body: body };
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      throw new Error(e && e.name === 'AbortError' ? '接続がタイムアウトしました' : '接続できませんでした');
    });
  }

  function meta() {
    return req('/v1/meta').then(function (r) {
      if (r.status === 401) throw new Error('合鍵が違います');
      if (!r.ok) throw new Error(errText(r));
      return r.body || { exists: false, rev: 0 };
    });
  }

  function pull() {
    return req('/v1/state').then(function (r) {
      if (r.status === 404) return null;         // サーバーにまだ何も無い
      if (r.status === 401) throw new Error('合鍵が違います');
      if (!r.ok) throw new Error(errText(r));
      return r.body;
    });
  }

  function put(force) {
    var c = conf();
    var payload = S.syncPayload();
    return req('/v1/state', {
      method: 'PUT',
      body: {
        rev: U.num(c.rev, 0), savedAt: payload.savedAt || '',
        by: c.deviceName || deviceName(), force: !!force, data: payload
      }
    }).then(function (r) {
      if (r.status === 401) throw new Error('合鍵が違います');
      if (r.status === 413) throw new Error('データが大きすぎます');
      if (r.status === 409) return { conflict: true, remote: r.body };
      if (!r.ok) throw new Error(errText(r));
      S.updateSync({ rev: r.body.rev, baseSavedAt: payload.savedAt || '', lastAt: new Date().toISOString(), lastError: '' });
      return { pushed: true, rev: r.body.rev };
    });
  }

  function errText(r) {
    var e = r.body && r.body.error;
    if (e === 'kv_not_bound') return 'サーバー側の設定が未完了です（KV が未接続）';
    if (e === 'not_found') return '接続先の URL が違うようです';
    return 'サーバーが応答しませんでした（' + r.status + '）';
  }

  /* 端末の見分け用。同期の中身ではなく、どちらが書いたかを表示するだけに使う */
  function deviceName() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'PC';
  }

  /* ---------------- 同期の本体 ---------------- */

  /**
   * 一度だけ同期する。
   * @param {object} [opts]
   * @param {boolean} [opts.silent] 画面に何も出さない（自動実行のとき）
   * @param {'local'|'remote'|'merge'} [opts.resolve] 衝突したときの決着のつけかた
   * @returns {Promise<{status:string}>}
   *   status: 'pushed' | 'pulled' | 'uptodate' | 'conflict' | 'off' | 'error'
   */
  function run(opts) {
    opts = opts || {};
    if (!active() && !opts.force) return Promise.resolve({ status: 'off' });
    if (busy) return Promise.resolve({ status: 'busy' });
    busy = true;
    lastRunAt = Date.now();
    emit({ phase: 'start' });

    return meta().then(function (m) {
      var c = conf();
      var localChanged = S.changedSinceSync();

      // サーバーが空 → こちらを置く
      if (!m.exists) return put().then(done('pushed'));

      // サーバーはこちらが最後に置いたまま
      if (Number(m.rev) === U.num(c.rev, 0)) {
        if (!localChanged) {
          S.updateSync({ lastAt: new Date().toISOString(), lastError: '' });
          return { status: 'uptodate' };
        }
        return put().then(done('pushed'));
      }

      // サーバーが進んでいる
      return pull().then(function (remote) {
        if (!remote || !remote.data) return put(true).then(done('pushed'));

        if (!localChanged) return adopt(remote).then(done('pulled'));

        // 両方に変更がある
        if (opts.resolve === 'local') return put(true).then(done('pushed'));
        if (opts.resolve === 'remote') return adopt(remote).then(done('pulled'));
        if (opts.resolve === 'merge') {
          S.mergeRemote(remote.data);
          S.updateSync({ rev: remote.rev });
          return put(true).then(done('merged'));
        }
        return { status: 'conflict', remote: remote };
      });
    }).then(function (r) {
      busy = false;
      emit({ phase: 'done', result: r });
      if (r.status === 'conflict' && !opts.silent) askConflict(r.remote);
      return r;
    }).catch(function (e) {
      busy = false;
      S.updateSync({ lastError: e.message || String(e) });
      emit({ phase: 'error', error: e });
      if (!opts.silent && DL.ui) DL.ui.toast('同期できませんでした：' + e.message, 'danger');
      return { status: 'error', error: e };
    });
  }

  function done(status) {
    return function (r) {
      if (r && r.conflict) return { status: 'conflict', remote: r.remote };
      return { status: status };
    };
  }

  /* サーバーの内容を採用する。上書きする前に控えを取る */
  function adopt(remote) {
    return S.makeBackup('before-sync', 'サーバーの内容を取り込む前').then(function () {
      S.applyRemote(remote.data);
      S.updateSync({ rev: remote.rev, baseSavedAt: S.state.savedAt || '', lastAt: new Date().toISOString(), lastError: '' });
    });
  }

  /* ---------------- 衝突したとき ---------------- */

  var conflictOpen = false;

  function askConflict(remote) {
    if (conflictOpen) return;      // 自動同期と手動が重なっても、聞くのは一度だけ
    conflictOpen = true;
    var ui = DL.ui, el = U.el;
    var rd = remote.data || {};
    var rs = rd.settings || {};

    var body = el('div', { class: 'form' }, [
      el('div', { class: 'cmp' }, [
        col('この端末', S.state.savedAt, [
          S.projects().length + '件の案件', S.allDocs().length + '件の書類',
          S.issuers().length + 'つの名義', S.clients().length + '件の取引先'
        ]),
        col('サーバー' + (remote.by ? '（' + remote.by + '）' : ''), remote.savedAt, [
          (rd.projects || []).length + '件の案件',
          (rd.projects || []).reduce(function (n, p) { return n + ((p.docs || []).length); }, 0) + '件の書類',
          (rs.issuers || []).length + 'つの名義', (rs.clients || []).length + '件の取引先'
        ])
      ]),
      el('div', { class: 'alert warn' }, [
        el('span', { class: 'alert-icon' }, ui.icon('alert', 17)),
        el('span', { text: '前回の同期のあと、両方で変更がありました。どちらを残すか選んでください。' })
      ]),
      choice('merge', '統合する', 'どちらにも無いものを足し合わせます。片方でしか触っていない案件が多いときはこれが安全です。既にあるものの中身は書き換えません。', true),
      choice('local', 'この端末を残す', 'サーバーの内容をこの端末の内容で置き換えます。もう片方の端末でした変更は消えます。'),
      choice('remote', 'サーバーを残す', 'この端末の内容をサーバーの内容で置き換えます。この端末でした変更は消えます。'),
      el('p', { class: 'muted small', text: 'どれを選んでも、いまの状態は控えとして残ります（設定 → 自動バックアップ →「控えの一覧から戻す」）。' })
    ]);

    function choice(how, label, note, primary) {
      return el('button', { class: 'choice' + (primary ? ' primary' : ''), onclick: function () { finish(how); } }, [
        el('div', {}, [
          el('strong', { text: label }),
          el('div', { class: 'muted small', text: note })
        ]),
        el('span', { class: 'chev' }, ui.icon('chevronRight', 16))
      ]);
    }

    function col(title, savedAt, lines) {
      return el('div', { class: 'cmp-col' }, [
        el('span', { class: 'cmp-t', text: title }),
        el('strong', { class: 'cmp-when', text: savedAt ? fmtAt(savedAt) : '—' }),
        el('div', { class: 'cmp-lines' }, lines.map(function (t) { return el('span', { text: t }); }))
      ]);
    }

    var close = ui.sheet({
      title: '同期がぶつかりました', body: body,
      onClose: function () { conflictOpen = false; },
      actions: [ui.btn('あとで決める', 'ghost', function () { close(); })]
    });

    function finish(how) {
      close();
      run({ resolve: how }).then(function (r) {
        if (r.status === 'error') return;
        ui.toast(how === 'merge' ? '統合しました' : how === 'local' ? 'この端末の内容に揃えました' : 'サーバーの内容に揃えました');
        DL.app.render();
      });
    }
  }

  function fmtAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return U.fmtYMDW(U.toISO(d)) + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  /* ---------------- 自動実行 ---------------- */

  /**
   * 編集が落ち着いてから送る。連打しても1回にまとめる。
   * 同期そのものも保存を伴うので、変更が無いときは何もしない
   * （ここを見ないと、送信 → 保存 → また送信、と回り続けてしまう）。
   */
  function schedulePush() {
    if (!active() || !S.changedSinceSync()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      if (!active() || !S.changedSinceSync()) return;
      run({ silent: true });
    }, 8000);
  }

  /**
   * 画面を移ったときなど「ついでに合わせておきたい」場面で呼ぶ。
   * この端末に変更があるときは必ず送り、無いときは受け取りのために
   * 一定の間隔をあけて走らせる（タブを行き来するたびに叩かないため）。
   * 画面には何も出さないが、ぶつかったときだけは選んでもらう。
   */
  function touch() {
    if (!active()) return Promise.resolve({ status: 'off' });
    if (!S.changedSinceSync() && (Date.now() - lastRunAt) < MIN_GAP) {
      return Promise.resolve({ status: 'skipped' });
    }
    return run({ silent: true }).then(function (r) {
      if (r.status === 'conflict') askConflict(r.remote);
      return r;
    });
  }

  function flush() {
    if (!active() || !S.changedSinceSync()) return Promise.resolve({ status: 'off' });
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    return run({ silent: true });
  }

  function start() {
    if (!active()) return;
    // 起動時はまず取りに行く（もう片方の端末での変更を拾う）
    run({ silent: true }).then(function (r) {
      if (r.status === 'pulled' || r.status === 'merged') DL.app.render();
      if (r.status === 'conflict') askConflict(r.remote);
    });
    S.subscribe(schedulePush);
  }

  /* 接続の確認（設定画面から） */
  function test() {
    return meta().then(function (m) {
      return { ok: true, exists: !!m.exists, rev: m.rev || 0, savedAt: m.savedAt || '', by: m.by || '' };
    }).catch(function (e) { return { ok: false, message: e.message }; });
  }

  /* 合鍵を作る（推測されない長さで） */
  function makeToken() {
    var bytes = new Uint8Array(32);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return [].map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  DL.sync = {
    ready: ready, active: active, run: run, touch: touch, flush: flush, start: start,
    test: test, makeToken: makeToken, deviceName: deviceName, on: on,
    fmtAt: fmtAt
  };
})(window.DL);
