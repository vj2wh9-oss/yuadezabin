# テスト

アプリを実際のブラウザで開いて、壊れていないかを確かめる。
アプリ本体はビルドを持たないので、ここだけ `node_modules` を使う。

## 走らせる

```sh
node tests/run.mjs                 # ぜんぶ
node tests/run.mjs behind          # 名前で絞る
node tests/run.mjs behind preset   # いくつでも
```

アプリを配るサーバー（8778）は `run.mjs` が自分で立てて、終わったら畳む。
同期のテストだけは `sync/dev-server.mjs`（8790）も立てる。
これは**本番と同じ `sync/worker.js` をそのまま読む**ので、
手元で確かめたことがそのまま本番の動きになる。

## 用意する

Playwright が要る。どれかで入れる。

```sh
cd tests && npm run setup                               # ここに入れる（おすすめ）
npm i -g playwright && npx playwright install chromium  # 端末ぜんぶで使う
PLAYWRIGHT_PATH=/path/to/playwright node tests/run.mjs  # 場所を教える
```

`npm install` だけだとブラウザ本体が落ちてこないので、
`npx playwright install chromium` まで要る（`npm run setup` は両方やる）。
`tests/node_modules` があると、そちらが先に使われる。

## いま見ているもの

| ファイル | 何を守っているか |
|---|---|
| `cases/behind.mjs` | 遅れの計算。今日やったぶんで過去の遅れが消えないこと（v215 で直した） |
| `cases/preset.mjs` | 準備のプリセット。呼び出しで二重にならない・保存を押すまで控えを動かす |
| `cases/sync.mjs` | PC と iPhone の同期。届くこと。絵を見失った端末が相手の絵を消さないこと |
| `cases/splash.mjs` | 起動の一枚。ロゴが3つ出る・合わさってから開く・動きが必ず終わる |
| `cases/tabs.mjs` | 下タブ。7つとも絵が入る・選んだ動きが必ず終わる・「動きを控える」で止まる |
| `cases/calendar.mjs` | カレンダーの見た目。今日のマスの示し方と、設定で元に戻せること |
| `cases/ticket.mjs` | チケットの出し入れ。即売会は当日まで消えないこと |
| `cases/menu.mjs` | 前に作った料理を、主菜・副菜ばらばらに選べること |
| `cases/smoke.mjs` | 全画面を一周。3種類の画面幅で、開いてエラーが出ないこと |

「動きが必ず終わる」を何度も見ているのは、**終わらない動きが1つでもあると
iPhone の電池を食い続ける**ため（v208 で全部に回数の上限を付けた）。

## 書き足す

`cases/` に `.mjs` を1つ置く。`default` でこの形を出せば、`run.mjs` が拾う。

```js
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

export default {
  name: '何を見るか',
  // needsSync: true,        // 同期のサーバーも要るとき
  async run({ base, syncBase }) {
    const s = sheet('何を見るか');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      s.ok('見たいこと', 実際, 期待);      // 同じでなければ「だめ」
      s.yes('真であってほしいこと', 実際);
      s.note('様子だけ書き残す');
      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
```

`open()` は起動の一枚を飛ばして開く。起動の一枚そのものを見たいときは `openRaw()`。

## 気をつけていること

- **時間で待たない**。`waitForSelector` など、状態を見て待つ。
  どうしても要るところだけ `waitForTimeout` を使っている（動きが終わるのを待つなど）
- **画面の中で測る**。外からスクリーンショットを撮ると、その時間ぶんずれる
- **この一式は `sw.js` の配り物に入れない**。アプリと一緒に配らないため

## 自動で走らせる

`.github/workflows/tests.yml` で、`main` と `claude/**` への push、
プルリクエスト、手動（Actions のページの「Run workflow」）のときに走る。
落ちても公開は止めない（いまは知らせるだけ）。
