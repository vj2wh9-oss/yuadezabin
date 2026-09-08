/* 遅れたときの立て直し相談。

   締切に間に合いそうにないとき、いまの数字をそろえて OpenAI に渡し、
   「どこを削るか・どれだけ上げるか・いつまで延ばせるか」を案として出す。
   案を出すだけで、予定そのものはこちらから書き換えない。
   組み直すかどうかは、いつもの「自動スケジュール」で自分で決める。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store, sc = DL.schedule, el = U.el;

  var RISK = { low: { label: '間に合いそう', cls: 'ok' },
    mid: { label: 'きわどい', cls: 'warn' }, high: { label: '厳しい', cls: 'danger' } };
  var KIND = { pace: 'ペースを上げる', cut: '減らす', move: '締切を動かす',
    help: '人に頼む', other: 'その他' };

  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }
  function ready() { return !!(base() && conf().token); }

  /**
   * いまの数字。画面にもそのまま出すし、相談にも渡す。
   * 数えるのはこちら側で、AI には数え直させない
   */
  function facts(p, today) {
    today = U.isISO(today) ? today : U.today();
    var tasks = (p.tasks || []).filter(function (t) { return !sc.taskIsComplete(t); })
      .map(function (t) {
        var pace = sc.taskPace(p, t, today);
        return {
          name: t.name, unit: sc.unit(t),
          total: pace.total, done: pace.done, remaining: pace.remaining,
          behind: pace.behind, days: pace.remainingDays, perDay: pace.perDay,
          end: U.isISO(t.end) ? t.end : ''
        };
      });
    var deadline = U.isISO(p.deadline) ? p.deadline : '';
    var daysLeft = deadline ? Math.max(0, U.diffDays(today, deadline)) : 0;
    var workdaysLeft = deadline && U.cmp(deadline, today) >= 0
      ? sc.workdays(p, today, deadline).length : 0;

    return {
      title: p.title, kind: ui().KIND_LABEL[p.kind] || '案件',
      deadline: deadline, today: today,
      daysLeft: daysLeft, workdaysLeft: workdaysLeft,
      limit: U.num(S.settings.dailyLimit, 0),
      otherLoad: otherLoad(p, today, Math.min(14, Math.max(1, daysLeft))),
      pace: paceText(today),
      behind: tasks.reduce(function (n, t) { return n + t.behind; }, 0),
      remaining: tasks.reduce(function (n, t) { return n + t.remaining; }, 0),
      tasks: tasks
    };
  }

  function ui() { return DL.ui; }

  /* ほかの案件が同じころに持っているノルマ（1日あたり） */
  function otherLoad(p, today, days) {
    var sum = 0;
    for (var i = 0; i < days; i++) {
      var d = U.addDays(today, i);
      sc.dayEntries(d).forEach(function (e) {
        if (e.project.id !== p.id) sum += U.num(e.qty, 0);
      });
    }
    return days ? Math.round(sum / days) : 0;
  }

  function paceText(today) {
    var a = sc.actualPace(60, today);
    if (!a.activeDays) return '';
    return a.perActiveDay + '（' + a.activeDays + '日ぶんの平均）';
  }

  function reason(status, body) {
    var k = body && body.error;
    if (status === 401) return '合鍵が違います';
    if (k === 'no_api_key') {
      return 'サーバー側に OpenAI の鍵がありません。Worker に OPENAI_API_KEY を入れてください';
    }
    if (k === 'no_deadline') return '締切が決まっていません';
    if (k === 'openai_error') return 'OpenAI が断りました：' + (body.message || '');
    if (k === 'openai_unreachable') return 'OpenAI につながりませんでした';
    if (k === 'openai_empty') return 'OpenAI が中身を返しませんでした';
    if (k === 'not_json') return '返事が JSON になっていません';
    if (status === 404) {
      return 'サーバー側が未対応です。Cloudflare の Worker を最新にして deploy し直してください';
    }
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  /** 相談する。返るのは {summary, risk, plans, note} */
  function ask(f, note) {
    if (!ready()) {
      return Promise.reject(new Error('同期の接続先が未設定です。設定から先につないでください'));
    }
    if (!f.deadline) return Promise.reject(new Error('締切が決まっていません'));

    return fetch(base() + '/v1/reschedule', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'application/json'
      },
      body: JSON.stringify(Object.assign({}, f, { note: String(note || '').slice(0, 300) }))
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(reason(res.status, b));
        return normalize(b.data);
      });
    }, function () {
      throw new Error('通信できませんでした');
    });
  }

  function normalize(d) {
    d = d || {};
    return {
      summary: String(d.summary || '').slice(0, 300),
      risk: RISK[d.risk] ? d.risk : 'mid',
      note: String(d.note || '').slice(0, 300),
      plans: (Array.isArray(d.plans) ? d.plans : []).slice(0, 4).map(function (x) {
        x = x || {};
        return {
          title: String(x.title || '').slice(0, 60),
          kind: KIND[x.kind] ? x.kind : 'other',
          detail: String(x.detail || '').slice(0, 500),
          perDay: Math.max(0, Math.round(U.num(x.perDay, 0))),
          risk: RISK[x.risk] ? x.risk : 'mid'
        };
      }).filter(function (x) { return x.title || x.detail; })
    };
  }

  DL.advice = {
    RISK: RISK, KIND: KIND,
    ready: ready, facts: facts, ask: ask, normalize: normalize
  };
})(window.DL);
