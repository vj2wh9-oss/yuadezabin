/* IndexedDB の薄いラッパー
   localStorage の 5MB 制限を外し、バックアップ世代のような大きいものを置けるようにする。
   使えない環境（プライベートモード等）では null / false を返すだけで、呼び出し側は
   localStorage のミラーで動き続けられる。 */
(function (DL) {
  'use strict';

  var NAME = 'shimekiri';
  var VERSION = 1;

  var STORES = {
    kv: { keyPath: 'k' },            // 本体データ（k:'state'）などの単票
    backups: { keyPath: 'id' }       // バックアップ世代
  };

  var dbp = null;      // Promise<IDBDatabase>
  var broken = false;  // 一度でも開けなかったら以後は諦める

  function supported() {
    try { return !!window.indexedDB; } catch (e) { return false; }
  }

  function open() {
    if (broken || !supported()) return Promise.resolve(null);
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(NAME, VERSION); } catch (e) { broken = true; resolve(null); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        Object.keys(STORES).forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, STORES[name]);
        });
      };
      req.onsuccess = function () {
        var db = req.result;
        // 別タブが新しいバージョンを開いたら、こちらは閉じて作り直す
        db.onversionchange = function () { db.close(); dbp = null; };
        resolve(db);
      };
      req.onerror = function () { broken = true; resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return dbp;
  }

  /* 1トランザクションを Promise で包む。fn(store) の戻り値のリクエスト結果を返す */
  function run(storeName, mode, fn) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var t;
        try { t = db.transaction(storeName, mode); } catch (e) { resolve(null); return; }
        var store = t.objectStore(storeName);
        var req = fn(store);
        var value = null;
        if (req) req.onsuccess = function () { value = req.result; };
        t.oncomplete = function () { resolve(value); };
        t.onerror = function () { resolve(null); };
        t.onabort = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function get(storeName, key) {
    return run(storeName, 'readonly', function (s) { return s.get(key); });
  }

  function put(storeName, value) {
    return run(storeName, 'readwrite', function (s) { return s.put(value); })
      .then(function (r) { return r !== null; });
  }

  function del(storeName, key) {
    return run(storeName, 'readwrite', function (s) { return s.delete(key); })
      .then(function () { return true; });
  }

  function all(storeName) {
    return run(storeName, 'readonly', function (s) { return s.getAll(); })
      .then(function (r) { return r || []; });
  }

  /* 中身は読まずにキーだけ。世代一覧のように本文が重いときに使う */
  function keys(storeName) {
    return run(storeName, 'readonly', function (s) { return s.getAllKeys(); })
      .then(function (r) { return r || []; });
  }

  function clear(storeName) {
    return run(storeName, 'readwrite', function (s) { return s.clear(); })
      .then(function () { return true; });
  }

  /* 使えるかどうかを一度だけ実測する（設定画面の表示用） */
  var okp = null;
  function usable() {
    if (okp) return okp;
    okp = open().then(function (db) { return !!db; });
    return okp;
  }

  /* 使用量の目安。対応していない環境では null */
  function usage() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage.estimate().then(function (e) {
      return { used: e.usage || 0, quota: e.quota || 0 };
    }).catch(function () { return null; });
  }

  DL.db = {
    supported: supported, usable: usable, usage: usage,
    get: get, put: put, del: del, all: all, keys: keys, clear: clear
  };
})(window.DL);
