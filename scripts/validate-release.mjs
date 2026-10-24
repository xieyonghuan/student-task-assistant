import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('dist');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, './'); assert.equal(manifest.start_url, './');
assert.equal(manifest.orientation, 'any');
for (const item of manifest.icons) {
  const data = await readFile(path.join(root, item.src));
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
  assert.equal(`${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`, item.sizes);
}
let total = 0;
async function check(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    assert.ok(!/(?:^|\/)(?:\.git|\.env|node_modules|private|local-data|tests|work)(?:\/|$)/.test(name), `Private/source artifact in release: ${name}`);
    if (entry.isDirectory()) await check(path.join(dir, entry.name), `${name}/`);
    else {
      assert.ok(!/\.(?:ics|wav|mp3|log|map)$/i.test(name), `Runtime/test data in release: ${name}`);
      const size = (await stat(path.join(dir, entry.name))).size;
      assert.ok(size < 100 * 1024 * 1024, `File exceeds GitHub file limit: ${name}`);
      total += size;
    }
  }
}
await check(root);
assert.ok(total < 1024 ** 3, 'Static site exceeds GitHub Pages size limit');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert.ok(!/(?:src|href)="\/[^/]/.test(html), 'Root-only asset path would break the repository URL');
for (const kind of ['ocr', 'voice']) {
  const info = JSON.parse(await readFile(path.join(root, kind, 'resources.json'), 'utf8'));
  for (const file of info.files) assert.ok((await stat(path.join(root, kind, file))).size > 0, `Missing ${kind} asset: ${file}`);
}
const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
assert.ok(sw.includes('encodeURIComponent(BASE.pathname)'), 'Service worker caches must be scoped to this app path');
console.log(`Release checks passed: ${(total / 1024 / 1024).toFixed(1)} MB; install icons, relative URLs, local models and data exclusions verified.`);
