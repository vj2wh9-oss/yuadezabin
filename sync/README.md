# 同期サーバーの立てかた（Cloudflare Workers）

PC と iPhone でデータを自動同期するための、置き場をひとつ用意します。
**無料枠だけで足ります**（1日10万リクエストまで。個人利用なら1日数十回です）。
Vercel には一切触れないので、`room reserve` に影響はありません。

かかる時間は10分ほどです。

---

## 1. Cloudflare のアカウントを作る

<https://dash.cloudflare.com/sign-up> でアカウントを作ります。クレジットカードは要りません。

## 2. wrangler を用意する

PC のターミナルで（Node.js が必要です）:

```sh
npm install -g wrangler   # v4 以上
wrangler --version
wrangler login            # ブラウザが開くので許可する
```

## 3. 置き場（KV 名前空間）を作る

このフォルダに移動してから:

```sh
cd sync
wrangler kv namespace create SYNC
```

`id` が表示されるので、その **id を `wrangler.jsonc` の `"id": "ここに KV 名前空間の id"` に貼り替えます**。

## 4. 公開する

```sh
wrangler deploy
```

`https://anken-portal-sync.<あなたのサブドメイン>.workers.dev` という URL が出ます。**これが接続先です。** 控えておいてください。

### ダッシュボードで入れた変数は消えません

`wrangler deploy` は既定だと、`wrangler.jsonc` の `vars` に書いていない平文の変数を
ぜんぶ消してしまいます（レシート読み取りのモデル名や、通知の差出人が飛びます）。
それを避けるため `wrangler.jsonc` に `"keep_vars": true` を入れてあります。

- 平文の変数（`OPENAI_MODEL` / `OPENAI_MODEL_STRONG` / `VAPID_SUBJECT`）… 消えません
- 鍵（`OPENAI_API_KEY` / `VAPID_PUBLIC` / `VAPID_PRIVATE`）… もともと deploy では消えません

このリポジトリは公開なので、モデル名や連絡先はここには書かず、
ダッシュボードの **Settings → Variables** に置いたままにしてください。

## 4.5 ファイル共有を使う場合（任意）

「ファイル」タブを使うときだけ必要です。使わないなら飛ばして構いません。

```sh
wrangler r2 bucket create anken-portal-files
wrangler deploy
```

`wrangler.jsonc` にはこのバケット名がすでに書いてあるので、作るだけで繋がります。
別の名前にしたいときは `wrangler.jsonc` の `bucket_name` を合わせて書き換えてください。

ダッシュボードから作る場合は **R2 object storage → Create bucket** で `anken-portal-files` を作り、
Worker の **Settings → Bindings → Add → R2 bucket** で Variable name を `FILES`、バケットを選びます。

### フォルダを増やしたら deploy し直す

`worker.js` は、ファイルを置いたときの**フォルダのパス**も R2 に残すようになりました（`x-file-folder` ヘッダ）。
これがないと、片方の端末で入れたファイルが、もう片方ではいちばん上に出てしまいます。

```sh
wrangler deploy
```

古いままだと、アップロードが **CORS のエラー**（`x-file-folder is not allowed by Access-Control-Allow-Headers`）で失敗します。
ダッシュボードから貼り付けている場合は、`sync/worker.js` の中身を丸ごと貼り直して Deploy してください。

**注意**

- R2 を初めて有効にするとき、**有料プランの登録（カード登録）を求められる場合があります**。無料枠（10GB保存・転送量無料）に収まっていれば請求は発生しません。
- **1ファイル100MBまで**です。これは R2 ではなく Workers の受信上限（無料・Proプラン）によるものです。大きな制作データは分割するか、R2 のダッシュボードから直接入れてください。

## 4.7 Discord へ毎晩バックアップを送る場合（任意）

毎日 0時（日本時間）に、サーバーが持っているアプリのデータを丸ごと
Discord のチャンネルへ送ります。iPhone を開いていなくても送られます。

### webhook を作る

1. Discord で、送り先にしたいチャンネルの ⚙（チャンネルの編集）を開く
2. 「連携サービス」→「ウェブフックを作成」
3. 「ウェブフック URL をコピー」

**この URL を知っている人は、誰でもそのチャンネルに書き込めます。**
チャットや、この公開リポジトリには貼らないでください。

### Worker に渡す

```sh
cd sync
wrangler secret put DISCORD_WEBHOOK      # コピーした URL を貼る
```

これだけで、毎晩送られるようになります。

### 中身を暗号にする（すすめます）

送るファイルには顧客管理の連絡先もそのまま入ります。Discord に置く以上、
チャンネルを見られる人・Discord 側からは読める状態になります。
合言葉を入れておくと、包んでから送るようになります。

```sh
wrangler secret put BACKUP_KEY           # 長めの合言葉。忘れると戻せません
```

鍵は合言葉から PBKDF2（SHA-256・10万回）で作ります。10万回は
Cloudflare Workers が受け付ける上限なので、**回数では稼げません**。
そのぶん、**合言葉は20文字以上**を目安に長くしてください。
（`wrangler.jsonc` の隣で回数を変えると、前に送ったファイルが開かなくなります）

包んだファイルは `.json.gz.enc` という名前になります。戻すときは
アプリの 設定 →「バックアップを読み込む」でそのファイルを選ぶと、
合言葉を聞かれます。

### 時刻を変える

```sh
wrangler deploy --var BACKUP_HOUR:21     # 21:00 UTC ＝ 日本の朝6時
```

省略すると 15（＝日本の 0時）です。

### 様子を見る・いますぐ送る

