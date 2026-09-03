/* 発注フォームから届いた発注。

   流れ
     yuadezabin.com の発注ページ
       → 受け口の Worker（order/worker.js）がメールを送り、同期サーバーへ預ける
       → このアプリが同期サーバーから受け取り、「発注」の画面に出す
       → 発注社名を取引先と手で照らし合わせ、結果を控えてお客様へ返す

   ここが持つのはやりとりだけで、照らし合わせの判断はしない。
   取引先の一覧はこのアプリの中（設定 →「取引先」）にあるので、
   候補を挙げるところまでをやり、決めるのは人に任せる。 */
(function (DL) {
  'use strict';

  var STATUS = {
    'new': { label: '未確認', chip: 'warn' },
    matched: { label: '照合できた', chip: 'ok' },
    unmatched: { label: '照合できない', chip: 'danger' },
    done: { label: '対応済み', chip: 'ghosty' }
  };

  var box = [];            // いま手元に持っている発注
  var checkedAt = 0;
  var CHECK_MS = 60000;    // 画面を行き来しても、これより短い間は聞き直さない

  function conf() { return DL.store.syncSettings(); }
  function ready() { var c = conf(); return !!(c && c.url && c.token && c.enabled); }
  function base() { return String(conf().url).replace(/\/+$/, ''); }

  function api(path, method, body) {
    if (!ready()) return Promise.reject(new Error('同期の接続先が未設定です'));
    var opts = {
      method: method || 'GET',
      headers: { authorization: 'Bearer ' + conf().token },
      cache: 'no-store'
    };
    if (body) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(base() + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error === 'not_found' ? 'この発注は見つかりませんでした' : (b.error || ('HTTP ' + r.status)));
        return b;
      });
    });
  }

  /**
   * 届いていないか聞きに行く。
   * @param {boolean} [force] 時間を置かずに聞き直す
   * @returns {Promise<Array>} 届いている発注（新しい順）
   */
  function check(force) {
    if (!ready()) return Promise.resolve([]);
    if (!force && Date.now() - checkedAt < CHECK_MS) return Promise.resolve(box);
    checkedAt = Date.now();
    return api('/v1/inbox/orders').then(function (r) {
      box = (r && r.orders) || [];
      return box;
    }).catch(function () {
      return box;      // つながらないときは、前に受け取ったものをそのまま使う
    });
  }

  /** いま手元に持っている発注（聞きに行かない） */
  function list() { return box; }

  function get(id) {
    return box.filter(function (o) { return o.id === id; })[0] || null;
  }

  /** まだ照合していない件数 */
  function unread() {
    return box.filter(function (o) { return o.status === 'new'; }).length;
  }

  /** 照合の結果を控える。PC と iPhone のどちらから触っても同じものが残る */
  function setStatus(id, status, memo) {
    var body = { status: status };
    if (typeof memo === 'string') body.memo = memo;
    return api('/v1/inbox/orders/' + encodeURIComponent(id), 'PATCH', body).then(function (r) {
      var cur = get(id);
      if (cur && r && r.order) Object.assign(cur, r.order);
      return cur;
    });
  }

  function remove(id) {
    return api('/v1/inbox/orders/' + encodeURIComponent(id), 'DELETE').then(function () {
      box = box.filter(function (o) { return o.id !== id; });
    });
  }

  function statusOf(o) {
    return STATUS[o && o.status] || STATUS['new'];
  }

  /* ---------------- 取引先との照らし合わせ ----------------

     決めるのは人。ここは「これではないか」を挙げるだけにする。
     法人格（株式会社など）や空白の入れかたは書く人によって違うので、
     そこを落としてから比べる。 */

  // 前株・後株、かっこ書き、法人格の略号
  var CORP = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|医療法人|学校法人|宗教法人|独立行政法人|\(株\)|（株）|\(有\)|（有）|\(同\)|（同）|㈱|㈲|Co\.|Ltd\.|Inc\.|K\.K\.|LLC)/gi;

  /** 比べるための形にそろえる（法人格・空白・記号・大文字小文字・全角半角を落とす） */
  function norm(name) {
    return String(name || '')
      .replace(CORP, '')
      // 全角の英数字と空白を半角に寄せる
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\s　]/g, '')
      .replace(/[・．。，、,.\-ー―‐_/／\\「」『』()（）]/g, '')
      .toLowerCase();
  }

  /**
   * 発注社名に近い取引先を挙げる。
   * @param {string} company 発注社名
   * @returns {Array} [{ client, how:'same'|'part' }] 近いものから順に
   */
  function candidates(company) {
    var target = norm(company);
    if (!target) return [];

    var out = [];
    DL.store.clients().forEach(function (c) {
      var n = norm(c.name);
      if (!n) return;
      if (n === target) out.push({ client: c, how: 'same' });
      else if (n.indexOf(target) >= 0 || target.indexOf(n) >= 0) out.push({ client: c, how: 'part' });
    });

    return out.sort(function (a, b) { return (a.how === 'same' ? 0 : 1) - (b.how === 'same' ? 0 : 1); });
  }

  /* ---------------- お客様への返事 ----------------

     メールの下書きを作るところまでをやる（送るのは手元のメールアプリ）。
     サーバーからお客様へ勝手に送らないのは、
     文面を必ず目で見てから出したいため。 */

  function replyMail(o, kind) {
    var subject = '【' + (kind === 'ok' ? 'ご発注承りました' : 'ご発注内容の確認のお願い') + '】'
      + o.company + ' 様（受付番号 ' + o.id + '）';

    var head = [
      o.company + ' 様',
      o.person ? o.person + ' 様' : '',
      '',
      'お世話になっております。',
      'このたびはご発注をいただき、ありがとうございます。',
      ''
    ].filter(function (s) { return s !== ''; });

    var detail = [
      '　受付番号　　' + o.id,
      '　サービス　　' + (o.serviceLabel || o.service),
      '　ご希望納期　' + (o.deadline || '—'),
      '　納品形式　　' + (o.formatLabel || o.format),
      ''
    ];

    var body = kind === 'ok'
      ? [
        '下記の内容で承りました。',
        ''
      ].concat(detail, [
        '着手いたしますので、進捗は追ってご連絡いたします。',
        'ご不明な点がございましたら、このメールにご返信ください。',
        ''
      ])
      : [
        '下記の内容でご発注を承りましたが、',
        'いただいた発注社名とご契約の記録が一致しませんでした。',
        ''
      ].concat(detail, [
        'お手数ですが、ご契約時のお名前（正式名称）をご返信いただけますでしょうか。',
        '確認が取れ次第、あらためて着手のご連絡をいたします。',
        ''
      ]);

    return { to: o.email, subject: subject, body: head.concat(body).join('\n') };
  }

  /** メールアプリを開くための宛先。iPhone でも PC でも同じように開く */
  function mailtoUrl(m) {
    return 'mailto:' + encodeURIComponent(m.to)
      + '?subject=' + encodeURIComponent(m.subject)
      + '&body=' + encodeURIComponent(m.body);
  }

  DL.orders = {
    ready: ready, check: check, list: list, get: get, unread: unread,
    setStatus: setStatus, remove: remove,
    statusOf: statusOf, STATUS: STATUS,
    candidates: candidates, norm: norm,
    replyMail: replyMail, mailtoUrl: mailtoUrl
  };
})(window.DL);
