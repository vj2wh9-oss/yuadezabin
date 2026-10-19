/**
 * 自分で作る、案件の基本テンプレート。
 *
 * 内容（漫画・イラスト・デザイン）ごとのひと揃いはもとからあるが、
 * 同じ「漫画」でも寄稿と新刊では工程が違うので、3つでは足りない。
 * 名前を付けたテンプレートを自分で作り、案件を作るときに選べること。
 *
 * 見るのは4つ。
 *  ・作って、しまって、取り出せること（おかしな値は直してからしまう）
 *  ・設定の画面から作れること
 *  ・あとから基本タスクを足すときに、自分のぶんも選べること
 *  ・消しても、それで作った案件のタスクは残ること
 */
import { sheet, withPage, open, IPHONE } from '../lib/harness.mjs';

export default {
  name: '自分で作るテンプレート',
  async run({ base }) {
    const s = sheet('自分で作るテンプレート');
    await withPage(base, IPHONE, async (page, errors) => {
      await open(page, base);

      /* ---- しまい方 ---- */
      s.ok('はじめは1本も無い',
        await page.evaluate(() => window.DL.store.taskTemplates().length), 0);

      const id = await page.evaluate(() => window.DL.store.putTaskTemplate({
        name: '寄稿イラスト',
        steps: [
          { name: 'ラフ', weight: 20, unit: 'cut' },
          { name: '線画', weight: 40, unit: 'cut' },
          { name: '  ', weight: 10, unit: 'cut' },            // 名前が無い行
          { name: '提出', weight: 0, unit: 'ふしぎな単位' }     // おかしな値
        ]
      }).id);

      const steps = await page.evaluate(
        (i) => window.DL.store.getTaskTemplate(i).steps, id);
      s.note('しまった工程: ' + JSON.stringify(steps));
      s.ok('名前の無い工程は落とす', steps.map((t) => t.name), ['ラフ', '線画', '提出']);
      s.ok('重みは1より下げない', steps[2].weight, 1);
      s.ok('知らない単位は「数量なし」にする', steps[2].unit, 'none');
      s.ok('名前で呼び出せる',
        await page.evaluate((i) => window.DL.store.templateName(i), id), '寄稿イラスト');
      s.ok('内容のほうも、これまでどおり名前が出る',
        await page.evaluate(() => window.DL.store.templateName('manga')), '漫画');

      /* ---- タスクに起こす ---- */
      s.ok('テンプレートからタスクを作れる', await page.evaluate(
        (i) => window.DL.store.templateTasks(i, 5)
          .map((t) => t.name + ':' + (t.qty === null ? '—' : t.qty)), id),
      ['ラフ:5', '線画:5', '提出:—']);
      s.ok('内容の名前でも、これまでどおり作れる', await page.evaluate(
        () => window.DL.store.templateTasks('manga', 20).map((t) => t.name)),
      ['プロット', 'ネーム', '下書き', '線画', '仕上げ']);

      /* ---- 設定の画面から作る ---- */
      await page.evaluate(async () => {
        location.hash = '#/settings';
        await new Promise((r) => setTimeout(r, 600));
      });
      // 設定はジャンルごとにたたんであるので、テンプレートが入っているところを開く
      await page.locator('.sg-head', { hasText: '作業と表示' }).click();
      await page.waitForTimeout(300);
      s.yes('作ったものが設定に並ぶ',
        (await page.locator('.tpl-summary:has-text("寄稿イラスト")').count()) === 1);

      await page.locator('.btn:has-text("テンプレートを作る")').click();
      await page.waitForSelector('.sheet-title:has-text("テンプレートを作る")');
      // 「ほかから写す」で漫画のひと揃いを写し、名前を付けて保存する
      await page.locator('.sheet-body .preset:has-text("漫画")').first().click();
      await page.waitForTimeout(200);
      s.ok('写すと、その工程が並ぶ',
        await page.locator('.sheet-body .tpl-row').count(), 5);
      await page.locator('.sheet-body .field input').first().fill('新刊（32P）');
      await page.locator('.sheet-foot .btn:has-text("保存")').click();
      await page.waitForTimeout(500);

      s.ok('2本になった',
        await page.evaluate(() => window.DL.store.taskTemplates().map((t) => t.name)),
        ['寄稿イラスト', '新刊（32P）']);
      s.ok('写した工程がそのまま入っている', await page.evaluate(() =>
        window.DL.store.taskTemplates()[1].steps.map((t) => t.name)),
      ['プロット', 'ネーム', '下書き', '線画', '仕上げ']);
      s.yes('設定にも出ている',
        (await page.locator('.tpl-summary:has-text("新刊（32P）")').count()) === 1);

      /* ---- 案件に当てる ---- */
      const pid = await page.evaluate(() => {
        const U = window.DL.util, S = window.DL.store;
        return S.createProject({
          name: '夏の寄稿', category: 'illust', qty: 3,
          deadline: U.addDays(U.today(), 20), status: 'active'
        }).id;
      });
      await page.evaluate(async (i) => {
        location.hash = '#/project/' + i;
        await new Promise((r) => setTimeout(r, 600));
      }, pid);
      await page.locator(".btn:has-text(\"基本タスクを追加\")").first().click();
      await page.waitForSelector('.sheet-title:has-text("基本タスクを追加")');

      const opts = await page.locator('.sheet-body select option').allTextContents();
      s.note('選べるもの: ' + opts.join(' / '));
      s.ok('内容の3つと、自分のぶんが並ぶ', opts,
        ['漫画（基本）', 'イラスト（基本）', 'デザイン（基本）', '寄稿イラスト', '新刊（32P）']);

      await page.locator('.sheet-body select').selectOption({ label: '寄稿イラスト' });
      await page.waitForTimeout(300);
      s.ok('選ぶと、その工程に入れ替わる',
        await page.locator('.sheet-body .row-check').count(), 3);
      await page.locator('.sheet-foot .btn:has-text("追加")').click();
      await page.waitForTimeout(500);

      s.ok('案件にそのタスクが入る', await page.evaluate(
        (i) => window.DL.store.getProject(i).tasks.map((t) => t.name), pid),
      ['ラフ', '線画', '提出']);
      s.ok('数量のある工程には、案件の数量が入る', await page.evaluate(
        (i) => window.DL.store.getProject(i).tasks.map((t) => t.qty), pid),
      [3, 3, null]);

      /* ---- 新しい案件を作るときにも選べる ---- */
      await page.evaluate(async () => {
        location.hash = '#/projects';
        await new Promise((r) => setTimeout(r, 400));
        window.DL.forms.projectForm(null);
        await new Promise((r) => setTimeout(r, 400));
      });
      await page.waitForSelector('.sheet-title:has-text("新しい案件")');
      const made = page.locator('.sheet-body .field:has-text("使うテンプレート") select');
      s.ok('「使うテンプレート」の欄が出る', await made.count(), 1);
      s.ok('はじめは内容まかせ', await made.inputValue(), '');
      s.ok('自分のぶんが並ぶ', await made.locator('option').allTextContents(),
        ['内容に合わせる', '寄稿イラスト', '新刊（32P）']);

      /* 内容（漫画）のひと揃いとは中身が違うものを選ぶ。
         同じ中身のものを選ぶと、効いているのか分からないため */
      await made.selectOption({ label: '寄稿イラスト' });
      await page.locator('.sheet-body .field:has-text("イベント名") input').fill('冬の即売会');
      await page.locator('.sheet-body .field:has-text("入稿締切") input').fill(
        await page.evaluate(() => window.DL.util.addDays(window.DL.util.today(), 40)));
      await page.locator('.sheet-foot .btn:has-text("保存")').click();
      await page.waitForTimeout(700);

      s.ok('選んだテンプレートで基本タスクが入る（内容まかせにしない）',
        await page.evaluate(() => {
          const S = window.DL.store;
          const pr = S.projects().filter((x) => x.eventName === '冬の即売会')[0];
          return pr ? pr.tasks.map((t) => t.name) : null;
        }), ['ラフ', '線画', '提出']);

      /* ---- 消しても、作ったタスクは残る ---- */
      await page.evaluate((i) => window.DL.store.removeTaskTemplate(i), id);
      s.ok('消すと並びから抜ける',
        await page.evaluate(() => window.DL.store.taskTemplates().map((t) => t.name)),
        ['新刊（32P）']);
      s.ok('案件のタスクはそのまま', await page.evaluate(
        (i) => window.DL.store.getProject(i).tasks.length, pid), 3);

      s.ok('画面のエラー', errors, []);
    });
    return s;
  }
};
