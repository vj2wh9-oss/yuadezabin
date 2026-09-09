#!/usr/bin/env bash
# 同期サーバー（Worker）の送り先を入れて、deploy する。
#
#   git bash で、どこにいても動く：
#     bash ~/yuadezabin/sync/setup.sh
#
# フォルダを移動しなくてよいように、このファイル自身の場所へ移ってから動く。
# wrangler は設定ファイル（wrangler.jsonc）のあるところで動かす必要があり、
# それ以外の場所だと「Required Worker name missing」になる。
#
# Webhook の URL は bash が受け取って、そのまま wrangler に渡す。
# コマンドの履歴には残らない。

set -u

cd "$(dirname "$0")" || exit 1

echo "場所　　: $(pwd)"
if [ ! -f wrangler.jsonc ]; then
  echo "！ wrangler.jsonc がありません。sync フォルダに置いてください。"
  exit 1
fi
NAME="$(grep -o '"name"[^,]*' wrangler.jsonc | head -1 | cut -d'"' -f4)"
echo "Worker　: $NAME"

# ---- wrangler を探す ----------------------------------------------
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

# ---- 送り先（Webhook）を入れる -------------------------------------
# 空のまま Enter を押せば飛ばす。もう入れてあるものはそのまま残る。

FAILED=0

put_secret() {
  key="$1"; what="$2"
  printf '\n%s\n' "── $what"
  printf '   %s\n   URL（そのまま Enter で飛ばす）: ' "$key"
  IFS= read -r val
  if [ -z "$val" ]; then
    echo "   → 飛ばしました"
    return 0
  fi
  if printf '%s' "$val" | $WR secret put "$key"; then
    echo "   → 入れました"
  else
    echo "   → 入れられませんでした（上の出力を見てください）"
    FAILED=1
  fi
}

echo
echo "==== Discord の送り先 ============================================="
echo "各チャンネルの「連携サービス → ウェブフック」で作った URL を貼ってください。"
echo "すでに入れてあるものは、空のまま Enter で飛ばせます。"

put_secret DISCORD_ESTIMATE_WEBHOOK "見積書のチャンネル"
put_secret DISCORD_INVOICE_WEBHOOK  "請求書のチャンネル"
put_secret DISCORD_RECEIPT_WEBHOOK  "領収書のチャンネル"
put_secret DISCORD_MEMO_WEBHOOK     "ひらめきメモのチャンネル"
put_secret DISCORD_PLOT_WEBHOOK     "プロットのチャンネル"
put_secret DISCORD_MENU_WEBHOOK     "献立のチャンネル"
put_secret DISCORD_WEBHOOK          "夜のバックアップのチャンネル"

echo
echo "==== 貯金口座（GMOあおぞらネット銀行）============================="
echo "口座がまだなら、ぜんぶ空のまま Enter で飛ばせます（あとから入れ直せます）。"
echo "アクセストークンをそのまま使うなら1つめだけ。OAuth で回すなら下の3つ。"
put_secret BANK_ACCESS_TOKEN  "アクセストークン"
put_secret BANK_CLIENT_ID     "クライアントID（OAuth のとき）"
put_secret BANK_CLIENT_SECRET "クライアントシークレット（OAuth のとき）"
put_secret BANK_REFRESH_TOKEN "リフレッシュトークン（OAuth のとき）"

# ---- deploy -------------------------------------------------------
echo
echo "==== deploy ======================================================"
if ! $WR deploy; then
  echo
  echo "！ deploy に失敗しました。上の出力を見てください。"
  exit 1
fi

echo
echo "==== できました =================================================="
if [ "$FAILED" = "1" ]; then
  echo "※ 入れられなかった送り先があります。もう一度この script を動かしてください。"
fi
echo
echo "確かめかた：ブラウザで Worker の /health を開いて、次が true になっていること"
echo "  estimateWebhook / invoiceWebhook / receiptWebhook / memoWebhook / plotWebhook / discord"
echo "  openai / backupKey / bank"
echo
echo "Worker の URL は、上の deploy の出力に出ています（https://$NAME.…workers.dev）。"
