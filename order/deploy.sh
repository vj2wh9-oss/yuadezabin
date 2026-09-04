#!/usr/bin/env bash
# 発注ページと、その受け口をまとめて公開する。
#
#   cd order
#   bash deploy.sh
#
# 聞かれるのは2つだけです。
#   1. 同期サーバーの URL（アプリの 設定 →「同期」→「接続先」と同じもの）
#   2. 同期の合鍵（アプリの 設定 →「同期」→「合鍵をコピー」で取れるもの）
#
# 合鍵は wrangler が直接 Cloudflare へ渡します。
# この端末のファイルにも、画面にも残りません。
#
# 要るもの：Node.js と、bash が動く環境
#   Windows … Git for Windows に付いてくる「Git Bash」
#   Mac / Linux … 標準のターミナル
# Python は要りません（設定の書き替えも Node.js で行います）。

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
sync_dir="$(cd "$here/.." && pwd)/sync"
conf="$here/wrangler.jsonc"          # 元。git の管理下。触らない
local_conf="$here/wrangler.local.jsonc"   # 作業用。git には入れない

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31mやめました：%s\033[0m\n' "$*" >&2; exit 1; }

wr() { npx --yes wrangler@4 "$@"; }

# 設定ファイルを読み書きする小さな道具。Node.js だけで動く
conf_get() { node "$here/.deploy-conf.cjs" get "$conf" "$1"; }

# ---------------------------------------------------------------- 下ごしらえ

say "0. 下ごしらえ"

command -v node >/dev/null 2>&1 || die "Node.js が要ります（https://nodejs.org/ から入れてください）"
note "Node.js $(node -v)"

[ -f "$conf" ] || die "$conf が見つかりません。order フォルダの中で実行してください"
[ -f "$sync_dir/wrangler.jsonc" ] || die "$sync_dir が見つかりません"

# 設定を読み書きする道具を、そのつど作る（リポジトリには置かない）
cat > "$here/.deploy-conf.cjs" <<'JS'
// wrangler.jsonc の中の1か所だけを読む／書き替える。
// コメント付きの JSON なので、JSON.parse は使わず、その場所だけを見る。
const fs = require('fs');
const [, , op, path, what, value] = process.argv;
const src = fs.readFileSync(path, 'utf8');

const RE = {
  syncUrl: /("SYNC_URL"\s*:\s*")([^"]*)(")/,
  kvId: /("binding"\s*:\s*"ORDERS"\s*,\s*"id"\s*:\s*")([^"]*)(")/,
  site: /("pattern"\s*:\s*")([^"]*)(")/
};

// get … テンプレから1か所を読む
if (op === 'get') {
  const re = RE[what];
  if (!re) { console.error('不明な項目: ' + what); process.exit(1); }
  const m = src.match(re);
  if (!m) { console.error('wrangler.jsonc に ' + what + ' が見つかりません'); process.exit(1); }
  process.stdout.write(m[2]);
  process.exit(0);
}

// build … テンプレを元に、作業用の設定を別ファイルへ書き出す。
// テンプレ（git の管理下）には一切手を入れないので、あとから git pull できる。
if (op === 'build') {
  const [kvId, syncUrl, out] = process.argv.slice(5);
  let t = src;
  t = t.replace(RE.kvId, (s, a, _b, c) => a + kvId + c);
  t = t.replace(RE.syncUrl, (s, a, _b, c) => a + syncUrl + c);
  t = '// deploy.sh が作った作業用の設定です。直さないでください。\n'
    + '// 直すときは wrangler.jsonc のほうを直します。\n' + t;
  fs.writeFileSync(out, t, 'utf8');
  process.exit(0);
}

console.error('不明な操作: ' + op);
process.exit(1);
JS
trap 'rm -f "$here/.deploy-conf.cjs"' EXIT

if ! wr whoami >/dev/null 2>&1; then
  note "Cloudflare にログインします（ブラウザが開きます）"
  wr login
fi
note "Cloudflare にログイン済みです"

# ---------------------------------------------------------------- 聞くこと

say "1. 同期サーバーのこと"

cur_url="$(conf_get syncUrl)"
note "いまの設定：$cur_url"
printf '  同期サーバーの URL を入れてください（そのままで良ければ Enter）\n  > '
read -r sync_url
[ -n "$sync_url" ] || sync_url="$cur_url"
sync_url="${sync_url%/}"

case "$sync_url" in
  https://*) ;;
  *) die "URL は https:// で始まる必要があります" ;;
