import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const target = path.resolve('android/app/src/main/assets/web');
await mkdir(target, { recursive: true });
await cp(path.resolve('dist'), target, { recursive: true });
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
