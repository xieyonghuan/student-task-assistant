import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mount = process.env.APP_BASE_PATH || '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(mount)) throw new Error('APP_BASE_PATH must be a slash-delimited static site path');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/octet-stream' };
try { await stat(path.join(root, 'index.html')); }
catch { console.error('找不到构建文件。请先执行 npm install 和 npm run build。'); process.exit(1); }
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (mount !== '/' && url.pathname === mount.slice(0, -1)) { response.writeHead(302, { Location: mount }); response.end(); return; }
    if (!url.pathname.startsWith(mount)) { response.writeHead(404); response.end(); return; }
    const relative = decodeURIComponent(url.pathname.slice(mount.length)) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root) || relative.includes('\\') || relative.includes('\0')) { response.writeHead(403); response.end(); return; }
    const data = await readFile(file);
    const workerHeaders = relative === 'voice/recognizer-worker.js' ? {
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self' data:; worker-src 'none'",
    } : {};
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Service-Worker-Allowed': mount,
      ...workerHeaders,
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('找不到此文件'); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被使用。请检查是否已打开拾课，或关闭之前的预览窗口。` : error.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}${mount}`;
  console.log(`\n拾课 · 学习任务助手\n\n请打开：${url}\n保留此窗口，关闭窗口即可停止预览。\n`);
  if (process.argv.includes('--open') && process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
});
