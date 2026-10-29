import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const edgePath = process.env.SHIKE_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 240000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../work/browser-results',
  use: {
    baseURL: process.env.TEST_URL || 'http://127.0.0.1:4173',
    channel: 'msedge',
    launchOptions: existsSync(edgePath) ? { executablePath: edgePath } : {},
    headless: true,
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
