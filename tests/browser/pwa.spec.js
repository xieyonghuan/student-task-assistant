import { test, expect } from '@playwright/test';

test('install help is available when the browser does not expose a native install prompt', async ({ page }) => {
  await page.addInitScript(() => window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true }));
  await page.goto('./');
  await page.getByRole('button', { name: '安装到桌面', exact: true }).click();
  await expect(page.getByRole('heading', { name: '安装到平板桌面', exact: true })).toBeVisible();
  await expect(page.locator('dialog')).toContainText('添加到桌面');
  await expect(page.locator('dialog')).toContainText('导出备份');
  await expect(page.locator('dialog')).toContainText('不会通过账号自动同步');
});

test('native install is requested only by a click and installed state is reflected in the page', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__installRequests = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.__installRequests++; };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  expect(await page.evaluate(() => window.__installRequests)).toBe(0);
  await page.getByRole('button', { name: '安装到桌面', exact: true }).click();
  expect(await page.evaluate(() => window.__installRequests)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('button', { name: '已安装到桌面', exact: true })).toBeDisabled();
});

test('PWA manifest, worker scope and caches belong to the deployed repository path', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const report = await page.evaluate(async () => {
    const base = new URL('./', location.href);
    const manifest = await (await fetch(new URL('manifest.webmanifest', base))).json();
    const registration = await navigator.serviceWorker.ready;
    return { base: base.href, manifest, scope: registration.scope, caches: await caches.keys() };
  });
  expect(report.scope).toBe(report.base);
  expect(new URL(report.manifest.start_url, report.base).href).toBe(report.base);
  expect(report.manifest.display).toBe('standalone');
  expect(report.manifest.orientation).toBe('any');
  expect(report.manifest.icons.some(icon => icon.purpose === 'maskable')).toBe(true);
  const prefix = `shike-${encodeURIComponent(new URL(report.base).pathname)}-`;
  expect(report.caches.some(name => name.startsWith(prefix + 'shell-'))).toBe(true);
});
