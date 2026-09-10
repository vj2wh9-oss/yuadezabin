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
          keys: Array.isArray(b.keys) ? b.keys : [],
          tried: Array.isArray(b.tried) ? b.tried : []
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
   * @returns {object|null} {srcId, date, start, end, open, memo}
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
      min: open ? 0 : min,
      // メモには在宅の可否だけを書く。付いていなければ空のまま
      memo: homeOf(e)
    };
  }

  /* ---------------- 在宅の可否 ----------------

     向こうの予定に「けいすけの在宅可否」が付く（ok / ng）。
     こちらのメモには「在宅可能」「在宅不可」だけを書く。
     出どころは予定の名前（ROOM RESERVE）で分かるので、
     メモにそれ以上のことは入れない。 */

  var HOME_FIELDS = ['homeStatus', 'home', 'homeOk', 'stayHome', '在宅'];

  /** その1件に付いている在宅の可否。無ければ空 */
  function homeOf(e) {
    for (var i = 0; i < HOME_FIELDS.length; i++) {
      var t = homeText(e[HOME_FIELDS[i]]);
      if (t) return t;
    }
    return '';
  }

  /** ok / ng のほか、そのまま日本語で来ても読めるようにする */
  function homeText(v) {
    if (v === true) return '在宅可能';
    if (v === false) return '在宅不可';
    var s = String(v == null ? '' : v).trim();
    if (!s || s.length > 20) return '';
    // 「不可」を先に見る（「在宅不可」にも「可」の字が入っているため）
    if (/^(ng|no|false)$/i.test(s) || s.indexOf('不可') >= 0) return '在宅不可';
    if (/^(ok|yes|true)$/i.test(s) || s.indexOf('可') >= 0) return '在宅可能';
    return '';
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

  /* 中身の言葉で見分ける。泊まりを先に見る（「泊まり勤務」は勤務でもある）。
     向こう（ROOM RESERVE）は remote / overnight / office の3つを使っていて、
     画面には「リモートワーク／泊まり勤務／出勤」と出している。
     どちらの書き方でも読めるようにしてある */
  var DUTY_WORDS = [
    { kind: 'stay', re: /泊|stay|overnight|宿泊/i },
    { kind: 'remote', re: /リモート|在宅|テレワーク|remote|wfh|telework/i },
    { kind: 'office', re: /出社|出勤|通勤|office|onsite|on-site|commute/i }
  ];

  /* 勤務種別が入っていそうなキーの名前。
     向こうは日付に付ける印を dayMark と呼び、値は type に入れている。
     type / mark / kind のように短い名前も見るが、
     中身が上の言葉に当てはまらなければ勤務にはしないので、取り違えはしない */
  var DUTY_KEY = new RegExp(
    'duty|dutie|day ?mark|daymark|work ?style|work ?type|work ?kind'
    + '|shift|attendance|kinmu|勤務|出勤形態|勤務形態|勤務種別'
    + '|^type$|^mark$|^kind$|^status$', 'i');

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
      var d = dateOf(e);
      if (d) put(d, dutyIn(e, false, 0));
    });

    // 予定とは別に、日付の一覧で持っているとき
    walk(b.extra || {}, 0);
    return out;

    /* {'2026-09-10': '出社'} のような対応表と、
       [{dateKey:'2026-09-10', type:'remote'}] のような並びの両方を見る */
    function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 4) return;
      if (Array.isArray(o)) {
        o.forEach(function (x) {
          var d = dateOf(x);
          if (d) put(d, dutyIn(x, false, 0));
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

  /* その1件が指している日。向こうは dateKey と呼んでいるが、
     date で返してくるところもあるので、どちらでも読めるようにしておく */
  var DATE_FIELDS = ['dateKey', 'date', 'day', 'ymd', 'on'];

  function dateOf(x) {
    if (!x || typeof x !== 'object') return '';
    for (var i = 0; i < DATE_FIELDS.length; i++) {
      if (U.isISO(x[DATE_FIELDS[i]])) return x[DATE_FIELDS[i]];
    }
    return '';
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
   * すでにこちらにある1件を返す（無ければ null）。
   * 同じ日・同じ時刻の予定があれば「ある」とみなす
   * （手で入れていたぶんと重ならないように）。
   */
  function existing(plan, list) {
    return list.filter(function (ev) {
      return ev.date === plan.date && ev.start === plan.start
        && (!plan.end || !ev.end || ev.end === plan.end);
    })[0] || null;
  }

  /** こちらが取り込んで作った予定か。手で入れたぶんは書き替えない */
  function mine(ev) {
    return !!ev && (ev.title === TITLE || ev.title === OLD_TITLE);
  }

  /* 前の名前で入っているぶんを、新しい名前に付け替える。
     向こうから消えた予定はもう照合できないので、ここでまとめて直す。
     メモは、前に自分で入れていた決まり文句のときだけ空にする
     （あとから手で書き足したものは残す） */
  var OLD_MEMO = 'ROOM RESERVE から取り込み';

  function renameOld(list, fixed) {
    list.forEach(function (ev) {
      if (ev.title !== OLD_TITLE) return;
      var patch = { title: TITLE };
      if (String(ev.memo || '') === OLD_MEMO) patch.memo = '';
      S.updateEvent(ev.id, patch);
      ev.title = TITLE;
      if (patch.memo !== undefined) ev.memo = '';
      fixed[ev.id] = true;
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
      var added = [], skipped = 0, mark = {}, fixed = {};
      var color = conf().color;
      // 前の名前（部屋の予約）で入っているぶんを、先に付け替えておく
      renameOld(list, fixed);

      plans.forEach(function (p) {
        if (p.srcId) mark[p.srcId] = true;
        var was = existing(p, list);
        if (was) {
          /* すでに入っている。名前とメモだけ、いまの向こうに合わせ直す。
             在宅の可否は向こうであとから付くので、取り込み済みのぶんにも届くように
             （手で入れた予定は書き替えない） */
          if (mine(was) && String(was.memo || '') !== p.memo) {
            S.updateEvent(was.id, { title: TITLE, memo: p.memo });
            fixed[was.id] = true;
          }
          skipped++;
          return;
        }
        var ev = S.addEvent({
          date: p.date,
          days: 1,
          title: TITLE,
          start: p.start,
          end: p.end,
          color: color,
          memo: p.memo
        });
        list.push(ev);
        added.push(ev);
      });

      // 勤務種別は、こちらに登録の無い日だけ写す
      var duty = applyDuties(dutiesFrom(got));

      // 次からは同じものを見ないよう、向こうの id を控える
      S.updateRoomReserve({ lastAt: new Date().toISOString(), seen: mark });

      return {
        added: added, skipped: skipped, fixed: Object.keys(fixed).length,
        total: raw.length, plans: plans.length,
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
    // 新しい予定は無くても、在宅の可否が付いたぶんは書き替えている
    if (r.fixed) return '予定 ' + r.fixed + '件を今の内容に合わせました';
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
        tried: got.tried,
        duties: map,
        found: Object.keys(map).length
      };
    });
  }

  /* 取り込んだ予定に付ける名前。あとから見て出どころが分かるように。
     OLD_TITLE は前に付けていた名前。すでに入っているぶんを
     取り込み直したときに、こちらのものだと見分けて付け替える */
  var TITLE = 'ROOM RESERVE';
  var OLD_TITLE = '部屋の予約';

  DL.roomreserve = {
    TITLE: TITLE, OLD_TITLE: OLD_TITLE,
    conf: conf, ready: ready, parseUrl: parseUrl,
    fetchEvents: fetchEvents, fetchAll: fetchAll, toPlan: toPlan, pull: pull, addMin: addMin,
    dutiesFrom: dutiesFrom, applyDuties: applyDuties, check: check, pullText: pullText,
    homeText: homeText
  };
})(window.DL);
