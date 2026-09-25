/* 通知。

   考え方
     「いつ・何を出すか」はぜんぶこちら側で決めて、その一覧（予定表）を
     同期サーバーへ預ける。サーバーは時刻が来たものを送るだけで、中身は
     解釈しない。こうしておくと、通知の種別を増やすときにサーバーを
     触らずに済む（KINDS に1つ足すだけ）。

   なぜサーバーが要るのか
     ブラウザのアプリは、自分で「あとで鳴らす」ことができない。
     それができる仕組み（Notification Triggers）は Safari に無く、
     サービスワーカーはタイマーを持てない（iOS に止められる）。
     アプリを閉じていても鳴らすには、外から送ってもらうしかない。

   iPhone での約束ごと
     ホーム画面に追加したアプリでのみ通知を受け取れる（Safari のタブでは不可）。 */
(function (DL) {
  'use strict';
  var U = DL.util, S = DL.store;

  var HORIZON_DAYS = 60;     // 何日先ぶんまで先に作って預けるか
  var MAX_ITEMS = 400;
  var DIGEST_DAYS = 7;       // 「気になること」を先に作っておく日数

  /* 出かける前の雨の知らせ */
  var OFFICE_TIME = '06:20';  // 出社の日に知らせる時刻
  var STAY_TIME = '14:20';    // 泊まり勤務の日に知らせる時刻
  var STAY_UNTIL = '10:00';   // 泊まり勤務は、翌日のこの時刻まで見る
  var RAIN_POP = 50;          // 記号が降っていなくても、これ以上の降水確率なら雨とみなす
  var RAIN_LEAD = 10;         // 予定に付けた雨の知らせは、何分前に出すか

  /* ---------------- 種別ごとの作り方 ----------------
     足すときはここに1つ書く。設定画面と予定表づくりが自動でついてくる。 */

  var KINDS = {
    /* 日常の予定 */
    lifeEvent: {
      label: '日常の予定',
      note: 'カレンダーの「日常」に入れた予定を知らせます',
      // 使える鳴らし方
      whens: [
        { value: 'beforeDay', label: '前日の指定時刻' },
        { value: 'onDay', label: '当日の指定時刻' },
        { value: 'beforeMin', label: '開始の◯分前（時刻を決めた予定だけ）' }
      ],
      build: function (rule, from, to) {
        var out = [];
        var map = DL.events.byDay(from, U.addDays(to, 2));
        Object.keys(map).forEach(function (date) {
          map[date].forEach(function (o) {
            if (o.index !== 0) return;                       // またがる予定は初日だけ
            if (rule.importantOnly && !o.ev.important) return;
            if (DL.events.isDone(o)) return;                 // ホームから外したものは鳴らさない

            var at = null, lead = '';
            if (rule.when === 'beforeMin') {
              if (!o.ev.start) return;                       // 終日には効かない
              at = atLocal(date, o.ev.start, -U.num(rule.minutes, 30));
              lead = 'まもなく';
            } else if (rule.when === 'beforeDay') {
              at = atLocal(U.addDays(date, -1), rule.time || '20:00', 0);
              lead = '明日';
            } else {
              at = atLocal(date, rule.time || '08:00', 0);
              lead = '今日';
            }
            if (!at) return;
            out.push({
              id: 'ev|' + rule.id + '|' + o.ev.id + '|' + date,
              at: at,
              title: lead + '　' + o.ev.title,
              body: bodyOf(o),
              tag: 'ev-' + o.ev.id + '-' + date,
              url: '#/day/' + date
            });
          });
        });
        return out;
      }
    },

    /* 今日やること（朝のまとめ） */
    todo: {
      label: '今日やること',
      note: 'その日の案件のノルマと日常の予定を、まとめて1通で知らせます',
      whens: [{ value: 'onDay', label: '当日の指定時刻' }],
      build: function (rule, from, to) {
        var out = [];
        U.rangeDays(from, to).forEach(function (date) {
          var load = DL.schedule.loadOfDay(date);
          var plans = DL.events.ofDay(date).filter(function (o) { return !DL.events.isDone(o); });
          var n = load.entries.length + plans.length;
          if (!n) return;                                   // 何も無い日は鳴らさない
          var at = atLocal(date, rule.time || '08:00', 0);
          if (!at) return;
          var names = load.entries.map(function (e) { return e.task.name; })
            .concat(plans.map(function (o) { return o.ev.title; }));
          out.push({
            id: 'todo|' + rule.id + '|' + date,
            at: at,
            title: '今日やること ' + n + '件',
            body: names.slice(0, 4).join('、') + (names.length > 4 ? ' ほか' : ''),
            tag: 'todo-' + date,
            url: '#/home'
          });
        });
        return out;
      }
    },

    /* 出かける前の雨 */
    rain: {
      label: '出かける前の雨',
      note: '出かける少し前に、雨（雪）の予報があれば知らせます。'
        + '知らせる時刻は勤務の種別で変わり、リモートワークの日は出しません。'
        + '天気の地点を登録しておいてください',
      whens: [{ value: 'duty', label: '勤務ごとの時刻' }],
      noTime: true,
      times: [
        { key: 'officeTime', short: '出社', def: OFFICE_TIME,
          label: '出社の日に知らせる時刻', hint: 'この時刻から、その日のうちに雨があれば知らせます' },
        { key: 'stayTime', short: '泊まり', def: STAY_TIME,
          label: '泊まり勤務の日に知らせる時刻', hint: 'この時刻から、翌日の ' + STAY_UNTIL + ' までを見ます' }
      ],
      numbers: [
        { key: 'pop', label: '雨とみなす降水確率（%）', min: 10, max: 100, def: RAIN_POP }
      ],
      build: function (rule, from, to) { return rainReminders(rule, from, to); }
    },

    /* 案件の締切 */
    deadline: {
      label: '案件の締切',
      note: '入稿締切・納品日・即売会の当日を知らせます',
      days: true,
      whens: [
        { value: 'beforeDay', label: '◯日前の指定時刻' },
        { value: 'onDay', label: '当日の指定時刻' }
      ],
      build: function (rule, from, to) {
        var out = [];
        var days = Math.max(0, U.diffDays(from, to));
        var lead = rule.when === 'beforeDay' ? Math.max(1, U.num(rule.days, 3)) : 0;
        DL.schedule.timeline(from, days + lead).forEach(function (it) {
          var fire = U.addDays(it.date, -lead);
          if (U.cmp(fire, from) < 0 || U.cmp(fire, to) > 0) return;
          var at = atLocal(fire, rule.time || '09:00', 0);
          if (!at) return;
          out.push({
            id: 'dl|' + rule.id + '|' + it.project.id + '|' + it.type + '|' + it.date,
            at: at,
            title: (lead ? lead + '日後' : '今日') + '　' + it.label,
            body: it.project.title,
            tag: 'dl-' + it.project.id + '-' + it.date,
            url: '#/project/' + it.project.id
          });
        });
        return out;
      }
    },

    /* 請求書の入金 */
    unpaid: {
      label: '請求書の入金',
      note: '発行済みで、まだ入金していない請求書の支払期限を知らせます',
      days: true,
      whens: [
        { value: 'beforeDay', label: '支払期限の◯日前' },
        { value: 'onDay', label: '支払期限の当日' },
        { value: 'afterDay', label: '支払期限から◯日後' }
      ],
      build: function (rule, from, to) {
        var out = [];
        var n = Math.max(1, U.num(rule.days, 3));
        var shift = rule.when === 'beforeDay' ? -n : rule.when === 'afterDay' ? n : 0;
        S.allDocs().forEach(function (e) {
          var d = e.doc;
          // 下書きはまだ出していない。入金済みは用が済んでいる
          if (d.type !== 'invoice' || d.status !== 'issued') return;
          if (!U.isISO(d.dueDate)) return;
          var fire = U.addDays(d.dueDate, shift);
          if (U.cmp(fire, from) < 0 || U.cmp(fire, to) > 0) return;
          var at = atLocal(fire, rule.time || '09:00', 0);
          if (!at) return;
          var yen = DL.docs.yen(DL.docs.calc(d).payable);
          out.push({
            id: 'unpaid|' + rule.id + '|' + d.id + '|' + fire,
            at: at,
            title: shift < 0 ? n + '日後が入金予定日'
              : shift > 0 ? '入金予定日を ' + n + '日 過ぎました' : '今日が入金予定日',
            body: (d.clientName || e.project.title) + '　' + yen,
            tag: 'unpaid-' + d.id,
            url: '#/doc/' + e.project.id + '/' + d.id
          });
        });
        return out;
      }
    },

    /* 請求漏れ */
    uninvoiced: {
      label: '請求漏れ',
      note: '納品日を過ぎたお仕事に請求書が1枚も無ければ知らせます',
      days: true,
      whens: [{ value: 'afterDay', label: '納品日から◯日後' }],
      build: function (rule, from, to) {
        var out = [];
        var n = Math.max(0, U.num(rule.days, 3));
        S.projects().forEach(function (p) {
          if (p.kind !== 'work' || p.status === 'archived') return;
          if (!U.isISO(p.deadline)) return;
          if ((p.docs || []).some(function (d) { return d.type === 'invoice'; })) return;
          var fire = U.addDays(p.deadline, n);
          if (U.cmp(fire, from) < 0 || U.cmp(fire, to) > 0) return;
          var at = atLocal(fire, rule.time || '09:00', 0);
          if (!at) return;
          out.push({
            id: 'uninv|' + rule.id + '|' + p.id,
            at: at,
            title: '請求書がまだです',
            body: p.title + '　納品日 ' + U.fmtMD(p.deadline),
            tag: 'uninv-' + p.id,
            url: '#/docs/' + p.id
          });
        });
        return out;
      }
    },

    /* 固定費の引き落とし */
    recurring: {
      label: '固定費の引き落とし',
      note: '毎月きまって出るお金の日を知らせます（残高の用意に）',
      whens: [
        { value: 'beforeDay', label: '前日の指定時刻' },
        { value: 'onDay', label: '当日の指定時刻' }
      ],
      build: function (rule, from, to) {
        var out = [];
        var list = S.recurring().filter(function (r) { return r.active; });
        if (!list.length) return out;
        var shift = rule.when === 'beforeDay' ? -1 : 0;

        monthsIn(from, to).forEach(function (ym) {
          // 同じ日に重なるものは1通にまとめる
          var byDate = {};
          list.forEach(function (r) {
            // 始める前の月・解約したあとの月・その月だけ休むぶんは鳴らさない
            if (!DL.expenses.liveInMonth(r, ym)) return;
            var date = U.clampDay(ym, r.day);
            (byDate[date] || (byDate[date] = [])).push(r);
          });
          Object.keys(byDate).forEach(function (date) {
            var fire = U.addDays(date, shift);
            if (U.cmp(fire, from) < 0 || U.cmp(fire, to) > 0) return;
            var at = atLocal(fire, rule.time || '20:00', 0);
            if (!at) return;
            var rs = byDate[date];
            var sum = rs.reduce(function (a, r) { return a + U.num(r.amount, 0); }, 0);
            out.push({
              id: 'rec|' + rule.id + '|' + date,
              at: at,
              title: (shift ? '明日' : '今日') + 'の引き落とし ' + DL.docs.yen(sum),
              body: rs.map(function (r) { return r.name; }).slice(0, 4).join('、')
                + (rs.length > 4 ? ' ほか' : ''),
              tag: 'rec-' + date,
              url: '#/books'
            });
          });
        });
        return out;
      }
    },

    /* 見積書の有効期限 */
    estimate: {
      label: '見積書の有効期限',
      note: '出したままの見積書が切れる前に知らせます（出し直しの目安）',
      days: true,
      whens: [
        { value: 'beforeDay', label: '有効期限の◯日前' },
        { value: 'onDay', label: '有効期限の当日' }
      ],
      build: function (rule, from, to) {
        var out = [];
        var n = Math.max(1, U.num(rule.days, 3));
        var shift = rule.when === 'beforeDay' ? -n : 0;
        S.allDocs().forEach(function (e) {
          var d = e.doc;
          // 受注・見送りが決まったものは、もう気にしなくていい
          if (d.type !== 'estimate' || d.status !== 'issued') return;
          if (!U.isISO(d.validUntil)) return;
          var fire = U.addDays(d.validUntil, shift);
          if (U.cmp(fire, from) < 0 || U.cmp(fire, to) > 0) return;
          var at = atLocal(fire, rule.time || '09:00', 0);
          if (!at) return;
          out.push({
            id: 'est|' + rule.id + '|' + d.id + '|' + fire,
            at: at,
            title: shift ? '見積書の期限まで ' + n + '日' : '今日で見積書の期限',
            body: (d.clientName || e.project.title) + '　' + DL.docs.yen(DL.docs.calc(d).payable),
            tag: 'est-' + d.id,
            url: '#/doc/' + e.project.id + '/' + d.id
          });
        });
        return out;
      }
    },

    /* 即売会前の在庫 */
    stock: {
      label: '即売会前の在庫',
      note: '即売会の前に、残りが少ない頒布物を知らせます（刷り増し・持ち出しの判断に）',
      days: true,
      numbers: [{ key: 'count', label: '残部がいくつ以下か', min: 1, max: 999, def: 10 }],
      whens: [{ value: 'beforeDay', label: '即売会の◯日前' }],
      build: function (rule, from, to) {
        var out = [];
        if (!DL.stock) return out;
        var n = Math.max(1, U.num(rule.days, 14));
        var limit = Math.max(1, U.num(rule.count, 10));
        var low = DL.stock.all().filter(function (x) { return x.left > 0 && x.left <= limit; });
        if (!low.length) return out;

        S.projects().forEach(function (p) {
          if (p.kind !== 'event' || p.status === 'archived') return;
          if (!U.isISO(p.eventDate)) return;
          var fire = U.addDays(p.eventDate, -n);
          if (U.cmp(fire, from) < 0 || U.cmp(fire, to) > 0) return;
          var at = atLocal(fire, rule.time || '10:00', 0);
          if (!at) return;
          out.push({
            id: 'stk|' + rule.id + '|' + p.id,
            at: at,
            title: (p.eventName || p.title) + 'まで ' + n + '日',
            body: '残りわずか：' + low.map(function (x) {
              return x.item.title + '（残' + x.left + '）';
            }).slice(0, 4).join('、'),
            tag: 'stk-' + p.id,
            url: '#/stock'
          });
        });
        return out;
      }
    },

    /* 気になることのまとめ */
    alert: {
      label: '気になることのまとめ',
      note: 'ホームのいちばん上に出ている注意（遅れ・締切・入金・請求漏れ）を、まとめて1通で知らせます',
      whens: [{ value: 'onDay', label: '毎日の指定時刻' }],
      build: function (rule, from, to) {
        var out = [];
        // 先の日ぶんは「これ以上進めなかったら」という見立てになる。
        // アプリを開くたびに作り直すので、近い日ぶんだけ持たせておく
        var last = U.addDays(from, Math.min(DIGEST_DAYS, Math.max(0, U.diffDays(from, to))));
        U.rangeDays(from, last).forEach(function (date) {
          var list = DL.schedule.alerts(date, { all: true })
            .filter(function (a) { return a.level === 'danger' || a.level === 'warn'; });
          if (!list.length) return;
          var at = atLocal(date, rule.time || '09:00', 0);
          if (!at) return;
          out.push({
            id: 'alert|' + rule.id + '|' + date,
            at: at,
            title: '気になること ' + list.length + '件',
            body: list.slice(0, 3).map(function (a) {
              return (a.project ? a.project.title + '：' : '') + a.text;
            }).join('\n'),
            tag: 'alert-' + date,
            url: '#/home'
          });
        });
        return out;
      }
    }
  };

  /* from〜to にかかる 'YYYY-MM' を並べる */
  function monthsIn(from, to) {
    var out = [], ym = String(from).slice(0, 7), endYm = String(to).slice(0, 7), guard = 0;
    while (U.cmp(ym, endYm) <= 0 && guard++ < 40) {
      out.push(ym);
      ym = U.addYm(ym, 1);
    }
    return out;
  }

  function bodyOf(o) {
    var t = DL.events.timeText(o.ev);
    var parts = [t || '終日'];
    if (o.ev.memo) parts.push(String(o.ev.memo).split('\n')[0].slice(0, 60));
    return parts.join('　');
  }

  /**
   * その日のその時刻を、世界時の文字列にする。
   * サーバーに時差の判断をさせないため、送る前にここで直しておく。
   */
  function atLocal(date, time, offsetMin) {
    if (!U.isISO(date)) return null;
    var hm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''));
    if (!hm) return null;
    var d = U.parse(date);
    d.setHours(U.num(hm[1], 0), U.num(hm[2], 0) + U.num(offsetMin, 0), 0, 0);
    return d.toISOString();
  }

  /* ---------------- 予定そのものに付けたリマインダー ----------------

     「重要」にした予定には、日にちと時刻をいくつでも足せる。
     設定の決まりごと（KINDS）とは別の道で、こちらは常に作る。 */

  function leadText(days) {
    if (days <= 0) return '今日';
    if (days === 1) return '明日';
    return 'あと' + days + '日';
  }

  function eventReminders(from, to) {
    var out = [];
    var map = DL.events.byDay(from, U.addDays(to, 2));
    var seenAbs = {};
    Object.keys(map).sort().forEach(function (date) {
      map[date].forEach(function (o) {
        if (o.index !== 0) return;                  // またがる予定は初日だけ
        var ev = o.ev;
        if (!ev.important) return;                  // 重要にした予定のためのもの
        var list = ev.reminders || [];
        if (!list.length) return;
        if (DL.events.isDone(o)) return;            // 済ませたものは鳴らさない

        list.forEach(function (r) {
          var at = null, lead = '';
          if (r.mode === 'min') {
            if (!ev.start) return;                  // 終日には効かない
            at = atLocal(date, ev.start, -U.num(r.minutes, 30));
            lead = 'まもなく';
          } else if (r.mode === 'abs') {
            // 日時を決めたぶんは、その日以降でいちばん近い回に結び付ける
            var key = ev.id + '|' + r.id;
            if (seenAbs[key] || U.cmp(date, r.date) < 0) return;
            seenAbs[key] = true;
            at = atLocal(r.date, r.time, 0);
            lead = leadText(U.diffDays(r.date, date));
          } else {
            at = atLocal(U.addDays(date, -U.num(r.days, 0)), r.time, 0);
            lead = leadText(U.num(r.days, 0));
          }
          if (!at) return;
          out.push({
            id: 'rem|' + ev.id + '|' + r.id + (r.mode === 'abs' ? '' : '|' + date),
            at: at,
            title: lead + '　' + ev.title,
            body: U.fmtMDW(date) + '　' + bodyOf(o),
            tag: 'rem-' + ev.id + '-' + r.id,
            url: '#/day/' + date
          });
        });
      });
    });
    return out;
  }

  /* ---------------- 1日の時間に付けた知らせ ----------------

     円グラフの予定ごとに「始まるとき」「終わるとき」を選べる。
     設定の決まりごととは別の道で、印が付いていれば いつも作る。 */

  /** その日の0時から何分後か、を世界時の文字列にする（24時を超えたら翌日） */
  function atMin(date, min) {
    if (!U.isISO(date)) return null;
    var d = U.parse(date);
    d.setHours(0, Math.max(0, Math.round(U.num(min, 0))), 0, 0);
    return d.toISOString();
  }

  /* ---------------- 出かける前の雨 ----------------

     予報は3日ぶんしか無いので、作れるのもその範囲まで。
     アプリを開いて予報を取り直すたびに作り直して預け直すので
     （weather.load → notify.sync）、出かける前には新しい見立てになる。

     見る範囲は「知らせる時刻から、帰ってくるまで」。
       出社　　　その日のうち（23:59 まで）
       泊まり　　翌日の 10:00 まで
       リモート　出かけないので知らせない */

  function rainReminders(rule, from, to) {
    var W = DL.weather;
    if (!W || !W.place()) return [];
    var pop = Math.max(1, Math.min(100, U.num(rule.pop, RAIN_POP)));
    var out = [];
    U.rangeDays(from, to).forEach(function (date) {
      var duty = S.duty(date);
      if (duty !== 'office' && duty !== 'stay') return;
      var stay = duty === 'stay';
      var at = atLocal(date, (stay ? rule.stayTime : rule.officeTime)
        || (stay ? STAY_TIME : OFFICE_TIME), 0);
      var till = stay ? atLocal(U.addDays(date, 1), STAY_UNTIL, 0) : atLocal(date, '23:59', 0);
      if (!at || !till) return;
      var r = W.rainBetween(ms(at), ms(till), pop);
      if (!r) return;
      out.push({
        id: 'rain|' + rule.id + '|' + date,
        at: at,
        title: '傘を持って　' + (S.dutyLabel(duty) || 'おでかけ'),
        body: rainBody(r, date),
        tag: 'rain-' + date,
        url: '#/day/' + date
      });
    });
    return out;
  }

  function ms(iso) { return new Date(iso).getTime(); }

  /** 「7時ごろから 雨（降水確率80%・3時間）」。日をまたぐときは日付も添える */
  function rainBody(r, date) {
    var day = String(r.time).slice(0, 10);
    var head = (day === date ? '' : U.fmtMD(day) + ' ') + String(r.time).slice(11, 16);
    return head + 'ごろから' + r.label
      + '（降水確率 ' + Math.round(r.pop) + '%・' + r.hours + '時間）';
  }

  /** 雨とみなす降水確率。決まりごとに入れた値をそろって使う */
  function rainPop() {
    var r = rules().filter(function (x) { return x.kind === 'rain' && x.active !== false; })[0];
    return r ? Math.max(1, Math.min(100, U.num(r.pop, RAIN_POP))) : RAIN_POP;
  }

  function blockReminders(from, to) {
    var T = DL.timeblocks;
    var W = DL.weather;
    var pop = rainPop();
    var out = [];
    U.rangeDays(from, to).forEach(function (date) {
      S.timeblocks(date).forEach(function (b) {
        var span = T.fmtDay(b.start) + '〜' + T.fmtDay(b.end);
        var body = span + (b.memo ? '　' + b.memo : '');
        // 天気の知らせ。予報に雨があるときだけ、始まりの10分前に出す
        if (b.notifyRain && W && W.place()) {
          var r = W.rainBetween(ms(atMin(date, b.start)), ms(atMin(date, b.end)), pop);
          if (r) {
            out.push({
              id: 'tb|' + date + '|' + b.id + '|r',
              at: atMin(date, b.start - RAIN_LEAD),
              title: '傘を持って　' + b.label,
              body: span + '　' + rainBody(r, date),
              tag: 'tb-' + b.id + '-r',
              url: '#/day/' + date
            });
          }
        }
        if (b.notifyStart) {
          out.push({
            id: 'tb|' + date + '|' + b.id + '|s',
            at: atMin(date, b.start),
            title: 'はじまり　' + b.label,
            body: body,
            tag: 'tb-' + b.id + '-s',
            url: '#/day/' + date
          });
        }
        if (b.notifyEnd) {
          out.push({
            id: 'tb|' + date + '|' + b.id + '|e',
            at: atMin(date, b.end),
            title: 'おわり　' + b.label,
            body: body,
            tag: 'tb-' + b.id + '-e',
            url: '#/day/' + date
          });
        }
      });
    });
    return out.filter(function (x) { return x.at; });
  }

  /* ---------------- 予定表を組む ---------------- */

  /**
   * 有効な決まりごとを全部たどって、送る予定の一覧を作る。
   * @param {string} [from] 既定は今日
   * @returns {Array} [{id, at, title, body, tag, url}]
   */
  function build(from) {
    var start = from || U.today();
    var end = U.addDays(start, HORIZON_DAYS);
    var now = new Date().toISOString();
    var out = [];

    rules().forEach(function (r) {
      if (!r.active) return;
      var kind = KINDS[r.kind];
      if (!kind) return;
      var made;
      try { made = kind.build(r, start, end) || []; } catch (e) { made = []; }
      made.forEach(function (x) { if (x && x.at > now) out.push(x); });   // 過ぎたぶんは送らない
    });

    // 予定そのものに付けたリマインダー。設定の決まりごととは別に、いつも作る。
    // 「重要」にした予定を取りこぼさないための道なので、ここは止めない
    var made2;
    try { made2 = eventReminders(start, end); } catch (e) { made2 = []; }
    made2.forEach(function (x) { if (x && x.at > now) out.push(x); });

    // 1日の時間に付けた「始まり・終わり」の知らせ。これも決まりごととは別の道
    var made3;
    try { made3 = blockReminders(start, end); } catch (e) { made3 = []; }
    made3.forEach(function (x) { if (x && x.at > now) out.push(x); });

    // 同じ id は1つに。時刻の早い順
    var by = {};
    out.forEach(function (x) { by[x.id] = x; });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; })
      .slice(0, MAX_ITEMS);
  }

  /* ---------------- 決まりごと（設定） ---------------- */

  function settings() {
    var n = S.settings.notify;
    return n && typeof n === 'object' ? n : { enabled: false, rules: [] };
  }
  function rules() { return (settings().rules || []).slice(); }

  function defaultRules() {
    return [
      { id: U.uid(), kind: 'lifeEvent', active: true, when: 'beforeDay', time: '20:00', importantOnly: false },
      { id: U.uid(), kind: 'lifeEvent', active: true, when: 'onDay', time: '08:00', importantOnly: false },
      { id: U.uid(), kind: 'todo', active: true, when: 'onDay', time: '08:00' },
      { id: U.uid(), kind: 'rain', active: true, when: 'duty',
        officeTime: OFFICE_TIME, stayTime: STAY_TIME, pop: RAIN_POP }
    ];
  }

  /* ---------------- 端末の登録 ---------------- */

  function supported() {
    return typeof Notification !== 'undefined' &&
      'serviceWorker' in navigator && 'PushManager' in window;
  }

  /* iPhone は、ホーム画面に追加したアプリでしか通知を受け取れない */
  function standalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /** いま通知を使える状態か、使えないなら何が足りないか */
  function status() {
    if (!supported()) return { ok: false, why: 'この端末（ブラウザ）は通知に対応していません' };
    if (isIOS() && !standalone()) {
      return { ok: false, why: 'iPhone では、ホーム画面に追加したアプリからのみ通知を受け取れます。共有ボタン →「ホーム画面に追加」から開き直してください' };
    }
    if (Notification.permission === 'denied') {
      return { ok: false, why: '通知が拒否されています。端末の設定 → METEO365 → 通知 から許可してください' };
    }
    return { ok: true, permission: Notification.permission };
  }

  function deviceId() {
    var s = S.settings.notifyDevice || {};
    if (!s.id) {
      s.id = U.uid();
      S.updateSettings({ notifyDevice: s });
    }
    return s.id;
  }

  /* この端末で、いま何を宛先として預けてあるか（端末の中だけの控え） */
  function known() { return S.settings.notifyDevice || {}; }

  function remember(endpoint) {
    S.updateSettings({ notifyDevice: Object.assign({}, known(), {
      id: deviceId(), endpoint: String(endpoint || '').slice(0, 800),
      at: new Date().toISOString()
    }) });
  }

  /**
   * いまの宛先が、サーバーの鍵（VAPID）で作られたものか。
   * サーバーの鍵を入れ替えると、前の鍵で作った宛先は
   * 送っても弾かれる（403）。見た目は「急に来なくなった」になる。
   */
  function sameKey(sub, key) {
    try {
      var got = sub && sub.options && sub.options.applicationServerKey;
      if (!got || !key) return false;       // 確かめられないなら、作り直す
      var a = new Uint8Array(got), b = urlBase64ToUint8Array(key);
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    } catch (e) { return false; }
  }

  /**
   * いまの鍵で作った宛先を用意する。合っていなければ作り直す。
   * @returns {Promise<{sub:PushSubscription, made:boolean}>}
   */
  function subscribeFresh(reg, key) {
    return reg.pushManager.getSubscription().then(function (cur) {
      if (cur && sameKey(cur, key)) return { sub: cur, made: false };
      var drop = cur ? cur.unsubscribe().catch(function () { }) : Promise.resolve();
      return drop.then(function () {
        return reg.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key)
        });
      }).then(function (sub) { return { sub: sub, made: true }; });
    });
  }

  function putSub(sub) {
    var json = sub.toJSON ? sub.toJSON() : sub;
    return api('PUT', '/v1/push/sub', {
      sub: json,
      deviceId: deviceId(),
      name: (S.settings.sync && S.settings.sync.deviceName) || ''
    }).then(function (r) { remember(json.endpoint); return r; });
  }

  /**
   * この端末が、いまも宛先として登録されているか確かめ、外れていれば入れ直す。
   *
   * 通知が「設定を触っていないのに来なくなる」のは、たいていこの2つ。
   *   ・ブラウザの都合で宛先が作り直された（そのままでは届かない）
   *   ・サーバーの鍵を入れ替えた（前の鍵の宛先は弾かれる）
   * どちらも黙って直せるので、アプリを開いたときに直しておく。
   * @returns {Promise<{ok:boolean, fixed?:boolean, why?:string}>}
   */
  function check() {
    if (!settings().enabled) return Promise.resolve({ ok: false, why: 'off' });
    if (!DL.sync.active()) return Promise.resolve({ ok: false, why: 'nosync' });
    if (!supported() || Notification.permission !== 'granted') {
      return Promise.resolve({ ok: false, why: 'perm' });
    }
    return state().then(function (st) {
      if (!st || !st.vapidPublic) return { ok: false, why: 'nokey' };
      var here = (st.subs || []).filter(function (x) { return x.deviceId === deviceId(); })[0];
      return navigator.serviceWorker.ready.then(function (reg) {
        return subscribeFresh(reg, st.vapidPublic).then(function (r) {
          var json = r.sub.toJSON ? r.sub.toJSON() : r.sub;
          // 向こうに無い・作り直した・前と違う宛先 のどれかなら、入れ直す
          if (here && !r.made && known().endpoint === json.endpoint) return { ok: true };
          return putSub(r.sub).then(function () { return { ok: true, fixed: true }; });
        });
      });
    }).catch(function (e) {
      return { ok: false, why: String((e && e.message) || e) };
    });
  }

  /**
   * 通知を許可してもらい、この端末を宛先として登録する。
   * @returns {Promise<{ok:boolean, why?:string}>}
   */
  function enable() {
    var st = status();
    if (!st.ok) return Promise.resolve(st);
    if (!DL.sync.active()) {
      return Promise.resolve({ ok: false, why: '先に「PC・iPhone の同期」を設定してください（通知は同期サーバーから送ります）' });
    }

    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') return { ok: false, why: '通知が許可されませんでした' };
      return serverKey().then(function (key) {
        if (!key) return { ok: false, why: 'サーバーに通知の鍵（VAPID）が設定されていません' };
        return navigator.serviceWorker.ready.then(function (reg) {
          /* いまの宛先をそのまま使い回さない。サーバーの鍵を入れ替えていると、
             前の鍵で作った宛先はいくら送っても弾かれる */
          return subscribeFresh(reg, key);
        }).then(function (r) {
          return putSub(r.sub);
        }).then(function () {
          S.updateSettings({ notify: Object.assign({}, settings(), { enabled: true }) });
          return sync();
        }).then(function () { return { ok: true }; });
      });
    }).catch(function (e) {
      return { ok: false, why: String((e && e.message) || e) };
    });
  }

  /** この端末を宛先から外す（他の端末はそのまま） */
  function disable() {
    return api('DELETE', '/v1/push/sub', { deviceId: deviceId() })
      .catch(function () { /* 届かなくても手元は止める */ })
      .then(function () {
        S.updateSettings({ notify: Object.assign({}, settings(), { enabled: false }) });
        if (!('serviceWorker' in navigator)) return null;
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription();
        }).then(function (sub) { return sub && sub.unsubscribe(); }).catch(function () { });
      });
  }

  /* 予定表をサーバーへ預け直す。データを直したあとに呼ぶ */
  function sync() {
    if (!settings().enabled || !DL.sync.active()) return Promise.resolve(null);
    var items = build();
    return api('PUT', '/v1/push/queue', { items: items })
      .then(function (r) { return { queued: items.length, server: r }; });
  }

  function state() { return api('GET', '/v1/push/state'); }
  function testSend() { return api('POST', '/v1/push/test'); }

  function serverKey() {
    return state().then(function (s) { return s && s.vapidPublic; })
      .catch(function () { return null; });
  }

  /* ---------------- サーバーとのやりとり ---------------- */

  function api(method, path, body) {
    var sy = S.settings.sync || {};
    if (!sy.url || !sy.token) return Promise.reject(new Error('同期の接続先が未設定です'));
    return fetch(String(sy.url).replace(/\/+$/, '') + path, {
      method: method,
      headers: Object.assign({ authorization: 'Bearer ' + sy.token },
        body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
        return j;
      });
    });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  DL.notify = {
    KINDS: KINDS, build: build, rules: rules, settings: settings, defaultRules: defaultRules,
    status: status, supported: supported, standalone: standalone,
    enable: enable, disable: disable, sync: sync, state: state, testSend: testSend,
    check: check, deviceId: deviceId,
    atLocal: atLocal, eventReminders: eventReminders, blockReminders: blockReminders,
    rainReminders: rainReminders, rainPop: rainPop, RAIN_LEAD: RAIN_LEAD,
    OFFICE_TIME: OFFICE_TIME, STAY_TIME: STAY_TIME, STAY_UNTIL: STAY_UNTIL
  };
})(window.DL);
