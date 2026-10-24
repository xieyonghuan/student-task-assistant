import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const dest = path.join(root, 'public/ocr');
await mkdir(path.join(dest, 'core'), { recursive: true });
await mkdir(path.join(dest, 'lang'), { recursive: true });
const licenses = path.join(root, 'public/licenses');
await mkdir(licenses, { recursive: true });
await copyFile(path.join(root, 'node_modules/tesseract.js/LICENSE.md'), path.join(licenses, 'tesseract-js-Apache-2.0.txt'));
await copyFile(path.join(root, 'node_modules/tesseract.js-core/LICENSE'), path.join(licenses, 'tesseract-core-Apache-2.0.txt'));
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'), path.join(dest, 'worker.min.js.LICENSE.txt'));
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(dest, 'worker.min.js'));
const core = path.join(root, 'node_modules/tesseract.js-core');
for (const name of await readdir(core)) {
  if (/^tesseract-core.*\.(wasm|wasm\.js)$/.test(name)) await copyFile(path.join(core, name), path.join(dest, 'core', name));
}
for (const lang of ['chi_sim', 'eng']) {
  await copyFile(path.join(root, `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), path.join(dest, 'lang', `${lang}.traineddata.gz`));
}
const files = ['worker.min.js', ...(await readdir(path.join(dest, 'core'))).map(n => `core/${n}`), 'lang/chi_sim.traineddata.gz', 'lang/eng.traineddata.gz'];
const hash = createHash('sha256');
let bytes = 0;
for (const file of files) { const data = await readFile(path.join(dest, file)); hash.update(data); bytes += data.length; }
await writeFile(path.join(dest, 'resources.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 12), bytes, files }));
console.log(`Local OCR: ${files.length} resources, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
