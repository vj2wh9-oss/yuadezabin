/* 天気（Open-Meteo）。登録した地点の予報を取ってきて、ホームに出す。
   鍵の要らない API なので、そのまま呼ぶ。取れないときは黙って前の値を使う。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var API = 'https://api.open-meteo.com/v1/forecast';
  var GEO = 'https://geocoding-api.open-meteo.com/v1/search';
  var FRESH_MIN = 30;       // これより新しければ取り直さない
  var DAYS = 3;

  /* WMO の記号 → アイコンと呼び名 */
  var CODES = [
    { max: 0, icon: 'wSun', label: '快晴' },
    { max: 1, icon: 'wSun', label: '晴れ' },
    { max: 2, icon: 'wSunCloud', label: '晴れときどきくもり' },
    { max: 3, icon: 'wCloud2', label: 'くもり' },
    { max: 48, icon: 'wFog', label: '霧' },
    { max: 57, icon: 'wDrizzle', label: '霧雨' },
    { max: 67, icon: 'wRain', label: '雨' },
    { max: 77, icon: 'wSnow', label: '雪' },
    { max: 82, icon: 'wShower', label: 'にわか雨' },
    { max: 86, icon: 'wSnow', label: 'にわか雪' },
    { max: 99, icon: 'wThunder', label: '雷雨' }
  ];

  function codeInfo(code) {
    var c = U.num(code, -1);
    if (c < 0) return { icon: 'wUnknown', label: '—' };
    for (var i = 0; i < CODES.length; i++) if (c <= CODES[i].max) return CODES[i];
    return { icon: 'wUnknown', label: '—' };
  }

  /* ---------------- 地点 ---------------- */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function place() {
    var w = S.settings.weather;
    return (w && isNum(w.lat) && isNum(w.lon)) ? w : null;
  }

  function setPlace(o) {
    if (!o) {
      S.updateSettings({ weather: { name: '', lat: null, lon: null } });
    } else {
      S.updateSettings({ weather: {
        name: String(o.name || '').slice(0, 40),
        lat: Math.round(o.lat * 10000) / 10000,
        lon: Math.round(o.lon * 10000) / 10000
      } });
    }
    S.updateSettings({ weatherCache: null }, { quiet: true });   // 地点が変わったら前の予報は捨てる
    return place();
  }

  /* 地名を探す。Open-Meteo の検索はローマ字で当たる（表示名は日本語で返る） */
  function search(q) {
    q = String(q || '').trim();
    if (!q) return Promise.resolve([]);
    var url = GEO + '?name=' + encodeURIComponent(q) + '&count=8&language=ja&format=json';
    return fetchJSON(url).then(function (j) {
      return ((j && j.results) || []).map(function (r) {
        var area = [r.admin1, r.country].filter(Boolean).join('・');
        return {
          name: r.name, lat: r.latitude, lon: r.longitude,
          label: r.name + (area ? '（' + area + '）' : '')
        };
      });
    });
  }

  /* 緯度経度から地名を引く（現在地を登録するとき） */
  function nameOf(lat, lon) {
    var url = GEO + '?latitude=' + lat + '&longitude=' + lon + '&count=1&language=ja&format=json';
    return fetchJSON(url).then(function (j) {
      var r = (j && j.results && j.results[0]) || null;
      return r ? r.name : '';
    }).catch(function () { return ''; });
  }

  /* この端末の位置。許可されなければ失敗する */
  function locate() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error('この端末では位置を取れません')); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
        function () { reject(new Error('位置を取れませんでした（許可を確認してください）')); },
        { timeout: 10000, maximumAge: 600000 }
      );
    });
  }

  /* ---------------- 予報 ---------------- */

  function cache() {
    var c = S.settings.weatherCache;
    return (c && c.days && c.days.length) ? c : null;
  }

  function keyOf(p) { return p ? p.lat + ',' + p.lon : ''; }

  function fresh(c, p) {
    if (!c || c.key !== keyOf(p)) return false;
    var min = (Date.now() - new Date(c.at).getTime()) / 60000;
    return min >= 0 && min < FRESH_MIN;
  }

  /**
   * 予報を返す。新しければそのまま、古ければ取りに行く。
   * つながらないときは前の値を返す（消さない）。
   * @param {object} [opts] {force:true} で必ず取りに行く
   */
  var busy = null;
  function load(opts) {
    opts = opts || {};
    var p = place();
    if (!p) return Promise.resolve(null);
    var c = cache();
    if (!opts.force && fresh(c, p)) return Promise.resolve(c);
    if (busy) return busy;

    var url = API + '?latitude=' + p.lat + '&longitude=' + p.lon
      + '&current=weather_code,temperature_2m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + '&timezone=auto&forecast_days=' + DAYS;

    busy = fetchJSON(url).then(function (j) {
      busy = null;
      var data = shape(j, p);
      if (!data) return c;
      S.updateSettings({ weatherCache: data }, { quiet: true });
      return data;
    }).catch(function () {
      busy = null;
      return c;      // つながらないときは前の値のまま
    });
    return busy;
  }

  function shape(j, p) {
    var d = j && j.daily;
    if (!d || !d.time || !d.time.length) return null;
    var days = d.time.map(function (date, i) {
      return {
        date: date,
        code: U.num(d.weather_code[i], -1),
        max: round1(d.temperature_2m_max[i]),
        min: round1(d.temperature_2m_min[i]),
        pop: U.num((d.precipitation_probability_max || [])[i], 0)
      };
    });
    var now = j.current || {};
    return {
      at: new Date().toISOString(),
      key: keyOf(p),
      name: p.name,
      days: days,
      now: { code: U.num(now.weather_code, -1), temp: round1(now.temperature_2m) }
    };
  }

  function round1(v) {
    var n = parseFloat(v);
    return isFinite(n) ? Math.round(n) : null;
  }

  /* いま持っている値のうち、その日のぶん（取りに行かない） */
  function dayOf(date) {
    var c = cache();
    if (!c) return null;
    var hit = c.days.filter(function (d) { return d.date === (date || U.today()); })[0];
    return hit || null;
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  DL.weather = {
    place: place, setPlace: setPlace, search: search, nameOf: nameOf, locate: locate,
    load: load, cache: cache, dayOf: dayOf, codeInfo: codeInfo, FRESH_MIN: FRESH_MIN
  };
})(window.DL);
