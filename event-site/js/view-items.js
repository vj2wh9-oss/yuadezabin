/* 頒布物。持ち込んだ数と、イベントが終わってから数えた在庫を入れる。
   「在庫締め」を押すと METEO365 へ送る。 */
(function (DL) {
  'use strict';
  var U = DL.util, ui = DL.ui, S = DL.store, el = U.el;

  var sending = false;

  function render(root) {
    var id = S.state.eventId;
    var one = S.state.one;
    var wrap = el('div', { class: 'page' });

    if (!one) {
      wrap.appendChild(ui.empty('読み込めませんでした。',
        ui.btn('読み直す', 'primary', function () { DL.app.open(id); }, 'refresh')));
      root.appendChild(wrap);
      return;
    }

    wrap.appendChild(head(one.event));

    var rows = S.lines(id);
    wrap.appendChild(ui.section('頒布物', el('div', { class: 'row-wrap' }, [
      ui.chip(rows.length + '点', 'ghosty'),
      ui.btn('足す', 'tiny', function () { addSheet(id); }, 'plus')
    ])));

    if (!rows.length) {
      wrap.appendChild(ui.empty('この券に持っていく頒布物がありません。'));
    } else {
      wrap.appendChild(el('div', { class: 'it-list' }, rows.map(function (x) {
        return row(id, x);
      })));
    }

    // 隠したものは、戻せるように名前だけ出しておく
    var off = S.hidden(id);
    if (off.length) {
      wrap.appendChild(ui.section('隠したもの', ui.chip(off.length + '点', 'ghosty')));
      wrap.appendChild(el('div', { class: 'row-wrap' }, off.map(function (x) {
        return ui.btn(x.title, 'tiny', function () {
          S.show(id, x.itemId);
          DL.app.render();
        }, 'eye');
      })));
    }

    wrap.appendChild(foot(id, rows));
    root.appendChild(wrap);
  }

  /* 券の顔。どのイベントを見ているか、いつも見えるようにしておく */
  function head(ev) {
    var box = el('div', { class: 'it-head' });
    if (ev.logo) {
      DL.api.pic(ev.logo).then(function (src) {
        if (src) box.insertBefore(el('img', { class: 'it-head-logo', src: src, alt: '' }), box.firstChild);
      });
    }
    box.appendChild(el('div', { class: 'it-head-main' }, [
      el('div', { class: 'it-head-n', text: ev.name }),
      el('div', { class: 'ev-sub' }, [
        U.isISO(ev.date) ? ui.chip(U.fmtMD(ev.date), 'ghosty') : null,
        ev.venue ? ui.chip(ev.venue, 'ghosty') : null,
        ev.space ? ui.chip(ev.space, 'soft') : null
      ])
    ]));
    return box;
  }

  /* 1点ぶん。持ち込みと持ち帰りを入れると、販売数が出る */
  function row(id, x) {
    var cover = el('span', { class: 'it-cover none' },
      ui.icon(x.kind === 'goods' ? 'star' : 'book', 18));
    if (x.cover) {
      DL.api.pic(x.cover).then(function (src) {
        if (!src) return;
        var img = el('img', { class: 'it-cover', src: src, alt: '' });
        if (cover.parentNode) cover.parentNode.replaceChild(img, cover);
      });
    }

    var sold = el('b', { class: 'it-sold' });
    function drawSold() {
      var bring = Math.max(0, U.num(bringIn ? bringIn.value : x.bring, 0));
      var v = backIn.value.trim();
      if (v === '') { sold.textContent = '—'; sold.classList.remove('on'); return; }
      var n = Math.max(0, bring - Math.min(bring, Math.max(0, U.num(v, 0))));
      sold.textContent = String(n);
      sold.classList.toggle('on', n > 0);
    }

    /* 持ち込みは、会場で足したものだけ直せる。
       METEO365 で入れてあるぶんは、そちらが正なので触らない */
    var bringIn = null;
    var bringNode;
    if (x.added) {
      bringIn = ui.input({
        type: 'number', inputmode: 'numeric', min: 0, class: 'it-in',
        value: String(U.num(x.bring, 0)), 'aria-label': x.title + 'の持ち込み'
      });
      var putBring = function () {
        S.setBring(id, x.itemId, bringIn.value);
        drawSold();
        drawFoot();
      };
      bringIn.addEventListener('change', putBring);
      bringIn.addEventListener('blur', putBring);
      bringNode = bringIn;
    } else {
      bringNode = el('b', { class: 'it-sold', text: String(U.num(x.bring, 0)) });
    }

    var backIn = ui.input({
      type: 'number', inputmode: 'numeric', min: 0, class: 'it-in',
      value: x.back == null ? '' : String(x.back),
      placeholder: '—', 'aria-label': x.title + 'の在庫'
    });
    var putBack = function () {
      S.setBack(id, x.itemId, backIn.value);
      drawSold();
      drawFoot();
    };
    backIn.addEventListener('change', putBack);
    backIn.addEventListener('blur', putBack);
    drawSold();

    return el('div', { class: 'it-row' }, [
      cover,
      el('div', { class: 'it-main' }, [
        el('div', { class: 'it-name', text: x.title }),
        el('div', { class: 'it-sub' }, [
          x.price ? ui.chip(U.yen(x.price), 'ghosty') : null,
          x.added ? ui.chip('会場で追加', 'soft') : null
        ]),
        el('div', { class: 'it-nums' }, [
          el('span', { class: 'it-num' }, [
            el('span', { class: 'it-lbl', text: '持込' }), bringNode
          ]),
          el('span', { class: 'it-num' }, [
            el('span', { class: 'it-lbl', text: '在庫' }), backIn
          ]),
          el('span', { class: 'it-num' }, [
            el('span', { class: 'it-lbl', text: '頒布' }), sold
          ])
        ])
      ]),
      el('div', { class: 'it-acts' },
        el('button', {
          type: 'button', class: 'iconbtn', 'aria-label': x.title + 'を隠す',
          onclick: function () {
            S.hide(id, x.itemId);
            DL.app.render();
          }
        }, ui.icon('eyeOff', 18)))
    ]);
  }

  /* 下に貼り付く締めの帯。数えながらでも、いつでも押せる */
  var footBox = null;

  function foot(id, rows) {
    footBox = el('div', { class: 'it-foot' });
    drawFoot(id, rows);
    return footBox;
  }

  function drawFoot(id, rows) {
    if (!footBox) return;
    id = id || S.state.eventId;
    rows = rows || S.lines(id);
    var sum = S.sum(id);
    U.clear(footBox);
    footBox.appendChild(el('div', { class: 'it-sum' }, [
      ui.chip('数えた ' + sum.counted + ' / ' + sum.all + '点',
        sum.all && sum.counted >= sum.all ? 'ok' : 'ghosty'),
      ui.chip('頒布 ' + sum.sold + '部', sum.sold ? 'ok' : 'ghosty'),
      ui.chip(U.yen(sum.revenue), 'soft')
    ]));
    footBox.appendChild(ui.btn(
      sending ? '送っています…' : '在庫締め',
      'primary full big' + (sending || !sum.all ? ' disabled' : ''),
      function () { close(id); }, 'check'));
  }

  /* 在庫締め。数えたぶんを METEO365 へ送る */
  function close(id) {
    if (sending) return;
    var rows = S.lines(id);
    var sum = S.sum(id);
    if (!rows.length) return;
    var yet = sum.all - sum.counted;
    ui.confirm(
      '頒布 ' + sum.sold + '部（' + U.yen(sum.revenue) + '）を METEO365 へ送ります。'
        + (yet ? '\n\nまだ数えていないものが ' + yet + '点あります。'
          + 'そのぶんは「数えていない」として送ります。' : ''),
      { okText: '送る' }
    ).then(function (ok) {
      if (!ok) return;
      sending = true;
      drawFoot(id, rows);
      DL.api.close({
        ticketId: id,
        ticketName: (S.state.one && S.state.one.event && S.state.one.event.name) || '',
        lines: rows.map(function (x) {
          return {
            itemId: x.itemId, title: x.title,
            bring: Math.max(0, U.num(x.bring, 0)),
            back: x.back == null ? null : Math.max(0, U.num(x.back, 0))
          };
        })
      }).then(function () {
        sending = false;
        S.done(id);
        ui.toast('送りました。METEO365 のチケットから取り込めます', 'ok');
        DL.app.open(id);
      }, function (e) {
        sending = false;
        drawFoot(id, rows);
        ui.toast(e.message, 'danger');
      });
    });
  }

  /* 会場で足す。METEO365 に登録してある頒布物から選ぶ */
  function addSheet(id) {
    var rest = S.more(id);
    var body = el('div');
    if (!rest.length) {
      body.appendChild(ui.empty('足せるものがありません。'));
    } else {
      body.appendChild(el('div', { class: 'it-list' }, rest.map(function (x) {
        var cover = el('span', { class: 'pick-cover' });
        if (x.cover) {
          DL.api.pic(x.cover).then(function (src) {
            if (src) cover.style.backgroundImage = 'url(' + src + ')';
            cover.style.backgroundSize = 'cover';
          });
        }
        return el('button', {
          type: 'button', class: 'pick-row',
          onclick: function () {
            S.add(id, x);
            closeSheet();
            DL.app.render();
            ui.toast(x.title + ' を足しました');
          }
        }, [
          cover,
          el('div', { class: 'pick-main' }, [
            el('div', { class: 'pick-n', text: x.title }),
            el('div', { class: 'it-sub' }, [
              ui.chip(x.kind === 'goods' ? 'グッズ' : '本', 'ghosty'),
              x.price ? ui.chip(U.yen(x.price), 'ghosty') : null
            ])
          ]),
          ui.icon('plus', 18)
        ]);
      })));
    }
    var closeSheet = ui.sheet({ title: '頒布物を足す', body: body });
  }

  DL.views = DL.views || {};
  DL.views.items = { render: render };
})(window.DL = window.DL || {});
