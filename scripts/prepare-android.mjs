import { cp, mkdir, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
const target = path.resolve('android/app/src/main/assets/web');
if (!target.startsWith(path.resolve() + path.sep) || JSON.parse(await readFile('package.json', 'utf8')).name !== 'study-task-assistant') throw new Error('Unexpected Android assets workspace');
await stat(path.resolve('dist/index.html'));
// Repeated local builds must not package obsolete hashed JavaScript chunks.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(path.resolve('dist'), target, { recursive: true });
// AAPT otherwise gunzips .gz assets and strips their suffix. Keep their exact
// bytes under .bin in the APK; the loopback asset handler maps the public URL.
async function protectArchives(dir) {
  for (const item of await readdir(dir, {withFileTypes:true})) {
    const file=path.join(dir,item.name);
    if(item.isDirectory()) await protectArchives(file);
    else if(item.name.endsWith('.gz')) await rename(file,file+'.bin');
  }
}
await protectArchives(target);
// Forward initialization failures from older Android WebViews to Tesseract's
// normal job rejection channel instead of leaving its ready promise pending.
const worker = path.join(target, 'ocr/worker.min.js');
const guard = `/* Shike Android modification: forward asynchronous worker initialization failures. */
let shikeJob;
self.addEventListener('message', event => { const p=event.data; if(p?.workerId && p?.jobId) shikeJob={workerId:p.workerId,jobId:p.jobId,action:p.action}; });
self.addEventListener('unhandledrejection', event => { if(shikeJob){self.postMessage({...shikeJob,status:'reject',data:String(event.reason?.message || event.reason || '本地识别引擎初始化失败')});event.preventDefault();} });
`;
await writeFile(worker, guard + await readFile(worker, 'utf8'));
const html = await readFile(path.join(target, 'index.html'), 'utf8');
if (/https?:\/\//.test(html)) throw new Error('The Android entry must contain only local assets');
console.log('Android assets prepared. OCR and speech models are bundled for offline use.');
