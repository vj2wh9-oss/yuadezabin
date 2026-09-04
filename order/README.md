# 発注ページの立てかた（Cloudflare Workers）

`order.yuadezabin.com` に発注ページを出し、届いた発注を

1. **keisuke@yuadezabin.com へメール**
2. **アプリ（METEO365）の「発注」画面**

の2か所へ届けます。無料枠だけで足ります。かかる時間は20分ほどです。

このフォルダは、同期サーバー（`sync/`）とは別の Worker です。
同期サーバーのほうも新しくする必要があるので、**5. を飛ばさないでください**。

---

## まとめてやる（おすすめ）

下の 1・2・4・5・6 をひとつにしたものがあります。

```sh
cd order
bash deploy.sh
```

聞かれるのは **同期サーバーの URL** と **同期の合鍵** の2つだけです。
合鍵は wrangler が Cloudflare へ直接渡すので、画面にもファイルにも残りません。

メールの設定（手順3）と Turnstile（手順7）は、ダッシュボードでの操作が要るので別です。
うまくいかないときや、何をしているか確かめたいときは、下の手順を1つずつどうぞ。

---

## 全体の形

```
お客様のブラウザ
   ↓ 同じサイトの中だけで送信（外部への送信口を持たない）
order.yuadezabin.com（この Worker）
   ├→ メール       keisuke@yuadezabin.com（そのまま返信すればお客様宛）
   └→ 同期サーバー /v1/inbox/order
                        ↓
                  METEO365 の「発注」画面 → 取引先と手で照合 → お客様へ返事
```

**発注ページは取引先の一覧をひとつも持ちません。**照合はアプリの中だけで行うので、
お客様の情報や取引先の情報が、ページを通じて外に出ることはありません。
合鍵（同期のトークン）もこの Worker の中だけにあり、ブラウザには一切渡していません。

---

## 1. 置き場（KV 名前空間）を作る

このフォルダに移動してから:

```sh
cd order
wrangler kv namespace create ORDERS
```

`id` が表示されるので、**`wrangler.jsonc` の `"id": "ここに KV 名前空間の id"` に貼り替えます**。

## 2. 同期サーバーの URL を書く

`wrangler.jsonc` の `SYNC_URL` を、いま使っている同期サーバーの URL にします。
アプリの 設定 →「PC・iPhone の同期」→「接続先」に入っているものと同じです。

```jsonc
"SYNC_URL": "https://anken-portal-sync.<あなたのサブドメイン>.workers.dev"
```

## 3. メールを出せるようにする（Cloudflare Email Routing）

Cloudflare のダッシュボードで yuadezabin.com を開き、**Email → Email Routing**:

1. Email Routing を **有効にする**（DNS のレコードは自動で入ります）
2. **Destination addresses** に `keisuke@yuadezabin.com` を追加し、届いた確認メールのリンクを押す
   - `keisuke@yuadezabin.com` を普段使いのアドレス（Gmail など）へ転送している場合は、
     転送先で確認メールを受け取れます
   - うまくいかないときは、**転送先のアドレスそのもの**（例：`〇〇@gmail.com`）を
     Destination address にして、`wrangler.jsonc` の `MAIL_TO` と `send_email` の
     `destination_address` をそちらに書き替えてください
3. `wrangler.jsonc` の `MAIL_FROM`（既定 `order@yuadezabin.com`）は、
   **受信用に作らなくて構いません**。差出人として使うだけです

### Cloudflare のメールが使えないとき（任意）

