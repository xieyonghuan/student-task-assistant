import { downloadModel } from './download-voice.mjs';
import fs from 'node:fs';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';

const URL_MODEL = 'https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip?download=1';
const cacheDir = path.resolve('node_modules/.cache/study-voice');
const dest = path.resolve('public/voice');
const archive = path.join(cacheDir, 'vosk-model-small-cn-0.22.zip');
const packed = path.join(cacheDir, 'cn-small-0.22-ustar2.tar.gz');
await mkdir(cacheDir, { recursive: true });
await mkdir(dest, { recursive: true });

if (!fs.existsSync(archive)) await downloadModel(URL_MODEL, archive);
const zip = await readFile(archive);
const sourceSHA256 = createHash('sha256').update(zip).digest('hex');
// The archive is pinned by SHA-256 after the initial official download.
const expectedSHA256 = '3af8b0e7e0f835ae9d414ce5df580237a3cfb08d586c9fbbb0f7ff29ad5b14ba';
if (expectedSHA256 && sourceSHA256 !== expectedSHA256) throw new Error('Chinese voice model checksum mismatch');
if (!fs.existsSync(packed)) {
  const entries = unzipSync(zip);
  const blocks = [];
  const directories = new Set();
  function directoryHeader(name) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    for (const [number, start, length] of [[0o755, 100, 8], [0, 108, 8], [0, 116, 8], [0, 124, 12], [0, 136, 12]]) header.write(number.toString(8).padStart(length - 1, '0') + '\0', start, length, 'ascii');
    header.fill(32, 148, 156); header.write('5', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    return header;
  }
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const relative = name.replace(/^vosk-model-small-cn-0\.22\//, 'model/');
    if (!relative.startsWith('model/') || relative.includes('..') || Buffer.byteLength(relative) > 99) throw new Error('Unexpected model archive path');
    const parents = relative.split('/').slice(0, -1);
    for (let i = 1; i <= parents.length; i++) {
      const directory = parents.slice(0, i).join('/') + '/';
      if (!directories.has(directory)) { blocks.push(directoryHeader(directory)); directories.add(directory); }
    }
    const header = Buffer.alloc(512);
    header.write(relative, 0, 100, 'utf8');
    const octal = (number, start, length) => header.write(number.toString(8).padStart(length - 1, '0') + '\0', start, length, 'ascii');
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, Buffer.from(bytes), Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  await writeFile(packed, gzipSync(Buffer.concat(blocks), { level: 6 }));
}
await copyFile(packed, path.join(dest, 'cn-small-0.22.tar.gz'));
const bundled = await readFile('node_modules/vosk-browser/dist/vosk.js', 'utf8');
const workerMatch = bundled.match(/var WorkerFactory = createBase64WorkerFactory\('([^']+)', null, false\);/);
if (!workerMatch) throw new Error('Unexpected pinned Vosk worker format');
let workerSource = Buffer.from(workerMatch[1], 'base64').toString('utf8');
for (const statement of ['this.Vosk.FS.mount(this.Vosk.IDBFS, {}, storagePath);', 'return this.Vosk.syncFilesystem(true);', 'return this.Vosk.syncFilesystem(false);']) {
  if (!workerSource.includes(statement)) throw new Error('Unexpected pinned filesystem format');
}
// CacheStorage already holds the verified archive. Keep unpacked models in worker
// memory instead of maintaining a second, incompatible legacy IDBFS copy.
workerSource = workerSource.replace('this.Vosk.FS.mount(this.Vosk.IDBFS, {}, storagePath);', '/* Persistent model archive is managed by Shike CacheStorage. */')
  .replace('return this.Vosk.syncFilesystem(true);', 'return Promise.resolve();')
  .replace('return this.Vosk.syncFilesystem(false);', 'return Promise.resolve();')
  .replaceAll('error: error.message', 'error: error.message || String(error)');
if (!workerSource.includes('result: JSON.parse(finalResult),')) throw new Error('Unexpected pinned final-result format');
// Mark only explicit final results so stopping never drops the final spoken phrase.
await writeFile(path.join(dest, 'recognizer-worker.js'), '/* Shike modification: extracted local worker and explicit final-result acknowledgement. */\n' + workerSource.replace('result: JSON.parse(finalResult),', 'result: JSON.parse(finalResult), shikeFinal: true,'));
const workerFactory = `var WorkerFactory = (() => { const base = new URL('.', document.currentScript.src); return function(options) { return new Worker(new URL('recognizer-worker.js', base), options); }; })();`;
await writeFile(path.join(dest, 'vosk.js'), bundled.replace(workerMatch[0], workerFactory));
const files = ['vosk.js', 'recognizer-worker.js', 'cn-small-0.22.tar.gz'];
const hash = createHash('sha256');
let bytes = 0;
for (const file of files) { const data = await readFile(path.join(dest, file)); hash.update(data); bytes += data.length; }
await writeFile(path.join(dest, 'resources.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 12), bytes, files, source: URL_MODEL, sourceSHA256 }));
console.log(`Local voice: ${(bytes / 1024 / 1024).toFixed(1)} MB; model SHA256 ${sourceSHA256}`);
