import { isNativeApp } from './native.js';
const base = new URL(import.meta.env.BASE_URL, document.baseURI);
export const appURL = file => new URL(file, base).href;
let resources;
const cachePrefix = `shike-${encodeURIComponent(base.pathname)}-`;
const cacheName = (kind, version) => `${cachePrefix}${kind}-${version}`;

async function resourceCache(kind, info) {
  const cache = await caches.open(cacheName(kind, info.version));
  // Preserve already-prepared resources when upgrading the original local preview.
  const legacy = `shike-${kind}-${info.version}`;
  if (await caches.has(legacy)) {
    const old = await caches.open(legacy);
    for (const file of info.files) {
      const url = appURL(`${kind}/${file}`);
      if (!(await cache.match(url, { ignoreVary: true }))) {
        const response = await old.match(url, { ignoreVary: true });
        if (response) await cache.put(url, response);
      }
    }
  }
  return cache;
}
async function persistIfAvailable() {
  try { await navigator.storage?.persist?.(); } catch { /* Optional storage hint must not invalidate a successful download. */ }
}

async function manifest() {
  if (!resources) {
    const response = await fetch(appURL('ocr/resources.json'));
    if (!response.ok) throw new Error('无法读取识别资源，请连接网络后重试。');
    resources = await response.json();
  }
  return resources;
}

export async function registerOffline() {
  if (isNativeApp()) return true;
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return false;
  if (import.meta.env.DEV) return false;
  await navigator.serviceWorker.register(appURL('sw.js'), { scope: base.pathname });
  let timer;
  try {
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('离线服务未能就绪，请重新打开页面，或换用支持 PWA 的浏览器。')), 12000); })]);
  } finally { clearTimeout(timer); }
  return true;
}

export async function offlineStatus() {
  if (isNativeApp()) { const info = await manifest(); return { ready: true, bytes: info.bytes }; }
  if (!('caches' in window)) return { ready: false, bytes: 0 };
  const info = await manifest();
  const cache = await resourceCache('ocr', info);
  const checks = await Promise.all(info.files.map(f => cache.match(appURL(`ocr/${f}`), { ignoreVary: true })));
  return { ready: checks.every(Boolean), bytes: info.bytes };
}

export async function prepareOffline(onProgress) {
  if (isNativeApp()) { const info = await manifest(); onProgress(1); return { bytes: info.bytes }; }
  if (!window.isSecureContext || !('caches' in window)) throw new Error('离线安装需要 HTTPS 安全地址。电脑本机可使用 localhost。');
  if (import.meta.env.DEV) throw new Error('当前是开发预览。请运行构建后的版本以准备完整离线功能。');
  await registerOffline();
  const info = await manifest();
  const name = cacheName('ocr', info.version);
  const cache = await resourceCache('ocr', info);
  let completed = 0;
  for (const file of info.files) {
    const url = appURL(`ocr/${file}`);
    if (!(await cache.match(url, { ignoreVary: true }))) {
      const response = await fetch(url);
      if (!response.ok) throw new Error('资源下载中断，请联网后重试，已下载的内容会保留。');
      await cache.put(url, response);
    }
    onProgress(++completed / info.files.length);
  }
  // Only discard older OCR versions after the new set is completely available.
  for (const key of await caches.keys()) if (key.startsWith(`${cachePrefix}ocr-`) && key !== name) await caches.delete(key);
  await persistIfAvailable();
  return { bytes: info.bytes };
}

let voiceResources;
async function voiceManifest() {
  if (!voiceResources) {
    const response = await fetch(appURL('voice/resources.json'));
    if (!response.ok) throw new Error('无法读取中文语音资源，请连接网络后重试。');
    voiceResources = await response.json();
  }
  return voiceResources;
}
export async function voiceOfflineStatus() {
  const info = await voiceManifest();
  if (isNativeApp()) return { ready: true, bytes: info.bytes };
  if (!('caches' in window)) return { ready: false, bytes: info.bytes };
  const cache = await resourceCache('voice', info);
  const resources = await Promise.all(info.files.map(f => cache.match(appURL(`voice/${f}`), { ignoreVary: true })));
  return { ready: resources.every(Boolean), bytes: info.bytes };
}
export async function prepareVoiceOffline(onProgress, signal) {
  if (isNativeApp()) { const info = await voiceManifest(); onProgress(1); return { ready: true, bytes: info.bytes }; }
  if (!window.isSecureContext || !('caches' in window)) throw new Error('语音输入需要 HTTPS 安全网址，电脑本机可用 localhost。');
  if (import.meta.env.DEV) throw new Error('完整离线语音请在构建后的版本中使用。');
  await registerOffline();
  const info = await voiceManifest();
  const name = cacheName('voice', info.version);
  const cache = await resourceCache('voice', info);
  let complete = 0;
  for (const file of info.files) {
    const url = appURL(`voice/${file}`);
    const cached = await cache.match(url, { ignoreVary: true });
    if (!cached) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('语音资源准备中断，请联网后重试。');
      const reader = response.body.getReader();
      const total = Number(response.headers.get('content-length')) || info.bytes;
      let received = 0;
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { controller.close(); return; }
            received += value.byteLength;
            onProgress((complete + Math.min(1, received / total)) / info.files.length);
            controller.enqueue(value);
          } catch (error) { controller.error(error); }
        },
        cancel(reason) { return reader.cancel(reason); },
      });
      await cache.put(url, new Response(body, { status: response.status, headers: response.headers }));
    }
    complete++; onProgress(complete / info.files.length);
  }
  for (const key of await caches.keys()) if (key.startsWith(`${cachePrefix}voice-`) && key !== name) await caches.delete(key);
  await persistIfAvailable();
  return { ready: true, bytes: info.bytes };
}
