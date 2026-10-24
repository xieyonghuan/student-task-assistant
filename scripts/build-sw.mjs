import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

async function walk(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) result.push(...await walk(path.join(dir, entry.name), `${relative}/`));
    else if (relative !== 'sw.js' && !relative.startsWith('ocr/') && !relative.startsWith('voice/')) result.push(relative);
  }
  return result;
}
const files = await walk('dist');
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(path.join('dist', file)));
const version = hash.digest('hex').slice(0, 12);
const resource = JSON.parse(await readFile('dist/ocr/resources.json', 'utf8'));
const voice = JSON.parse(await readFile('dist/voice/resources.json', 'utf8'));
const source = `
const BASE = new URL('./', self.location.href);
const PREFIX = 'shike-' + encodeURIComponent(BASE.pathname) + '-';
const SHELL = PREFIX + 'shell-${version}';
const OCR = PREFIX + 'ocr-${resource.version}';
const VOICE = PREFIX + 'voice-${voice.version}';
const SHELL_FILES = ${JSON.stringify([...files, 'ocr/resources.json', 'voice/resources.json'])};
const local = file => new URL(file, BASE).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(SHELL_FILES.map(local))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX + 'shell-') && name !== SHELL) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== BASE.origin) return;
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(BASE.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try { const response = await fetch(event.request); if (response.ok) return response; } catch {}
      return (await caches.open(SHELL)).match(local('index.html'), { ignoreVary: true });
    })());
    return;
  }
  const isOCR = url.pathname.startsWith(new URL('ocr/', BASE).pathname) && !url.pathname.endsWith('resources.json');
  const isVoice = url.pathname.startsWith(new URL('voice/', BASE).pathname) && !url.pathname.endsWith('resources.json');
  event.respondWith((async () => {
    const cache = await caches.open(isOCR ? OCR : isVoice ? VOICE : SHELL);
    return (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request);
  })());
});
`;
await writeFile('dist/sw.js', source);
console.log(`Service worker: ${files.length} shell files + separately prepared local OCR and voice resources`);
