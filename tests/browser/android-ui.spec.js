import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function android(page) {
  await page.addInitScript(() => {
    window.ShikeNative = { postMessage(raw) {
      const { id } = JSON.parse(raw);
      setTimeout(() => window.ShikeNative.onmessage?.({ data: JSON.stringify({ id, ok: true, result: JSON.parse(raw).method === 'shareInbox' ? [] : { available: true, enabled: false, granted: false } }) }), 0);
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
  await expect(page.getByRole('button', { name: '打开设置', exact: true })).toHaveCount(0);
  await page.locator('.sidebar [data-view="home"]').click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '你的本地学习空间', exact: true })).toBeVisible();
});

test('expanded tablet navigation keeps icons, labels and counts inside separate full-width rows', async ({ page }) => {
  await android(page);
  for (const [width, height] of [[651, 1000], [800, 1280], [900, 1280], [901, 1280], [1100, 800], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    for (const textScale of [1, 1.3]) {
      await page.locator('.sidebar .nav-item').evaluateAll((items, scale) => {
        for (const item of items) item.style.fontSize = `${12 * scale}px`;
      }, textScale);
      const rows = await page.locator('.sidebar .nav-item').evaluateAll(items => items.map(item => {
        const box = item.getBoundingClientRect();
        const parts = [...item.children].map(child => child.getBoundingClientRect().toJSON());
        return { box: box.toJSON(), parts, parentWidth: item.parentElement.clientWidth, width: item.clientWidth, scrollWidth: item.scrollWidth };
      }));
      for (const [index, row] of rows.entries()) {
        expect(row.box.width, `${width}px row ${index}`).toBeCloseTo(row.parentWidth, 0);
        expect(row.scrollWidth).toBeLessThanOrEqual(row.width);
        for (const [partIndex, part] of row.parts.entries()) {
          expect(part.left).toBeGreaterThanOrEqual(row.box.left);
          expect(part.right).toBeLessThanOrEqual(row.box.right);
          expect(part.top).toBeGreaterThanOrEqual(row.box.top);
          expect(part.bottom).toBeLessThanOrEqual(row.box.bottom);
          if (partIndex) expect(part.left).toBeGreaterThanOrEqual(row.parts[partIndex - 1].right);
        }
        if (index) expect(row.box.top).toBeGreaterThanOrEqual(rows[index - 1].box.bottom);
      }
    }
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await expect(page.locator('.sidebar .nav-item > span').first()).toBeHidden();
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('Android tablet settings is available only at home across task and import routes', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await android(page);
  for (const view of ['all', 'upcoming', 'overdue', 'undated', 'completed']) {
    if(view==='completed'){await page.locator('.sidebar [data-view=all]').click();await page.locator('.task-completed-top [data-view=completed]').click();}else await page.locator(`.sidebar [data-view="${view}"]`).click();
    await expect(page.locator('[data-action="settings"]')).toHaveCount(0);
    await expect(page.locator('.native-footer')).toHaveCount(0);
  }
  await page.locator('.sidebar [data-view="home"]').click();
  await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await expect(page.locator('[data-action="settings"]')).toHaveCount(0);
  await page.locator('#notification-text').fill('完成数学第三章习题\n2026年12月30日截止');
  await page.getByRole('button', { name: '从文字提取任务', exact: true }).click();
  await expect(page).toHaveURL(/#\/import\/review$/);
  await expect(page.locator('[data-action="settings"]')).toHaveCount(0);
  await page.getByRole('button', { name: '退出添加', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeVisible();
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

test('phone home keeps all input methods visible with both draft types and can open either recovery', async ({ page }) => {
  await page.setViewportSize({ width: 421, height: 927 });
  await android(page);
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#notification-text').fill('尚未提取的通知原文');
  await page.getByRole('button', { name: '退出添加', exact: true }).click();
  await page.locator('#home-manual').click();
  await page.locator('#task-form [name="title"]').fill('尚未保存的填写');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  for (const [width, height] of [[360, 792], [393, 864], [421, 927]]) {
    await page.setViewportSize({ width, height });
    const nav = await page.locator('.sidebar').boundingBox();
    for (const selector of ['[data-action="import"]', '[data-action="voice"]', '#home-manual']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
    }
    await expect(page.getByRole('button', { name: '恢复上次内容', exact: true })).toBeInViewport();
  }
  await page.getByRole('button', { name: '恢复上次内容', exact: true }).click();
  await page.getByRole('button', { name: '恢复填写草稿', exact: true }).click();
  await expect(page.locator('#task-form [name="title"]')).toHaveValue('尚未保存的填写');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('button', { name: '恢复上次内容', exact: true }).click();
  await page.getByRole('button', { name: '继续上次导入', exact: true }).click();
  await expect(page.locator('#notification-text')).toHaveValue('尚未提取的通知原文');
});
