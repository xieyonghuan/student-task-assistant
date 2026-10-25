import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function android(page) {
  await page.addInitScript(() => {
    window.ShikeNative = { postMessage(raw) {
      const { id } = JSON.parse(raw);
      setTimeout(() => window.ShikeNative.onmessage?.({ data: JSON.stringify({ id, ok: true, result: { available: true, enabled: false, granted: false } }) }), 0);
    } };
  });
  await page.goto('./#/home');
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
}

test('Android removes web chrome, puts privacy above settings and remembers a collapsible tablet sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await android(page);
  await expect(page.locator('.topbar, .breadcrumb, [data-action="install"]')).toHaveCount(0);
  const privacy = await page.locator('.native-utility .privacy-badge').boundingBox();
  const settings = await page.getByRole('button', { name: '打开设置', exact: true }).boundingBox();
  expect(privacy.x).toBeGreaterThan(640);
  expect(settings.y).toBeGreaterThanOrEqual(privacy.y + privacy.height);
  await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeInViewport();
  const expanded = await page.locator('.sidebar').boundingBox();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  const collapsed = await page.locator('.sidebar').boundingBox();
  expect(collapsed.width).toBeLessThan(expanded.width / 2);
  await expect(page.getByRole('button', { name: '展开侧栏', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.sidebar [data-view="upcoming"]').click();
  await expect(page.getByRole('heading', { name: '即将截止', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '展开侧栏', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar [data-view="upcoming"]')).toHaveAttribute('aria-current', 'page');
  await mkdir('../outputs', { recursive: true });
  await page.screenshot({ path: '../outputs/shike-android-sidebar-collapsed.png', fullPage: true });
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '你的本地学习空间', exact: true })).toBeVisible();
});

test('Android phone home keeps all input methods visible and settings at the top right', async ({ page }) => {
  await android(page);
  for (const [width, height] of [[360, 792], [393, 864], [421, 927]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const heading = await page.getByRole('heading', { name: '首页', exact: true }).boundingBox();
    const settings = page.getByRole('button', { name: '打开设置', exact: true });
    await expect(page.locator('.native-utility .privacy-badge')).toBeVisible();
    const box = await settings.boundingBox();
    expect(box.x).toBeGreaterThan(width / 2);
    expect(box.y).toBeLessThan(heading.y + heading.height);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await expect(settings).toBeInViewport();
    const nav = await page.locator('.sidebar').boundingBox();
    for (const selector of ['[data-action="import"]', '[data-action="voice"]', '#home-manual']) {
      const button = page.locator(selector);
      await expect(button).toBeInViewport();
      const bounds = await button.boundingBox();
      expect(bounds.bottom ?? bounds.y + bounds.height).toBeLessThanOrEqual(nav.y);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
  }
  await mkdir('../outputs', { recursive: true });
  await page.screenshot({ path: '../outputs/shike-android-phone-home.png', fullPage: true });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.locator('#open-calendar-sync')).toBeVisible();
});

test('folding the Android sidebar preserves an in-progress extraction and works without saved preferences', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Preference storage blocked', 'SecurityError'); }; });
  await page.setViewportSize({ width: 800, height: 1280 });
  await android(page);
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  const text = '完成数学第三章习题\n2026年12月30日截止';
  await page.locator('#notification-text').fill(text);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(page.locator('#notification-text')).toHaveValue(text);
  await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
  await expect(page).toHaveURL(/#\/import\/review$/);
  await page.locator('#review-form [name="title"]').fill('已核对的数学任务');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(page.locator('#review-form [name="title"]')).toHaveValue('已核对的数学任务');
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await page.getByRole('button', { name: '回到我的任务' }).click();
  await expect(page.locator('.task-card')).toContainText('已核对的数学任务');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
