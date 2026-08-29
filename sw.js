/* オフライン用のシンプルなキャッシュ（アプリ本体のみ。データは localStorage） */
var CACHE = 'shimekiri-v1';
var ASSETS = [
  './', './index.html', './assets/style.css', './manifest.webmanifest',
  './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png', './assets/icon.svg',
  './js/util.js', './js/store.js', './js/schedule.js', './js/ui.js', './js/forms.js',
  './js/view-home.js', './js/view-calendar.js', './js/view-projects.js',
  './js/view-detail.js', './js/view-settings.js', './js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
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
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
