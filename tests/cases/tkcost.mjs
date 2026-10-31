/**
 * 経費を券（即売会など）に紐づける。
 *
 * これまで経費に付けられたのは案件までだった。けれど交通費・宿・設営は
 * 「新刊」にも「既刊」にも寄せられない——即売会そのものの出費なので、
 * 券に付けられるようにした。
 *
 * 見るのは5つ。
 *  ・券に付けてしまえること
 *  ・案件を選んだら、その案件の入っている券が自動で入ること
 *  ・券の画面に「かかったお金」が出ること。案件ごしのぶんも数えること
 *  ・日常の帳簿には出さないこと
 *  ・券を捨てても、経費そのものは帳簿に残ること
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

/** 券1枚と、その下の案件、ほかの券に属さない案件をこしらえる */
const setup = (page) => page.evaluate(() => {
  const U = window.DL.util, S = window.DL.store;
  const pr = S.createProject({
    kind: 'event', category: 'manga', title: '冬の新刊',
    eventName: '冬の即売会', eventDate: U.addDays(U.today(), 20),
    deadline: U.addDays(U.today(), 10), startDate: U.today(), qty: 16, status: 'active'
  });
  const other = S.createProject({
    kind: 'work', category: 'illust', title: 'A社の表紙', client: 'A社',
    deadline: U.addDays(U.today(), 8), startDate: U.today(), qty: 1, status: 'active'
  });
  return { tid: pr.ticketId, pid: pr.id, oid: other.id, otherTid: other.ticketId };
});

