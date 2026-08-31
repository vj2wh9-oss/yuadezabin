/* 通知。

   考え方
     「いつ・何を出すか」はぜんぶこちら側で決めて、その一覧（予定表）を
     同期サーバーへ預ける。サーバーは時刻が来たものを送るだけで、中身は
     解釈しない。こうしておくと、通知の種別を増やすときにサーバーを
     触らずに済む（KINDS に1つ足すだけ）。

   なぜサーバーが要るのか
     ブラウザのアプリは、自分で「あとで鳴らす」ことができない。
     それができる仕組み（Notification Triggers）は Safari に無く、
     サービスワーカーはタイマーを持てない（iOS に止められる）。
     アプリを閉じていても鳴らすには、外から送ってもらうしかない。

   iPhone での約束ごと
     ホーム画面に追加したアプリでのみ通知を受け取れる（Safari のタブでは不可）。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var HORIZON_DAYS = 60;     // 何日先ぶんまで先に作って預けるか
  var MAX_ITEMS = 400;

  /* ---------------- 種別ごとの作り方 ----------------
     足すときはここに1つ書く。設定画面と予定表づくりが自動でついてくる。 */

  var KINDS = {
    /* 日常の予定 */
    lifeEvent: {
      label: '日常の予定',
      note: 'カレンダーの「日常」に入れた予定を知らせます',
      // 使える鳴らし方
      whens: [
        { value: 'beforeDay', label: '前日の指定時刻' },
        { value: 'onDay', label: '当日の指定時刻' },
        { value: 'beforeMin', label: '開始の◯分前（時刻を決めた予定だけ）' }
      ],
      build: function (rule, from, to) {
        var out = [];
        var map = DL.events.byDay(from, U.addDays(to, 2));
        Object.keys(map).forEach(function (date) {
          map[date].forEach(function (o) {
            if (o.index !== 0) return;                       // またがる予定は初日だけ
            if (rule.importantOnly && !o.ev.important) return;
            if (DL.events.isDone(o)) return;                 // ホームから外したものは鳴らさない

            var at = null, lead = '';
            if (rule.when === 'beforeMin') {
              if (!o.ev.start) return;                       // 終日には効かない
              at = atLocal(date, o.ev.start, -U.num(rule.minutes, 30));
              lead = 'まもなく';
            } else if (rule.when === 'beforeDay') {
              at = atLocal(U.addDays(date, -1), rule.time || '20:00', 0);
              lead = '明日';
            } else {
              at = atLocal(date, rule.time || '08:00', 0);
              lead = '今日';
            }
            if (!at) return;
            out.push({
              id: 'ev|' + rule.id + '|' + o.ev.id + '|' + date,
              at: at,
              title: lead + '　' + o.ev.title,
              body: bodyOf(o),
              tag: 'ev-' + o.ev.id + '-' + date,
              url: '#/day/' + date
            });
          });
        });
        return out;
      }
    },

    /* 今日やること（朝のまとめ） */
    todo: {
      label: '今日やること',
      note: 'その日の案件のノルマと日常の予定を、まとめて1通で知らせます',
      whens: [{ value: 'onDay', label: '当日の指定時刻' }],
      build: function (rule, from, to) {
        var out = [];
        U.rangeDays(from, to).forEach(function (date) {
          var load = DL.schedule.loadOfDay(date);
          var plans = DL.events.ofDay(date).filter(function (o) { return !DL.events.isDone(o); });
          var n = load.entries.length + plans.length;
          if (!n) return;                                   // 何も無い日は鳴らさない
          var at = atLocal(date, rule.time || '08:00', 0);
          if (!at) return;
          var names = load.entries.map(function (e) { return e.task.name; })
            .concat(plans.map(function (o) { return o.ev.title; }));
          out.push({
            id: 'todo|' + rule.id + '|' + date,
            at: at,
            title: '今日やること ' + n + '件',
            body: names.slice(0, 4).join('、') + (names.length > 4 ? ' ほか' : ''),
            tag: 'todo-' + date,
            url: '#/home'
          });
        });
        return out;
      }
    },

    /* 案件の締切 */
    deadline: {
      label: '案件の締切',
      note: '入稿締切・納品日・即売会の当日を知らせます',
      whens: [
        { value: 'beforeDay', label: '◯日前の指定時刻' },
        { value: 'onDay', label: '当日の指定時刻' }
      ],
      build: function (rule, from, to) {
        var out = [];
        var days = Math.max(0, U.diffDays(from, to));
        var lead = rule.when === 'beforeDay' ? Math.max(1, U.num(rule.days, 3)) : 0;
        DL.schedule.timeline(from, days + lead).forEach(function (it) {
          var fire = U.addDays(it.date, -lead);
          if (U.cmp(fire, from) < 0 || U.cmp(fire, to) > 0) return;
          var at = atLocal(fire, rule.time || '09:00', 0);
          if (!at) return;
          out.push({
            id: 'dl|' + rule.id + '|' + it.project.id + '|' + it.type + '|' + it.date,
            at: at,
            title: (lead ? lead + '日後' : '今日') + '　' + it.label,
            body: it.project.title,
            tag: 'dl-' + it.project.id + '-' + it.date,
            url: '#/project/' + it.project.id
          });
        });
        return out;
      }
    }
  };

  function bodyOf(o) {
    var t = DL.events.timeText(o.ev);
    var parts = [t || '終日'];
    if (o.ev.memo) parts.push(String(o.ev.memo).split('\n')[0].slice(0, 60));
    return parts.join('　');
  }

  /**
   * その日のその時刻を、世界時の文字列にする。
   * サーバーに時差の判断をさせないため、送る前にここで直しておく。
   */
  function atLocal(date, time, offsetMin) {
    if (!U.isISO(date)) return null;
    var hm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''));
    if (!hm) return null;
    var d = U.parse(date);
    d.setHours(U.num(hm[1], 0), U.num(hm[2], 0) + U.num(offsetMin, 0), 0, 0);
    return d.toISOString();
  }

  /* ---------------- 予定表を組む ---------------- */

  /**
   * 有効な決まりごとを全部たどって、送る予定の一覧を作る。
   * @param {string} [from] 既定は今日
   * @returns {Array} [{id, at, title, body, tag, url}]
   */
  function build(from) {
    var start = from || U.today();
    var end = U.addDays(start, HORIZON_DAYS);
    var now = new Date().toISOString();
    var out = [];

    rules().forEach(function (r) {
      if (!r.active) return;
      var kind = KINDS[r.kind];
      if (!kind) return;
      var made;
      try { made = kind.build(r, start, end) || []; } catch (e) { made = []; }
      made.forEach(function (x) { if (x && x.at > now) out.push(x); });   // 過ぎたぶんは送らない
    });

    // 同じ id は1つに。時刻の早い順
    var by = {};
    out.forEach(function (x) { by[x.id] = x; });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; })
      .slice(0, MAX_ITEMS);
  }

  /* ---------------- 決まりごと（設定） ---------------- */

  function settings() {
    var n = S.settings.notify;
    return n && typeof n === 'object' ? n : { enabled: false, rules: [] };
  }
  function rules() { return (settings().rules || []).slice(); }

  function defaultRules() {
    return [
      { id: U.uid(), kind: 'lifeEvent', active: true, when: 'beforeDay', time: '20:00', importantOnly: false },
      { id: U.uid(), kind: 'lifeEvent', active: true, when: 'onDay', time: '08:00', importantOnly: false },
      { id: U.uid(), kind: 'todo', active: true, when: 'onDay', time: '08:00' }
    ];
  }

  /* ---------------- 端末の登録 ---------------- */

  function supported() {
    return typeof Notification !== 'undefined' &&
      'serviceWorker' in navigator && 'PushManager' in window;
  }

  /* iPhone は、ホーム画面に追加したアプリでしか通知を受け取れない */
  function standalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /** いま通知を使える状態か、使えないなら何が足りないか */
  function status() {
    if (!supported()) return { ok: false, why: 'この端末（ブラウザ）は通知に対応していません' };
    if (isIOS() && !standalone()) {
      return { ok: false, why: 'iPhone では、ホーム画面に追加したアプリからのみ通知を受け取れます。共有ボタン →「ホーム画面に追加」から開き直してください' };
    }
    if (Notification.permission === 'denied') {
      return { ok: false, why: '通知が拒否されています。端末の設定 → METEO365 → 通知 から許可してください' };
    }
    return { ok: true, permission: Notification.permission };
  }

  function deviceId() {
    var s = S.settings.notifyDevice || {};
    if (!s.id) {
      s.id = U.uid();
      S.updateSettings({ notifyDevice: s });
    }
    return s.id;
  }

  /**
   * 通知を許可してもらい、この端末を宛先として登録する。
   * @returns {Promise<{ok:boolean, why?:string}>}
   */
  function enable() {
    var st = status();
    if (!st.ok) return Promise.resolve(st);
    if (!DL.sync.active()) {
      return Promise.resolve({ ok: false, why: '先に「PC・iPhone の同期」を設定してください（通知は同期サーバーから送ります）' });
    }

    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') return { ok: false, why: '通知が許可されませんでした' };
      return serverKey().then(function (key) {
        if (!key) return { ok: false, why: 'サーバーに通知の鍵（VAPID）が設定されていません' };
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (cur) {
            if (cur) return cur;
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(key)
            });
          });
        }).then(function (sub) {
          return api('PUT', '/v1/push/sub', {
            sub: sub.toJSON ? sub.toJSON() : sub,
            deviceId: deviceId(),
            name: (S.settings.sync && S.settings.sync.deviceName) || ''
          });
        }).then(function () {
          S.updateSettings({ notify: Object.assign({}, settings(), { enabled: true }) });
          return sync();
        }).then(function () { return { ok: true }; });
      });
    }).catch(function (e) {
      return { ok: false, why: String((e && e.message) || e) };
    });
  }

  /** この端末を宛先から外す（他の端末はそのまま） */
  function disable() {
    return api('DELETE', '/v1/push/sub', { deviceId: deviceId() })
      .catch(function () { /* 届かなくても手元は止める */ })
      .then(function () {
        S.updateSettings({ notify: Object.assign({}, settings(), { enabled: false }) });
        if (!('serviceWorker' in navigator)) return null;
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription();
        }).then(function (sub) { return sub && sub.unsubscribe(); }).catch(function () { });
      });
  }

  /* 予定表をサーバーへ預け直す。データを直したあとに呼ぶ */
  function sync() {
    if (!settings().enabled || !DL.sync.active()) return Promise.resolve(null);
    var items = build();
    return api('PUT', '/v1/push/queue', { items: items })
      .then(function (r) { return { queued: items.length, server: r }; });
  }

  function state() { return api('GET', '/v1/push/state'); }
  function testSend() { return api('POST', '/v1/push/test'); }

  function serverKey() {
    return state().then(function (s) { return s && s.vapidPublic; })
      .catch(function () { return null; });
  }

  /* ---------------- サーバーとのやりとり ---------------- */

  function api(method, path, body) {
    var sy = S.settings.sync || {};
    if (!sy.url || !sy.token) return Promise.reject(new Error('同期の接続先が未設定です'));
    return fetch(String(sy.url).replace(/\/+$/, '') + path, {
      method: method,
      headers: Object.assign({ authorization: 'Bearer ' + sy.token },
        body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
        return j;
      });
    });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  DL.notify = {
    KINDS: KINDS, build: build, rules: rules, settings: settings, defaultRules: defaultRules,
    status: status, supported: supported, standalone: standalone,
    enable: enable, disable: disable, sync: sync, state: state, testSend: testSend,
    atLocal: atLocal
  };
})(window.DL);
