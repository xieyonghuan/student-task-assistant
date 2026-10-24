import { test, expect } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

async function homepage(page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/home$/);
  await page.evaluate(() => navigator.serviceWorker.ready);
}
async function voiceDialog(page) {
  await page.getByRole('button', { name: '开始语音输入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '语音添加任务', exact: true })).toBeVisible();
  await expect(page.locator('#prepare-voice')).toBeEnabled();
}
async function prepare(page) {
  await page.locator('#prepare-voice').click();
  await expect(page.locator('#voice-resource-title')).toContainText('资源已就绪', { timeout: 120000 });
  await expect(page.locator('#voice-start')).toBeEnabled();
}
async function mockModel(page, { rejectMicrophone = false, transcript = '完成 数学 作业，明天 提交' } = {}) {
  await page.addInitScript(({ rejectMicrophone, transcript }) => {
    window.__voiceWorkerTerminated = 0; window.__micRequests = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__micRequests++;
      if (rejectMicrophone) throw new DOMException('Denied by test', 'NotAllowedError');
      const stream = await original(constraints); window.__testMicStream = stream; return stream;
    };
    class Model {
      constructor() { this.handlers = {}; this.worker = { terminate: () => { window.__voiceWorkerTerminated++; } }; setTimeout(() => this.handlers.load?.({ result: true }), 10); }
      on(name, listener) { this.handlers[name] = listener; }
      get KaldiRecognizer() {
        const model = this;
        return class {
          constructor() { this.id = 'test-recognizer'; this.handlers = {}; model.recognizer = this; }
          on(name, listener) { this.handlers[name] = listener; }
          acceptWaveformFloat(samples) { if (samples.length) this.handlers.partialresult?.({ result: { partial: '完成 数学 作业' } }); }
        };
      }
      postMessage(message) { if (message.action === 'retrieveFinalResult') setTimeout(() => this.recognizer.handlers.result?.({ result: { text: transcript }, shikeFinal: true }), 20); }
      terminate() {}
    }
    window.Vosk = { Model };
  }, { rejectMicrophone, transcript });
}

test('home opens by default with all three input methods and a separate timeline', async ({ page }) => {
  await homepage(page);
  await expect(page.locator('.home-capture')).toBeVisible();
  await expect(page.locator('.home-methods')).toBeVisible();
  await expect(page.getByRole('button', { name: /识别课程截图/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '手动添加', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始语音输入', exact: true })).toBeVisible();
  await expect(page.locator('.task-timeline')).toHaveCount(0);
  await page.screenshot({ path: '../outputs/shike-home.png', fullPage: true });
  for (const [width, height] of [[800, 1280], [390, 844]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 800) await page.screenshot({ path: '../outputs/shike-home-portrait.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '手动添加', exact: true }).click();
  await page.locator('#task-form [name="title"]').fill('从首页添加的阅读任务');
  await page.locator('#task-form [name="dueDate"]').fill('2026-12-31');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.locator('#task-form')).toHaveCount(0);
  await page.getByRole('button', { name: '查看全部待办', exact: true }).click();
  await expect(page).toHaveURL(/#\/tasks$/);
  await expect(page.locator('.task-card')).toContainText('从首页添加的阅读任务');
  await page.locator('.sidebar [data-view="home"]').click();
  await page.reload();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.home-capture')).toBeVisible();
});

test.describe('voice input with a browser test microphone', () => {
  for (const [name, deadline] of [['plain Chinese date', '十月三十号提交'], ['labelled Chinese date', '截止日期十月三十号']]) {
    test(`spoken ${name} fills one task and its deadline without an unnecessary date dialog`, async ({ page, context }) => {
      await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+08:00'));
      await mockModel(page, { transcript: `完成数学第三章习题\n${deadline}` });
      await context.grantPermissions(['microphone']);
      await homepage(page); await voiceDialog(page); await prepare(page);
      await page.locator('#voice-start').click();
      await expect(page.locator('#recording-status')).toContainText('正在听');
      await page.locator('#voice-stop').click();
      await expect(page.locator('#voice-transcript')).toHaveValue(`完成数学第三章习题\n${deadline}`);
      await page.locator('#voice-use').click();
      await expect(page.locator('#review-panel')).toContainText('第 1 / 1 项任务');
      await expect(page.locator('#review-form [name="title"]')).toHaveValue('完成数学第三章习题');
      await expect(page.locator('#review-form [name="dueDate"]')).toHaveValue('2026-10-30');
      await expect(page.locator('#review-form [name="dueTime"]')).toHaveValue('');
      await expect(page.getByRole('heading', { name: '确认截止日期', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '确认并保存', exact: true }).click();
      await page.getByRole('button', { name: '回到我的任务' }).click();
      await expect(page.locator('.task-card')).toHaveCount(1);
      await expect(page.locator('.task-card')).toContainText('完成数学第三章习题');
      await expect(page.locator('.task-card')).toContainText('10月30日 · 00:00');
    });
  }

  test('transcript is editable, fills a device-relative date, saves on confirmation and releases microphone', async ({ page, context }) => {
    await page.clock.setFixedTime(new Date('2026-10-24T20:30:00+08:00'));
    await mockModel(page); await context.grantPermissions(['microphone']);
    await homepage(page); await voiceDialog(page); await prepare(page);
    expect(await page.evaluate(() => window.__micRequests)).toBe(0);
    await page.locator('#voice-start').click();
    await expect(page.locator('#recording-status')).toContainText('正在听');
    await expect(page.locator('#voice-partial')).toContainText('数学作业');
    await expect(page.locator('#voice-use')).toBeDisabled();
    await page.locator('#voice-stop').click();
    await expect(page.locator('#recording-status')).toContainText('核对');
    await expect(page.locator('#voice-transcript')).toHaveValue(/完成数学作业/);
    expect(await page.evaluate(() => window.__testMicStream.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
    await page.locator('#voice-transcript').fill('完成高等数学第三章习题，明天提交');
    await page.locator('#voice-use').click();
    await expect(page.getByRole('heading', { name: '确认截止日期', exact: true })).toHaveCount(0);
    await expect(page.locator('#review-form [name="dueDate"]')).toHaveValue('2026-10-25');
    await expect(page.locator('#review-panel')).toContainText('设备本地时间 2026-10-24 20:30');
    await page.locator('#review-form [name="dueDate"]').fill('2026-11-06');
    await page.getByRole('button', { name: '确认并保存', exact: true }).click();
    await page.getByRole('button', { name: '回到我的任务' }).click();
    await expect(page).toHaveURL(/#\/tasks$/);
    await expect(page.locator('.task-card')).toHaveCount(1);
    await expect(page.locator('.task-card')).toContainText('高等数学');
    await expect(page.locator('.task-card')).toContainText('11月6日');
  });

  test('denied microphone permission shows clear recovery and preserves editable text', async ({ page }) => {
    await mockModel(page, { rejectMicrophone: true });
    await homepage(page); await voiceDialog(page); await prepare(page);
    await page.locator('#voice-transcript').fill('先记下我的阅读任务');
    await page.locator('#voice-start').click();
    await expect(page.locator('#voice-error')).toContainText('麦克风权限未允许');
    await expect(page.locator('#voice-transcript')).toHaveValue('先记下我的阅读任务');
    await expect(page.locator('#voice-start')).toBeEnabled();
    expect(await page.evaluate(() => window.__voiceWorkerTerminated)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  });

  test('closing the recording dialog releases the microphone and creates no task', async ({ page, context }) => {
    await mockModel(page); await context.grantPermissions(['microphone']);
    await homepage(page); await voiceDialog(page); await prepare(page);
    await page.locator('#voice-start').click();
    await expect(page.locator('#recording-status')).toContainText('正在听');
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.__testMicStream.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
    expect(await page.evaluate(() => window.__voiceWorkerTerminated)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '查看全部待办', exact: true }).click();
    await expect(page.locator('.task-card')).toHaveCount(0);
  });

  test('real Chinese model loads offline, accepts audio and stops cleanly without external requests', async ({ page, context }) => {
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    context.on('request', request => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') external.push(request.url()); });
    await page.addInitScript(() => {
      window.__audioChunks = 0;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...rest) { if (message.action === 'audioChunk') window.__audioChunks++; return super.postMessage(message, ...rest); }
      };
    });
    await context.grantPermissions(['microphone']);
    await homepage(page); await voiceDialog(page); await prepare(page);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await context.setOffline(true); await page.reload();
    await voiceDialog(page);
    await expect(page.locator('#voice-start')).toBeEnabled();
    await page.locator('#voice-start').click();
    await page.waitForFunction(() => document.querySelector('#recording-status')?.textContent.includes('正在听') || document.querySelector('#voice-error')?.textContent.trim(), undefined, { timeout: 90000 });
    await expect(page.locator('#voice-error')).toHaveText('');
    await expect(page.locator('#recording-status')).toContainText('正在听');
    await expect(page.locator('#voice-stop')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__audioChunks)).toBeGreaterThan(2);
    await page.locator('#voice-stop').click();
    await expect(page.locator('#recording-status')).toHaveText(/核对|没有听到清晰文字/, { timeout: 20000 });
    await expect(page.locator('#voice-start')).toBeEnabled();
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await context.setOffline(false);
    expect(external).toEqual([]); expect(errors).toEqual([]);
  });
});

