/* 天気（Open-Meteo）。登録した地点の予報を取ってきて、ホームに出す。
   鍵の要らない API なので、そのまま呼ぶ。取れないときは黙って前の値を使う。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var API = 'https://api.open-meteo.com/v1/forecast';
  var GEO = 'https://geocoding-api.open-meteo.com/v1/search';
  var REV = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
  var FRESH_MIN = 30;       // これより新しければ取り直さない
  var DAYS = 3;
  var HOURS = 12;           // 「これから」に出す時間数
  var PAST_HOURS = 24;      // さかのぼって持っておく時間数（正午の天気を写すため）

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

  /* 夜のあいだは、晴れの記号を月にする */
  var NIGHT = { wSun: 'wMoon', wSunCloud: 'wMoonCloud' };

  /**
   * @param {number} code WMO の記号
   * @param {boolean} [night] 夜なら true（現在の天気にだけ使う）
   */
  function codeInfo(code, night) {
    var c = U.num(code, -1);
    var hit = null;
    if (c >= 0) {
      for (var i = 0; i < CODES.length && !hit; i++) if (c <= CODES[i].max) hit = CODES[i];
    }
    if (!hit) return { icon: 'wUnknown', label: '—' };
    if (!night || !NIGHT[hit.icon]) return hit;
    return { icon: NIGHT[hit.icon], label: hit.label };
  }

  /* 風向き（16方位） */
  var DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
              '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  function windDir(deg) {
    var d = U.num(deg, -1);
    if (d < 0) return '';
    return DIRS[Math.round((d % 360) / 22.5) % 16];
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

  /**
   * 緯度経度から市区町村の名前を引く（現在地を登録するとき）。
   * Open-Meteo の検索は地名からしか引けないので、ここだけ別の
   * 鍵の要らない逆引き（BigDataCloud）を使う。取れなければ空を返す。
   */
  function nameOf(lat, lon) {
    var url = REV + '?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=ja';
    return fetchJSON(url).then(function (j) {
      if (!j) return '';
      // 市区町村 → 市 → 都道府県 の順に、いちばん細かいものを使う
      var name = j.locality || j.city || j.principalSubdivision || '';
      return String(name).slice(0, 40);
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
      + '&current=weather_code,temperature_2m,apparent_temperature,relative_humidity_2m,'
      + 'precipitation,wind_speed_10m,wind_direction_10m,is_day'
      + '&hourly=weather_code,temperature_2m,precipitation_probability'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,'
      + 'precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max'
      // past_hours は、その日の正午を過ぎてから開いても正午の値が残るように取っておく
      // （1日の記録に写す天気が、正午のものだと言い切れるようにするため）
      + '&timezone=auto&forecast_days=' + DAYS + '&forecast_hours=' + HOURS + '&past_hours=' + PAST_HOURS;

    busy = fetchJSON(url).then(function (j) {
      busy = null;
      var data = shape(j, p);
      if (!data) return c;
      S.updateSettings({ weatherCache: data }, { quiet: true });
      // 今日の正午の天気を、1日の記録に写しておく（記録の画面を開かない日のため）
      if (DL.daylog) DL.daylog.keepWeather(U.today());
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
        pop: U.num((d.precipitation_probability_max || [])[i], 0),
        rain: num1((d.precipitation_sum || [])[i]),
        uv: round1((d.uv_index_max || [])[i]),
        wind: num1((d.wind_speed_10m_max || [])[i]),
        sunrise: hhmm((d.sunrise || [])[i]),
        sunset: hhmm((d.sunset || [])[i])
      };
    });

    var h = j.hourly || {};
    var hours = (h.time || []).map(function (t, i) {
      return {
        time: t,
        code: U.num((h.weather_code || [])[i], -1),
        temp: round1((h.temperature_2m || [])[i]),
        pop: U.num((h.precipitation_probability || [])[i], 0)
      };
    });

    var now = j.current || {};
    return {
      at: new Date().toISOString(),
      key: keyOf(p),
      name: p.name,
      days: days,
      hours: hours,
      now: {
        code: U.num(now.weather_code, -1),
        temp: round1(now.temperature_2m),
        feels: round1(now.apparent_temperature),
        humidity: U.num(now.relative_humidity_2m, -1),
        rain: num1(now.precipitation),
        wind: num1(now.wind_speed_10m),
        dir: windDir(now.wind_direction_10m),
        night: U.num(now.is_day, 1) === 0
      }
    };
  }

  /* 小数1桁まで（降水量・風速） */
  function num1(v) {
    var n = parseFloat(v);
    return isFinite(n) ? Math.round(n * 10) / 10 : null;
  }

  function hhmm(t) {
    var m = /T(\d\d:\d\d)/.exec(String(t || ''));
    return m ? m[1] : '';
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

  /**
   * その日の正午の天気と、その日の最高・最低気温。
   * 1日を1つで言い表すとき、朝晩のにわか雨に引っ張られない正午の値を使う。
   * @returns {{code:number,max:number,min:number}|null}
   */
  function noonOf(date) {
    date = date || U.today();
    var d = dayOf(date);
    if (!d) return null;
    var c = cache();
    var noon = (c.hours || []).filter(function (h) {
      return String(h.time || '').indexOf(date + 'T12') === 0;
    })[0];
    var code = noon && U.num(noon.code, -1) >= 0 ? noon.code : d.code;
    if (U.num(code, -1) < 0) return null;
    // 記録に写す形（整数の気温）でそろえて返す。
    // ここで丸めておかないと、写した値と見比べたときに毎回ちがう扱いになる
    return { code: U.num(code, -1), max: round1(d.max), min: round1(d.min) };
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  DL.weather = {
    place: place, setPlace: setPlace, search: search, nameOf: nameOf, locate: locate,
    load: load, cache: cache, dayOf: dayOf, noonOf: noonOf, codeInfo: codeInfo,
    windDir: windDir, FRESH_MIN: FRESH_MIN
  };
})(window.DL);
