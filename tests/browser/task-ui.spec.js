import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('voice appears above manual entry on desktop, tablet and phone', async ({ page }) => {
  await page.goto('./#/home');
  for (const [width, height] of [[1440, 1000], [800, 1280], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const voice = await page.locator('.voice-entry').boundingBox();
    const manual = await page.locator('.manual-entry').boundingBox();
    expect(manual.y).toBeGreaterThanOrEqual(voice.y + voice.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('text extraction opens a visible review page, preserves edits on back and saves once', async ({ page }) => {
  await page.goto('./#/home');
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await expect(page).toHaveURL(/#\/import$/);
  await expect(page.locator('#review-panel')).toBeHidden();
  const text = '完成数学第三章习题\n截止时间：2026年12月30日 23:59\n要求：写出计算过程。';
  await page.locator('#notification-text').fill(text);
  await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
  await expect(page).toHaveURL(/#\/import\/review$/);
  await expect(page.getByRole('heading', { name: '确认任务', exact: true })).toBeInViewport();
  await expect(page.locator('.review-heading')).toBeInViewport();
  await expect(page.locator('#notification-text')).toBeHidden();
  await expect(page.locator('.source-reference pre')).toBeHidden();
  await page.locator('.source-reference summary').click();
  await expect(page.locator('.source-reference pre')).toHaveText(text);
  await page.locator('#review-form [name="title"]').fill('核对后的数学作业');
  await page.getByRole('button', { name: /返回修改原文/ }).click();
  await expect(page).toHaveURL(/#\/import$/);
  await expect(page.locator('#notification-text')).toHaveValue(text);
  await page.getByRole('button', { name: /继续确认任务/ }).click();
  await expect(page.locator('#review-form [name="title"]')).toHaveValue('核对后的数学作业');
  await page.goBack();
  await expect(page.locator('#notification-text')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#review-form [name="title"]')).toHaveValue('核对后的数学作业');
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await expect(page.locator('#review-panel')).toContainText('已保存 1 项');
  await page.getByRole('button', { name: '回到我的任务' }).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('.task-card')).toContainText('核对后的数学作业');
  expect(await page.locator('.due-label').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
});

test('phone extraction moves from a scrolled input to the next page; direct review URL starts safely', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('./#/import/review');
  await expect(page).toHaveURL(/#\/import$/);
  await expect(page.getByRole('heading', { name: '导入通知', exact: true })).toBeVisible();
  await page.locator('#notification-text').fill('完成英语阅读报告\n2026年12月30日截止');
  await page.getByRole('button', { name: '从文字提取任务', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
  await expect(page).toHaveURL(/#\/import\/review$/);
  await expect(page.getByRole('heading', { name: '确认任务', exact: true })).toBeInViewport();
  await expect(page.locator('.review-heading')).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('../outputs', { recursive: true });
  await page.screenshot({ path: '../outputs/shike-review-phone.png', fullPage: true });
  await page.reload();
  await expect(page).toHaveURL(/#\/import$/);
  await expect(page.locator('#notification-text')).toHaveValue('');
});
