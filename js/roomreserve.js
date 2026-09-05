/* ROOM RESERVE（ルームシェアの予定表）から、部屋を使う予定を取り込む。

   向こうのアプリには一切さわらない。読むだけ。
   CORS を返さないので、同期の Worker（/v1/roomreserve）に取りに行ってもらう。

   取り込むのは「時間の登録」だけ。向こうで kind が
   deadline（締切）や event（イベント）になっているものは入れない。

   一度入れたものは、向こうの予定の id を控えておいて二度は入れない。
   手で同じ日時の予定を作ってあるときも、重ねて入れない。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  var DAY = 1440;

  /* ---------------- 設定 ---------------- */

  /** 取り込み先の設定 { url, color, lastAt, seen } */
  function conf() { return S.roomReserve(); }

  /** URL を入れてあり、同期の接続先もあるか */
  function ready() { return !!parseUrl(conf().url) && DL.sync.active(); }

  /**
   * 予定表の URL から、置き場所と部屋の id を取り出す。
   * 'https://xxx.vercel.app/c/<id>' の形。読めなければ null
   */
  function parseUrl(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    var m = /\/c\/([A-Za-z0-9_-]{6,64})/.exec(u.pathname);
    if (!m) return null;
    return { base: u.origin, room: m[1] };
  }

  /* ---------------- 取りに行く ---------------- */

  function syncConf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }

  /** 向こうの予定をそのまま取ってくる */
  function fetchEvents() {
    var at = parseUrl(conf().url);
    if (!at) return Promise.reject(new Error('予定表の URL が入っていません。設定から入れてください'));
    if (!DL.sync.active()) return Promise.reject(new Error('先に「PC・iPhone の同期」を設定してください'));

    var c = syncConf();
    var url = String(c.url).replace(/\/+$/, '') + '/v1/roomreserve'
      + '?base=' + encodeURIComponent(at.base) + '&room=' + encodeURIComponent(at.room);

    return fetch(url, {
      headers: { authorization: 'Bearer ' + c.token }, cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(reason(res.status, b));
        return Array.isArray(b.events) ? b.events : [];
      });
    });
  }

  function reason(status, b) {
    var k = b && b.error;
    if (status === 404) return '同期サーバーが ROOM RESERVE に未対応です。Worker を貼り直して deploy してください';
    if (k === 'bad_room' || k === 'bad_base') return '予定表の URL を読み取れませんでした';
    if (k === 'base_not_allowed') return 'この URL の置き場所には取りに行けません';
    if (k === 'room_unreachable') return 'ROOM RESERVE につながりませんでした';
    if (k === 'room_error') return 'ROOM RESERVE が断りました（' + (b.status || '') + '）';
    if (k === 'room_not_json') return 'ROOM RESERVE の返事を読み取れませんでした';
    if (status === 401) return '合鍵が違います';
    return '取りに行けませんでした（' + status + '）';
  }

  /* ---------------- こちらの形にそろえる ---------------- */

  /**
   * 向こうの1件を、日常の予定の形にする。
   * 時間の登録でないもの（締切・イベント）は null を返す。
   * @returns {object|null} {srcId, date, start, end, open}
   */
  function toPlan(e) {
    if (!e || e.kind !== 'normal') return null;         // 締切・イベントは入れない
    if (!U.isISO(e.date)) return null;
    if (!HHMM.test(String(e.start || e.startTime))) return null;

    var start = pad(String(e.startTime || e.start));
    var min = U.num(e.durationMin, 0);
    // 長さが無いものは「13:00〜」の書き方。終わりは持たせない
    var open = !(min > 0);
    return {
      srcId: String(e.id || ''),
      date: e.date,
      start: start,
      end: open ? '' : addMin(start, min),
      open: open,
      min: open ? 0 : min
    };
  }

  /** 'H:MM' も '0H:MM' にそろえる */
  function pad(s) {
    var m = HHMM.exec(s);
    if (!m) return s;
    return (m[1].length < 2 ? '0' : '') + m[1] + ':' + m[2];
  }

  /* 24時をまたぐぶんは向こうと同じく巻き戻す（向こうの表示に合わせる） */
  function addMin(hhmm, min) {
    var p = hhmm.split(':');
    var t = ((+p[0] * 60 + +p[1] + min) % DAY + DAY) % DAY;
    return two(Math.floor(t / 60)) + ':' + two(t % 60);
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- こちらに無いものだけ入れる ---------------- */

  /** 取り込み済みとして控えてある、向こうの id */
  function seen() { return conf().seen || {}; }

  /**
   * すでにこちらにあるか。
   * 一度入れた id は控えてあるので、それで見る。
   * 控えの無いものも、同じ日・同じ時刻の予定があれば「ある」とみなす
   * （手で入れていたぶんと重ならないように）。
   */
  function have(plan, list) {
    if (plan.srcId && seen()[plan.srcId]) return true;
    return list.some(function (ev) {
      return ev.date === plan.date && ev.start === plan.start
        && (!plan.end || !ev.end || ev.end === plan.end);
    });
  }

  /**
   * 向こうの予定を、こちらに無いものだけ足す。
   * @returns {Promise<{added:Array, skipped:number, total:number, plans:number}>}
   */
  function pull() {
    return fetchEvents().then(function (raw) {
      var plans = [];
      raw.forEach(function (e) {
        var p = toPlan(e);
        if (p) plans.push(p);
      });

      var list = S.events();
      var added = [], skipped = 0, mark = {};
      var color = conf().color;

      plans.forEach(function (p) {
        if (have(p, list)) { skipped++; if (p.srcId) mark[p.srcId] = true; return; }
        var ev = S.addEvent({
          date: p.date,
          days: 1,
          title: TITLE,
          start: p.start,
          end: p.end,
          color: color,
          memo: 'ROOM RESERVE から取り込み'
        });
        list.push(ev);
        added.push(ev);
        if (p.srcId) mark[p.srcId] = true;
      });

      // 次からは同じものを見ないよう、向こうの id を控える
      S.updateRoomReserve({ lastAt: new Date().toISOString(), seen: mark });

      return { added: added, skipped: skipped, total: raw.length, plans: plans.length };
    });
  }

  /* 取り込んだ予定に付ける名前。あとから見て出どころが分かるように */
  var TITLE = '部屋の予約';

  DL.roomreserve = {
    TITLE: TITLE,
    conf: conf, ready: ready, parseUrl: parseUrl,
    fetchEvents: fetchEvents, toPlan: toPlan, pull: pull, addMin: addMin
  };
})(window.DL);
