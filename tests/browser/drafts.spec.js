import { test, expect } from '@playwright/test';

async function stored(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('shike-study-tasks'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction(['tasks', 'drafts', 'draft-files'], 'readonly');
    const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [tasks, draft, manual, files] = await Promise.all([read(tx.objectStore('tasks').getAll()), read(tx.objectStore('drafts').get('import')), read(tx.objectStore('drafts').get('manual')), read(tx.objectStore('draft-files').count())]);
    db.close(); return { tasks, draft, manual, files, version: db.version };
  });
}

async function screenshots(page, relative = false) {
  return page.evaluate(relative => ['数学作业：完成第三章习题', '数学作业：完成第三章习题', '英语任务：提交阅读报告'].map((title, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 850;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1400, 850);
    ctx.fillStyle = '#202020'; ctx.font = '38px "Microsoft YaHei"';
    ['课程作业通知', '1. ' + title, relative ? '截止时间：明天 23:59' : '截止时间：2026年12月30日 23:59'].forEach((line, i) => ctx.fillText(line, 65, 100 + i * 200));
    return { name: ['first.png', 'second.png', 'third.png'][index], base64: canvas.toDataURL('image/png').split(',')[1] };
  }), relative);
}

test('batch OCR resumes after refresh, flags duplicates across images and atomically clears saved drafts and images', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-25T20:00:00+08:00'));
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) { super(url, options); this.isOCR = String(url).includes('/ocr/'); }
      postMessage(message, ...rest) {
        if (this.isOCR && message.action === 'recognize') setTimeout(() => super.postMessage(message, ...rest), 500);
        else super.postMessage(message, ...rest);
      }
    };
  });
  await page.goto('./#/home');
  const images = await screenshots(page, true);
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#screenshot-file').setInputFiles(images.map(image => ({ name: image.name, mimeType: 'image/png', buffer: Buffer.from(image.base64, 'base64') })));
  await expect.poll(async () => { const s = await stored(page); return s.draft?.sources[0].status === 'done' && s.draft?.sources[1].status === 'running'; }, { timeout: 30000, intervals: [25] }).toBe(true);
  const firstId = (await stored(page)).draft.tasks[0].id;
  await page.clock.setFixedTime(new Date('2026-10-26T20:00:00+08:00'));
  await page.reload();
  await expect(page.locator('.batch-task')).toHaveCount(3, { timeout: 120000 });
  expect((await stored(page)).draft.tasks[0].id).toBe(firstId);
  expect((await stored(page)).draft.tasks.every(task => task.dueDate === '2026-10-26')).toBe(true);
  await expect(page.locator('.batch-task').first()).toContainText('可能与 second.png');
  await page.locator('.batch-task').nth(1).locator('[name="selected"]').uncheck();
  await page.locator('.batch-task').nth(2).locator('[name="details"]').fill('保留修改后的阅读要求');
  await expect.poll(async () => (await stored(page)).draft?.tasks[2].details).toBe('保留修改后的阅读要求');
  await page.reload();
  await expect(page.locator('.batch-task').nth(1).locator('[name="selected"]')).not.toBeChecked();
  await expect(page.locator('.batch-task').nth(2).locator('[name="details"]')).toHaveValue('保留修改后的阅读要求');
  await page.getByRole('button', { name: '确认并保存所选任务', exact: true }).click();
  await expect(page.locator('.review-done')).toContainText('已保存 2 项');
  const state = await stored(page);
  expect(state.tasks).toHaveLength(2); expect(state.files).toBe(0); expect(state.draft).toBeUndefined();
  await page.getByRole('button', { name: '回到我的任务' }).click();
  await page.reload();
  await expect(page.locator('.task-card')).toHaveCount(2);
  expect((await stored(page)).draft).toBeUndefined();
});