esac
case "$sync_url" in
  *example.workers.dev) die "URL が例のままです。アプリの 設定 →「同期」→「接続先」の値を入れてください" ;;
esac

note "つながるか確かめています…"
curl -fsS --max-time 15 "$sync_url/health" >/dev/null 2>&1 \
  || die "$sync_url につながりませんでした。URL をお確かめください"
note "つながりました"

# ---------------------------------------------------------------- KV

say "2. 発注の置き場（KV）を用意する"

# Cloudflare 側の一覧から探す。設定ファイルの中身に頼らないので、
# 何度走らせても増えない（前回どこまで進んだかを気にしなくてよい）
note "すでにあるか見ています…"
kv_id="$(wr kv namespace list 2>/dev/null | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b < a) return;
  let list; try { list = JSON.parse(s.slice(a, b + 1)); } catch (e) { return; }
  const hit = (list || []).find(n => /(^|-)ORDERS$/.test(String(n.title || "")));
  if (hit) process.stdout.write(String(hit.id || ""));
});' || true)"

if printf '%s' "$kv_id" | grep -qE '^[0-9a-f]{32}$'; then
  note "見つかりました（$kv_id）。作り直しません"
else
  note "無いので作ります…"
  out="$(wr kv namespace create ORDERS 2>&1 || true)"
  kv_id="$(printf '%s' "$out" | grep -oE '[0-9a-f]{32}' | head -1)"
  [ -n "$kv_id" ] || { printf '%s\n' "$out"; die "KV を作れませんでした（上の出力をご確認ください）"; }
  note "できました（$kv_id）"
fi

# ---------------------------------------------------------------- 設定を書く

say "3. 作業用の設定を書き出す"
# wrangler.jsonc（git の管理下）には手を入れない。
# 手を入れると、次に git pull したときに弾かれてしまう。
node "$here/.deploy-conf.cjs" build "$conf" - "$kv_id" "$sync_url" "$local_conf"
note "$(basename "$local_conf") を作りました（git には入りません）"

# ---------------------------------------------------------------- 合鍵

say "4. 同期の合鍵を預ける"
note "アプリの 設定 →「PC・iPhone の同期」→「合鍵をコピー」で取れます。"
note "貼り付けても画面には出ません（そういう入力です）。"
note "合鍵は Cloudflare へ直接渡り、この端末には残りません。"
echo
if wr secret list --config "$local_conf" 2>/dev/null | grep -q SYNC_TOKEN; then
  note "すでに預けてあります。"
  printf '  入れ直しますか？（そのままで良ければ Enter、入れ直すなら y）\n  > '
  read -r again
  case "$again" in
    [yY]*) ( cd "$here" && wr secret put SYNC_TOKEN --config "$local_conf" ) ;;
    *) note "そのまま使います" ;;
  esac
else
  ( cd "$here" && wr secret put SYNC_TOKEN --config "$local_conf" )
fi

say "5. 連投よけの塩を預ける"
# 中身は何でもよいので、こちらで作って渡す（画面には出さない）
node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))' \
  | ( cd "$here" && wr secret put RL_SALT --config "$local_conf" )
note "できました"

# ---------------------------------------------------------------- 公開

say "6. 同期サーバーを新しくする"
note "発注の受け口（/v1/inbox/order）を足したものに入れ替えます"
( cd "$sync_dir" && wr deploy )

say "7. 発注ページを公開する"
( cd "$here" && wr deploy --config "$local_conf" )

# ---------------------------------------------------------------- 確かめ

say "8. 動いているか確かめる"
site="$(conf_get site)"
note "$site を見に行きます（DNS が行き渡るまで少しかかることがあります）"
sleep 8
if health="$(curl -fsS --max-time 20 "https://$site/api/health" 2>/dev/null)"; then
  printf '  %s\n' "$health"
  case "$health" in
    *'"sync":true'*) note "同期サーバーへの道：つながっています" ;;
    *) note "※ 同期サーバーへの道が未設定です。4. の合鍵をやり直してください" ;;
  esac
  case "$health" in
    *'"mail":true'*) note "メールの送り口：あります" ;;
    *) note "※ メールの送り口がまだです。README の手順3（Email Routing）をご覧ください" ;;
  esac
else
  note "※ まだ応答がありません。数分おいて https://$site/api/health を開いてみてください"
fi

say "できました"
note "発注ページ　https://$site/"
note "様子見　　　https://$site/api/health"
note "アプリ側　　設定 →「発注フォーム」→「受け口があるか確かめる」"
echo