[Resend](https://resend.com) の無料枠でも送れます。API キーを作り、ドメインを認証してから:

```sh
wrangler secret put RESEND_API_KEY
```

`RESEND_API_KEY` を入れておくと、Cloudflare 側が使えないときに自動でこちらを使います。
どちらも入れていないと、メールは飛ばずアプリにだけ届きます（発注そのものは失われません）。

## 4. 合鍵を渡す

アプリの 設定 →「PC・iPhone の同期」→「合鍵をコピー」で取り出し、

```sh
wrangler secret put SYNC_TOKEN
```

貼り付けます。**これがこの Worker の一番大事な設定です。**
ここにだけ置き、`wrangler.jsonc` にもページ側にも書かないでください。

連投よけの指紋に混ぜる塩も、決めておくと安心です（省略可）:

```sh
wrangler secret put RL_SALT      # 適当な長い文字列
```

## 5. 同期サーバーを新しくする

発注の受け口（`/v1/inbox/order`）は、`sync/worker.js` に足してあります。
**古いままだと発注がアプリに届きません。**

```sh
cd ../sync
wrangler deploy
```

ダッシュボードから貼り付けている場合は、`sync/worker.js` の中身を丸ごと貼り直して Deploy します。

うまくいったかは、アプリの 設定 →「発注フォーム」→「受け口があるか確かめる」で見られます。

## 6. 公開する

> **なぜ apex（yuadezabin.com）ではなく `order.` なのか**
>
> yuadezabin.com そのものは Squarespace につながっています。
> そちらへ Worker を割り当てると、既にある DNS レコードを消すことになり、
> Squarespace 側が切れてしまいます（Cloudflare もそれを理由に拒みます）。
> `order.yuadezabin.com` にしておけば、どちらも並べておけます。
>
> apex に置きたい場合は、先に Cloudflare の DNS から yuadezabin.com の
> A / CNAME レコードを消してから、`wrangler.jsonc` の `pattern` を
> `yuadezabin.com` に戻してください（Squarespace のページは表示されなくなります）。


```sh
cd ../order
wrangler deploy
```

初回は「`order.yuadezabin.com` を custom domain にしてよいか」と聞かれるので許可します。
`https://order.yuadezabin.com/` を開いて、発注ページが出れば完了です。

`https://order.yuadezabin.com/api/health` を開くと、どこまで繋がっているかが分かります。

```json
{ "bindings": { "kv": true, "mail": true, "sync": true, "turnstile": false } }
```

## 7. 機械からの送信を止める（任意・おすすめ）

Cloudflare の **Turnstile**（無料）を使うと、自動で送られてくる発注を減らせます。

1. ダッシュボードの **Turnstile → Add widget**、ドメインに `order.yuadezabin.com` を入れる
2. 出てきた **Site Key** を `public/form.json` の `turnstileSiteKey` に貼る
3. **Secret Key** を Worker に渡す

```sh
wrangler secret put TURNSTILE_SECRET
wrangler deploy
```

入れなくても、下記の見張りは常に効いています。

- 人には見えない欄（罠）に何か入っていたら受け付けない
- 同じ相手からは 10分で5件・1日で20件まで
- 本文は 16KB まで、欄ごとに文字数の上限あり
- このサイトの画面からの送信だけを受ける（別のサイトに置かれた偽フォームは弾く）

---

## 発注ページの中身を変える

`public/form.json` **だけ**を直します。ページも受け口も同じこのファイルを見ているので、
片方だけ古くなることがありません。

```jsonc
"services": [ { "id": "banner", "label": "バナー・Web用画像" }, … ],
"formats":  [ { "id": "png",    "label": "PNG" }, … ],
"deadline": { "minLeadDays": 7, "maxAheadDays": 365 }
```

- `id` は控えとメールに残るので、**一度公開したら変えない**でください（`label` は変えて構いません）
- 直したら `wrangler deploy` で反映します

欄そのもの（発注社名・種目・納期・納品形式…）を増やし減らしするときは、
`public/index.html`・`public/form.js`・`worker.js` の3つを合わせて直します。

---

## 届いた発注をさばく

1. アプリのホームに「未確認の発注が n件」と出る（設定 →「発注フォーム」からも開けます）
2. 押すと一覧。1件開くと、発注社名に近い**取引先の候補**が出る
3. 目で確かめて
   - **照合できた（受領のご連絡）** → 状態を控え、受領のメールの下書きが開く
   - **照合できない（お名前の確認）** → 状態を控え、お名前を尋ねるメールの下書きが開く
4. 文面を見てから送る（勝手には送りません）

控えた状態は同期サーバーに残るので、**出先の iPhone で受領にすれば、PC でも受領になっています。**

メールのほうは、そのまま**返信すればお客様宛**になります（Reply-To がお客様のアドレスです）。

---

## お客様の情報の扱い

| どこ | 何が | いつまで |
| --- | --- | --- |
| 発注ページ（ブラウザ） | 送信するまでの入力内容だけ | 送信したら消える。保存も Cookie も無し |
| この Worker の KV | 発注1件 | 30日で自動的に消える（届けそこねたときの送り直し用） |
| 同期サーバー | 発注1件 | 触っていないものは180日。アプリから消せる |
| メール | 発注1件 | 手元のメールの決まりに従う |

- **読み出す口をひとつも開けていません。**入った発注を外から読む方法は無く、
  出口はメールとアプリの2つだけです。
- IP アドレスはそのまま残しません（連投を数えるための指紋だけを短時間置きます）。
- 外部のフォームサービス・解析・フォントを一切読み込みません
  （読み込むのは、Turnstile を入れたときの Cloudflare のものだけです）。

## やめるとき

```sh
wrangler delete                                # 発注ページの Worker を消す
wrangler kv namespace delete --binding ORDERS  # 置き場ごと消す
```
