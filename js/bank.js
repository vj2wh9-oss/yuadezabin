/* 貯金口座の残高。

   銀行（GMOあおぞらネット銀行の個人向け API）につなぐのは同期サーバーの役目で、
   銀行の鍵はそちらの secret にだけ置く。アプリが受け取るのは「いくらあるか」だけ。

   口座がまだ無いあいだは、手で入れても同じように使える。
   入れた数字はその日ごとに残るので、あとから推移を見られる。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }

  /** 同期の接続先が入っているか（銀行につながるかは別） */
  function ready() { return !!(base() && conf().token); }

  function reason(status, body) {
    var k = body && body.error;
    if (status === 401) return '合鍵が違います';
    if (k === 'no_bank_token') {
      return 'サーバー側に銀行の鍵がありません。Worker に BANK_ACCESS_TOKEN を入れてください';
    }
    if (k === 'no_api_key') return 'Worker に OPENAI_API_KEY がありません';
    if (k === 'no_data') return 'まだ材料がありません';
    if (k === 'openai_error') return 'OpenAI が断りました：' + (body.message || '');
    if (k === 'openai_unreachable') return 'OpenAI につながりませんでした';
    if (k === 'openai_empty') return 'OpenAI が中身を返しませんでした';
    if (k === 'not_json') return '返事が JSON になっていません';
    if (k === 'bank_unreachable') return '銀行につながりませんでした';
    if (k === 'bank_error') {
      var code = body.status || status;
      // HTML が返るのは、API まで届いていないとき（入口ちがい・許可されていない）
      if (body.html) {
        return '銀行の入口が ' + code + ' を返しました（' + (body.message || '') + '）。'
          + (code === 403
            ? 'URL・鍵・利用の許可のどれかが合っていません。BANK_BASE と BANK_BALANCE_PATH、'
              + 'それに鍵の種類（本番か砂場か）を確かめてください'
            : 'API の入口（BANK_BASE）が合っているか確かめてください');
      }
      return '銀行が断りました（' + code + '）：' + (body.message || '');
    }
    if (k === 'bank_not_json') return '銀行の返事が JSON になっていません';
    if (k === 'bank_no_match') {
      return '口座の絞り込み（BANK_ACCOUNT_ID）が合っていません。'
        + '返ってきたのは ' + ((body.ids || []).join('、') || 'なし') + ' です';
    }
    if (status === 404) {
      return 'サーバー側が未対応です。Cloudflare の Worker を最新にして deploy し直してください';
    }
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  function api(path) {
    if (!ready()) {
      return Promise.reject(new Error('同期の接続先が未設定です。設定から先につないでください'));
    }
    return fetch(base() + path, {
      headers: { authorization: 'Bearer ' + conf().token }
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(reason(res.status, b));
        return b;
      });
    }, function () {
      throw new Error('通信できませんでした');
    });
  }

  /** 残高を読みに行き、手元にも残す */
  function refresh() {
    return api('/v1/bank/balance?days=400').then(function (b) {
      var d = b.data || {};
      S.setSavings({ total: d.total, accounts: d.accounts, at: d.at });
      if (b.history) S.mergeSavingsHistory(b.history);
      return S.savings();
    });
  }

  /** 読みに行かず、サーバーに控えてあるぶんだけ取る */
  function pull() {
    return api('/v1/bank/history?days=400').then(function (b) {
      if (b.data) S.setSavings({ total: b.data.total, accounts: b.data.accounts, at: b.data.at });
      if (b.history) S.mergeSavingsHistory(b.history);
      return S.savings();
    });
  }

  /** つながるかを確かめる（設定画面用。鍵は返らない） */
  function check() { return api('/v1/bank/debug'); }

  /* ---- 手元の計算 ---- */

  /** その月の初めから見て、いくら増えたか */
  function gainOfMonth(ym) {
    var sv = S.savings();
    var days = Object.keys(sv.history).sort();
    if (!days.length) return null;
    ym = ym || U.today().slice(0, 7);
    var before = null, last = null;
    days.forEach(function (d) {
      if (d.slice(0, 7) < ym) before = sv.history[d];
      if (d.slice(0, 7) === ym) last = sv.history[d];
    });
    if (last === null) last = sv.total;
    if (before === null) return null;      // 先月ぶんの控えが無ければ出さない
    return last - before;
  }

  /**
   * 目標までの見通し。
   * ここ数ヶ月の増えかたから、あと何ヶ月かかりそうかを出す
   */
  function outlook() {
    var sv = S.savings();
    if (!sv.goal) return null;
    var left = Math.max(0, sv.goal - sv.total);
    var pace = monthlyPace();
    return {
      goal: sv.goal, total: sv.total, left: left,
      pct: sv.goal ? Math.min(100, Math.round(sv.total / sv.goal * 100)) : 0,
      pace: pace,
      months: (pace > 0 && left > 0) ? Math.ceil(left / pace) : (left > 0 ? 0 : 0),
      done: left <= 0
    };
  }

  /**
   * 期日から逆算した貯金の割り当て。
   * 毎月いくら・毎日いくら貯めれば届くか。
   * @returns {object|null} 目標と期日を決めていなければ null
   */
  function plan(date) {
    var sv = S.savings();
    if (!sv.goal || !sv.goalOn) return null;
    var today = U.isISO(date) ? date : U.today();
    var left = Math.max(0, sv.goal - sv.total);
    var days = U.diffDays(today, sv.goalOn) + 1;        // 今日を入れて何日
    var months = monthsLeft(today, sv.goalOn);
    var over = days <= 0;                               // 期日を過ぎている
    var d = Math.max(1, days), m = Math.max(1, months);
    var b = DL.expenses.dailyBudget(today);             // いまの1日予算
    var perDay = Math.ceil(left / d);
    return {
      goal: sv.goal, on: sv.goalOn, total: sv.total, left: left,
      days: days, months: months, over: over, done: left <= 0,
      perMonth: Math.ceil(left / m),
      perDay: perDay,
      // 1日の予算からこれだけ削る。残りが今日から使ってよい額
      budgetPerDay: b ? b.perDay : 0,
      spendable: b ? b.perDay - perDay : 0,
      short: b ? Math.max(0, perDay - b.perDay) : 0
    };
  }

  /* 今月を入れて、期日の月まで何ヶ月あるか */
  function monthsLeft(today, on) {
    var a = today.split('-'), b = String(on).split('-');
    return (U.num(b[0], 0) - U.num(a[0], 0)) * 12 + (U.num(b[1], 0) - U.num(a[1], 0)) + 1;
  }

  /** ひと月あたり、いくら増えているか（控えのある範囲で） */
  function monthlyPace() {
    var sv = S.savings();
    var days = Object.keys(sv.history).sort();
    if (days.length < 2) return 0;
    var first = days[0], last = days[days.length - 1];
    var span = Math.max(1, U.diffDays(first, last));
    if (span < 14) return 0;               // 短すぎるうちは出さない
    var diff = sv.history[last] - sv.history[first];
    return Math.round(diff / span * 30);
  }

  /* ---- 支出のアドバイス ---- */

  var RISK = { low: { label: '届きそう', cls: 'ok' },
    mid: { label: 'きわどい', cls: 'warn' }, high: { label: '厳しい', cls: 'danger' } };

  /** 渡す材料。数はこちらで数える */
  function facts(days) {
    var E = DL.expenses, U2 = U;
    var today = U2.today();
    var from = U2.addDays(today, -(days || 30));
    var rows = (S.settings.expenses || []).filter(function (x) {
      return U2.cmp(String(x.date), from) >= 0 && U2.cmp(String(x.date), today) <= 0;
    });
    var cats = {};
    rows.forEach(function (x) {
      var k = x.category || 'その他';
      if (!cats[k]) cats[k] = { name: k, amount: 0, count: 0 };
      cats[k].amount += U2.num(x.amount, 0);
      cats[k].count++;
    });
    var b = E.dailyBudget(today);
    var pl = plan(today);
    return {
      days: days || 30,
      month: b ? b.month : 0, fixed: b ? b.fixed : 0,
      perDay: b ? b.perDay : 0, spent: b ? b.spent : 0,
      goal: pl ? pl.goal : 0, goalOn: pl ? pl.on : '',
      left: pl ? pl.left : 0, perMonth: pl ? pl.perMonth : 0, goalPerDay: pl ? pl.perDay : 0,
      cats: Object.keys(cats).map(function (k) { return cats[k]; })
        .sort(function (a, b2) { return b2.amount - a.amount; }),
      rows: rows.slice().sort(function (a, b2) { return U2.num(b2.amount, 0) - U2.num(a.amount, 0); })
        .slice(0, 60).map(function (x) {
          return { date: x.date, category: x.category || '', vendor: x.vendor || '',
            amount: U2.num(x.amount, 0) };
        })
    };
  }

  /** 支出を見てもらう */
  function advise(days) {
    if (!ready()) {
      return Promise.reject(new Error('同期の接続先が未設定です'));
    }
    var f = facts(days);
    if (!f.month && !f.rows.length) return Promise.reject(new Error('まだ材料がありません'));
    return fetch(base() + '/v1/spend', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'application/json'
      },
      body: JSON.stringify(f)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(reason(res.status, b));
        var d = b.data || {};
        return {
          summary: String(d.summary || '').slice(0, 300),
          risk: RISK[d.risk] ? d.risk : 'mid',
          note: String(d.note || '').slice(0, 300),
          tips: (Array.isArray(d.tips) ? d.tips : []).slice(0, 6).map(function (t) {
            t = t || {};
            return {
              title: String(t.title || '').slice(0, 60),
              detail: String(t.detail || '').slice(0, 400),
              saving: Math.max(0, Math.round(U.num(t.saving, 0)))
            };
          }).filter(function (t) { return t.title || t.detail; })
        };
      });
    }, function () {
      throw new Error('通信できませんでした');
    });
  }

  /** 推移。日ごとの控えを古い順に */
  function series(days) {
    var sv = S.savings();
    var from = U.addDays(U.today(), -(days || 180));
    return Object.keys(sv.history).filter(function (d) { return U.cmp(d, from) >= 0; })
      .sort().map(function (d) { return { date: d, total: sv.history[d] }; });
  }

  DL.bank = {
    RISK: RISK,
    ready: ready, refresh: refresh, pull: pull, check: check,
    gainOfMonth: gainOfMonth, outlook: outlook, monthlyPace: monthlyPace, series: series,
    plan: plan, facts: facts, advise: advise
  };
})(window.DL);
