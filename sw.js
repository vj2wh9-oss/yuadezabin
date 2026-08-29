/* オフライン用のシンプルなキャッシュ（アプリ本体のみ。データは localStorage） */
var CACHE = 'shimekiri-v7';
var ASSETS = [
  './', './index.html', './assets/style.css', './manifest.webmanifest',
  './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png',
  './assets/icon-maskable-512.png', './assets/favicon-64.png',
  './js/util.js', './js/icons.js', './js/db.js', './js/store.js', './js/schedule.js', './js/documents.js', './js/ui.js', './js/forms.js',
  './js/view-home.js', './js/view-calendar.js', './js/view-projects.js',
  './js/view-detail.js', './js/view-doc.js', './js/view-sales.js', './js/view-settings.js', './js/app.js'
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
  e.respondWith(
    fetch(e.request).then(function (res) {
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
