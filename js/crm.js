/* 顧客管理の鍵と、社名の照らし合わせ。

   ここでやることは2つ。

   1) 顧客管理の画面を開くときの鍵。合言葉、できれば顔でも開ける。
      ここは「人目に触れないようにする蓋」であって、中身を暗号で守るものでは
      ない。データはこの端末の IndexedDB にそのまま入っている。持ち主が
      解錠済みの端末を渡してしまえば読める。そこは端末のロックに任せる。

   2) メールで届いた発注の社名を、顧客管理の名簿と照らし合わせるところ。
      決めるのは人。ここは「これではないか」を挙げるだけにする。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  /* ---------------- 合言葉 ---------------- */

  var MIN = 4;                       // 合言葉の最短の長さ
  var OPEN_KEY = 'dl.crm.open';      // 開けたままにしておく印（そのとき限り）

  function hex(buf) {
    var out = '', a = new Uint8Array(buf);
    for (var i = 0; i < a.length; i++) out += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return out;
  }

  function randomSalt() {
    var a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a)
      : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    return hex(a.buffer);
  }

  /* 合言葉そのものは残さない。塩と混ぜて潰した形だけを比べる */
  function digest(pass, salt) {
    var text = salt + '/' + pass;
    var sub = (window.crypto || {}).subtle;
    if (!sub) return Promise.resolve('plain:' + text);     // 古い端末（https でないときなど）
    return sub.digest('SHA-256', new TextEncoder().encode(text)).then(hex);
  }

  function hasPass() { return !!S.crmPass(); }

  /**
   * 合言葉を決める（入れ替える）。
   * @returns {Promise<boolean>} 短すぎるときは false
   */
  function setPass(pass) {
    pass = String(pass == null ? '' : pass);
    if (pass.length < MIN) return Promise.resolve(false);
    var salt = randomSalt();
    return digest(pass, salt).then(function (h) {
      S.setCrmPass({ salt: salt, hash: h });
      return true;
    });
  }

  /** 合言葉を外す（顔の鍵もいっしょに片付ける） */
  function clearPass() {
    S.setCrmPass(null);
    S.setCrmFace(null);
    lock();
  }

  /** @returns {Promise<boolean>} 合っていれば開ける */
  function checkPass(pass) {
    var cur = S.crmPass();
    if (!cur) return Promise.resolve(false);
    return digest(String(pass == null ? '' : pass), cur.salt).then(function (h) {
      var ok = h === cur.hash;
      if (ok) open();
      return ok;
    });
  }

  /* ---------------- 開いている状態 ----------------

     アプリを閉じたらまた閉じる。タブを移るくらいでは閉じない */

  function unlocked() {
    if (!hasPass()) return true;                 // 合言葉を決めていなければ、素通し
    try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; }
  }

  function open() {
    try { sessionStorage.setItem(OPEN_KEY, '1'); } catch (e) { /* 使えなくても動く */ }
  }

  function lock() {
    try { sessionStorage.removeItem(OPEN_KEY); } catch (e) { /* 同上 */ }
  }

  /* ---------------- 顔（Face ID）で開ける ----------------

     WebAuthn の「この端末の鍵」を1本だけ作っておき、
     開けるときに、その鍵で署名できるかを端末に聞く。
     顔を見るのも、鍵を仕舞っておくのも端末の仕事で、
     こちらは顔のデータには触れない。 */

  function faceReady() {
    return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
  }

  /** その端末に顔などの鍵があるか。@returns {Promise<boolean>} */
  function faceAvailable() {
    if (!faceReady()) return Promise.resolve(false);
    var f = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    if (!f) return Promise.resolve(false);
    return f.call(window.PublicKeyCredential).catch(function () { return false; });
  }

  /** この端末で、顔で開けるようにしてあるか */
  function faceOn() { return !!S.crmFace(); }

  function b64(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unb64(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function challenge() {
    var a = new Uint8Array(32);
    if ((window.crypto || {}).getRandomValues) window.crypto.getRandomValues(a);
    return a;
  }

  /**
   * この端末で顔で開けるようにする。合言葉を決めたあとで呼ぶ。
   * @returns {Promise<boolean>}
   */
  function enrollFace() {
    if (!faceReady() || !hasPass()) return Promise.resolve(false);
    return navigator.credentials.create({
      publicKey: {
        challenge: challenge(),
        rp: { name: 'METEO365' },        // id は省く。いまのドメインになる
        user: { id: challenge().slice(0, 16), name: '顧客管理', displayName: '顧客管理' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred'
        },
        timeout: 60000,
        attestation: 'none'
      }
    }).then(function (cred) {
      if (!cred) return false;
      S.setCrmFace({ id: b64(cred.rawId) });
      return true;
    });
  }

  function forgetFace() { S.setCrmFace(null); }

  /**
   * 顔で開ける。断られたり、合わなければ false。
   * @returns {Promise<boolean>}
   */
  function faceUnlock() {
    var saved = S.crmFace();
    if (!faceReady() || !saved) return Promise.resolve(false);
    return navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        allowCredentials: [{ type: 'public-key', id: unb64(saved.id) }],
        userVerification: 'required',
        timeout: 60000
      }
    }).then(function (a) {
      if (!a) return false;
      open();
      return true;
    }).catch(function () { return false; });
  }

  /* ---------------- 社名の照らし合わせ ----------------

     メールで届いた発注の社名を、顧客管理の名簿に当てる。
     法人格（株式会社など）や空白の入れかたは書く人によって違うので、
     そこを落としてから比べる。別名を入れてあれば、それも見る。
     まだ契約していない営業先（見込み）も名簿のうちなので、同じように挙げる。 */

  var CORP = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|医療法人|学校法人|宗教法人|独立行政法人|\(株\)|（株）|\(有\)|（有）|\(同\)|（同）|㈱|㈲|Co\.|Ltd\.|Inc\.|K\.K\.|LLC)/gi;

  /** 比べるための形にそろえる（法人格・空白・記号・大文字小文字・全角半角を落とす） */
  function norm(name) {
    return String(name || '')
      .replace(CORP, '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\s　]/g, '')
      .replace(/[・．。，、,.\-ー―‐_/／\\「」『』()（）]/g, '')
      .toLowerCase();
  }

  /** メールアドレスの @ から後ろ。よくある無料のものは、手がかりにしない */
  var FREE = ['gmail.com', 'yahoo.co.jp', 'ymail.ne.jp', 'icloud.com', 'me.com', 'outlook.com',
    'outlook.jp', 'hotmail.com', 'hotmail.co.jp', 'live.jp', 'docomo.ne.jp', 'ezweb.ne.jp',
    'au.com', 'softbank.ne.jp', 'i.softbank.jp', 'nifty.com', 'proton.me'];

  function domain(email) {
    var m = /@([^@\s]+)$/.exec(String(email || '').trim().toLowerCase());
    if (!m) return '';
    var d = m[1];
    return FREE.indexOf(d) >= 0 ? '' : d;
  }

  /** その顧客の呼び名すべて（会社名と別名） */
  function namesOf(c) { return [c.name].concat(c.aliases || []); }

  /**
   * 社名（とメールアドレス）に近い顧客を挙げる。近いものから順に。
   * @param {string} company メールで届いた社名
   * @param {string} [email] 差出人のアドレス。会社のドメインなら手がかりにする
   * @returns {Array<{client:object, how:'same'|'alias'|'mail'|'part'}>}
   */
  function match(company, email) {
    var target = norm(company);
    var dom = domain(email);
    if (!target && !dom) return [];

    var rank = { same: 0, alias: 1, mail: 2, part: 3 };
    var out = [];

    S.clients().forEach(function (c) {
      var how = '';
      namesOf(c).forEach(function (name, i) {
        var n = norm(name);
        if (!n || !target) return;
        if (n === target) how = better(how, i === 0 ? 'same' : 'alias');
        else if (n.indexOf(target) >= 0 || target.indexOf(n) >= 0) how = better(how, 'part');
      });
      if (dom && domain(c.email) === dom) how = better(how, 'mail');
      if (how) out.push({ client: c, how: how });
    });

    function better(a, b) { return !a ? b : (rank[b] < rank[a] ? b : a); }

    return out.sort(function (a, b) { return rank[a.how] - rank[b.how]; });
  }

  /** ぴたりと1件だけ決まるなら、その顧客。迷うときは null */
  function pick(company, email) {
    var hits = match(company, email).filter(function (h) { return h.how !== 'part'; });
    return hits.length === 1 ? hits[0].client : null;
  }

  /* ---------------- 一覧を出すための小道具 ---------------- */

  var STATUS = {
    client: { label: '取引中', cls: 'ok' },
    prospect: { label: '見込み', cls: 'warn' }
  };
  var RESULT = {
    visited: '訪問した', talking: '商談中', won: '契約になった', lost: '見送り'
  };

  function statusOf(c) { return STATUS[(c || {}).status] || STATUS.client; }
  function resultLabel(r) { return RESULT[r] || RESULT.visited; }

  /** 名前・担当・メール・電話・住所・別名を横断して探す */
  function search(word) {
    var w = String(word || '').trim().toLowerCase();
    var list = S.clients().slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'ja');
    });
    if (!w) return list;
    var n = norm(w);
    return list.filter(function (c) {
      var hay = namesOf(c).concat([c.contact, c.email, c.tel, c.address, c.plan]).join(' ').toLowerCase();
      return hay.indexOf(w) >= 0 || (n && norm(hay).indexOf(n) >= 0);
    });
  }

  /** その顧客の発注履歴。案件と、メールで届いた発注の両方から拾う */
  function history(c) {
    if (!c) return [];
    var out = S.clientProjects(c.id).map(function (p) {
      return { kind: 'project', id: p.id, date: p.deadline || p.startDate || '',
        title: p.title, note: '案件' };
    });
    var seen = {};
    out.forEach(function (o) { seen[o.id] = true; });
    (DL.orders && DL.orders.list ? DL.orders.list() : []).forEach(function (o) {
      if (!match(o.company, o.email).some(function (h) { return h.client.id === c.id; })) return;
      out.push({ kind: 'order', id: o.id, date: o.deadline || (o.at || '').slice(0, 10),
        title: (o.serviceLabel || o.service || '制作'), note: 'メールの発注' });
    });
    return out.sort(function (a, b) { return U.cmp(b.date, a.date); });
  }

  DL.crm = {
    MIN: MIN,
    hasPass: hasPass, setPass: setPass, clearPass: clearPass, checkPass: checkPass,
    unlocked: unlocked, open: open, lock: lock,
    faceReady: faceReady, faceAvailable: faceAvailable, faceOn: faceOn,
    enrollFace: enrollFace, forgetFace: forgetFace, faceUnlock: faceUnlock,
    norm: norm, domain: domain, match: match, pick: pick,
    statusOf: statusOf, resultLabel: resultLabel, RESULT: RESULT,
    search: search, history: history
  };
})(window.DL);
