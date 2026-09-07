/* ひらめきメモを Discord のチャンネルへ送る。

   送り先の Webhook URL はアプリ側に持たない。Worker の secret
   （DISCORD_MEMO_WEBHOOK）にだけ置いてあり、こちらは「これを送って」と
   頼むだけ。URL を知っていれば誰でもそのチャンネルに書き込めるので、
   公開しているコードにも、端末にも、バックアップのファイルにも置かない。

   ファイルではなく、そのまま読める文として送る。 */
(function (DL) {
  'use strict';
  var S = DL.store;

  function conf() { return S.syncSettings ? S.syncSettings() : (S.settings.sync || {}); }
  function base() { return String(conf().url || '').replace(/\/+$/, ''); }

  /** 送れる状態か（同期の接続先が入っているか） */
  function ready() { return !!(base() && conf().token); }

  /* 向こうの返事を、そのまま出しても分かる日本語にする */
  function reason(status, body) {
    var k = body && body.error;
    if (status === 401) return '合鍵が違います';
    if (k === 'no_memo_webhook') {
      return 'サーバー側に送り先がありません。Worker に DISCORD_MEMO_WEBHOOK を'
        + ' secret として入れてください（wrangler secret put DISCORD_MEMO_WEBHOOK）';
    }
    if (k === 'discord_error') return 'Discord が断りました（' + (body.status || '') + '）：' + (body.message || '');
    if (k === 'empty') return '中身がありません';
    if (status === 404) {
      return 'サーバー側が未対応です。Cloudflare の Worker を最新のコードにして deploy し直してください';
    }
    return 'サーバーが応答しませんでした（' + status + '）';
  }

  /**
   * メモを1件送る。
   * @param {object} idea {title, text}
   * @param {string} [date] いつ書いたか
   * @returns {Promise<{ok:boolean, parts:number}>}
   */
  function send(idea, date) {
    if (!ready()) {
      return Promise.reject(new Error('同期の接続先が未設定です。設定から先につないでください'));
    }
    idea = idea || {};
    return fetch(base() + '/v1/memo/send', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: idea.title || '', text: idea.text || '', date: date || ''
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(reason(res.status, b));
        return b;
      });
    }, function () {
      throw new Error('通信できませんでした');
    });
  }

  /**
   * 書類（見積書・請求書・領収書）を、種類ごとのチャンネルへ送る。
   * PDF そのものは R2 に置いてあるので、その ID だけ渡す。
   * @param {object} o {type, fileId, name, number, client, total, issueDate, project}
   */
  function sendDoc(o) {
    if (!ready()) {
      return Promise.reject(new Error('同期の接続先が未設定です。設定から先につないでください'));
    }
    return fetch(base() + '/v1/doc/send', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + conf().token,
        'content-type': 'application/json'
      },
      body: JSON.stringify(o || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(docReason(res.status, b));
        return b;
      });
    }, function () {
      throw new Error('通信できませんでした');
    });
  }

  function docReason(status, body) {
    var k = body && body.error;
    if (k === 'no_doc_webhook') {
      return (body.label || '書類') + 'の送り先がサーバー側にありません。'
        + 'Worker に ' + (body.which || '') + ' を secret として入れてください';
    }
    if (k === 'too_large') return 'PDF が大きすぎて送れません';
    return reason(status, body);
  }

  DL.memosend = { send: send, sendDoc: sendDoc, ready: ready };
})(window.DL);
