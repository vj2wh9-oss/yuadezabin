/* 無圧縮ZIPの組み立て。
   共有ファイルをまとめて手元に落とすためだけに使う。
   画像・PDF・動画は圧縮がほとんど効かないので、素直に並べる（store方式）。
   外部ライブラリを持ち込まないための最小実装。 */
(function (DL) {
  'use strict';

  var TABLE = null;
  function table() {
    if (TABLE) return TABLE;
    TABLE = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      TABLE[i] = c >>> 0;
    }
    return TABLE;
  }

  function crc32(bytes) {
    var t = table(), c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ZIP は MS-DOS 時代の日付形式を使う */
  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  }
  function dosDate(d) {
    var y = Math.max(1980, d.getFullYear());
    return (((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  function writer(size) {
    var buf = new Uint8Array(size), p = 0;
    return {
      u16: function (v) { buf[p++] = v & 0xFF; buf[p++] = (v >>> 8) & 0xFF; return this; },
      u32: function (v) {
        buf[p++] = v & 0xFF; buf[p++] = (v >>> 8) & 0xFF;
        buf[p++] = (v >>> 16) & 0xFF; buf[p++] = (v >>> 24) & 0xFF; return this;
      },
      bytes: function (b) { buf.set(b, p); p += b.length; return this; },
      done: function () { return buf; }
    };
  }

  /* 同じ名前が来たら「(2)」を足して重ならないようにする */
  function uniqueName(name, used) {
    if (!used[name]) { used[name] = 1; return name; }
    var dot = name.lastIndexOf('.');
    var stem = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var n = used[name] + 1;
    while (used[stem + '(' + n + ')' + ext]) n++;
    used[name] = n;
    var out = stem + '(' + n + ')' + ext;
    used[out] = 1;
    return out;
  }

  /**
   * ZIP を組み立てる。
   * @param {Array<{name:string, data:Uint8Array, date?:Date}>} entries
   * @returns {Blob}
   */
  function build(entries) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0, used = {};

    entries.forEach(function (e) {
      var name = enc.encode(uniqueName(e.name || 'file', used));
      var data = e.data;
      var crc = crc32(data);
      var d = e.date || new Date();
      var t = dosTime(d), dt = dosDate(d);

      var local = writer(30 + name.length);
      local.u32(0x04034b50);            // ローカルファイルヘッダの目印
      local.u16(20);                    // 展開に必要なバージョン
      local.u16(0x0800);                // 名前は UTF-8
      local.u16(0);                     // 無圧縮
      local.u16(t).u16(dt).u32(crc).u32(data.length).u32(data.length);
      local.u16(name.length).u16(0).bytes(name);

      parts.push(local.done(), data);

      var cd = writer(46 + name.length);
      cd.u32(0x02014b50);
      cd.u16(20).u16(20).u16(0x0800).u16(0);
      cd.u16(t).u16(dt).u32(crc).u32(data.length).u32(data.length);
      cd.u16(name.length).u16(0).u16(0);   // 名前長・extra・コメント
      cd.u16(0).u16(0).u32(0);             // ディスク番号・内部属性・外部属性
      cd.u32(offset).bytes(name);
      central.push(cd.done());

      offset += 30 + name.length + data.length;
    });

    var cdSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = writer(22);
    end.u32(0x06054b50).u16(0).u16(0);
    end.u16(entries.length).u16(entries.length);
    end.u32(cdSize).u32(offset).u16(0);

    return new Blob(parts.concat(central, [end.done()]), { type: 'application/zip' });
  }

  DL.zip = { build: build, crc32: crc32 };
})(window.DL);
