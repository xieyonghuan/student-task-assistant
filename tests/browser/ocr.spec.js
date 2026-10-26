import { test, expect } from '@playwright/test';

test('repeated OCR resets numeric-only settings, reuses one engine and recovers after cancellation', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.ocrWorkers = { created: 0, terminated: 0 };
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.ocr = String(url).includes('/ocr/worker.min.js');
        if (this.ocr) window.ocrWorkers.created++;
      }
      terminate() {
        if (this.ocr) window.ocrWorkers.terminated++;
        return super.terminate();
      }
    };
  });
  await page.goto('./#/home');
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 1600;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#202020'; ctx.font = '36px "Microsoft YaHei"';
    ctx.fillText('课程作业通知', 65, 85);
    ctx.fillText('1. 高等数学：完成第三章习题', 65, 300);
    ctx.fillStyle = '#3885d0'; ctx.fillText('截止时间：2026-12-30/23:59', 65, 1300);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  async function upload(name) {
    await page.getByRole('button', { name: /识别课程截图/ }).click();
    await page.locator('#screenshot-file').setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  }
  async function checkResult() {
    await expect(page.locator('#review-form [name="title"]')).toHaveValue(/高等数学/, { timeout: 120000 });
    await expect(page.locator('#review-form [name="dueDate"]')).toHaveValue('2026-12-30');
    await expect(page.locator('#review-form [name="dueTime"]')).toHaveValue('23:59');
    await page.getByRole('button', { name: '退出添加', exact: true }).click();
  }
  await upload('first.png'); await checkResult();
  await upload('second.png'); await checkResult();
  expect(await page.evaluate(() => ocrWorkers.created)).toBe(1);
  await upload('cancelled.png');
  await page.locator('#cancel-ocr').click();
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续上次导入', exact: true }).click(); await checkResult();
  const stats = await page.evaluate(() => ocrWorkers);
  expect(stats.created).toBe(2);
  expect(stats.terminated).toBeGreaterThanOrEqual(1);
});
