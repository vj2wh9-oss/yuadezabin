/**
 * 行き来する地点と、起動の一枚の出しかた。
 *
 *  ・天気の地点は、港区と中野区をはじめから持ち、押すだけで切り替わること
 *    （位置情報は使わない）。予報は地点ごとに取っておき、戻っても取り直さないこと
 *  ・起動の一枚は、しばらく離れていたときだけ出すこと
 *    （ちょっと通知を見て戻るたびに幕が降りると、じきに煩わしくなる）
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

export default {
  name: '地点と起動の一枚',
  async run({ base }) {
    const s = sheet('地点と起動の一枚');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      /* ---- はじめから2つ ---- */
      s.ok('港区と中野区がはじめから入っている',
        await page.evaluate(() => window.DL.weather.places().map((o) => o.name)),
        ['東京都港区', '東京都中野区']);
      s.ok('いま見ているのは港区',
        await page.evaluate(() => window.DL.weather.place().name), '東京都港区');
      s.ok('緯度経度も入っている', await page.evaluate(() => {
        const p = window.DL.weather.place();
        return [p.lat, p.lon];
      }), [35.6581, 139.7515]);

      /* ---- 押すだけで切り替わる（位置情報は使わない） ---- */
      s.ok('中野区へ切り替えられる', await page.evaluate(() => {
        const W = window.DL.weather;
        const nakano = W.places().filter((o) => o.name === '東京都中野区')[0];
        W.usePlace(nakano.id);
        return W.place().name;
      }), '東京都中野区');
      s.yes('いま見ているところが分かる', await page.evaluate(() => {
        const W = window.DL.weather;
        const list = W.places();
        return !W.isHere(list[0]) && W.isHere(list[1]);
      }));

      /* ---- 予報は地点ごとに取っておく ---- */
      s.ok('地点ごとに別の入れものに入る', await page.evaluate(() => {
        const W = window.DL.weather, S = window.DL.store;
        const list = W.places();
        const put = (p, max) => {
          const m = Object.assign({}, S.settings.weatherCache);
          m[W.keyOf(p)] = { at: new Date().toISOString(), key: W.keyOf(p), name: p.name,
            days: [{ date: window.DL.util.today(), code: 0, max: max, min: 10, pop: 0 }] };
          S.updateSettings({ weatherCache: m }, { quiet: true });
        };
        put(list[0], 21);
        put(list[1], 18);
        W.usePlace(list[0].id);
        const a = W.cache().days[0].max;
        W.usePlace(list[1].id);
        const b = W.cache().days[0].max;
        return [a, b];
      }), [21, 18]);
      s.ok('ほかの地点ぶんも、名指しで取り出せる', await page.evaluate(() => {
        const W = window.DL.weather;
        return W.cache(W.places()[0]).days[0].max;
      }), 21);
      s.yes('切り替えても、前の予報は捨てない', await page.evaluate(() => {
        const W = window.DL.weather;
        W.usePlace(W.places()[0].id);
        return !!W.cache();
      }));

      /* ---- 足す・外す ---- */
      s.ok('探して選んだものは、並びにも足す', await page.evaluate(() => {
        const W = window.DL.weather;
        W.addPlace({ name: '大阪市', lat: 34.6937, lon: 135.5023 });
        return [W.places().map((o) => o.name), W.place().name];
      }), [['東京都港区', '東京都中野区', '大阪市'], '大阪市']);
      s.ok('同じところは二度持たない', await page.evaluate(() => {
        const W = window.DL.weather;
        W.addPlace({ name: 'おおさか', lat: 34.6937, lon: 135.5023 });
        return W.places().length;
      }), 3);
      s.ok('いま見ているところを外すと、残りの先頭へ移る', await page.evaluate(() => {
        const W = window.DL.weather;
        const osaka = W.places().filter((o) => o.name === '大阪市')[0];
        W.removePlace(osaka.id);
        return [W.places().map((o) => o.name), W.place().name];
      }), [['東京都港区', '東京都中野区'], '東京都港区']);

      /* ---- 設定の画面 ---- */
      await page.evaluate(async () => {
        location.hash = '#/settings';
        await new Promise((r) => setTimeout(r, 600));
      });
      // 設定はジャンルごとにたたんであるので、天気が入っているところを開く
      await page.locator('.sg-head', { hasText: '作業と表示' }).click();
      await page.waitForTimeout(300);
      s.ok('設定に2つ並ぶ', await page.locator('.wx-pick-b').count(), 2);
      s.ok('いま見ているほうが塗られている',
        await page.locator('.wx-pick-b.on').count(), 1);
      await page.locator('.wx-pick-b').nth(1).click();
      await page.waitForTimeout(500);
      s.ok('押すと切り替わる',
        await page.evaluate(() => window.DL.weather.place().name), '東京都中野区');

      /* ---- 起動の一枚 ---- */
      s.ok('2分という決まり',
        await page.evaluate(() => window.DL.SPLASH_AWAY_MIN), 120000);
      s.ok('すぐ戻ったぶんでは出さない', await page.evaluate(() => {
        return window.DL.replaySplash(30 * 1000);
      }), false);
      s.ok('そのとき幕は出ていない',
        await page.locator('#splash').count(), 0);
      s.ok('2分以上あいたら出す', await page.evaluate(() => {
        return window.DL.replaySplash(3 * 60 * 1000);
      }), true);
      s.ok('幕が出ている', await page.locator('#splash').count(), 1);
      // 押せば飛ばせる。次の確かめのために閉じておく
      await page.locator('#splash').click();
      await page.waitForTimeout(600);
      s.ok('押せば閉じる', await page.locator('#splash').count(), 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
