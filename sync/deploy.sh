#!/usr/bin/env bash
# 同期サーバー（Worker）を deploy するだけ。送り先の登録は setup.sh のほう。
#
#   git bash で、どこにいても動く：
#     bash ~/yuadezabin/sync/deploy.sh
#
# このファイル自身の場所へ移ってから動く。wrangler は設定ファイル
# （wrangler.jsonc）のあるところで動かす必要があり、それ以外の場所だと
# 「Required Worker name missing」になる。

set -u

cd "$(dirname "$0")" || exit 1

echo "場所　　: $(pwd)"
if [ ! -f wrangler.jsonc ]; then
  echo "！ wrangler.jsonc がありません。sync フォルダに置いてください。"
  exit 1
fi
NAME="$(grep -o '"name"[^,]*' wrangler.jsonc | head -1 | cut -d'"' -f4)"
echo "Worker　: $NAME"

# git bash では wrangler / wrangler.cmd / npx のどれが通るか環境で違う
WR=""
for c in wrangler wrangler.cmd; do
  if command -v "$c" >/dev/null 2>&1; then WR="$c"; break; fi
done
if [ -z "$WR" ] && command -v npx >/dev/null 2>&1; then
  WR="npx --no-install wrangler"
fi
if [ -z "$WR" ]; then
  echo "！ wrangler が見つかりません。npm i -g wrangler で入れてください。"
  exit 1
fi
echo "wrangler: $WR"
echo

if ! $WR deploy; then
  echo
  echo "！ deploy に失敗しました。上の出力を見てください。"
  exit 1
fi

echo
echo "できました。ブラウザで Worker の /health を開くと、支度ができているか見られます。"
echo "（URL は上の deploy の出力にある https://$NAME.…workers.dev）"
