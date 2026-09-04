/* オフライン用のシンプルなキャッシュ（アプリ本体のみ。データは localStorage） */
var CACHE = 'shimekiri-v66';
var ASSETS = [
  './', './index.html', './assets/style.css', './manifest.webmanifest',
  './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png',
  './assets/icon-maskable-512.png', './assets/favicon-64.png',
  './js/util.js', './js/icons.js', './js/db.js', './js/store.js', './js/schedule.js', './js/events.js', './js/holidays.js', './js/notify.js', './js/search.js', './js/documents.js', './js/fanbox.js', './js/weather.js', './js/daylog.js', './js/timeblocks.js', './js/expenses.js', './js/stock.js', './js/crop.js', './js/ocr.js', './js/sync.js', './js/zip.js', './js/files.js', './js/receipt.js', './js/ui.js', './js/forms.js',
  './js/view-home.js', './js/view-calendar.js', './js/view-events.js', './js/view-daylog.js', './js/view-time.js', './js/view-projects.js',
  './js/view-detail.js', './js/view-doc.js', './js/view-sales.js', './js/view-books.js', './js/view-receipt.js', './js/view-files.js', './js/view-stock.js', './js/view-onsite.js', './js/view-search.js', './js/view-settings.js', './js/app.js',
  // FANBOX のページで動かすスクリプト（設定画面がこれを読んで組み立てる）
  './tools/fanbox-collect.js'
];

self.addEventListener('install', function (e) {
  // 1つでも取得に失敗するとインストール全体が失敗するため、個別に登録する
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ASSETS.map(function (url) {
        return c.add(url).catch(function () { /* 取得できないものは後で取りに行く */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// ネットワーク優先・失敗時はキャッシュ（更新を取りこぼさないため）
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  // GitHub Pages は max-age=600 を返すため、そのまま fetch すると
  // 10分間ブラウザのHTTPキャッシュが返り、更新しても古い画面のままになる。
  // 毎回サーバーに確認しに行く（中身が同じなら 304 で軽く済む）。
  var fresh;
  try {
    fresh = new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
  } catch (err) {
    fresh = e.request;
  }

  e.respondWith(
    fetch(fresh).then(function (res) {
      // リダイレクトや部分応答はキャッシュに入れない
      if (!res || res.status !== 200 || res.type !== 'basic') return res;
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});

/* ---------------- 通知 ---------------- */

// サーバーから届いた通知を出す
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'METEO365', body: (e.data && e.data.text()) || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'METEO365', {
    body: d.body || '',
    tag: d.tag || 'meteo365',
    renotify: false,
    icon: './assets/icon-192.png',
    badge: './assets/favicon-64.png',
    data: { url: d.url || '#/home' }
  }));
});

// 通知を押したら、その画面を開く（すでに開いていればそこへ移す）
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var hash = (e.notification.data && e.notification.data.url) || '#/home';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
        if ('navigate' in c) c.navigate(c.url.split('#')[0] + hash).catch(function () {});
        return c.focus();
      }
    }
    return self.clients.openWindow('./' + hash);
  }));
});