export default {
  name: '券にかかったお金',
  async run({ base }) {
    const s = sheet('券にかかったお金');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);
      const at = await setup(page);
      s.yes('券ができている', !!at.tid);

      /* ---- しまい方 ---- */
      s.ok('券に付けてしまえる', await page.evaluate((a) => {
        const S = window.DL.store;
        const x = S.addExpense({
          book: 'work', date: window.DL.util.today(), amount: 12000,
          category: '旅費交通費', vendor: '新幹線', ticketId: a.tid
        });
        return S.getExpense(x.id).ticketId;
      }, at), at.tid);

      s.ok('券ごしに引ける', await page.evaluate(
        (a) => window.DL.store.ticketExpenses(a.tid).map((x) => x.vendor), at), ['新幹線']);

      /* 案件に付けたぶんも、その券のお金として数える
         （印刷費は案件に、交通費は券に付ける、という使いかたになるため） */
      await page.evaluate((a) => {
        const S = window.DL.store, U = window.DL.util;
        S.addExpense({ book: 'work', date: U.today(), amount: 48000,
          category: '印刷費', vendor: '○○印刷', projectId: a.pid });
        // ほかの券の案件に付けたぶんは、混ざらないこと
        S.addExpense({ book: 'work', date: U.today(), amount: 3000,
          category: '画材費', vendor: '画材店', projectId: a.oid });
        // 日常の帳簿は、券には関わらない
        S.addExpense({ book: 'life', date: U.today(), amount: 800,
          category: '食費', vendor: 'コンビニ' });
      }, at);

      s.ok('案件ごしのぶんも数える', await page.evaluate(
        (a) => window.DL.store.ticketExpenses(a.tid).map((x) => x.vendor).sort(), at),
      ['○○印刷', '新幹線']);
      s.ok('合計', await page.evaluate(
        (a) => window.DL.store.ticketExpenseTotal(a.tid), at), 60000);
      s.ok('ほかの券のぶんは混ざらない', await page.evaluate(
        (a) => window.DL.store.ticketExpenses(a.otherTid).map((x) => x.vendor), at), ['画材店']);
      s.yes('日常の帳簿は混ざらない', await page.evaluate(
        (a) => !window.DL.store.ticketExpenses(a.tid).some((x) => x.book === 'life'), at));

      s.ok('絞り込みでも引ける', await page.evaluate(
        (a) => window.DL.store.expenses({ ticketId: a.tid }).length, at), 1);

      /* ---- 入力の画面 ---- */
      await open(page, base, '#/books');
      await page.evaluate(() => window.DL.views.books.addExpense({ book: 'work' }));
      await page.waitForSelector('.sheet-body');
      const tkField = page.locator('.sheet-body .field:has-text("券（即売会など）") select');
      s.ok('券の欄が出る', await tkField.count(), 1);
      s.yes('作ってある券が並ぶ',
        (await tkField.locator('option').allTextContents()).some((t) => /冬の即売会/.test(t)));

      /* 案件を選ぶと、その案件の入っている券が自動で入る */
      s.ok('はじめは空', await tkField.inputValue(), '');
      const prField = page.locator('.sheet-body .field:has-text("案件") select').first();
      await prField.selectOption({ label: '冬の新刊' });
      await page.waitForTimeout(200);
      s.ok('案件を選ぶと、その券が入る', await tkField.inputValue(), at.tid);

      /* すでに選んである券は、あとから案件を選んでも差し替えない */
      await prField.selectOption({ label: 'A社の表紙' });
      await page.waitForTimeout(200);
      s.ok('選んである券は差し替えない', await tkField.inputValue(), at.tid);

      await page.locator('.sheet-body .field:has-text("金額") input').fill('5000');
      await page.locator('.sheet-body .field:has-text("支払先") input').fill('宿');
      await page.locator('.sheet-foot .btn:has-text("保存")').click();
      await page.waitForTimeout(600);
      s.ok('画面から入れたぶんも、券に付く', await page.evaluate(
        (a) => window.DL.store.expenses({ ticketId: a.tid }).map((x) => x.vendor).sort(), at),
      ['宿', '新幹線']);

      /* 日常の帳簿では、券の欄を出さない */
      await page.evaluate(() => window.DL.views.books.addExpense({ book: 'life' }));
      await page.waitForSelector('.sheet-body');
      s.ok('日常では券の欄を出さない',
        await page.locator('.sheet-body .field:has-text("券（即売会など）")').count(), 0);
      await page.locator('.sheet-foot .btn:has-text("キャンセル")').click();
      await page.waitForTimeout(300);

      /* 券を名指ししてあるぶんは、案件ごしに別の券へ数えない。
         いま入れた「宿」は、券は冬の即売会・案件は A社の表紙になっている。
         両方で数えると、同じお金が2枚の券に乗ってしまう */
      s.ok('名指しした券のほうだけに乗る', await page.evaluate(
        (a) => window.DL.store.ticketExpenses(a.otherTid).map((x) => x.vendor).sort(), at),
      ['画材店']);
      s.ok('名指しした券には乗る', await page.evaluate(
        (a) => window.DL.store.ticketExpenses(a.tid).map((x) => x.vendor).sort(), at),
      ['○○印刷', '宿', '新幹線']);

      /* ---- 券の画面 ---- */
      await open(page, base, '#/ticket/' + at.tid);
      const cost = await page.locator('.tk-cost').innerText();
      s.note('かかったお金: ' + cost.replace(/\n+/g, ' / '));
      s.yes('券に付けたぶんが出る', cost.indexOf('新幹線') >= 0);
      s.yes('案件ごしのぶんも出る', cost.indexOf('○○印刷') >= 0);
      s.yes('どの案件のぶんかも添える', cost.indexOf('冬の新刊') >= 0);
      s.yes('合計が出る', /かかったお金\s*¥?65,000/.test(cost.replace(/\s/g, ' ')));
      s.ok('ほかの券のぶんは出さない', cost.indexOf('画材店'), -1);

      s.ok('押すとその経費が開く', await page.evaluate(async () => {
        document.querySelector('.tk-cost-row').click();
        await new Promise((r) => setTimeout(r, 500));
        return document.querySelectorAll('.sheet-body').length;
      }), 1);
      await page.locator('.sheet-foot .btn:has-text("キャンセル")').click();
      await page.waitForTimeout(300);

      /* ---- 券を捨てても、経費は残る ---- */
      const before = await page.evaluate(() => window.DL.store.expenses({ book: 'work' }).length);
      await page.evaluate((a) => window.DL.store.removeTicket(a.tid), at);
      s.ok('経費そのものは帳簿に残る', await page.evaluate(
        () => window.DL.store.expenses({ book: 'work' }).length), before);
      s.ok('券との紐付けだけ外れる', await page.evaluate(
        (a) => window.DL.store.expenses({ ticketId: a.tid }).length, at), 0);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
