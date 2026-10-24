import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function home(page) {
  await page.goto('./#/tasks');
  await expect(page.getByRole('heading', { name: '全部待办' })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
}
async function addTask(page, title, date = '2026-12-30', details = '', dueTime = '') {
  await page.getByRole('button', { name: '手动添加', exact: true }).click();
  const form = page.locator('#task-form');
  await form.locator('[name="title"]').fill(title);
  if (date) await form.locator('[name="dueDate"]').fill(date);
  if (dueTime) await form.locator('[name="dueTime"]').fill(dueTime);
  if (details) await form.locator('[name="details"]').fill(details);
  await form.getByRole('button', { name: '保存任务', exact: true }).click();
  if (!date) await page.getByRole('button', { name: '暂无截止日期', exact: true }).click();
  await expect(form).not.toBeVisible();
}

test('empty dashboard fits landscape, portrait and narrow viewports without overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await home(page);
  for (const [width, height] of [[1440, 1000], [1280, 800], [800, 1280], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: /识别课程截图/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mkdir('../outputs', { recursive: true });
  await page.screenshot({ path: '../outputs/shike-landscape.png', fullPage: true });
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.screenshot({ path: '../outputs/shike-portrait.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('manual creation, validation, persistence, duplicates, completion, restoration and deletion', async ({ page }) => {
  await home(page);
  await addTask(page, '高等数学第三章习题', '2026-12-30', '写出计算步骤');
  await page.reload();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.getByRole('button', { name: '手动添加', exact: true }).click();
  await page.locator('#task-form [name="title"]').fill('高等数学 第三章习题');
  await page.locator('#task-form [name="dueDate"]').fill('2026-12-31');
  await page.locator('#task-form').getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '可能与已有任务重复' })).toBeVisible();
  await page.getByRole('button', { name: '修改选中的原任务' }).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.task-card')).toContainText('12月31日');
  await page.getByRole('button', { name: '标为已完成：高等数学 第三章习题', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(0);
  await page.locator('.sidebar [data-view="completed"]').click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.getByRole('button', { name: '恢复任务：高等数学 第三章习题', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(0);
  await page.locator('.sidebar [data-view="all"]').click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.getByRole('button', { name: '删除任务：高等数学 第三章习题', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(0);
  await addTask(page, '整理课堂笔记', '');
  await expect(page.locator('.task-card')).toContainText('暂无截止日期');
});

test('extracts multiple tasks, fills relative dates and asks only for missing dates', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T20:30:00+08:00'));
  await home(page);
  await page.getByRole('button', { name: '试试示例', exact: true }).click();
  await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
  await expect(page.locator('#review-panel')).toContainText('第 1 / 3 项任务');
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await expect(page.locator('#review-panel')).toContainText('第 2 / 3 项任务');
  await expect(page.locator('#review-form [name="dueDate"]')).toHaveValue('2026-10-30');
  await expect(page.getByRole('heading', { name: '确认截止日期', exact: true })).toHaveCount(0);
  await page.locator('#review-form [name="dueDate"]').fill('2026-11-06');
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await expect(page.locator('dialog').last()).toContainText('计算机基础');
  await page.getByRole('button', { name: '暂无截止日期', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await expect(page.locator('#review-panel')).toContainText('已保存 3 项');
  await page.getByRole('button', { name: '回到我的任务' }).click();
  await expect(page.locator('.task-card')).toHaveCount(3);
  await page.getByRole('searchbox', { name: '搜索任务' }).fill('英语');
  await expect(page.locator('.task-card')).toHaveCount(1);
});

test('device Saturday evening resolves relative deadlines, saves a fixed date and exports midnight', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T20:30:00+08:00'));
  await home(page);
  const cases = [['明天提交', '2026-10-25'], ['后天提交', '2026-10-26'], ['周五截止', '2026-10-30'], ['星期五提交', '2026-10-30']];
  for (const [expression, date] of cases) {
    await page.getByRole('button', { name: /识别课程截图/ }).click();
    await page.locator('#notification-text').fill(`完成数学第三章习题\n${expression}`);
    await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
    await expect(page.locator('#review-panel')).toContainText('第 1 / 1 项任务');
    await expect(page.locator('#review-form [name="dueDate"]')).toHaveValue(date);
    await expect(page.locator('#review-form [name="dueTime"]')).toHaveValue('');
    await expect(page.locator('#review-panel')).toContainText('设备本地时间 2026-10-24 20:30');
    await expect(page.getByRole('heading', { name: '确认截止日期', exact: true })).toHaveCount(0);
    if (expression === '明天提交') {
      await page.getByRole('button', { name: '确认并保存', exact: true }).click();
      await page.getByRole('button', { name: '回到我的任务' }).click();
    } else await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  }
  await page.clock.setFixedTime(new Date('2026-10-25T10:00:00+08:00'));
  await page.reload();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.task-card')).toContainText('10月25日 · 00:00');
  await page.getByRole('button', { name: '导出日历', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载日历文件', exact: true }).click();
  const file = await downloaded;
  expect(await readFile(await file.path(), 'utf8')).toContain('DTSTART:20261024T160000Z');
});

test.describe('device local timezone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('uses the device Saturday date even when UTC and China are already Sunday', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-25T02:30:00Z'));
    await home(page);
    await page.getByRole('button', { name: /识别课程截图/ }).click();
    await page.locator('#notification-text').fill('完成数学作业\n明天提交');
    await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
    await expect(page.locator('#review-form [name="dueDate"]')).toHaveValue('2026-10-25');
    await expect(page.locator('#review-panel')).toContainText('设备本地时间 2026-10-24 19:30');
    await expect(page.getByRole('heading', { name: '确认截止日期', exact: true })).toHaveCount(0);
  });
});

test('typed Chinese deadline text stays attached to its task and fills the date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+08:00'));
  await home(page);
  for (const deadline of ['十月三十号提交', '截止日期十月三十号']) {
    await page.getByRole('button', { name: /识别课程截图/ }).click();
    await page.locator('#notification-text').fill(`完成数学第三章习题\n${deadline}`);
    await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
    await expect(page.locator('#review-panel')).toContainText('第 1 / 1 项任务');
    await expect(page.locator('#review-form [name="title"]')).toHaveValue('完成数学第三章习题');
    await expect(page.locator('#review-form [name="dueDate"]')).toHaveValue('2026-10-30');
    await expect(page.locator('#review-form [name="dueTime"]')).toHaveValue('');
    await expect(page.getByRole('heading', { name: '确认截止日期', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  }
});

test('exports a valid calendar with midnight deadline and four reminders; no-date tasks excluded', async ({ page }) => {
  await home(page);
  await addTask(page, '阅读报告', '2026-12-30', '不要漏掉分析部分');
  await addTask(page, '物理实验归档', '2026-12-31');
  await page.getByRole('button', { name: '标为已完成：物理实验归档', exact: true }).click();
  await addTask(page, '整理笔记', '');
  await page.getByRole('button', { name: '导出日历', exact: true }).click();
  await expect(page.locator('input[name="export-task"]:checked')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载日历文件', exact: true }).click();
  const file = await download;
  const text = await readFile(await file.path(), 'utf8');
  expect(text).toContain('DTSTART:20261229T160000Z');
  expect(text.match(/BEGIN:VALARM/g)).toHaveLength(8);
  expect(text).not.toContain('SUMMARY:整理笔记');
  expect(text).toContain('SUMMARY:阅读报告');
});

test('backs up and restores local tasks and renders imported text safely', async ({ page }) => {
  await home(page);
  await addTask(page, '英语阅读报告', '2026-12-30', '<img src=x onerror="alert(1)">');
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const file = await downloaded;
  const backup = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(backup.tasks).toHaveLength(1);
  backup.tasks[0].title = '恢复后的英语报告';
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('.task-card')).toContainText('恢复后的英语报告');
  await expect(page.locator('.task-card img')).toHaveCount(0);
});

test('recovers from an invalid screenshot by letting the user paste and review text', async ({ page }) => {
  await home(page);
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#screenshot-file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a real picture') });
  await expect(page.locator('#review-panel')).toContainText('这次没有识别完成');
  await page.locator('#notification-text').fill('1. 完成地理作业\n截止时间：2026年12月30日');
  await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await page.getByRole('button', { name: '回到我的任务' }).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
});

test('prepares resources and performs real Chinese OCR after offline reload, with no external requests', async ({ page, context }) => {
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  context.on('request', request => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && !url.hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(request.url()); });
  await home(page);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 720;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#202020'; ctx.font = '36px "Microsoft YaHei"';
    ['课程作业通知', '1. 高等数学：完成第三章习题', '截止时间：2026年12月30日 23:59', '要求：写出计算过程。', '2. 大学英语：提交阅读报告', '截止时间：2026年12月31日', '要求：完成一篇阅读报告。'].forEach((line, i) => ctx.fillText(line, 65, 85 + i * 80));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.locator('#prepare-offline').click();
  await expect(page.locator('#offline-description')).toContainText('离线资源已就绪', { timeout: 120000 });
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(page.locator('.offline-card')).toContainText('离线资源已就绪');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '全部待办' })).toBeVisible();
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#screenshot-file').setInputFiles({ name: 'cancelled-notice.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.locator('#cancel-ocr').click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#screenshot-file').setInputFiles({ name: 'synthetic-course-notice.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#review-panel')).toContainText('第 1 / 2 项任务', { timeout: 180000 });
  await expect(page.locator('#notification-text')).toHaveValue(/高等数学/);
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await expect(page.locator('#review-panel')).toContainText('第 2 / 2 项任务');
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await page.getByRole('button', { name: '回到我的任务' }).click();
  await expect(page.locator('.task-card')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.task-card')).toHaveCount(2);
  await context.setOffline(false);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('learning destinations have independent routes, layouts, timeline and a strict 72-hour window', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+08:00'));
  await home(page);
  await addTask(page, '第六章作业', '2026-10-31', '完成章节练习并提交', '23:59');
  await addTask(page, '三天内的阅读报告', '2026-10-27');
  await addTask(page, '三天后的实验总结', '2026-10-28');
  await addTask(page, '需要重新安排的习题', '2026-10-23');
  await addTask(page, '课堂笔记整理', '');
  await expect(page).toHaveURL(/#\/tasks$/);
  const entries = page.locator('.timeline-entry');
  expect(await entries.evaluateAll(elements => elements.map(el => el.dataset.date))).toEqual(['2026-10-23', '2026-10-27', '2026-10-28', '2026-10-31', 'undated']);
  const dateBox = await entries.first().locator('.timeline-date').boundingBox();
  const taskBox = await entries.first().locator('.task-card').boundingBox();
  expect(taskBox.x).toBeGreaterThan(dateBox.x + dateBox.width);
  await page.screenshot({ path: '../outputs/shike-timeline.png', fullPage: true, style: '#toast { visibility: hidden !important; }' });
  for (const [width, height] of [[800, 1280], [390, 844]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.sidebar [data-view="upcoming"]').click();
  await expect(page).toHaveURL(/#\/upcoming$/);
  await expect(page.getByRole('heading', { name: '即将截止', exact: true })).toBeVisible();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.task-card')).toContainText('三天内的阅读报告');
  await expect(page.locator('.intake-strip')).toHaveCount(0);
  await expect(page.locator('.timeline-entry')).toHaveCount(0);
  await page.screenshot({ path: '../outputs/shike-upcoming.png', fullPage: true, style: '#toast { visibility: hidden !important; }' });
  await page.reload();
  await expect(page).toHaveURL(/#\/upcoming$/);
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.clock.setFixedTime(new Date('2026-10-25T12:00:00+08:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.task-card')).toHaveCount(2);
  await expect(page.locator('[data-count="upcoming"]')).toHaveText('2');
  await expect(page.locator('.sidebar [data-view="upcoming"] .nav-count')).toHaveText('2');
  await page.locator('.sidebar [data-view="overdue"]').click();
  await expect(page).toHaveURL(/#\/overdue$/);
  await expect(page.getByRole('heading', { name: '已逾期', exact: true })).toBeVisible();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.overdue-summary')).toBeVisible();
  await page.locator('.sidebar [data-view="undated"]').click();
  await expect(page).toHaveURL(/#\/undated$/);
  await expect(page.getByRole('heading', { name: '暂无截止日期', exact: true })).toBeVisible();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.undated-summary')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '已逾期', exact: true })).toBeVisible();
});

test('regression: real sparse platform screenshot yields the chapter task and correct deadline offline', async ({ page, context }) => {
  test.skip(!process.env.STUDY_TEST_IMAGE, 'Private image regression requires a user-supplied local fixture.');
  await home(page);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.locator('#prepare-offline').click();
  await expect(page.locator('#offline-description')).toContainText('离线资源已就绪', { timeout: 120000 });
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#screenshot-file').setInputFiles(process.env.STUDY_TEST_IMAGE);
  await expect(page.locator('#review-panel')).toContainText('第 1 / 1 项任务', { timeout: 180000 });
  await expect(page.locator('#review-form [name="title"]')).toHaveValue('第六章作业');
  await expect(page.locator('#review-form [name="dueDate"]')).toHaveValue('2026-10-31');
  await expect(page.locator('#review-form [name="dueTime"]')).toHaveValue('23:59');
  await expect(page.getByRole('heading', { name: '确认截止日期', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await page.getByRole('button', { name: '回到我的任务' }).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.task-card')).toContainText('第六章作业');
  await expect(page.locator('.task-card')).toContainText('10月31日 · 23:59');
  await context.setOffline(false);
});


