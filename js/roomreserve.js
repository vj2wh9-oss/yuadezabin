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

  /** 向こうの返事をそのまま取ってくる（予定と、日付に付けたもの） */
  function fetchAll() {
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
        return {
          events: Array.isArray(b.events) ? b.events : [],
          extra: (b.extra && typeof b.extra === 'object') ? b.extra : {},
          keys: Array.isArray(b.keys) ? b.keys : []
        };
      });
    });
  }

  /** 予定だけほしいとき */
  function fetchEvents() {
    return fetchAll().then(function (b) { return b.events; });
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

  /* ---------------- 勤務種別 ----------------

     向こうにも「出社／リモート／泊まり勤務」を日付に付けてある。
     こちらに登録が無い日だけ、その勤務をこちらへ写す。
     向こうのアプリには書き戻さない（読むだけなのは予定と同じ）。

     どのキーで返ってくるかは向こう次第なので、決め打ちにしない。
     「勤務らしい名前のキー」を探し、その中身の言葉で3つに振り分ける。
     予定の題や memo までは見ない（部屋の予定に「出社」と書いてあるだけで
     勤務にされると困るため）。 */

  /* 中身の言葉で見分ける。泊まりを先に見る（「泊まり勤務」は勤務でもある） */
  var DUTY_WORDS = [
    { kind: 'stay', re: /泊|stay|overnight|宿泊/i },
    { kind: 'remote', re: /リモート|在宅|テレワーク|remote|wfh|telework/i },
    { kind: 'office', re: /出社|出勤|通勤|office|onsite|on-site|commute/i }
  ];

  /* 勤務種別が入っていそうなキーの名前 */
  var DUTY_KEY = /(duty|dutie|work ?style|work ?type|work ?kind|shift|attendance|kinmu|勤務|出勤形態|勤務形態|勤務種別)/i;

  /** 言葉から勤務を見分ける。当てはまらなければ '' */
  function dutyWord(v) {
    if (typeof v === 'number' || typeof v === 'boolean') return '';
    var s = String(v == null ? '' : v).trim();
    if (!s || s.length > 40) return '';
    for (var i = 0; i < DUTY_WORDS.length; i++) {
      if (DUTY_WORDS[i].re.test(s)) return DUTY_WORDS[i].kind;
    }
    return '';
  }

  /**
   * ひとかたまりの中から、勤務らしいキーを探して勤務を取り出す。
   * 入れ子は3段まで（それより深いものは見ない）。
   * @param {object} o
   * @param {boolean} [any] true なら、キーの名前を問わず中身の言葉だけで見る
   */
  function dutyIn(o, any, depth) {
    if (!o || typeof o !== 'object' || (depth || 0) > 3) return '';
    var keys = Object.keys(o);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = o[k];
      var looks = any || DUTY_KEY.test(k);
      if (looks) {
        var d = dutyWord(v);
        if (d) return d;
      }
      if (v && typeof v === 'object') {
        // 勤務らしいキーの中は、その先も名前を問わずに見る
        var deep = dutyIn(v, looks, (depth || 0) + 1);
        if (deep) return deep;
      }
    }
    return '';
  }

  /**
   * 向こうの返事から「日付 → 勤務」を組み立てる。
   * 予定に付いていても、日付ごとの一覧に入っていても拾えるようにする。
   * @param {object} b fetchAll の返り
   * @returns {object} {'YYYY-MM-DD': 'office'|'remote'|'stay'}
   */
  function dutiesFrom(b) {
    var out = {};
    var put = function (date, kind) {
      if (U.isISO(date) && kind && !out[date]) out[date] = kind;
    };

    // 予定に付いているとき
    (b.events || []).forEach(function (e) {
      if (!e || !U.isISO(e.date)) return;
      var d = dutyIn(e, false, 0);
      // kind そのものが勤務を表しているとき（'remote' など）
      if (!d) d = dutyWord(e.kind) && e.kind !== 'normal' ? dutyWord(e.kind) : '';
      put(e.date, d);
    });

    // 予定とは別に、日付の一覧で持っているとき
    walk(b.extra || {}, 0);
    return out;

    /* {'2026-09-10': '出社'} のような対応表と、
       [{date:'2026-09-10', workStyle:'remote'}] のような並びの両方を見る */
    function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 4) return;
      if (Array.isArray(o)) {
        o.forEach(function (x) {
          if (x && typeof x === 'object' && U.isISO(x.date)) put(x.date, dutyIn(x, false, 0));
          else walk(x, depth + 1);
        });
        return;
      }
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (U.isISO(k)) {
          put(k, typeof v === 'object' ? dutyIn(v, true, 0) : dutyWord(v));
          return;
        }
        walk(v, depth + 1);
      });
    }
  }

  /**
   * 勤務種別を、こちらに登録の無い日だけ写す。
   * @returns {{added:Array, kept:number}} added は写した日、kept は元からあった日の数
   */
  function applyDuties(map) {
    var added = [], kept = 0;
    Object.keys(map || {}).sort().forEach(function (date) {
      if (S.duty(date)) { kept++; return; }     // こちらの登録が勝つ。上書きしない
      S.setDuty(date, map[date]);
      added.push({ date: date, kind: map[date] });
    });
    return { added: added, kept: kept };
  }

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
    return fetchAll().then(function (got) {
      var raw = got.events;
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

      // 勤務種別は、こちらに登録の無い日だけ写す
      var duty = applyDuties(dutiesFrom(got));

      // 次からは同じものを見ないよう、向こうの id を控える
      S.updateRoomReserve({ lastAt: new Date().toISOString(), seen: mark });

      return {
        added: added, skipped: skipped, total: raw.length, plans: plans.length,
        duties: duty.added, dutiesKept: duty.kept
      };
    });
  }

  /** 取り込んだ結果を、ひとことにする（カレンダーと設定で同じ文言にする） */
  function pullText(r) {
    var parts = [];
    if (r.added.length) parts.push('予定 ' + r.added.length + '件（' + r.plans + '件のうち）');
    if (r.duties.length) parts.push('勤務 ' + r.duties.length + '日');
    if (parts.length) return parts.join('・') + 'を取り込みました';
    if (r.plans) return '新しい予定はありませんでした';
    return '時間の登録がありませんでした';
  }

  /** 何がどう見えているかを確かめる（設定画面用） */
  function check() {
    return fetchAll().then(function (got) {
      var map = dutiesFrom(got);
      return {
        events: got.events.length,
        keys: got.keys,
        extraKeys: Object.keys(got.extra || {}),
        duties: map,
        found: Object.keys(map).length
      };
    });
  }

  /* 取り込んだ予定に付ける名前。あとから見て出どころが分かるように */
  var TITLE = '部屋の予約';

  DL.roomreserve = {
    TITLE: TITLE,
    conf: conf, ready: ready, parseUrl: parseUrl,
    fetchEvents: fetchEvents, fetchAll: fetchAll, toPlan: toPlan, pull: pull, addMin: addMin,
    dutiesFrom: dutiesFrom, applyDuties: applyDuties, check: check, pullText: pullText
  };
})(window.DL);
