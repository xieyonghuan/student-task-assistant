// Rasterize the tracked SVG for Android install icons; only needed when the logo changes.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

await mkdir('public/icons', { recursive: true });
const svg = await readFile('public/icon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  for (const [name, size, maskable] of [['icon-192', 192, false], ['icon-512', 512, false], ['icon-maskable', 512, true]]) {
    const data = await page.evaluate(async ({ svg, size, maskable }) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (maskable) { ctx.fillStyle = '#7685df'; ctx.fillRect(0, 0, size, size); }
      const image = new Image(); image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`; await image.decode();
      const inset = maskable ? size * 0.15 : 0;
      ctx.drawImage(image, inset, inset, size - inset * 2, size - inset * 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size, maskable });
    await writeFile(`public/icons/${name}.png`, Buffer.from(data, 'base64'));
  }
} finally { await browser.close(); }
console.log('Install icons generated.');