アプリの 設定 →「Discord への夜のバックアップ」で、今日ぶんを送ったか、
暗号があるか、最後の送信はいつかが見られます。「いますぐ1回送る」で
その場で試せます。

### 送られるもの

- 短い文（日付・案件数・顧客数・書類数・レシート数・大きさ）
- `meteo365-YYYY-MM-DD.json.gz`（暗号ありなら `.enc` が付く）

顧客管理の合言葉（潰した形）は持ち出しません。戻したあとは決め直してください。

---

## 貯金口座（GMOあおぞらネット銀行）につなぐ

貯蓄用の口座の残高を、アプリの「経理 → 貯金」に出せます。
**銀行の鍵は Worker の secret にだけ置き、アプリには渡しません。**
アプリが受け取るのは「いくらあるか」という数字だけです。

口座がまだ無いあいだは、同じ画面の「手で入れる」で始められます。
入れた数字はその日ごとに残るので、あとで銀行につないでも記録は続きます。

### 1. 鍵を入れる

`bash sync/setup.sh` の途中で聞かれます。あとから入れ直すこともできます:

```sh
cd sync
wrangler secret put BANK_ACCESS_TOKEN     # アクセストークンをそのまま使うとき
# OAuth で回すときは、こちらの3つ
wrangler secret put BANK_CLIENT_ID
wrangler secret put BANK_CLIENT_SECRET
wrangler secret put BANK_REFRESH_TOKEN
```

`BANK_ACCESS_TOKEN` があればそれを使い、無ければ OAuth の3つで更新しながら使います。
更新したトークンは KV に短いあいだだけ置きます。

### 2. 口座と道を合わせる

既定は個人向け API の本番と、よくある道・名前です:

| 名前 | 既定 | 何のため |
| --- | --- | --- |
| `BANK_BASE` | `https://api.gmo-aozora.com/ganb/api/personal/v1` | API の入口 |
| `BANK_BALANCE_PATH` | `/accounts/balances` | 残高の道 |
| `BANK_TOKEN_PATH` | `/oauth/token` | トークンの道（OAuth のとき） |
| `BANK_ACCOUNT_ID` | （空） | 貯蓄用の口座だけに絞る |
| `BANK_LIST_KEY` | `balances` | 口座の並びの名前 |
| `BANK_AMOUNT_KEY` | `balance` | 残高の名前 |
| `BANK_NAME_KEY` | `accountTypeName` | 口座名の名前 |
| `BANK_ID_KEY` | `accountId` | 口座IDの名前 |

**道や JSON の名前は、開発者ポータルの仕様（sunabar の返事）で確かめてください。**
違っていても、上の名前を変えるだけで直ります（コードは触りません）。
変えるときは Cloudflare のダッシュボード → Workers → Settings → Variables で足すのが手軽です。

砂場（sunabar）で試すときは `BANK_BASE` を砂場の入口にして、
砂場で発行したトークンを `BANK_ACCESS_TOKEN` に入れます。

### 3. 確かめる

アプリの 経理 →「貯金」→「つながるか試す」を押すと、

- つながったか／応答の番号
- 読み取れた口座と残高
- 銀行から返ってきた JSON の頭のほう

が出ます（鍵は出ません）。口座が読めていなければ、その JSON を見て
`BANK_LIST_KEY` などを合わせてください。
`BANK_ACCOUNT_ID` が合っていないときは、返ってきた口座IDを教えます。

### 4. ふだんの動き

- 「残高を更新」を押すと、そのとき読みに行きます。
- 夜（日本時間の0時すぎ）に1日1回、Cron が自分で読んで控えます。
  アプリを開いていなくても、日ごとの記録が積み上がります。
- 控えは Worker 側にも 400日ぶん残るので、端末を変えても推移が続きます。

---

## 5. アプリにつなぐ

1. iPhone（または PC）でアプリを開き、設定 →「同期」
2. 「接続先」に 4. の URL を貼る
3. 「合鍵を作る」を押す（長いランダム文字列が入ります）
4. 「接続をたしかめる」→ 成功したら「同期を有効にする」

もう一方の端末では、**同じ URL と同じ合鍵**を入れます。合鍵は設定画面の「合鍵をコピー」から取り出せます。

---

## 仕組み

- 保管するのは「アプリのデータ1件」だけです。合鍵（トークン）ひとつが持ち主を表します。
- **合鍵そのものはサーバーに保存しません。** SHA-256 にしたものを保管キーに使います。合鍵を知らない限り、誰も読み書きできません。
- 書き込みは **版番号（rev）つき**です。もう一方の端末が先に書いていたら、こちらの内容で黙って上書きせず、アプリ側で「どちらを採るか」を聞きます。
- 合鍵・接続先は**端末ごとの設定**で、同期の対象に含めません（片方の端末の合鍵がもう片方に流れることはありません）。

## 注意

- Cloudflare KV は**書き込みが世界中に行き渡るまで最大60秒ほどかかります**。片方で保存した直後にもう片方を開くと、古い内容が見えることがあります。少し待って「いま同期」を押せば揃います。
- 合鍵を無くすとサーバー上のデータは読めなくなります（こちらから復旧はできません）。ただし各端末のデータは残っているので、合鍵を作り直してつなぎ直せます。
- 保管できるのは 20MB までです。

## やめるとき

```sh
wrangler delete                          # Worker を消す
wrangler kv namespace delete --binding SYNC   # 置き場ごと消す
```

アプリ側は 設定 →「同期」→「接続を解除」で切り離せます（端末内のデータはそのまま残ります）。
