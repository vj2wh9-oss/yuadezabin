/* 家事の周期表。

   日常のカレンダーには繰り返しの予定が置けるが、家事はそれでは回らない。
   繰り返しは「決めた日に出る」ものなので、さぼった日はただ流れていき、
   次の回がまた同じ間隔でやってくる。シーツを2週間おきにしていて
   3週間さぼっても、予定表は何も言わない。

   こちらは逆に「前にやった日から数えて次」で回す。

     ・やった日を押すと、そこから周期ぶん先が次の予定になる
     ・さぼってもずれていかない（次は常に「最後にやった日＋周期」）
     ・遅れているものから順に出す

   どれくらい遅れているかは、周期に対する割合で見る。
   毎日のものが2日遅れるのと、半年のものが2日遅れるのは、重さが違うため。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  /* 先回りして出す日数。周期に対する割合で決める（長いものほど早めに出す） */
  var LEAD_RATIO = 0.15;
  var LEAD_MAX = 7;

  /* 下ごしらえ。周期は目安で、あとから直せる */
  var PRESETS = [
    { name: 'シーツを替える', every: 14, place: '寝室' },
    { name: '枕カバーを替える', every: 7, place: '寝室' },
    { name: '布団を干す', every: 21, place: '寝室' },
    { name: '風呂の排水口', every: 7, place: '風呂' },
    { name: '台所の排水口', every: 7, place: '台所' },
    { name: '換気扇', every: 90, place: '台所' },
    { name: 'エアコンのフィルター', every: 30, place: '居間' },
    { name: '冷蔵庫の中を見直す', every: 14, place: '台所' },
    { name: 'トイレの掃除', every: 7, place: 'トイレ' },
    { name: '洗濯機の槽洗浄', every: 60, place: '洗面' },
    { name: '窓を拭く', every: 90 },
    { name: '床のワックス', every: 180 },
    { name: '玄関を掃く', every: 14, place: '玄関' },
    { name: '歯ブラシを替える', every: 30, place: '洗面' },
    { name: '机まわりを片づける', every: 7, place: '仕事部屋' },
    { name: '液タブを拭く', every: 14, place: '仕事部屋' }
  ];

  function list(o) {
    o = o || {};
    var all = S.chores();
    return o.all ? all : all.filter(function (c) { return c.active !== false; });
  }

  /** 次にやる日。まだ一度もやっていなければ、始めた日から */
  function nextOn(c) {
    if (!c) return '';
    var every = Math.max(1, U.num(c.every, 1));
    var last = U.isISO(c.lastAt) ? c.lastAt : '';
    if (!last) return U.isISO(c.from) ? c.from : '';
    return U.addDays(last, every);
  }

  /** 何日ぶん先回りして出すか */
  function lead(c) {
    var every = Math.max(1, U.num(c && c.every, 1));
    return Math.min(LEAD_MAX, Math.max(0, Math.round(every * LEAD_RATIO)));
  }

  /**
   * いまどんな具合か。
   *
   * late … 遅れている日数（まだなら 0）
   * ratio … 周期に対する遅れの割合。毎日のものが2日遅れるのと、
   *         半年のものが2日遅れるのは重さが違うので、並べるときはこちらで見る
   */
  function state(c, date) {
    var today = U.isISO(date) ? date : U.today();
    var every = Math.max(1, U.num(c.every, 1));
    var on = nextOn(c);
    if (!on) {
      return { c: c, on: '', every: every, left: null, late: 0, ratio: 0,
        due: true, over: false, never: true };
    }
    var left = U.diffDays(today, on);
    var late = Math.max(0, -left);
    return {
      c: c, on: on, every: every, left: left, late: late,
      ratio: late / every,
      due: left <= lead(c),       // そろそろ、または過ぎている
      over: left < 0,             // 過ぎている
      never: !U.isISO(c.lastAt)
    };
  }

  /** 遅れている順。同じなら周期の短いものから */
  function order(a, b) {
    return (b.ratio - a.ratio)
      || U.cmp(a.on || '9999-99-99', b.on || '9999-99-99')
      || (a.every - b.every);
  }

  /** いまやるもの（そろそろ＋過ぎている）。遅れている順 */
  function due(date) {
    return list().map(function (c) { return state(c, date); })
      .filter(function (st) { return st.due; })
      .sort(order);
  }

  /** ぜんぶ。遅れている順 */
  function all(date) {
    return list().map(function (c) { return state(c, date); }).sort(order);
  }

  /** その日にやる予定のもの（カレンダーに出す） */
  function ofDay(date) {
    if (!U.isISO(date)) return [];
    return list().filter(function (c) { return nextOn(c) === date; });
  }

  function byDay(from, to) {
    var map = {};
    list().forEach(function (c) {
      var on = nextOn(c);
      if (!on || U.cmp(on, from) < 0 || U.cmp(on, to) > 0) return;
      (map[on] || (map[on] = [])).push(c);
    });
    return map;
  }

  /**
   * やった。
   *
   * 次は「やった日＋周期」になる。さぼっても間隔は縮まないし、
   * 早めにやれば次も早くなる——「前にやった日から数えて次」だから。
   */
  function done(id, date, opts) {
    var c = S.getChore(id);
    if (!c) return null;
    var on = U.isISO(date) ? date : U.today();
    var log = (c.log || []).concat([on])
      .filter(function (d, i, a) { return a.indexOf(d) === i; })
      .sort().slice(-60);
    /* ホームから押すときは描き直さない（押した行がその場から消えないように）。
       くすりのチェックと同じ考えかた */
    return S.updateChore(id, { lastAt: on, log: log }, opts);
  }

  /** やったのを取り消す（押し間違えたとき）。ひとつ前の記録に戻す */
  function undo(id) {
    var c = S.getChore(id);
    if (!c) return null;
    var log = (c.log || []).slice().sort();
    log.pop();
    return S.updateChore(id, { lastAt: log.length ? log[log.length - 1] : '', log: log });
  }

  /** 続きぐあい。決めた周期どおりに回せているか */
  function keep(c) {
    var log = (c && c.log ? c.log : []).slice().sort();
    if (log.length < 2) return null;
    var every = Math.max(1, U.num(c.every, 1));
    var gaps = [];
    for (var i = 1; i < log.length; i++) gaps.push(U.diffDays(log[i - 1], log[i]));
    var avg = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
    return {
      times: log.length, avg: Math.round(avg * 10) / 10, every: every,
      // 決めた周期より、どれだけ間があいているか
      slip: Math.round((avg - every) * 10) / 10
    };
  }

  /** ホームの警告。だいぶ遅れているものだけ（うるさくしない） */
  function alerts(date) {
    var rows = due(date).filter(function (st) {
      // 周期の半分ぶん以上あいてしまったものだけ
      return st.over && st.ratio >= 0.5;
    });
    if (!rows.length) return [];
    return [{
      level: 'info',
      href: '#/chores',
      text: '家事が ' + rows.length + '件 遅れています（'
        + rows.slice(0, 3).map(function (st) { return st.c.name; }).join('・')
        + (rows.length > 3 ? ' ほか' : '') + '）'
    }];
  }

  /** 画面の見出しに出す様子 */
  function summary(date) {
    var rows = all(date);
    return {
      all: rows.length,
      due: rows.filter(function (st) { return st.due; }).length,
      over: rows.filter(function (st) { return st.over; }).length
    };
  }

  /** 周期の言いかた */
  function everyLabel(n) {
    n = Math.max(1, U.num(n, 1));
    if (n === 1) return '毎日';
    if (n === 7) return '毎週';
    if (n === 14) return '2週間ごと';
    if (n === 30) return '毎月';
    if (n === 60) return '2ヶ月ごと';
    if (n === 90) return '3ヶ月ごと';
    if (n === 180) return '半年ごと';
    if (n === 365) return '毎年';
    return n + '日ごと';
  }

  DL.chores = {
    PRESETS: PRESETS, LEAD_MAX: LEAD_MAX,
    list: list, nextOn: nextOn, lead: lead, state: state,
    due: due, all: all, ofDay: ofDay, byDay: byDay,
    done: done, undo: undo, keep: keep,
    alerts: alerts, summary: summary, everyLabel: everyLabel
  };
})(window.DL);
