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
    if (k === 'bank_unreachable') return '銀行につながりませんでした';
    if (k === 'bank_error') return '銀行が断りました（' + (body.status || status) + '）：' + (body.message || '');
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

  /** 推移。日ごとの控えを古い順に */
  function series(days) {
    var sv = S.savings();
    var from = U.addDays(U.today(), -(days || 180));
    return Object.keys(sv.history).filter(function (d) { return U.cmp(d, from) >= 0; })
      .sort().map(function (d) { return { date: d, total: sv.history[d] }; });
  }

  DL.bank = {
    ready: ready, refresh: refresh, pull: pull, check: check,
    gainOfMonth: gainOfMonth, outlook: outlook, monthlyPace: monthlyPace, series: series
  };
})(window.DL);
