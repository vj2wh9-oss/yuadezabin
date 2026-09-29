/**
 * Playwright を見つけて読み込む。
 *
 * このリポジトリは node_modules を持たない（ビルドを持たない作りなので）。
 * 入れ方は人によって違うので、順に探す。
 *
 *   1. tests/node_modules（tests で npm i した）
 *   2. 環境変数 PLAYWRIGHT_PATH が指す場所
 *   3. NODE_PATH ／ グローバル（npm i -g playwright）
 *   4. よくある置き場所
 *
 * 見つからなければ、入れ方を出して終わる。
 */
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);

const GUESSES = [
  '/opt/node22/lib/node_modules/playwright',
  '/usr/lib/node_modules/playwright',
  '/usr/local/lib/node_modules/playwright'
];

let loaded = null;

export async function playwright() {
  if (loaded) return loaded;
  const why = [];

  // 1〜3。require は NODE_PATH も見てくれる
  try { loaded = await import('playwright'); } catch (e) { why.push(e.message); }
  if (!loaded && process.env.PLAYWRIGHT_PATH) {
    try { loaded = req(process.env.PLAYWRIGHT_PATH); } catch (e) { why.push(e.message); }
  }
  if (!loaded) {
    try { loaded = req('playwright'); } catch (e) { why.push(e.message); }
  }
  // 4
  if (!loaded) {
    for (const p of GUESSES) {
      try { loaded = req(p); break; } catch { /* 次へ */ }
    }
  }

  if (!loaded) {
    const err = new Error(
      'Playwright が見つかりません。どれかで入れてください:\n'
      + '  cd tests && npm install          （このリポジトリの中に入れる）\n'
      + '  npm i -g playwright              （端末ぜんぶで使う）\n'
      + '  PLAYWRIGHT_PATH=/path/to/playwright node tests/run.mjs\n'
      + 'そのあと chromium を落とします:\n'
      + '  npx playwright install chromium'
    );
    err.missing = true;
    err.detail = why;
    throw err;
  }

  // import と require で形が違うので、どちらでも同じに見えるようにする
  if (!loaded.chromium && loaded.default && loaded.default.chromium) loaded = loaded.default;
  return loaded;
}
