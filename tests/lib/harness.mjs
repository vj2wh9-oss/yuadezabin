/**
 * テストの下ごしらえ。
 *
 * このアプリはビルドを持たないので、テストも素の Node と Playwright だけで動かす。
 * 各テストは default で { name, run } を出す。run は harness を受け取って、
 * 確かめたいことを ok() で並べていく。
 */
import { playwright } from './playwright.mjs';

const { devices } = await playwright();

export const IPHONE = { ...devices['iPhone SE'], locale: 'ja-JP', timezoneId: 'Asia/Tokyo' };
export const IPHONE13 = { ...devices['iPhone 13'], locale: 'ja-JP', timezoneId: 'Asia/Tokyo' };
export const PC = { viewport: { width: 1280, height: 860 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' };

/** テスト1本ぶんの記録。ok() で数え、あとで run.mjs がまとめる */
export function sheet(name) {
  const rows = [];
  return {
    name,
    rows,
    /** 確かめる。got と want が同じでなければ「だめ」として数える */
    ok(what, got, want) {
      const good = JSON.stringify(got) === JSON.stringify(want);
      rows.push({ good, what, got, want });
      return good;
    },
    /** 真であってほしいだけのとき */
    yes(what, got) { return this.ok(what, !!got, true); },
    /** 確かめずに、様子だけ書き残す */
    note(text) { rows.push({ note: text }); },
    get bad() { return rows.filter((r) => r.good === false).length; }
  };
}

/**
 * ブラウザを1つ開いて、渡された関数に渡す。終わったら必ず閉じる。
 * 画面で出たエラーは拾って、1つでもあれば「だめ」として数える。
 */
export async function withPage(base, opts, fn) {
  const { chromium } = await playwright();
  const browser = await chromium.launch();
  const ctx = await browser.newContext(opts || IPHONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('画面のエラー: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    return await fn(page, errors, { base, browser, ctx });
  } finally {
    await browser.close();
  }
}

/** アプリを開いて、DL が立ち上がるまで待つ。起動の一枚は飛ばす */
export async function open(page, base, hash = '#/home') {
  await page.goto(base + '/' + hash, { waitUntil: 'load' });
  /* settings は state がまだ無いと投げる。waitForFunction は中で投げられると
     やり直さずに落ちるので、ここで受け止めておく */
  await page.waitForFunction(() => {
    try { return !!(window.DL && window.DL.store && window.DL.store.settings); }
    catch (e) { return false; }
  }, null, { timeout: 15000 });
  // 起動の一枚は押せば飛ばせる。出ていなければ何もしない
  await page.evaluate(() => {
    const sp = document.getElementById('splash');
    if (sp) sp.click();
  });
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 8000 });
  await page.waitForTimeout(150);
  return page;
}

/** 起動の一枚を見たいときは、これで開く（飛ばさない） */
export async function openRaw(page, base, hash = '#/home') {
  await page.goto(base + '/' + hash, { waitUntil: 'commit' });
  await page.waitForSelector('#splash', { timeout: 8000 });
  return page;
}
