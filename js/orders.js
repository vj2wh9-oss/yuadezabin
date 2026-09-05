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

  /**
   * 照合の結果を控える。PC と iPhone のどちらから触っても同じものが残る。
   * @param {string} id
   * @param {string} status
   * @param {object} [more] 一緒に控えるもの（memo, projectId）
   */
  function setStatus(id, status, more) {
    var body = { status: status };
    if (more && typeof more.memo === 'string') body.memo = more.memo;
    if (more && typeof more.projectId === 'string') body.projectId = more.projectId;
    return api('/v1/inbox/orders/' + encodeURIComponent(id), 'PATCH', body).then(function (r) {
      var cur = get(id);
      if (cur && r && r.order) Object.assign(cur, r.order);
      return cur;
    });
  }

  /* ---------------- 案件にする ----------------

     対応済みにしたときに、その発注を「仕事」の案件として起こす。
     希望納期がそのまま締切になるので、案件のカレンダーとホームの
     締切一覧に出るようになる。

     同じ発注から二度作らないよう、作った案件の id を発注のほうに控える。 */

  /* 発注で受けた仕事の名義。決まって「ユアデザ便」なので、名前で探す。
     まだ名義を作っていないときだけ、既定の名義に落とす */
  var ORDER_ISSUER = 'ユアデザ便';

  function orderIssuer() {
    var want = norm(ORDER_ISSUER);
    return DL.store.issuers().filter(function (i) {
      return norm(i.name) === want;
    })[0] || null;
  }

  function orderIssuerId() {
    var i = orderIssuer();
    if (i) return i.id;
    var S = DL.store;
    return S.settings.defaultIssuerId || S.scopeId() || '';
  }

  /**
   * 発注を案件として起こす。すでに作ってあれば何もしない。
   * @returns {object|null} 作った案件（作らなかったときは null）
   */
  function makeProject(o) {
    if (!o || !DL.util.isISO(o.deadline)) return null;
    // すでに作ってあり、その案件がまだ残っているなら、二度は作らない
    if (o.projectId && DL.store.getProject(o.projectId)) return null;

    var S = DL.store;
    var service = o.serviceLabel || o.service || '制作';

    // 発注社名がぴたりと合う取引先が1つだけなら、それを紐付ける。
    // 迷うとき（候補が複数・一部一致だけ）は紐付けず、名前だけ残す
    var same = candidates(o.company).filter(function (h) { return h.how === 'same'; });
    var clientId = same.length === 1 ? same[0].client.id : '';

    return S.createProject({
      kind: 'work',
      category: 'design',
      title: o.company + 'の' + service,
      status: 'active',
      clientId: clientId,
      client: o.company,
      deadline: o.deadline,
      // 今日から着手できるようにする。納期が今日より前なら、その日に寄せる
      startDate: DL.util.cmp(DL.util.today(), o.deadline) <= 0 ? DL.util.today() : o.deadline,
      qty: 1,
      fee: 0,
      // 発注フォームから受けた仕事は、すべて「ユアデザ便」名義
      issuerId: orderIssuerId(),
      memo: [
        '発注フォームから',
        '受付番号 ' + o.id,
        '納品形式 ' + (o.formatLabel || o.format || ''),
        o.person ? '担当 ' + o.person : '',
        o.email,
        o.note ? '\n' + o.note : ''
      ].filter(function (t) { return t; }).join('\n')
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

  // 差出人の名乗り。変えるときはここだけ直す
  var SIGN = 'ユアデザ便の山田でございます。';

  /**
   * 宛名。会社と担当者は1行にまとめ、「様」は最後に一度だけ付ける。
   *   株式会社大喜利　横山様
   *   株式会社大喜利　ご担当者様   （担当者名が無いとき）
   */
  function addressee(o) {
    return o.company + '　' + (o.person ? o.person : 'ご担当者') + '様';
  }

  /**
   * 返事の下書きを作る。
   * @param {object} o 発注
   * @param {'ok'|'ng'} kind ok＝受領、ng＝発注社名の確認
   * @returns {{to:string, subject:string, body:string}}
   */
  function replyMail(o, kind) {
    var subject = '【' + (kind === 'ok' ? 'ご発注承りました' : 'ご発注内容の確認のお願い') + '】'
      + o.company + '　（受付番号 ' + o.id + '）';

    // 見出し付きで並べる。空文字の行は「空行」なので、間引かないこと
    var detail = [
      '■受付番号　　' + o.id,
      '■サービス　　' + (o.serviceLabel || o.service || '—'),
      '■ご希望納期　' + (o.deadline || '—'),
      '■納品形式　　' + (o.formatLabel || o.format || '—')
    ];

    var lines = [
      addressee(o),
      '',
      'お世話になっております。',
      SIGN,
      '',
      'このたびはご発注をいただき、ありがとうございます。'
    ];

    if (kind === 'ok') {
      lines = lines.concat([
        '下記の内容で承りました。',
        ''
      ], detail, [
        '',
        '進捗は追ってご連絡いたします。',
        'ご要望の欄を確認し、必要に応じてご連絡いたします。',
        '',
        'ご不明な点がございましたら、このメールにご返信ください。'
      ]);
    } else {
      lines = lines.concat([
        '下記の内容でご発注を承りました。',
        ''
      ], detail, [
        '',
        '恐れ入りますが、いただいた発注社名とご契約の記録が一致しませんでした。',
        'お手数ですが、ご契約時のお名前（正式名称）をご返信いただけますでしょうか。',
        '',
        '確認が取れ次第、あらためて着手のご連絡をいたします。',
        '',
        'ご不明な点がございましたら、このメールにご返信ください。'
      ]);
    }

    return { to: o.email, subject: subject, body: lines.join('\n') };
  }

  /**
   * メールアプリを開くための宛先。iPhone でも PC でも同じように開く。
   *
   * 本文の改行は CRLF にしてから包む。LF だけだと、
   * メールアプリによっては改行として扱われず、全部が1行に潰れてしまう。
   */
  function mailtoUrl(m) {
    return 'mailto:' + encodeURIComponent(m.to)
      + '?subject=' + encodeURIComponent(m.subject)
      + '&body=' + encodeURIComponent(String(m.body).replace(/\r?\n/g, '\r\n'));
  }

  DL.orders = {
    ready: ready, check: check, list: list, get: get, unread: unread,
    setStatus: setStatus, remove: remove, makeProject: makeProject,
    statusOf: statusOf, STATUS: STATUS,
    ORDER_ISSUER: ORDER_ISSUER, orderIssuer: orderIssuer, orderIssuerId: orderIssuerId,
    candidates: candidates, norm: norm,
    replyMail: replyMail, mailtoUrl: mailtoUrl
  };
})(window.DL);
