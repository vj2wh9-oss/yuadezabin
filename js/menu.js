/* 今日あと使える金額から、自炊の献立を考えてもらう。

   鍵はアプリ側に持たない。Worker の secret にだけ置いてあり、
   こちらは「この予算で考えて」と頼んで JSON を受け取るだけ。
   （レシート読み取りや名刺と同じ道） */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var SLOTS = [
    { value: 'lunch', label: '昼ごはん' },
    { value: 'dinner', label: '晩ごはん' }
  ];
  var SLOT_LABEL = { lunch: '昼ごはん', dinner: '晩ごはん' };

  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }

  /** 頼める状態か（同期の接続先が入っているか） */
  function ready() { return !!(base() && conf().token); }

  function reason(status, body) {
    var k = body && body.error;
    if (status === 401) return '合鍵が違います';
    if (k === 'no_api_key') {
      return 'サーバー側に OpenAI の鍵がありません。Worker に OPENAI_API_KEY を入れてください';
    }
    if (k === 'no_budget') return '今日の予算が決まっていません';
    if (k === 'no_slots') return 'どの食事にするか選んでください';
    if (k === 'openai_error') return 'OpenAI が断りました：' + (body.message || '');
    if (k === 'openai_unreachable') return 'OpenAI につながりませんでした';
    if (k === 'openai_empty') return 'OpenAI が中身を返しませんでした';
    if (k === 'not_json') return '返事が JSON になっていません';
    if (status === 404) {
      return 'サーバー側が未対応です。Cloudflare の Worker を最新にして deploy し直してください';
    }
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  /* いまの季節。旬のものを使ってもらう手がかり */
  function season(date) {
    var m = U.num(String(date || U.today()).slice(5, 7), 0);
    if (m >= 3 && m <= 5) return '春';
    if (m >= 6 && m <= 8) return '夏';
    if (m >= 9 && m <= 11) return '秋';
    return '冬';
  }

  /* 献立を頼むときに渡す残り物。期限の切れたものは食べないので外す */
  function useLeftovers(date) {
    var d = U.isISO(date) ? date : U.today();
    return S.leftovers().filter(function (x) {
      return x.name && !S.foodExpired(x, d);
    }).slice(0, 12).map(function (x) {
      return { name: x.name, qty: S.foodQty(x), until: x.until, kept: !!x.kept };
    });
  }

  /**
   * 献立を考えてもらう。
   * @param {object} o {budget, slots:['lunch','dinner'], servings:1|2, avoid:[名前], date}
   * @returns {Promise<object>} 正規化した献立
   */
  function suggest(o) {
    o = o || {};
    if (!ready()) {
      return Promise.reject(new Error('同期の接続先が未設定です。設定から先につないでください'));
    }
    var budget = Math.max(0, Math.round(U.num(o.budget, 0)));
    if (!budget) return Promise.reject(new Error('今日の予算が決まっていません'));
    // 押した順ではなく、1日の順（昼→晩）にそろえる
    var order = ['lunch', 'dinner'];
    var slots = order.filter(function (s) { return (o.slots || []).indexOf(s) >= 0; });
    if (!slots.length) return Promise.reject(new Error('どの食事にするか選んでください'));

    return fetch(base() + '/v1/menu', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        budget: budget,
        slots: slots,
        servings: U.num(o.servings, 1) === 2 ? 2 : 1,
        // 同じものばかり出ないよう、最近のぶんを渡す
        avoid: (o.avoid || []).concat(S.recentMenuNames(14)).slice(0, 12),
        // 残り物は先に食べたいので渡す（調味料のほうは献立に効かせない）
        leftovers: useLeftovers(o.date),
        season: season(o.date)
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(reason(res.status, b));
        var m = S.normalizeMenu(Object.assign({}, b.data, {
          servings: U.num(o.servings, 1), budget: budget
        }));
        if (!m.meals.length) throw new Error('献立を組み立てられませんでした');
        return m;
      });
    }, function () {
      throw new Error('通信できませんでした');
    });
  }

  /* ---- 家にある調味料と、献立で使う調味料の突き合わせ ----

     呼び方は献立ごとにぶれる（しょうゆ／醤油、油／サラダ油）ので、
     よくある言い換えだけまとめて、同じものとして数える。 */

  var SAME = [
    ['しょうゆ', '醤油', 'しょう油', '濃口しょうゆ', '薄口しょうゆ'],
    ['みそ', '味噌', 'みそ（合わせ）', '合わせみそ'],
    ['砂糖', 'さとう', '上白糖', 'グラニュー糖'],
    ['塩', 'しお', '食塩', '粗塩'],
    ['こしょう', '胡椒', 'コショウ', '黒こしょう', 'ブラックペッパー'],
    ['みりん', '味醂', 'みりん風調味料'],
    ['酒', '料理酒', '日本酒', '清酒'],
    ['酢', 'お酢', '米酢', '穀物酢'],
    ['ごま油', '胡麻油'],
    ['オリーブオイル', 'オリーブ油'],
    ['サラダ油', '食用油', '植物油', '油'],
    ['だしの素', '和風だし', '顆粒だし', 'ほんだし', 'だし']
  ];
  // 長い言い方から先に当てる（「ごま油」を「油」と取り違えないため）
  var WORDS = [];
  SAME.forEach(function (g) {
    g.forEach(function (w) { WORDS.push({ w: w, to: g[0] }); });
  });
  WORDS.sort(function (a, b) { return b.w.length - a.w.length; });

  /** 突き合わせ用の呼び名にそろえる */
  function key(name) {
    var n = String(name || '').replace(/[\s　]/g, '');
    for (var i = 0; i < WORDS.length; i++) {
      if (n === WORDS[i].w || n.indexOf(WORDS[i].w) >= 0) return WORDS[i].to;
    }
    return n;
  }

  /* 家にある調味料を、呼び名ごとに1つにまとめる（期限の遠いほうを残す） */
  function pantryMap() {
    var map = {};
    S.pantry().forEach(function (x) {
      var k = key(x.name);
      var cur = map[k];
      if (!cur) { map[k] = x; return; }
      // 期限を決めていないものがいちばん強い
      if (!x.until) map[k] = x;
      else if (cur.until && U.cmp(x.until, cur.until) > 0) map[k] = x;
    });
    return map;
  }

  /**
   * その調味料が家にあるか
   * @returns {'ok'|'none'|'expired'}
   */
  function seasoningState(name, date, map) {
    var own = (map || pantryMap())[key(name)];
    if (!own) return 'none';
    return S.foodExpired(own, date) ? 'expired' : 'ok';
  }

  /**
   * 献立で使う調味料のうち、買い足すもの。
   * 家に無いものと、期限の切れたもの。どちらも予算には数えない。
   * @returns {Array} [{name, qty, state:'none'|'expired', tag}]
   */
  function extras(m, date) {
    var map = pantryMap();
    var seen = {}, out = [];
    ((m && m.meals) || []).forEach(function (meal) {
      (meal.dishes || []).forEach(function (d) {
        (d.seasonings || []).forEach(function (s) {
          var k = key(s.name);
          if (seen[k]) return;
          seen[k] = true;
          var st = seasoningState(s.name, date, map);
          if (st === 'ok') return;
          var own = map[k];
          out.push({
            name: (own && own.name) || s.name,
            qty: st === 'expired' ? S.foodQty(own) : (s.qty || ''),
            state: st,
            tag: st === 'expired' ? '期限切れ' : '家にない'
          });
        });
      });
    });
    return out;
  }

  /** その献立の呼び名を並べたもの（「別のを出す」で避けるため） */
  function namesOf(m) {
    return ((m && m.meals) || []).map(function (x) { return x.name; })
      .filter(function (s) { return s; });
  }

  /** '昼ごはん・晩ごはん' */
  function slotsLabel(m) {
    return ((m && m.meals) || []).map(function (x) { return SLOT_LABEL[x.slot] || ''; })
      .filter(Boolean).join('・');
  }

  DL.menu = {
    SLOTS: SLOTS, SLOT_LABEL: SLOT_LABEL,
    ready: ready, suggest: suggest, namesOf: namesOf, slotsLabel: slotsLabel, season: season,
    extras: extras, seasoningState: seasoningState, pantryMap: pantryMap,
    useLeftovers: useLeftovers, key: key
  };
})(window.DL);
