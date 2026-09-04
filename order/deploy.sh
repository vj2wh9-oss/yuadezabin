#!/usr/bin/env bash
# 発注ページと、その受け口をまとめて公開する。
#
#   cd order
#   ./deploy.sh
#
# 聞かれるのは2つだけです。
#   1. 同期サーバーの URL（アプリの 設定 →「同期」→「接続先」と同じもの）
#   2. 同期の合鍵（アプリの 設定 →「同期」→「合鍵をコピー」で取れるもの）
#
# 合鍵は wrangler が直接 Cloudflare へ渡します。
# この端末のファイルにも、画面にも残りません。

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
sync_dir="$(cd "$here/.." && pwd)/sync"
conf="$here/wrangler.jsonc"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31mやめました：%s\033[0m\n' "$*" >&2; exit 1; }

wr() { npx --yes wrangler@4 "$@"; }

# ---------------------------------------------------------------- 下ごしらえ

say "0. 下ごしらえ"

command -v node >/dev/null 2>&1 || die "Node.js が要ります（https://nodejs.org/）"
note "Node.js $(node -v)"

[ -f "$conf" ] || die "$conf が見つかりません。order フォルダの中で実行してください"
[ -f "$sync_dir/wrangler.jsonc" ] || die "$sync_dir が見つかりません"

if ! wr whoami >/dev/null 2>&1; then
  note "Cloudflare にログインします（ブラウザが開きます）"
  wr login
fi
note "$(wr whoami 2>/dev/null | grep -i 'account' | head -1 || echo 'ログイン済み')"

# ---------------------------------------------------------------- 聞くこと

say "1. 同期サーバーのこと"

cur_url="$(sed -n 's/.*"SYNC_URL"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$conf" | head -1)"
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
if ! curl -fsS --max-time 15 "$sync_url/health" >/dev/null 2>&1; then
  die "$sync_url につながりませんでした。URL をお確かめください"
fi
note "つながりました"

# ---------------------------------------------------------------- KV

say "2. 発注の置き場（KV）を用意する"

kv_id="$(sed -n 's/.*"binding"[[:space:]]*:[[:space:]]*"ORDERS"[[:space:]]*,[[:space:]]*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$conf" | head -1)"

if printf '%s' "$kv_id" | grep -qE '^[0-9a-f]{32}$'; then
  note "すでにあります（$kv_id）。作り直しません"
else
  note "作っています…"
  out="$(wr kv namespace create ORDERS 2>&1 || true)"
  kv_id="$(printf '%s' "$out" | grep -oE '[0-9a-f]{32}' | head -1)"
  [ -n "$kv_id" ] || { printf '%s\n' "$out"; die "KV を作れませんでした（上の出力をご確認ください）"; }
  note "できました（$kv_id）"
fi

# ---------------------------------------------------------------- 設定を書く

say "3. 設定ファイルを書き替える"

cp "$conf" "$conf.bak"
note "控え：$conf.bak"

python3 - "$conf" "$kv_id" "$sync_url" <<'PY'
import re, sys
path, kv_id, sync_url = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path, encoding='utf-8').read()

# ORDERS の id
s2, n = re.subn(r'("binding"\s*:\s*"ORDERS"\s*,\s*"id"\s*:\s*")[^"]*(")',
                lambda m: m.group(1) + kv_id + m.group(2), s)
if n != 1:
    sys.exit('wrangler.jsonc の ORDERS の id を見つけられませんでした')

# SYNC_URL
s3, n = re.subn(r'("SYNC_URL"\s*:\s*")[^"]*(")',
                lambda m: m.group(1) + sync_url + m.group(2), s2)
if n != 1:
    sys.exit('wrangler.jsonc の SYNC_URL を見つけられませんでした')

open(path, 'w', encoding='utf-8').write(s3)
PY
note "書き替えました"

# ---------------------------------------------------------------- 合鍵

say "4. 同期の合鍵を預ける"
note "アプリの 設定 →「PC・iPhone の同期」→「合鍵をコピー」で取れます。"
note "貼り付けても画面には出ません（そういう入力です）。"
note "この合鍵は Cloudflare へ直接渡り、この端末には残りません。"
echo
wr secret put SYNC_TOKEN --config "$conf"

# 連投よけの塩。中身は何でもよいので、こちらで作って渡す
say "5. 連投よけの塩を預ける"
if command -v openssl >/dev/null 2>&1; then
  salt="$(openssl rand -hex 24)"
else
  salt="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
fi
printf '%s' "$salt" | wr secret put RL_SALT --config "$conf"
unset salt
note "できました"

# ---------------------------------------------------------------- 公開

say "6. 同期サーバーを新しくする"
note "発注の受け口（/v1/inbox/order）を足したものに入れ替えます"
( cd "$sync_dir" && wr deploy )

say "7. 発注ページを公開する"
( cd "$here" && wr deploy )

# ---------------------------------------------------------------- 確かめ

say "8. 動いているか確かめる"
sleep 5
if health="$(curl -fsS --max-time 20 https://yuadezabin.com/api/health 2>/dev/null)"; then
  printf '  %s\n' "$health"
  printf '%s' "$health" | grep -q '"sync":true' \
    && note "同期サーバーへの道：つながっています" \
    || note "※ 同期サーバーへの道が未設定です。4. の合鍵をやり直してください"
  printf '%s' "$health" | grep -q '"mail":true' \
    || note "※ メールの送り口がまだです。README の手順3（Email Routing）をご覧ください"
else
  note "※ まだ応答がありません。数分おいて https://yuadezabin.com/api/health を開いてみてください"
fi

say "できました"
note "発注ページ　https://yuadezabin.com/"
note "様子見　　　https://yuadezabin.com/api/health"
note "アプリ側　　設定 →「発注フォーム」→「受け口があるか確かめる」"
echo
