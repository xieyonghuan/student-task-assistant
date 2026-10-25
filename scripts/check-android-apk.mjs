import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import assert from 'node:assert/strict';
const apk = new Uint8Array(await readFile(process.argv[2]));
const entries=unzipSync(apk,{filter:entry=>entry.name.startsWith('assets/web/')});
const digest=data=>createHash('sha256').update(data).digest('hex');
let count=0;
for(const kind of ['ocr','voice']) {
  const info=JSON.parse(await readFile(`dist/${kind}/resources.json`,'utf8'));
  for(const file of info.files){
    const physical=`${kind}/${file}${file.endsWith('.gz')?'.bin':''}`;
    const data=entries[`assets/web/${physical}`];
    assert.ok(data?.length,`Packaged resource missing: ${physical}`);
    assert.equal(digest(data),digest(await readFile(`android/app/src/main/assets/web/${physical}`)),`Resource changed by Android packaging: ${physical}`);
    if(file.endsWith('.gz'))assert.deepEqual([...data.subarray(0,2)],[31,139],'Archive must retain its gzip header');
    count++;
  }
}
assert.ok(entries['assets/web/index.html']);
assert.ok(!Object.keys(entries).some(name=>/\.(?:ics|p12|jks|keystore|log)$/.test(name)),'Private/runtime data in APK');
console.log(`Android APK checked: ${count} exact model/runtime files and the app entry; gzip bytes intact.`);
