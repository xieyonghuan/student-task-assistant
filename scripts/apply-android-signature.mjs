import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = data => createHash('sha256').update(data).digest('hex');
export function applySignature(base, patch) {
  if (patch.format !== 'shike-apk-signature-v2' || hash(base) !== patch.baseSHA256) throw new Error('Unsigned APK does not match the reviewed build');
  if (!Array.isArray(patch.operations) || patch.operations.length>10000 || !Number.isSafeInteger(patch.bytes) || patch.bytes>200*1024*1024) throw new Error('Invalid signature patch');
  let literals=0, size=0;
  const pieces=patch.operations.map(operation=>{
    let data;
    if(operation.copy){
      const [start,length]=operation.copy;
      if(![start,length].every(Number.isSafeInteger)||start<0||length<0||start+length>base.length)throw new Error('Invalid APK copy range');
      data=base.subarray(start,start+length);
    }else if(typeof operation.data==='string'){
      literals+=operation.data.length;if(literals>2000000)throw new Error('Unexpected APK rewrite');
      data=Buffer.from(operation.data,'base64');
    }else throw new Error('Invalid signature operation');
    size+=data.length;if(size>patch.bytes)throw new Error('Signed APK size exceeds manifest');
    return data;
  });
  const data = Buffer.concat(pieces);
  if (data.length !== patch.bytes || hash(data) !== patch.signedSHA256) throw new Error('Signed APK integrity check failed');
  return data;
}
if (process.argv[1]?.endsWith('apply-android-signature.mjs')) {
  const patch = JSON.parse(await readFile('android/release/signature.json', 'utf8'));
  await writeFile(process.argv[3], applySignature(await readFile(process.argv[2]), patch));
  console.log(`Signed APK reconstructed and SHA-256 verified: ${patch.signedSHA256}`);
}