test('manual and edited task fields survive refresh and a save removes the draft in the same transaction', async ({ page }) => {
  await page.goto('./#/home');
  await page.getByRole('button', { name: '手动添加', exact: true }).click();
  await page.locator('#task-form [name="title"]').fill('刷新后恢复的数学作业');
  await page.locator('#task-form [name="details"]').fill('尚未保存的要求\n第二行');
  await page.locator('#task-form [name="dueDate"]').fill('2026-12-30');
  await expect.poll(async () => (await stored(page)).manual?.task.dueDate).toBe('2026-12-30');
  await page.reload();
  await page.getByRole('button', { name: '恢复填写草稿', exact: true }).click();
  await expect(page.locator('#task-form [name="title"]')).toHaveValue('刷新后恢复的数学作业');
  await expect(page.locator('#task-form [name="details"]')).toHaveValue('尚未保存的要求\n第二行');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.locator('#task-form')).toHaveCount(0);
  expect((await stored(page)).manual).toBeUndefined();
  await page.locator('.sidebar [data-view="all"]').click();
  await page.locator('.task-content').click();
  await page.locator('#task-form [name="details"]').fill('恢复的编辑草稿');
  await expect.poll(async () => (await stored(page)).manual?.task.details).toBe('恢复的编辑草稿');
  await page.reload();
  await page.locator('.sidebar [data-view="home"]').click();
  await page.getByRole('button', { name: '恢复填写草稿', exact: true }).click();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.locator('#task-form')).toHaveCount(0);
  expect((await stored(page)).tasks).toHaveLength(1);
  expect((await stored(page)).tasks[0].details).toBe('恢复的编辑草稿');
  expect((await stored(page)).manual).toBeUndefined();
});

test('refreshing during a duplicate decision keeps only the remaining batch tasks', async ({ page }) => {
  await page.goto('./#/home');
  const images = await screenshots(page);
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#screenshot-file').setInputFiles(images.map(image => ({ name: image.name, mimeType: 'image/png', buffer: Buffer.from(image.base64, 'base64') })));
  await expect(page.locator('.batch-task')).toHaveCount(3, { timeout: 120000 });
  await page.getByRole('button', { name: '确认并保存所选任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '可能与已有任务重复', exact: true })).toBeVisible();
  const before = await stored(page);
  expect(before.tasks).toHaveLength(1); expect(before.draft.tasks).toHaveLength(2);
  const savedId = before.tasks[0].id;
  await page.reload();
  await expect(page.locator('.batch-task')).toHaveCount(2);
  expect((await stored(page)).draft.tasks.some(task => task.id === savedId)).toBe(false);
  await page.locator('.batch-task').first().locator('[name="selected"]').uncheck();
  await page.getByRole('button', { name: '确认并保存所选任务', exact: true }).click();
  await expect(page.locator('.review-done')).toContainText('已保存 2 项');
  const after = await stored(page);
  expect(after.tasks).toHaveLength(2); expect(after.tasks.filter(task => task.id === savedId)).toHaveLength(1);
  expect(after.draft).toBeUndefined(); expect(after.files).toBe(0);
});

test('a failed screenshot does not discard successful results and skipping it cleans its local image', async ({ page }) => {
  await page.goto('./#/home');
  const [image] = await screenshots(page);
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#screenshot-file').setInputFiles([{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }, { name: image.name, mimeType: 'image/png', buffer: Buffer.from(image.base64, 'base64') }]);
  await expect(page.locator('.batch-task')).toHaveCount(1, { timeout: 120000 });
  await expect(page.locator('#review-panel')).toContainText('1 张截图尚未识别成功');
  await page.getByRole('button', { name: '确认并保存所选任务', exact: true }).click();
  await expect(page.locator('.review-done')).toContainText('已保存 1 项');
  expect((await stored(page)).draft.tasks).toHaveLength(0);
  await page.getByRole('button', { name: '跳过失败截图', exact: true }).click();
  await expect.poll(async () => (await stored(page)).files).toBe(0);
  await page.getByRole('button', { name: '回到我的任务' }).click();
  expect((await stored(page)).draft).toBeUndefined();
});

test('upgrading the v1 database adds drafts without changing or deleting existing tasks', async ({ page }) => {
  await page.route('**/migration-setup.html', route => route.fulfill({ contentType: 'text/html', body: '<html><body>migration fixture</body></html>' }));
  await page.goto('./migration-setup.html');
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('shike-study-tasks', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('tasks', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('tasks', 'readwrite');
        tx.objectStore('tasks').put({ id: 'old-task', title: '升级前的任务', details: '原有要求', dueDate: '2026-12-31', dueTime: '', createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z', completedAt: null });
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
  });
  await page.goto('./#/tasks');
  await expect(page.locator('.task-card')).toContainText('升级前的任务');
  const state = await stored(page);
  expect(state.version).toBe(2); expect(state.tasks).toHaveLength(1); expect(state.tasks[0].id).toBe('old-task');
  expect(state.tasks[0].details).toBe('原有要求'); expect(state.tasks[0].createdAt).toBe('2026-10-24T00:00:00.000Z');
});
