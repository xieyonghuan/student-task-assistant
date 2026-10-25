import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const target = path.resolve('android/app/src/main/assets/web');
await mkdir(target, { recursive: true });
await cp(path.resolve('dist'), target, { recursive: true });
const html = await readFile(path.join(target, 'index.html'), 'utf8');
if (/https?:\/\//.test(html)) throw new Error('The Android entry must contain only local assets');
console.log('Android assets prepared. OCR and speech models are bundled for offline use.');
