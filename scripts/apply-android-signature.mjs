import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = data => createHash('sha256').update(data).digest('hex');
export function applySignature(base, patch) {
  if (patch.format !== 'shike-apk-signature-v1' || hash(base) !== patch.baseSHA256) throw new Error('Unsigned APK does not match the reviewed build');
  const {prefix, suffix} = patch;
  if (![prefix, suffix].every(Number.isSafeInteger) || prefix < 0 || suffix < 0 || prefix + suffix > base.length || patch.middle.length > 400000) throw new Error('Invalid signature patch');
  const data = Buffer.concat([base.subarray(0, prefix), Buffer.from(patch.middle, 'base64'), base.subarray(base.length - suffix)]);
  if (data.length !== patch.bytes || hash(data) !== patch.signedSHA256) throw new Error('Signed APK integrity check failed');
  return data;
}
if (process.argv[1]?.endsWith('apply-android-signature.mjs')) {
  const patch = JSON.parse(await readFile('android/release/signature.json', 'utf8'));
  await writeFile(process.argv[3], applySignature(await readFile(process.argv[2]), patch));
  console.log(`Signed APK reconstructed and SHA-256 verified: ${patch.signedSHA256}`);
}
