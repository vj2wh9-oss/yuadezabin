/* 筋トレ。体づくりの計画と記録。

   考え方
     計画を考えるのは OpenAI（Worker 経由。鍵はこちらに持たない）。
     ただし「次に何キロ持つか」は、こちらで数えて決める。
     やった・やらなかったの記録から出る話なので、毎回聞くまでもないし、
     聞くたびに答えが揺れても困る。向こうには、こちらで数えた
     いまの重さと、直近の記録を渡して、その上で組んでもらう。

   進め方（漸進性過負荷）
     決めた回数を全部こなせた　→ 次は少し重くする（上半身 +2.5kg／下半身 +5kg）
     半分もこなせなかった　　　→ 5% 落として、同じ重さでもう一度
     どちらでもない　　　　　　→ 据え置き
   自重の種目は重さの代わりに回数を伸ばす。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  /* 上半身は刻みを小さく、下半身は大きく。ダンベルは 2.5kg 刻みが多い */
  var STEP_UPPER = 2.5;
  var STEP_LOWER = 5;
  var LOWER = /スクワット|レッグ|デッドリフト|ヒップ|カーフ|ランジ|ブルガリアン/;

  /* 有酸素の種類 */
  var CARDIO = [
    { value: 'ラン', label: 'ラン（外）' },
    { value: 'トレッドミル', label: 'トレッドミル' },
    { value: 'バイク', label: 'バイク' },
    { value: 'ウォーク', label: '早歩き' }
  ];

  /* 小数の読み取り。U.num は整数に丸めるので、kg や km には使えない */
  function dec(v, def) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (def === undefined ? 0 : def);
  }

  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }

  /** 計画を頼める状態か（同期の接続先が入っているか） */
  function ready() { return !!(base() && conf().token); }

  function reason(status, body) {
    var k = body && body.error;
    if (status === 401) return '合鍵が違います';
    if (k === 'no_api_key') {
      return 'サーバー側に OpenAI の鍵がありません。Worker に OPENAI_API_KEY を入れてください';
    }
    if (k === 'openai_error') return 'OpenAI が断りました：' + (body.message || '');
    if (k === 'openai_unreachable') return 'OpenAI につながりませんでした';
    if (k === 'openai_empty') return 'OpenAI が中身を返しませんでした';
    if (k === 'not_json') return '返事が JSON になっていません';
    if (status === 404) {
      return 'サーバー側が未対応です。Cloudflare の Worker を最新にして deploy し直してください';
    }
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  /* ---------------- 体の数字 ---------------- */

  /** BMI。身長を入れていなければ 0 */
  function bmi(kg, cm) {
    var h = dec(cm, 0) / 100;
    if (!(h > 0) || !(dec(kg, 0) > 0)) return 0;
    return Math.round(dec(kg, 0) / (h * h) * 10) / 10;
  }

  /**
   * 体重の動き。
   * @param {number} [days] 何日ぶんを見るか（既定 28）
   * @returns {{now,first,diff,perWeek,n,min,max,rows}|null}
   */
  function trend(days) {
    var list = S.fitWeights();
    if (!list.length) return null;
    var from = U.addDays(U.today(), -(U.num(days, 28)));
    var rows = list.filter(function (w) { return U.cmp(w.date, from) >= 0; })
      .slice().sort(function (a, b) { return U.cmp(a.date, b.date); });
    if (!rows.length) rows = [list[0]];
    var now = rows[rows.length - 1], first = rows[0];
    var span = Math.max(1, U.diffDays(first.date, now.date));
    var diff = Math.round((now.kg - first.kg) * 10) / 10;
    return {
      now: now, first: first, n: rows.length,
      diff: diff,
      perWeek: Math.round(diff / span * 7 * 100) / 100,
      min: Math.min.apply(null, rows.map(function (w) { return w.kg; })),
      max: Math.max.apply(null, rows.map(function (w) { return w.kg; })),
      rows: rows
    };
  }

  /* ---------------- 進め方 ---------------- */

  /** その種目の刻み（kg） */
  function step(name) { return LOWER.test(String(name || '')) ? STEP_LOWER : STEP_UPPER; }

  /**
   * 1種目ぶんの出来ぐあいを見て、次の重さを決める。
   * @param {object} planItem 計画（sets, reps, weight）
   * @param {object} logItem  記録（sets:[{reps,weight}]）
   * @returns {{kg:number, why:string}} 次に持つ重さ
   */
  function nextWeight(planItem, logItem) {
    var want = repsGoal(planItem && planItem.reps);
    var sets = (logItem && logItem.sets) || [];
    var used = sets.length ? sets[sets.length - 1].weight : dec(planItem && planItem.weight, 0);
    if (!sets.length) return { kg: used, why: '記録がないので据え置き' };
    var full = sets.filter(function (s) { return s.reps >= want && want > 0; }).length;
    if (!used) {
      // 自重の種目。重さは動かさず、回数を伸ばす
      return { kg: 0, why: full >= sets.length ? '次は回数を1つ増やす' : '同じ回数でもう一度' };
    }
    if (want > 0 && full >= sets.length) {
      return { kg: Math.round((used + step(planItem.name)) * 10) / 10,
        why: '全セット達成。+' + step(planItem.name) + 'kg' };
    }
    if (full * 2 < sets.length) {
      return { kg: Math.round(used * 0.95 * 2) / 2, why: '届かなかったので 5% 下げる' };
    }
    return { kg: used, why: '据え置き' };
  }

  /** '8-12' → 12（上の数を目標にする）。'10' → 10 */
  function repsGoal(reps) {
    var m = String(reps || '').match(/(\d+)\s*[-〜~]\s*(\d+)/);
    if (m) return U.num(m[2], 0);
    var n = String(reps || '').match(/(\d+)/);
    return n ? U.num(n[1], 0) : 0;
  }

  /**
   * 記録を入れたあと、種目ごとの「いまの重さ」を進める。
   * @param {string} date
   * @returns {Array<{name,from,to,why}>} 変わったもの
   */
  function applyProgress(date) {
    var plan = S.fitPlan(date), log = S.fitLog(date);
    if (!plan || !log || log.done === 'skip') return [];
    var out = [];
    plan.items.forEach(function (pi) {
      var li = log.items.filter(function (x) { return x.name === pi.name; })[0];
      if (!li || !li.sets.length) return;
      var next = nextWeight(pi, li);
      if (!next.kg) return;
      var before = S.fitLoad(pi.name);
      if (before === next.kg) return;
      S.setFitLoad(pi.name, next.kg);
      out.push({ name: pi.name, from: before, to: next.kg, why: next.why });
    });
    return out;
  }

  /* ---------------- 続きぐあい ---------------- */

  /**
   * ここ何週かの通いぐあい。
   * @param {number} [weeks]
   * @returns {{gym:number, run:number, planned:number, done:number, rate:number, streak:number}}
   */
  function recent(weeks) {
    var w = Math.max(1, U.num(weeks, 4));
    var from = U.addDays(U.today(), -(w * 7 - 1));
    var plans = S.fitPlans(), logs = S.fitLogs();
    var planned = 0, done = 0, gym = 0, run = 0;
    U.rangeDays(from, U.today()).forEach(function (d) {
      var p = plans[d], l = logs[d];
      if (p && p.kind !== 'rest') planned++;
      if (!l || l.done === 'skip') return;
      done++;
      if (l.cardio && (l.cardio.distance || l.cardio.minutes)) run++;
      if (l.items.length) gym++;
    });
    return {
      gym: gym, run: run, planned: planned, done: done,
      rate: planned ? Math.round(done / planned * 100) : 0,
      streak: streak()
    };
  }

  /** 今日から さかのぼって、計画どおりに動けている連続日数（休みの日は途切れない） */
  function streak() {
    var plans = S.fitPlans(), logs = S.fitLogs();
    var n = 0, d = U.today();
    for (var i = 0; i < 120; i++) {
      var p = plans[d], l = logs[d];
      if (p && p.kind !== 'rest') {
        if (!l || l.done === 'skip') {
          // 今日はまだこれからなので、途切れとは数えない
          if (d !== U.today()) break;
        } else n++;
      }
      d = U.addDays(d, -1);
    }
    return n;
  }

  /** 直近の記録を、頼むときに渡せる形で（新しい順） */
  function history(n) {
    var logs = S.fitLogs(), plans = S.fitPlans();
    return Object.keys(logs).sort().reverse().slice(0, U.num(n, 8)).map(function (d) {
      var l = logs[d], p = plans[d];
      return {
        date: d,
        title: (p && p.title) || '',
        done: l.done,
        minutes: l.minutes,
        rpe: l.rpe,
        items: l.items.slice(0, 10).map(function (i) {
          return {
            name: i.name,
            sets: i.sets.map(function (s) { return s.weight + 'kg×' + s.reps; }).join(' ')
          };
        }),
        cardio: l.cardio ? (l.cardio.kind + ' ' + (l.cardio.distance || 0) + 'km '
          + (l.cardio.minutes || 0) + '分') : '',
        memo: l.memo
      };
    });
  }

  /* ---------------- 計画を頼む ---------------- */

  /**
   * 何日ぶんかの計画を作ってもらう。
   * @param {object} o {from, days, note}
   * @returns {Promise<{plans:Array, advice:string, model:string}>}
   */
  function plan(o) {
    o = o || {};
    if (!ready()) {
      return Promise.reject(new Error('同期の接続先が未設定です。設定から先につないでください'));
    }
    var pr = S.fit().profile;
    var w = S.latestWeight();
    var from = U.isISO(o.from) ? o.from : U.today();
    var days = Math.min(14, Math.max(1, U.num(o.days, 7)));

    return fetch(base() + '/v1/fit/plan', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: from,
        days: days,
        // どの曜日にジムへ行くか（0=日）。決めていればその日に入れてもらう
        weekdays: pr.weekdays,
        profile: {
          height: pr.height, age: pr.age, sex: pr.sex,
          weight: w ? w.kg : 0,
          fat: w && w.fat ? w.fat : 0,
          goalWeight: pr.goalWeight,
          goal: pr.goal, level: pr.level,
          gym: pr.gym, minutes: pr.minutes, daysPerWeek: pr.days,
          note: pr.note
        },
        trend: trend(28),
        recent: recent(4),
        // 種目ごとの、いまの重さ。これを土台に組んでもらう
        loads: Object.keys(S.fitLoads()).map(function (k) {
          return { name: k, kg: S.fitLoads()[k].kg };
        }).slice(0, 40),
        history: history(8),
        want: String(o.note || '').slice(0, 400)
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(reason(res.status, b));
        var data = (b && b.data) || {};
        return {
          plans: (data.days || []).map(function (d) { return d; }),
          advice: String(data.advice || ''),
          model: b.model || ''
        };
      });
    }, function () {
      throw new Error('通信できませんでした');
    });
  }

  /**
   * 受け取った計画を、その日付に置く。
   * @param {Array} days [{date,kind,title,...}]
   * @param {object} [opts] {overwrite:true で、すでにある日も置き換える}
   * @returns {number} 置いた数
   */
  function adopt(days, opts) {
    opts = opts || {};
    var n = 0;
    (days || []).forEach(function (d) {
      if (!d || !U.isISO(d.date)) return;
      if (!opts.overwrite && S.fitPlan(d.date)) return;
      // 記録を入れ終えた日は、あとから計画で上書きしない
      if (S.fitLog(d.date)) return;
      if (S.putFitPlan(d.date, d)) n++;
    });
    return n;
  }

  /* ---------------- 体重の取り込み（Eufy） ----------------

     iPhone のブラウザから体重計へ直につなぐ道は無い（Web Bluetooth が無い）。
     そこで、PC やラズパイで動かす小さなスクリプト（tools/eufy-weight.py）が
     体重計から読んで Worker へ投げ、アプリはそれを取りに行く。
     取り込んだぶんはサーバーから消すので、二度入らない。 */

  /**
   * 預かっているぶんを取り込む。
   * @param {object} [opts] {quiet:true} で、預かりが空でも黙って終わる
   */
  function pull(opts) {
    if (!ready()) return Promise.resolve({ added: 0, skipped: 0, off: true });
    return fetch(base() + '/v1/inbox/weights', {
      headers: { authorization: 'Bearer ' + conf().token }
    }).then(function (res) {
      if (res.status === 404) return { items: [], off: true };
      if (!res.ok) throw new Error('取りに行けませんでした（' + res.status + '）');
      return res.json();
    }).then(function (b) {
      var list = (b && b.items) || [];
      var added = 0, skipped = 0;
      list.forEach(function (x) {
        if (S.putWeight({ date: x.date, kg: x.kg, fat: x.fat, muscle: x.muscle, from: 'eufy' })) added++;
        else skipped++;
      });
      if (!list.length) return { added: 0, skipped: 0, off: !!b.off };
      // 取り込めたら、預かってもらっていたぶんは片づける
      return fetch(base() + '/v1/inbox/weights', {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer ' + conf().token,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ ids: list.map(function (x) { return x.id; }) })
      }).catch(function () { /* 消せなくても、同じ日は上書きなので増えない */ })
        .then(function () { return { added: added, skipped: skipped }; });
    });
  }

  /* 画面を開いたときの、そっとした取り込み。
     ショートカットが朝のうちに預けてくれたぶんを、開いた拍子に入れる。
     何度も叩かないよう、しばらくは控える */
  var pulledAt = 0;

  function autoPull() {
    if (!ready()) return Promise.resolve({ added: 0 });
    if (Date.now() - pulledAt < 120000) return Promise.resolve({ added: 0 });
    pulledAt = Date.now();
    // 預かっているぶん（ショートカット・体重計のスクリプト）と、Fitbit の両方
    return Promise.all([
      pull({ quiet: true }).catch(function () { return { added: 0 }; }),
      fitbit.pull(30).catch(function () { return { added: 0 }; })
    ]).then(function (r) {
      return { added: (r[0].added || 0) + (r[1].added || 0) };
    });
  }

  /** ショートカットに入れる送り先 */
  function postUrl() { return base() ? base() + '/v1/inbox/weight' : ''; }

  /* 受け口が生きているか、そっと確かめる。
     ショートカットが通らないときの切り分けに使う。
     見に行くだけなので、押しても何も書き換わらない。
     まず入口（/）で Worker の品ぞろえを見て、そのあと合鍵を試す。
     返り {ok, kind, text}
       noconf … 同期の接続先がまだ
       net   … そもそも届かない
       auth  … 合鍵が違う
       old   … Worker が古くて体重の受け口が無い
       ok    … 通っている（held に預かり件数） */
  function checkInbox() {
    if (!ready()) {
      return Promise.resolve({ ok: false, kind: 'noconf',
        text: '同期の接続先がまだ入っていません。設定 → 同期で、Worker の URL と合鍵を入れてください。' });
    }
    var netErr = { ok: false, kind: 'net',
      text: '届きませんでした。設定 → 同期の URL が合っているか、'
        + '通信が生きているか確かめてください。' };

    /* 入口は合鍵が要らない。ここで Worker の品ぞろえが分かる */
    return fetch(base() + '/').then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) {
          return { ok: false, kind: 'net',
            text: 'サーバーが応答しませんでした（' + res.status + '）。' };
        }
        var list = (b && b.endpoints) || [];
        if (list.indexOf('/v1/inbox/weights') < 0) {
          return { ok: false, kind: 'old',
            text: 'Worker に体重の受け口がまだありません。パソコンで '
              + '「git pull && bash sync/setup.sh」を通して、Worker を新しくしてください。'
              + 'ショートカットが通らないのは、たいていこれです。' };
        }
        return fetch(base() + '/v1/inbox/weights', {
          headers: { authorization: 'Bearer ' + conf().token }
        }).then(function (r2) {
          if (r2.status === 401) {
            return { ok: false, kind: 'auth',
              text: '合鍵が違うと言われました（401）。ショートカットのヘッダに入れた合鍵と、'
                + '設定 → 同期の合鍵が同じか確かめてください。' };
          }
          if (!r2.ok) {
            return { ok: false, kind: 'net',
              text: '受け口が断りました（' + r2.status + '）。' };
          }
          return r2.json().catch(function () { return {}; }).then(function (box) {
            var n = U.num(box && box.count, 0);
            return { ok: true, kind: 'ok', held: n,
              text: '受け口は生きています。'
                + (n ? 'いま ' + n + '件 預かっています。' : 'いま預かっているぶんはありません。')
                + 'ここまで来ていれば、あとはショートカット側の作りだけです。' };
          });
        }, function () { return netErr; });
      });
    }, function () { return netErr; });
  }

  /* ---------------- Fitbit ----------------

     Eufy の体重計は EufyLife から Fitbit へ同期できる。
     そこまで行っていれば、あとは Worker が Fitbit から読むだけでよい。
     iPhone で何かを動かす必要も、体重計のそばに機械を置く必要もない。
     鍵とつなぎの控えは Worker 側（KV）にあって、この端末には何も残らない。 */

  function fbApi(path, init) {
    if (!ready()) return Promise.reject(new Error('同期の接続先が未設定です'));
    return fetch(base() + path, Object.assign({
      headers: { authorization: 'Bearer ' + conf().token }
    }, init || {})).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(fbReason(res.status, b));
        return b;
      });
    }, function () { throw new Error('通信できませんでした'); });
  }

  function fbReason(status, b) {
    var k = b && b.error;
    if (k === 'no_fitbit_key') {
      return 'Worker に Fitbit の鍵がありません（FITBIT_CLIENT_ID と FITBIT_CLIENT_SECRET）';
    }
    if (k === 'fitbit_not_linked') return 'まだ Fitbit とつないでいません';
    if (k === 'fitbit_auth_error') return 'Fitbit が許可を出しませんでした。つなぎ直してください';
    if (k === 'fitbit_error') return 'Fitbit が断りました（' + (b.status || status) + '）';
    if (k === 'fitbit_unreachable') return 'Fitbit につながりませんでした';
    if (status === 404) {
      return 'サーバー側が未対応です。Worker を最新にして deploy し直してください';
    }
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  var fitbit = {
    /** つないであるか。{ready, linked, at, redirect} */
    status: function () {
      if (!ready()) return Promise.resolve({ ready: false, linked: false });
      return fbApi('/v1/fitbit/status').catch(function () {
        return { ready: false, linked: false };
      });
    },

    /** つなぎ始める。返った URL を開いてもらう */
    start: function () {
      return fbApi('/v1/fitbit/start', { method: 'POST' });
    },

    /**
     * Fitbit から体重を取って、そのまま入れる。
     * @param {number} [days] さかのぼる日数（既定30・最大31）
     */
    pull: function (days) {
      return fbApi('/v1/fitbit/weight?days=' + Math.min(31, Math.max(1, U.num(days, 30))))
        .then(function (b) {
          var added = 0;
          (b.items || []).forEach(function (x) {
            if (S.putWeight({ date: x.date, kg: x.kg, fat: x.fat, from: 'eufy' })) added++;
          });
          return { added: added, found: (b.items || []).length };
        });
    },

    unlink: function () { return fbApi('/v1/fitbit', { method: 'DELETE' }); }
  };

  /**
   * EufyLife の書き出し（CSV）を読む。
   * 日付と体重の列があれば拾う。列の名前は英語・日本語のどちらでも。
   * @param {string} text
   * @returns {Array} [{date,kg,fat,muscle}]
   */
  function parseCSV(text) {
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return [];
    var head = splitRow(lines[0]).map(function (h) { return h.toLowerCase().trim(); });
    var iDate = pick(head, ['date', 'time', 'datetime', '日付', '測定日', '日時']);
    var iKg = pick(head, ['weight', 'weight(kg)', 'kg', '体重', '体重(kg)']);
    var iFat = pick(head, ['body fat', 'bodyfat', 'fat', 'fat(%)', '体脂肪', '体脂肪率']);
    var iMus = pick(head, ['muscle', 'muscle mass', '筋肉', '筋肉量']);
    if (iDate < 0 || iKg < 0) return [];
    var out = [];
    lines.slice(1).forEach(function (l) {
      var c = splitRow(l);
      var date = isoOf(c[iDate]);
      var kg = parseFloat(String(c[iKg] || '').replace(/[^\d.]/g, ''));
      if (!date || !(kg > 0)) return;
      out.push({
        date: date, kg: kg,
        fat: iFat >= 0 ? numOrNull(c[iFat]) : null,
        muscle: iMus >= 0 ? numOrNull(c[iMus]) : null
      });
    });
    return out;
  }

  function numOrNull(v) {
    var n = parseFloat(String(v || '').replace(/[^\d.]/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  }

  function pick(head, names) {
    for (var i = 0; i < head.length; i++) {
      for (var j = 0; j < names.length; j++) {
        if (head[i] === names[j] || head[i].indexOf(names[j]) === 0) return i;
      }
    }
    return -1;
  }

  /* かんたんな CSV の切り分け（引用符に入ったカンマだけ気にする） */
  function splitRow(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  /* '2026/09/14 07:12' でも '2026-09-14T07:12:00Z' でも日付にする */
  function isoOf(v) {
    var s = String(v || '').trim();
    var m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
    if (m) {
      return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    }
    var t = Date.parse(s);
    if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    return '';
  }

  DL.fit = {
    CARDIO: CARDIO, STEP_UPPER: STEP_UPPER, STEP_LOWER: STEP_LOWER, dec: dec,
    ready: ready, bmi: bmi, trend: trend,
    step: step, repsGoal: repsGoal, nextWeight: nextWeight, applyProgress: applyProgress,
    recent: recent, streak: streak, history: history,
    plan: plan, adopt: adopt,
    pull: pull, autoPull: autoPull, postUrl: postUrl, checkInbox: checkInbox,
    parseCSV: parseCSV,
    fitbit: fitbit
  };
})(window.DL);
