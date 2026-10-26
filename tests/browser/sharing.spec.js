import { test, expect } from '@playwright/test';

async function app(page) {
  await page.addInitScript(() => {
    window.__inbox = []; window.__calls = []; window.__failAck = false;
    window.ShikeNative = { postMessage(raw) {
      const m = JSON.parse(raw); window.__calls.push(m);
      let result = { available: true, enabled: false, granted: false }, error;
      if (m.method === 'shareInbox') result = window.__inbox;
      if (m.method === 'shareConsume') { if (window.__failAck) error = 'ack interrupted'; else window.__inbox = window.__inbox.filter(item => item.id !== m.args.id); }
      if (m.method === 'recognizeImage') result = { text: '完成物理练习\n截止时间：2026年12月15日', engine: 'native-chinese' };
      setTimeout(() => ShikeNative.onmessage?.({ data: JSON.stringify({ id: m.id, ok: !error, result, error }) }), 5);
    } };
  });
  await page.goto('./#/home'); await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
}
async function deliver(page, item) {
  await page.evaluate(item => { window.__inbox.push(item); dispatchEvent(new Event('shike-share-ready')); }, item);
}
async function seed(page, records) {
  await page.evaluate(async records => {
    const db = await new Promise(resolve => { const r = indexedDB.open('shike-study-tasks'); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['drafts', 'tasks'], 'readwrite');
      for (const [store, record] of records) tx.objectStore(store).put(record);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  }, records);
}
const share = (id, text, images = []) => ({ id, text, images, receivedAt: Date.parse('2026-10-26T12:00:00+08:00') });

test('incoming share preserves existing import/manual drafts and durable receipt prevents duplicates after ack failure', async ({ page }) => {
  await app(page);
  await seed(page, [['drafts', { id: 'manual', task: { title: '尚未完成的手动任务' }, updatedAt: new Date().toISOString() }], ['drafts', { id: 'import', text: '完成化学习题', tasks: [{ id: 'old-task', title: '完成化学习题', details: '', dueDate: '', selected: true }], sources: [], saved: 0, skipped: 0, stage: 'review' }]]);
  await page.evaluate(() => { window.__failAck = true; });
  await deliver(page, share('11111111-1111-4111-8111-111111111111', '完成物理练习\n截止时间：2026年12月15日'));
  await expect(page.locator('.batch-task')).toHaveCount(2);
  await expect(page.locator('#toast')).toContainText('ack interrupted');
  await page.evaluate(() => { window.__failAck = false; dispatchEvent(new Event('shike-share-ready')); });
  await expect.poll(() => page.evaluate(() => window.__inbox.length)).toBe(0);
  await expect(page.locator('.batch-task')).toHaveCount(2);
  expect(await page.evaluate(() => new Promise(resolve => { const r = indexedDB.open('shike-study-tasks'); r.onsuccess = () => { const db = r.result, q = db.transaction('drafts').objectStore('drafts').get('manual'); q.onsuccess = () => { resolve(q.result.task.title); db.close(); }; }; }))).toBe('尚未完成的手动任务');
  await page.reload(); await expect(page.locator('.batch-task')).toHaveCount(2);
});

test('text and multiple shared images enter sequential native OCR and preserve text source through refresh', async ({ page }) => {
  await app(page);
  const urls = ['/shared/22222222-2222-4222-8222-222222222222/1.img', '/shared/22222222-2222-4222-8222-222222222222/2.img'];
  const png = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 100; const x = c.getContext('2d'); x.fillStyle = 'white'; x.fillRect(0, 0, 100, 100); return c.toDataURL().split(',')[1]; }), 'base64');
  for (const url of urls) await page.route('**' + url, route => route.fulfill({ contentType: 'image/png', body: png }));
  await deliver(page, share('22222222-2222-4222-8222-222222222222', '完成英语阅读', urls.map((url, i) => ({ url: new URL(url, 'http://127.0.0.1:4173').href, name: `通知${i + 1}.png`, type: 'image/png' }))));
  await expect(page.locator('.batch-task')).toHaveCount(3);
  expect(await page.evaluate(() => window.__calls.filter(c => c.method === 'recognizeImage').length)).toBe(2);
  await expect(page.locator('#notification-text')).toHaveValue(/完成英语阅读/);
  await expect(page.locator('.batch-task').nth(1)).toContainText('重复');
  await page.reload(); await expect(page.locator('.batch-task')).toHaveCount(3);
  expect(await page.evaluate(() => window.__calls.filter(c => c.method === 'recognizeImage').length)).toBe(0);
});

test('single and selected course task sharing preview uses native chooser only after explicit click, fits phone and tablet', async ({ page }) => {
  await app(page);
  await seed(page, ['物理练习', '英语阅读'].map((title, index) => ['tasks', { id: String(index), title, details: '核对要求', dueDate: '2026-12-15', dueTime: '', createdAt: new Date().toISOString(), completedAt: null }]));
  await page.goto('./#/tasks'); await page.reload(); await expect(page.locator('.task-card')).toHaveCount(2);
  await page.getByRole('button', { name: '分享任务', exact: true }).click();
  await expect(page.locator('#share-preview')).toHaveValue(/物理练习[\s\S]*英语阅读/);
  await page.locator('[name=share-task]').last().uncheck();
  await expect(page.locator('#share-preview')).not.toHaveValue(/英语阅读/);
  expect(await page.evaluate(() => window.__calls.some(c => c.method === 'shareTasks'))).toBe(false);
  await page.getByRole('button', { name: '选择分享应用', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.method === 'shareTasks').length)).toBe(1);
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  for (const [width, height] of [[390, 844], [800, 1280]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '分享任务', exact: true }).click();
    await expect(page.locator('#share-preview')).toHaveValue(/英语阅读/);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await page.getByRole('button', { name: '分享任务：物理练习', exact: true }).click();
    await expect(page.locator('#share-preview')).toHaveValue(/物理练习/);
    await expect(page.locator('#share-preview')).not.toHaveValue(/英语阅读/);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  }
});

test('consumed share does not resurrect a completed draft and an untrusted image URL stays unacknowledged', async ({ page }) => {
  await app(page);
  const item = share('33333333-3333-4333-8333-333333333333', '完成数学练习');
  await deliver(page, item);
  await expect(page.locator('#review-form')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__inbox.length)).toBe(0);
  await page.getByRole('button', { name: '暂无截止日期', exact: true }).click();
  await page.locator('#review-form').getByRole('button', { name: /保存/ }).click();
  await expect(page.locator('.review-done')).toBeVisible();
  await deliver(page, item);
  await expect.poll(() => page.evaluate(() => window.__inbox.length)).toBe(0);
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
  await deliver(page, share('44444444-4444-4444-8444-444444444444', '', [{ url: 'https://example.com/untrusted.png', type: 'image/png' }]));
  await expect(page.locator('#toast')).toContainText('分享图片地址无效');
  expect(await page.evaluate(() => window.__inbox.length)).toBe(1);
  expect(await page.evaluate(() => window.__calls.some(c => c.method === 'shareConsume' && c.args.id.startsWith('44444444')))).toBe(false);
});
