# ここは「だてメテオ －イベント当日用－」の控え

本来の置き場所は別のリポジトリ。

    https://github.com/vj2wh9-oss/torani

そちらへ push しようとしたが、Claude にそのリポジトリへの
書き込みが許されておらず断られたので、無くさないようにここへ置いてある。

    remote: Claude doesn't have GitHub access to vj2wh9-oss/torani
    fatal: ... error: 403

## torani へ移すには

GitHub の設定で Claude にこのリポジトリを触らせるようにしたうえで、
この中身をそのまま torani の `main` に置けばよい（ビルドは無い）。

    cp -r event-site/* /path/to/torani/
    cd /path/to/torani && git add -A && git commit && git push

そのあと torani の Settings → Pages で `main` を公開先にすると、
https://vj2wh9-oss.github.io/torani/ で開くようになる。

## サーバー側

受け口は METEO365 と同じ Cloudflare Worker にある（`sync/worker.js` の
`/v1/event/...`）。こちらは deploy するだけで使える。
